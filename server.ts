import index from "./index.html"
import { file, serve } from "bun"

serve({
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
