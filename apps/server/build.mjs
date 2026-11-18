// Bundle the server into dist/server.js. Only `sharp` (native) stays external.
import { copyFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["sharp"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
});

copyFileSync(require.resolve("@prototyper/overlay/review.js"), "dist/review.js");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync(
  "dist/package.json",
  JSON.stringify(
    {
      name: "prototyper-server",
      version: pkg.version,
      private: true,
      type: "module",
      scripts: { start: "node --disable-warning=ExperimentalWarning server.js" },
      dependencies: { sharp: pkg.dependencies.sharp },
    },
    null,
    2,
  ) + "\n",
);
console.log("Built dist/server.js");
