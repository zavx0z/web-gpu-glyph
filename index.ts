import { TrueTypeFont } from "./TrueTypeFont"

// -------------------- WebGPU init --------------------
const adapter = await navigator.gpu.requestAdapter()
if (!adapter) throw new Error("WebGPU адаптер не найден")
const device = await adapter.requestDevice()

const format = navigator.gpu.getPreferredCanvasFormat()
const canvas = document.getElementById("canvas") as HTMLCanvasElement
const context = canvas.getContext("webgpu")
if (!context) throw new Error("WebGPU не поддерживается")
context.configure({ device, format })

// -------------------- Font & glyph --------------------
const font = await TrueTypeFont.fromUrl("JetBrainsMono-Bold.ttf")
const param = { size: 128, x: 150, y: 220 }

const gid = font.mapCharToGlyph("K".codePointAt(0)!)
const outline = font.getGlyphOutline(gid)

// -------- on-curve полилинии (только прямые) --------
function outlineToOnCurvePolyline(o: { points: Float32Array; onCurve: Uint8Array; contours: Uint16Array }): {
  points: Float32Array
  contours: Uint32Array
} {
  const P = o.points
  const ON = o.onCurve
  const ends = o.contours

  const outPts: number[] = []
  const outEnds: number[] = []

  let start = 0
  for (let ci = 0; ci < ends.length; ci++) {
    const end = ends[ci]!
    const base = outPts.length

    for (let i = start; i <= end; i++) {
      if (ON[i] !== 0) {
        const j = i * 2
        outPts.push(P[j]!, P[j + 1]!)
      }
    }

    const added = (outPts.length - base) / 2
    if (added >= 2) {
      outEnds.push(outPts.length / 2 - 1) // индекс последней вершины этого контура
    } else {
      // если точек < 2 — откатываем (рисовать нечего)
      outPts.length = base
    }
    start = end + 1
  }

  return { points: new Float32Array(outPts), contours: new Uint32Array(outEnds) }
}

const poly = outlineToOnCurvePolyline(outline)

// -------------------- GPU buffers --------------------
const pointBuffer = device.createBuffer({
  label: "points-oncurve",
  size: poly.points.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
})
device.queue.writeBuffer(pointBuffer, 0, poly.points)

// пары индексов для LINE_LIST, с замыканием внутри каждого контура
function makeLineListIndices(contourEnds: Uint32Array): Uint32Array {
  const idx: number[] = []
  let start = 0
  for (let c = 0; c < contourEnds.length; c++) {
    const end = contourEnds[c]!
    // последовательные рёбра
    for (let i = start; i < end; i++) {
      idx.push(i, i + 1)
    }
    // замыкание последняя -> первая
    idx.push(end, start)
    start = end + 1
  }
  return new Uint32Array(idx)
}
const indices = makeLineListIndices(poly.contours)

const indexBuffer = device.createBuffer({
  label: "indices-oncurve-linelist",
  size: indices.byteLength,
  usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
})
device.queue.writeBuffer(indexBuffer, 0, indices)

// -------------------- UBO --------------------
const uniformBuf = device.createBuffer({
  label: "params",
  size: 32, // 8 * f32
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})

// -------------------- Pipeline --------------------
const shaderCode = await (await fetch("./text.wgsl")).text()
const shader = device.createShaderModule({ label: "text", code: shaderCode })

const pipeline = device.createRenderPipeline({
  label: "Polyline (line-list) pipeline",
  layout: "auto",
  vertex: {
    module: shader,
    entryPoint: "vs_point",
    buffers: [{ arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }],
  },
  fragment: { module: shader, entryPoint: "fs_point", targets: [{ format }] },
  primitive: {
    topology: "line-list", // <<< вместо line-strip
  },
})

const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
})

// -------------------- Render --------------------
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
  pass.setIndexBuffer(indexBuffer, "uint32")
  pass.drawIndexed(indices.length)
  pass.end()

  device.queue.submit([encoder.finish()])
}

new ResizeObserver(render).observe(canvas)
render()
