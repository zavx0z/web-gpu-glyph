import index from "./index.html"
import { file, serve } from "bun"

serve({
  routes: {
    "/": index,
    "/point.wgsl": file("./point.wgsl")
  },
  development: {
    hmr: true,
    console: true,
  },
})
