import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // tronweb reaches for Node globals that don't exist in the browser
    // (Buffer, global, and process for env checks). Shim only those — not the
    // whole Node stdlib — so the bundle stays lean. This is what lets the same
    // chain code that runs in the measurement scripts also run in the SPA.
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // tronweb is a large CJS/ESM hybrid; pre-bundle it so dev-server cold starts
  // don't choke on its internal require graph.
  optimizeDeps: {
    include: ["tronweb"],
  },
})
