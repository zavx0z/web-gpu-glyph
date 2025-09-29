import index from "./index.html"
import { serve } from "bun"

serve({
  routes: {
    "/": index,
  },
  development: {
    hmr: true,
    console: true,
  },
})
