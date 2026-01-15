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

// -------------------- CONFIG --------------------
const FONT_SIZE_PX = 120
const LETTER_SPACING_PX = 6
const LINE_GAP_PX = Math.round(FONT_SIZE_PX * 1.35)
const START_X = 60
const START_Y = 200

const TEXT_LINES = [
  "Веста",
  "и",
  "Мирчик",
  "я вас люблю!",
]

const ADAPTIVE_TOLERANCE_FU = 0.5
const MAX_SUBDIVISION_DEPTH = 12

// -------------------- MATH & GEOMETRY --------------------
type Point = { x: number; y: number; on: boolean }

function pointLineDistance(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x0, py - y0)
  const t = ((px - x0) * dx + (py - y0) * dy) / len2
  const projx = x0 + t * dx
  const projy = y0 + t * dy
  return Math.hypot(px - projx, py - projy)
}

function splitQuad(p0: [number, number], p1: [number, number], p2: [number, number]): [[number, number], [number, number], [number, number], [number, number], [number, number]] {
  const p01: [number, number] = [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5]
  const p12: [number, number] = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5]
  const p012: [number, number] = [(p01[0] + p12[0]) * 0.5, (p01[1] + p12[1]) * 0.5]
  return [p0, p01, p012, p12, p2]
}

function quadBezierAdaptive(p0: [number, number], p1: [number, number], p2: [number, number], tolerance: number, out: number[], depth = 0) {
  if (depth > MAX_SUBDIVISION_DEPTH) {
    out.push(p2[0], p2[1])
    return
  }
  const err = pointLineDistance(p1[0], p1[1], p0[0], p0[1], p2[0], p2[1])
  if (err <= tolerance) {
    out.push(p2[0], p2[1])
    return
  }
  const [a, b, c, d, e] = splitQuad(p0, p1, p2)
  quadBezierAdaptive(a, b, c, tolerance, out, depth + 1)
  quadBezierAdaptive(c, d, e, tolerance, out, depth + 1)
}

// -------------------- FONT PROCESSING --------------------
const font = await TrueTypeFont.fromUrl("JetBrainsMono-Bold.ttf")

function outlineToPolylineTTF(o: { points: Float32Array; onCurve: Uint8Array; contours: Uint16Array }): { points: Float32Array; contours: Uint32Array } {
  const P = o.points
  const ON = o.onCurve
  const ends = o.contours
  const outPts: number[] = []
  const outEnds: number[] = []
  let start = 0
  for (let ci = 0; ci < ends.length; ci++) {
    const end = ends[ci]
    if (end === undefined) continue
    const contourStartIndex = outPts.length / 2
    const count = end - start + 1
    const get = (i: number): Point => {
      const idx = start + ((i % count + count) % count)
      return { x: P[idx * 2] || 0, y: P[idx * 2 + 1] || 0, on: ON[idx] !== 0 }
    }
    let prev = get(0)
    if (!prev.on) {
      const last = get(count - 1)
      prev = last.on ? { ...last } : { x: (last.x + prev.x) * 0.5, y: (last.y + prev.y) * 0.5, on: true }
      outPts.push(prev.x, prev.y)
    } else {
      outPts.push(prev.x, prev.y)
    }
    for (let i = 1; i <= count; i++) {
      const curr = get(i)
      if (prev.on && curr.on) {
        outPts.push(curr.x, curr.y)
        prev = curr
      } else if (prev.on && !curr.on) {
        const next = get(i + 1)
        let endPt: Point = next.on ? next : { x: (curr.x + next.x) * 0.5, y: (curr.y + next.y) * 0.5, on: true }
        if (next.on) i++
        quadBezierAdaptive([prev.x, prev.y], [curr.x, curr.y], [endPt.x, endPt.y], ADAPTIVE_TOLERANCE_FU, outPts)
        prev = endPt
      }
    }
    if (outPts.length / 2 - contourStartIndex >= 3) outEnds.push(outPts.length / 2 - 1)
    start = end + 1
  }
  return { points: new Float32Array(outPts), contours: new Uint32Array(outEnds) }
}

function makeFanIndices(contourEnds: Uint32Array): Uint32Array {
  const idx: number[] = []
  let start = 0
  for (const end of contourEnds) {
    for (let i = start + 1; i < end; i++) idx.push(start, i, i + 1)
    start = end + 1
  }
  return new Uint32Array(idx)
}

// -------------------- GPU RESOURCES --------------------
type GlyphMesh = {
  stencilVertexBuffer: GPUBuffer
  stencilIndexBuffer: GPUBuffer
  stencilIndicesCount: number
  coverVertexBuffer: GPUBuffer
  coverIndexBuffer: GPUBuffer
  advanceWidthFU: number
}

const GLYPH_CACHE = new Map<number, GlyphMesh | null>()

function getGlyphMesh(gid: number): GlyphMesh | null {
  if (GLYPH_CACHE.has(gid)) return GLYPH_CACHE.get(gid)!

  const outline = font.getGlyphOutline(gid)
  const poly = outlineToPolylineTTF(outline)
  if (poly.points.length === 0 || poly.contours.length === 0) {
    GLYPH_CACHE.set(gid, null)
    return null
  }

  // 1. Stencil Mesh (Fan)
  const stencilIndices = makeFanIndices(poly.contours)
  const stencilVertexBuffer = device.createBuffer({ size: poly.points.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(stencilVertexBuffer, 0, poly.points)
  const stencilIndexBuffer = device.createBuffer({ size: stencilIndices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(stencilIndexBuffer, 0, stencilIndices)

  // 2. Cover Mesh (BBox)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < poly.points.length; i += 2) {
    const x = poly.points[i], y = poly.points[i + 1]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  
  // Padding for distortion
  const PAD = 300
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;

  const coverVerts = new Float32Array([
    minX, minY,  maxX, minY,  minX, maxY,  maxX, maxY
  ])
  const coverIndices = new Uint32Array([0, 1, 2, 2, 1, 3])
  
  const coverVertexBuffer = device.createBuffer({ size: coverVerts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(coverVertexBuffer, 0, coverVerts)
  const coverIndexBuffer = device.createBuffer({ size: coverIndices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(coverIndexBuffer, 0, coverIndices)

  const mesh = {
    stencilVertexBuffer, stencilIndexBuffer, stencilIndicesCount: stencilIndices.length,
    coverVertexBuffer, coverIndexBuffer,
    advanceWidthFU: font.getHMetric(gid).advanceWidth
  }
  GLYPH_CACHE.set(gid, mesh)
  return mesh
}

// -------------------- PIPELINE --------------------
const shaderModule = device.createShaderModule({ code: await (await fetch("./text.wgsl")).text() })

const UNIFORM_ALIGN = device.limits.minUniformBufferOffsetAlignment
const MAX_GLYPHS = 4096
const PARAMS_SIZE_BYTES = 32
const paramsBuffer = device.createBuffer({ 
  size: MAX_GLYPHS * UNIFORM_ALIGN, 
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
})

const bindGroupLayout = device.createBindGroupLayout({ 
  entries: [{ 
    binding: 0, 
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, 
    buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PARAMS_SIZE_BYTES } 
  }]
})

const bindGroup = device.createBindGroup({ 
  layout: bindGroupLayout, 
  entries: [{ 
    binding: 0, 
    resource: { 
      buffer: paramsBuffer, 
      offset: 0, 
      size: PARAMS_SIZE_BYTES 
    } 
  }]
})

const depthStencilFormat = "depth24plus-stencil8"

// Pipeline 1: Stencil Pass
const stencilPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  vertex: { module: shaderModule, entryPoint: "vs_main", buffers: [{ arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }] },
  fragment: { module: shaderModule, entryPoint: "fs_stencil", targets: [{ format, writeMask: 0 }] },
  depthStencil: {
    format: depthStencilFormat,
    depthWriteEnabled: false, depthCompare: "always",
    stencilFront: { compare: "always", failOp: "keep", depthFailOp: "keep", passOp: "increment-wrap" },
    stencilBack:  { compare: "always", failOp: "keep", depthFailOp: "keep", passOp: "decrement-wrap" },
  },
  primitive: { topology: "triangle-list" }
})

// Pipeline 2: Cover Pass
const coverPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  vertex: { module: shaderModule, entryPoint: "vs_main", buffers: [{ arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }] },
  fragment: { module: shaderModule, entryPoint: "fs_cover", targets: [{ format, writeMask: GPUColorWrite.ALL }] },
  depthStencil: {
    format: depthStencilFormat,
    depthWriteEnabled: false, depthCompare: "always",
    stencilFront: { compare: "not-equal", failOp: "keep", depthFailOp: "keep", passOp: "keep" },
    stencilBack:  { compare: "not-equal", failOp: "keep", depthFailOp: "keep", passOp: "keep" },
  },
  primitive: { topology: "triangle-list" }
})

let depthTexture: GPUTexture | null = null

// -------------------- RENDER --------------------
function render(timeMs: number) {
  const dpr = window.devicePixelRatio || 1
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr))
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W; canvas.height = H
    depthTexture?.destroy()
    depthTexture = device.createTexture({ size: [W, H], format: depthStencilFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT })
  }

  // 1. Prepare Data
  const globalParams = new Float32Array((MAX_GLYPHS * UNIFORM_ALIGN) / 4)
  const drawList: { mesh: GlyphMesh, index: number }[] = []
  
  let penY = START_Y
  let glyphIndex = 0

  for (const line of TEXT_LINES) {
    let penX = START_X
    for (const ch of line) {
      if (glyphIndex >= MAX_GLYPHS) break;
      
      const gid = font.mapCharToGlyph(ch.codePointAt(0)!)
      const mesh = getGlyphMesh(gid)
      
      if (mesh) {
        const offsetFloats = (glyphIndex * UNIFORM_ALIGN) / 4
        globalParams[offsetFloats + 0] = font.unitsPerEm
        globalParams[offsetFloats + 1] = FONT_SIZE_PX
        globalParams[offsetFloats + 2] = penX
        globalParams[offsetFloats + 3] = penY
        globalParams[offsetFloats + 4] = W
        globalParams[offsetFloats + 5] = H
        globalParams[offsetFloats + 6] = timeMs
        globalParams[offsetFloats + 7] = 0
        
        drawList.push({ mesh, index: glyphIndex })
        glyphIndex++
      }
      
      let { advanceWidth } = font.getHMetric(gid)
      if (ch === ' ' && advanceWidth === 0) advanceWidth = font.unitsPerEm * 0.6
      penX += advanceWidth * (FONT_SIZE_PX / font.unitsPerEm) + LETTER_SPACING_PX
    }
    penY += LINE_GAP_PX
  }

  // 2. Upload
  device.queue.writeBuffer(paramsBuffer, 0, globalParams, 0, glyphIndex * UNIFORM_ALIGN)

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: context!.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    depthStencilAttachment: {
      view: depthTexture!.createView(),
      depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "discard",
      stencilClearValue: 0, stencilLoadOp: "clear", stencilStoreOp: "discard",
    }
  })

  // 3. Draw Stencil
  pass.setPipeline(stencilPipeline)
  for (const { mesh, index } of drawList) {
    pass.setBindGroup(0, bindGroup, [index * UNIFORM_ALIGN])
    pass.setVertexBuffer(0, mesh.stencilVertexBuffer)
    pass.setIndexBuffer(mesh.stencilIndexBuffer, "uint32")
    pass.drawIndexed(mesh.stencilIndicesCount)
  }

  // 4. Draw Cover
  pass.setPipeline(coverPipeline)
  for (const { mesh, index } of drawList) {
    pass.setBindGroup(0, bindGroup, [index * UNIFORM_ALIGN])
    pass.setVertexBuffer(0, mesh.coverVertexBuffer)
    pass.setIndexBuffer(mesh.coverIndexBuffer, "uint32")
    pass.drawIndexed(6)
  }

  pass.end()
  device.queue.submit([encoder.finish()])
  requestAnimationFrame(render)
}

requestAnimationFrame(render)