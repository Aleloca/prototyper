import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const common = fileURLToPath(new URL("./src/common", import.meta.url));

// Workspace packages ship TypeScript sources, so they must be bundled, not externalized.
const bundled = ["@prototyper/shared", "@prototyper/prototype-kit"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundled })],
    resolve: { alias: { "@common": common } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundled })],
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@common": common } },
  },
});
