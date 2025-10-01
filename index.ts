import { TrueTypeFont } from "./TrueTypeFont"

// --- WebGPU init ---
const adapter = await navigator.gpu.requestAdapter()
if (!adapter) throw new Error("WebGPU адаптер не найден")
const device = await adapter.requestDevice()

const format = navigator.gpu.getPreferredCanvasFormat()
const canvas = document.getElementById("canvas") as HTMLCanvasElement
const context = canvas.getContext("webgpu")
if (!context) throw new Error("WebGPU не поддерживается")
context.configure({ device, format })

// --- Font & glyph ---
const font = await TrueTypeFont.fromUrl("JetBrainsMono-Bold.ttf")
const param = {
  size: 128,
  x: 150,
  y: 220,
}
// Выбираем символ
const gid = font.mapCharToGlyph("❤️".codePointAt(0)!)
const outline = font.getGlyphOutline(gid)
const points = outline.points // Float32Array [x,y,...]

if (points.length === 0) {
  console.warn("Глиф пустой (simple=0 или compound без компонентов) — ничего не нарисуем")
}

// --- GPU buffers ---
const pointBuffer = device.createBuffer({
  label: "points",
  size: points.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
})
// Пишем ОДИН раз (точки статичны)
device.queue.writeBuffer(pointBuffer, 0, points.buffer, points.byteOffset, points.byteLength)

// UBO: unitsPerEm, fontSizePx, originPx(x,y), canvasWH(W,H)
const uniformBuf = device.createBuffer({
  label: "params",
  size: 32, // 8 * f32 (выравнивание)
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})

// --- Pipeline ---
const shaderCode = await (await fetch("./text.wgsl")).text()
const shader = device.createShaderModule({ label: "text", code: shaderCode })

const pipeline = device.createRenderPipeline({
  label: "Point pipeline",
  layout: "auto",
  vertex: {
    module: shader,
    entryPoint: "vs_point",
    buffers: [{ arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }],
  },
  fragment: { module: shader, entryPoint: "fs_point", targets: [{ format }] },
  primitive: { topology: "point-list" },
})

const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
})

function render() {
  const dpr = window.devicePixelRatio || 1
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr))
  canvas.width = W
  canvas.height = H

  const params = new Float32Array([font.unitsPerEm, param.size, param.x, param.y, W, H, 0, 0])
  device.queue.writeBuffer(uniformBuf, 0, params.buffer as ArrayBuffer, params.byteOffset, params.byteLength)

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context!.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  })

  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.setVertexBuffer(0, pointBuffer)
  pass.draw(points.length / 2)
  pass.end()

  device.queue.submit([encoder.finish()])
}

new ResizeObserver(render).observe(canvas)
render()
