/**
 * Manual end-to-end check without Electron: create a client + demo in a temp library,
 * generate it with the real Claude Code CLI, then print lint results and versions.
 *
 *   pnpm --filter @prototyper/desktop exec tsx scripts/e2e-generate.ts [libraryRoot] [model]
 */
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DemoService } from "../src/main/demos";
import { Library } from "../src/main/library";
import { PreviewServer } from "../src/main/preview";

const root = process.argv[2] ?? (await mkdtemp(join(tmpdir(), "pt-e2e-")));
const model = process.argv[3];
const library = new Library(root);
const preview = new PreviewServer();
await preview.start();

const service = new DemoService({
  library: () => library,
  settings: () => ({ libraryRoot: root, ...(model ? { model } : {}) }),
  preview,
  emit: (_ref, e) => {
    const t = new Date(e.at).toLocaleTimeString();
    if (e.type === "tool") console.log(t, "  ·", e.name, e.detail);
    else if (e.type === "assistant") console.log(t, "  >", e.text.slice(0, 300).replace(/\n/g, " "));
    else if (e.type === "lint") console.log(t, `LINT errors=${e.errors} warnings=${e.warnings}\n${e.report}`);
    else if (e.type === "result") console.log(t, "RESULT", e.ok, e.durationMs, e.costUsd, e.ok ? "" : e.text);
    else console.log(t, e.type.toUpperCase(), "message" in e ? e.message : "number" in e ? e.number : "ok" in e ? e.ok : "");
  },
  changed: () => {},
  capture: async () => {},
});

const client = await library.createClient({ name: "Studio Bianchi Commercialisti", website: "https://example.com" });
const meta = await service.create({
  client: client.slug,
  name: "Sito vetrina",
  language: "Italian",
  pages: ["Home", "Servizi", "Contatti"],
  structureFirst: false,
  brief: `Studio di commercialisti a Bergamo, 4 professionisti, clienti principali: PMI e liberi professionisti.
Vogliono un sito vetrina moderno e rassicurante: servizi (contabilità, consulenza fiscale, paghe, startup d'impresa),
il team, perché sceglierli, e un modulo contatti per prenotare una prima consulenza gratuita. Tono professionale ma umano.`,
});
const ref = { client: client.slug, demo: meta.slug };
console.log("Library:", root, "Demo:", library.demoDir(ref));

const t0 = Date.now();
await service.generate(ref, { structureFirst: false });
console.log(`\nFinished in ${Math.round((Date.now() - t0) / 1000)}s`);
const detail = await service.detail(ref);
console.log("versions:", detail.meta.versions, "unsaved:", detail.unsavedChanges, "lint:", detail.lint?.errors, detail.lint?.warnings);
console.log("dist:", await readdir(join(library.demoDir(ref), "dist"), { recursive: true }));
preview.stop();
