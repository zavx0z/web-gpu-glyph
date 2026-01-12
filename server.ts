import index from "./index.html"
import { file, serve } from "bun"

const server = serve({
  routes: {
    "/": index,
    "/point.wgsl": file("./point.wgsl"),
    "/text.wgsl": file("./text.wgsl"),
    "/JetBrainsMono-Bold.ttf": file("./JetBrainsMono-Bold.ttf"),
  },
  development: {
    hmr: true,
    console: false,
  },
})

console.log(`Сервер запущен: ${server.url}`)
