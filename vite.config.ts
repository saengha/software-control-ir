import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "demo",
  publicDir: false,
  resolve: {
    alias: {
      "@scir": path.join(root, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.join(root, "demo-dist"),
    emptyOutDir: true,
  },
});
