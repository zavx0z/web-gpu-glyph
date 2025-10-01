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

// -------------------- Font & layout --------------------
const font = await TrueTypeFont.fromUrl("JetBrainsMono-Bold.ttf")

const fontSizePx = 96
const letterSpacingPx = 6
const lineGapPx = Math.round(fontSizePx * 1.35) // межстрочный

const startX = 60
const startY = 160

const lines = ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"]

// -------- on-curve полилинии (только прямые) --------
function outlineToOnCurvePolyline(o: { points: Float32Array; onCurve: Uint8Array; contours: Uint16Array }): {
  points: Float32Array
  contours: Uint32Array
} {
  const P = o.points,
    ON = o.onCurve,
    ends = o.contours
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
    if (added >= 2) outEnds.push(outPts.length / 2 - 1)
    else outPts.length = base
    start = end + 1
  }
  return { points: new Float32Array(outPts), contours: new Uint32Array(outEnds) }
}

// Индексы для LINE_LIST с замыканием контуров
function makeLineListIndices(contourEnds: Uint32Array): Uint32Array {
  const idx: number[] = []
  let start = 0
  for (let c = 0; c < contourEnds.length; c++) {
    const end = contourEnds[c]!
    for (let i = start; i < end; i++) idx.push(i, i + 1)
    idx.push(end, start) // замыкание
    start = end + 1
  }
  return new Uint32Array(idx)
}

// Кэш мешей глифов
type GlyphMesh = {
  pointBuffer: GPUBuffer
  indexBuffer: GPUBuffer
  indicesCount: number
  advanceWidthFU: number // advance в font-units
}
const glyphCache = new Map<number, GlyphMesh>()

function getGlyphMesh(gid: number): GlyphMesh | null {
  const cached = glyphCache.get(gid)
  if (cached !== undefined) return cached

  const outline = font.getGlyphOutline(gid)
  const poly = outlineToOnCurvePolyline(outline)
  if (poly.points.length === 0 || poly.contours.length === 0) {
    glyphCache.set(gid, null as unknown as GlyphMesh)
    return null
  }

  const indices = makeLineListIndices(poly.contours)

  const pointBuffer = device.createBuffer({
    label: `glyph${gid}-points`,
    size: poly.points.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(
    pointBuffer,
    0,
    poly.points.buffer as ArrayBuffer,
    poly.points.byteOffset,
    poly.points.byteLength
  )

  const indexBuffer = device.createBuffer({
    label: `glyph${gid}-indices`,
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(indexBuffer, 0, indices.buffer as ArrayBuffer, indices.byteOffset, indices.byteLength)

  const { advanceWidth } = font.getHMetric(gid)
  const mesh: GlyphMesh = {
    pointBuffer,
    indexBuffer,
    indicesCount: indices.length,
    advanceWidthFU: advanceWidth,
  }
  glyphCache.set(gid, mesh)
  return mesh
}

// -------------------- Pipeline --------------------
const shaderCode = await (await fetch("./text.wgsl")).text()
const shader = device.createShaderModule({ label: "text", code: shaderCode })

const pipeline = device.createRenderPipeline({
  label: "Glyph wireframe (line-list)",
  layout: "auto",
  vertex: {
    module: shader,
    entryPoint: "vs_point",
    buffers: [{ arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }],
  },
  fragment: { module: shader, entryPoint: "fs_point", targets: [{ format }] },
  primitive: { topology: "line-list" },
})

// -------------------- Render --------------------
function render() {
  const dpr = window.devicePixelRatio || 1
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr))
  canvas.width = W
  canvas.height = H

  const scale = fontSizePx / font.unitsPerEm // FU -> px

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

  let penY = startY
  for (const line of lines) {
    let penX = startX
    for (const ch of line) {
      const cp = ch.codePointAt(0)!
      const gid = font.mapCharToGlyph(cp)
      const mesh = getGlyphMesh(gid)
      const { advanceWidth } = font.getHMetric(gid)

      if (mesh) {
        // Создаем отдельный uniform buffer для каждого глифа
        const glyphParams = new Float32Array([font.unitsPerEm, fontSizePx, penX, penY, W, H, 0, 0])
        const glyphUniformBuf = device.createBuffer({
          label: "glyph-params",
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        device.queue.writeBuffer(glyphUniformBuf, 0, glyphParams)

        const glyphBindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: glyphUniformBuf } }],
        })

        pass.setBindGroup(0, glyphBindGroup)
        pass.setVertexBuffer(0, mesh.pointBuffer)
        pass.setIndexBuffer(mesh.indexBuffer, "uint32")
        pass.drawIndexed(mesh.indicesCount)
      }

      // <<< ШАГ ПЕРА: advance в PX
      penX += advanceWidth * scale + letterSpacingPx
    }
    penY += lineGapPx
  }

  pass.end()
  device.queue.submit([encoder.finish()])
}

new ResizeObserver(render).observe(canvas)
render()
