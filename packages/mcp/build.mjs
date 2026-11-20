// Bundle the MCP server into one self-contained file shipped with the Claude Code plugin.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "../../plugin/server/prototyper-mcp.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "// Prototyper MCP server (bundled; source: packages/mcp). Do not edit.\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
  minify: true,
});
console.log("Built plugin/server/prototyper-mcp.mjs");
