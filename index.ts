import index from "./index.html"
import { file, serve } from "bun"

serve({
  routes: {
    "/": index,
    "/shaders/vertex.wgsl": file("./shaders/vertex.wgsl"),
    "/shaders/fragment.wgsl": file("./shaders/fragment.wgsl"),
  },
  development: {
    hmr: true,
    console: true,
  },
})
