import vertexShaderCode from "./shaders/vertex.wgsl" with { type: "text" }
import fragmentShaderCode from "./shaders/fragment.wgsl" with { type: "text" }

const canvas = document.getElementById("canvas") as HTMLCanvasElement
const context = canvas.getContext("webgpu")
if (!context) throw new Error("WebGPU не поддерживается")

// Инициализация WebGPU
const adapter = await navigator.gpu.requestAdapter()
if (!adapter) throw new Error("WebGPU адаптер не найден")

const device = await adapter.requestDevice()

// Настройка canvas
const canvasFormat = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format: canvasFormat })

const vertexShaderModule = device.createShaderModule({ label: "Vertex shader", code: vertexShaderCode })
const fragmentShaderModule = device.createShaderModule({ label: "Fragment shader", code: fragmentShaderCode })

// Создание pipeline
const pipeline = device.createRenderPipeline({
  label: "Point pipeline",
  layout: "auto",
  vertex: {
    module: vertexShaderModule,
    entryPoint: "vs_main",
  },
  fragment: {
    module: fragmentShaderModule,
    entryPoint: "fs_main",
    targets: [{ format: canvasFormat }],
  },
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

// Запуск рендеринга
render()
