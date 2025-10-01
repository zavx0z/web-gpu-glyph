import { parseFont, readLocaTable } from "./text/fontReader.js"
import { readGlyphData } from "./text/glyfReader.js"
import { fetchBinaryData } from "./text/loader.js"

const adapter = await navigator.gpu.requestAdapter()
if (!adapter) throw new Error("WebGPU адаптер не найден")
const device = await adapter.requestDevice()

const format = navigator.gpu.getPreferredCanvasFormat()
const canvas = document.getElementById("canvas") as HTMLCanvasElement
const context = canvas.getContext("webgpu")
if (!context) throw new Error("WebGPU не поддерживается")
context.configure({ device, format })

// Загружаем шрифт и извлекаем точки
const fontBuffer = await fetchBinaryData("JetBrainsMono-Bold.ttf")
const data = parseFont(fontBuffer)
const locaTable = readLocaTable(fontBuffer, data.get("loca")!)
const glyfTable = data.get("glyf")!
const glyphData = readGlyphData(fontBuffer, glyfTable)

// Делаем Float32Array из точек (x_fu, y_fu)
const points = new Float32Array(glyphData.flat())

// Буфер точек
const pointBuffer = device.createBuffer({
  label: "point buffer",
  size: points.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
})

// uniform: unitsPerEm, fontSizePx, originPx, canvasWH
// Читай unitsPerEm из таблицы head
function readUnitsPerEm(font: Uint8Array, headOffset: number) {
  // unitsPerEm в head на смещении 18 байт (0x12)
  const offset = headOffset + 18
  const hi = font[offset]!
  const lo = font[offset + 1]!
  return (hi << 8) | lo
}

const headInfo = data.get("head")
if (!headInfo) throw new Error("head table not found")
const unitsPerEm = readUnitsPerEm(new Uint8Array(fontBuffer), headInfo.offset)
console.log("unitsPerEm:", unitsPerEm)

const fontSizePx = 64
// позиция базовой точки глифа (в пикселях от верхнего левого угла канвы)
let originPx = { x: 100, y: 100 }

// делаем буфер с выравниванием до 16 байт
const uniformBuf = device.createBuffer({
  label: "params",
  size: 32, // 4 f32 = 16 байт, здесь 6 f32 → округляем до 32
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})

// создаём пайплайн
const shaderCode = await (await fetch("./text.wgsl")).text()
const shader = device.createShaderModule({ code: shaderCode })

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

// создаём bind group
const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
})

function render() {
  // обновляем буферы
  device.queue.writeBuffer(pointBuffer, 0, points)

  const dpr = window.devicePixelRatio || 1
  const W = Math.round(canvas.clientWidth * dpr)
  const H = Math.round(canvas.clientHeight * dpr)
  const params = new Float32Array([unitsPerEm, fontSizePx, originPx.x, originPx.y, W, H, 0, 0])
  device.queue.writeBuffer(uniformBuf, 0, params)

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

// следим за размером канвы
const resize = () => {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(canvas.clientWidth * dpr)
  canvas.height = Math.round(canvas.clientHeight * dpr)
  render()
}
new ResizeObserver(resize).observe(canvas)
resize()
