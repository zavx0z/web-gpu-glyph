import point from "./point.wgsl" with {type: "text"}

const canvas = document.getElementById("canvas") as HTMLCanvasElement
const context = canvas.getContext("webgpu")
if (!context) throw new Error("WebGPU не поддерживается")

// Инициализация WebGPU
const adapter = await navigator.gpu.requestAdapter()
if (!adapter) throw new Error("WebGPU адаптер не найден")

const device = await adapter.requestDevice()

// Настройка canvas
const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format })

const shader = device.createShaderModule({ label: "point", code: point })
// Создание pipeline
const pipeline = device.createRenderPipeline({
  label: "Point pipeline",
  layout: "auto",
  vertex: { module: shader, entryPoint: "vs_main" },
  fragment: { module: shader, entryPoint: "fs_main", targets: [{ format }] },
  primitive: {
    topology: "point-list",
  },
})

// Функция рендеринга
function render() {
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context!.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, // Черный фон
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  })

  pass.setPipeline(pipeline)
  pass.draw(1) // Рисуем одну точку
  pass.end()

  device.queue.submit([encoder.finish()])
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
