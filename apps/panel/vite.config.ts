import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In development, run the server on :3700 with PANEL_HOST=localhost and open http://localhost:5173.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, assetsDir: "assets" },
  server: {
    proxy: { "/api": { target: "http://localhost:3700", changeOrigin: false } },
  },
});
