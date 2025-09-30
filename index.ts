import { fetchBinaryData, readTTFHeader } from "./fontLoader.js"

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
const point = await (await fetch("./text.wgsl")).text()
const shader = device.createShaderModule({ label: "point", code: point })

const binaryData = await fetchBinaryData("JetBrainsMono-Bold.ttf")
const data = readTTFHeader(binaryData)
console.log(data)

function render() {}

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
