const adapter = await navigator.gpu.requestAdapter()
if (!adapter) throw new Error("WebGPU адаптер не найден")
const device = await adapter.requestDevice()
// canvas
const format = navigator.gpu.getPreferredCanvasFormat()
const canvas = document.getElementById("canvas") as HTMLCanvasElement
// Контекст
const context = canvas.getContext("webgpu")
if (!context) throw new Error("WebGPU не поддерживается")
context.configure({ device, format })
// Шейдеры
const point = await (await fetch("./point.wgsl")).text()
const shader = device.createShaderModule({ label: "point", code: point })
// Pipeline'ы
const haloPipeline = device.createRenderPipeline({
  label: "Halo pipeline",
  layout: "auto",
  vertex: { module: shader, entryPoint: "vs_full" },
  fragment: {
    module: shader,
    entryPoint: "fs_halo",
    targets: [
      {
        format,
        blend: {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      },
    ],
  },
  primitive: { topology: "triangle-list" },
})
const pointPipeline = device.createRenderPipeline({
  label: "Point pipeline",
  layout: "auto",
  vertex: { module: shader, entryPoint: "vs_point" },
  fragment: { module: shader, entryPoint: "fs_point", targets: [{ format }] },
  primitive: { topology: "point-list" },
})

// Uniforms: [mouse.x, mouse.y, radius, halo, resolution.x, resolution.y, hover, 0]
const uniformValues = new Float32Array(8)
const uniformBuffer = device.createBuffer({
  size: uniformValues.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})
const bindGroup = device.createBindGroup({
  layout: haloPipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
})

function updateUniforms() {
  const rect = canvas.getBoundingClientRect()
  // default sizes (in NDC units)
  if (uniformValues[2] === 0) uniformValues[2] = 0.015 // radius
  if (uniformValues[3] === 0) uniformValues[3] = 0.035 // halo
  // resolution (pixels)
  uniformValues[4] = rect.width
  uniformValues[5] = rect.height
  device.queue.writeBuffer(uniformBuffer, 0, uniformValues)
}

// mouse handling → NDC coords
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height
  // to NDC (-1..1), flip Y
  uniformValues[0] = x * 2 - 1
  uniformValues[1] = -(y * 2 - 1)
  // hover on только если курсор над центром точки (1 пиксель)
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const dx = Math.abs(e.clientX - cx)
  const dy = Math.abs(e.clientY - cy)
  uniformValues[6] = dx <= 1 && dy <= 1 ? 1 : 0
  updateUniforms()
  render()
})

canvas.addEventListener("mouseleave", () => {
  uniformValues[6] = 0
  updateUniforms()
  render()
})

// Функция рендеринга
function render() {
  updateUniforms()
  // создаем кодировщик команд для начала кодирования команд
  const encoder = device.createCommandEncoder({ label: "encoder command" })
  // создаем кодировщик прохода рендеринга для кодирования определенных команд рендеринга
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        // Получить текущую текстуру из контекста холста и устанавливаем его как текстуру для рендеринга.
        view: context!.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, // Черный фон
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  })

  // point
  pass.setPipeline(pointPipeline)
  pass.draw(1)

  // halo
  pass.setPipeline(haloPipeline)
  pass.setBindGroup(0, bindGroup)
  pass.draw(3)

  pass.end()

  const commandBuffer = encoder.finish()
  device.queue.submit([commandBuffer])
}
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const canvas = entry.target as HTMLCanvasElement
    const width = entry.contentBoxSize[0]!.inlineSize
    const height = entry.contentBoxSize[0]!.blockSize
    canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D))
    canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D))
    // re-render
    render()
  }
})
observer.observe(canvas)
