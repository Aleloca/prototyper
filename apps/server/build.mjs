// Bundle the server into dist/server.js. `sharp` (native) and `playwright-core` stay external.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  external: ["sharp", "playwright-core"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
});

copyFileSync(require.resolve("@prototyper/overlay/review.js"), "dist/review.js");

// The panel SPA, built by @prototyper/panel.
const panelDist = new URL("../panel/dist/", import.meta.url);
if (!existsSync(new URL("index.html", panelDist))) throw new Error("Build the panel first: pnpm --filter @prototyper/panel build");
rmSync("dist/panel", { recursive: true, force: true });
cpSync(panelDist, "dist/panel", { recursive: true });

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
      dependencies: { sharp: pkg.dependencies.sharp, "playwright-core": pkg.dependencies["playwright-core"] },
    },
    null,
    2,
  ) + "\n",
);
console.log("Built dist/server.js");
