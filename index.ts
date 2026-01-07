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

function outlineToPolylineTTF(
  o: { points: Float32Array; onCurve: Uint8Array; contours: Uint16Array },
  curveSteps = 8
): { points: Float32Array; contours: Uint32Array } {
  const P = o.points
  const ON = o.onCurve
  const ends = o.contours

  const outPts: number[] = []
  const outEnds: number[] = []

  let start = 0

  for (let ci = 0; ci < ends.length; ci++) {
    const end = ends[ci]
    const contourStartIndex = outPts.length / 2

    const count = end - start + 1

    // циклический доступ
    const get = (i: number) => {
      const idx = start + ((i + count) % count)
      return {
        x: P[idx * 2],
        y: P[idx * 2 + 1],
        on: ON[idx] !== 0,
      }
    }

    let prev = get(0)
    let curr: any

    // если первый off-curve — implicit start
    if (!prev.on) {
      const last = get(count - 1)
      if (last.on) {
        prev = { ...last }
      } else {
        prev = {
          x: (last.x + prev.x) * 0.5,
          y: (last.y + prev.y) * 0.5,
          on: true,
        }
      }
      outPts.push(prev.x, prev.y)
    } else {
      outPts.push(prev.x, prev.y)
    }

    for (let i = 1; i <= count; i++) {
      curr = get(i)

      if (prev.on && curr.on) {
        // line
        outPts.push(curr.x, curr.y)
        prev = curr
      } else if (prev.on && !curr.on) {
        // wait for next
        const next = get(i + 1)

        let endPt
        if (next.on) {
          endPt = next
          i++
        } else {
          endPt = {
            x: (curr.x + next.x) * 0.5,
            y: (curr.y + next.y) * 0.5,
            on: true,
          }
        }

        quadBezier(
          [prev.x, prev.y],
          [curr.x, curr.y],
          [endPt.x, endPt.y],
          curveSteps,
          outPts
        )

        prev = endPt
      }
    }

    const added = outPts.length / 2 - contourStartIndex
    if (added >= 2) outEnds.push(outPts.length / 2 - 1)
    start = end + 1
  }

  return {
    points: new Float32Array(outPts),
    contours: new Uint32Array(outEnds),
  }
}
function quadBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  steps: number,
  out: number[]
) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
    const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
    out.push(x, y)
  }
}
/**
 * Создает индексы для LINE_LIST с замыканием контуров
 * @param contourEnds - массив индексов последних вершин каждого контура
 * @returns массив пар индексов [i, i+1] с дополнительными парами [end, start] для замыкания
 */
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

/**
 * Структура данных для кэшированного меша глифа
 */
type GlyphMesh = {
  /** GPU буфер с координатами вершин */
  pointBuffer: GPUBuffer
  /** GPU буфер с индексами для LINE_LIST */
  indexBuffer: GPUBuffer
  /** Количество индексов в indexBuffer */
  indicesCount: number
  /** Ширина advance глифа в font-units */
  advanceWidthFU: number
}
const glyphCache = new Map<number, GlyphMesh>()

/**
 * Создает (и кэширует) меш для глифа по его glyphId
 * 1) Берем outline глифа, фильтруем только on-curve точки
 * 2) Строим index buffer с замыканием контуров под topology: line-list
 * 3) Кладем результат в кэш, чтобы не пересоздавать буферы каждый кадр
 * @param gid - идентификатор глифа
 * @returns кэшированный меш глифа или null если глиф пустой
 */
function getGlyphMesh(gid: number): GlyphMesh | null {
  const cached = glyphCache.get(gid)
  if (cached !== undefined) return cached

  const outline = font.getGlyphOutline(gid)
  const poly = outlineToPolylineTTF(outline, 10)
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
  // пишем данные вершин сразу после создания буфера
  device.queue.writeBuffer(pointBuffer, 0, poly.points.buffer, poly.points.byteOffset, poly.points.byteLength)

  const indexBuffer = device.createBuffer({
    label: `glyph${gid}-indices`,
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  })
  // пишем индексы линий
  device.queue.writeBuffer(indexBuffer, 0, indices.buffer, indices.byteOffset, indices.byteLength)

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
