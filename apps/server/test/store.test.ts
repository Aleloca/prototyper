import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Store } from "../src/db";

it("keeps version and upload paths relative to the data folder, converting old absolute ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pt-store-"));
  try {
    let store = new Store(join(dir, "prototyper.db"));
    const ws = store.createWorkspace(randomUUID(), "W").id;
    const client = store.ensureClient(randomUUID(), ws, "C");
    const uid = randomUUID();
    store.createUser({ id: uid, email: "a@example.com" });
    const p = store.createProject({ id: randomUUID(), workspace_id: ws, client_id: client.id, name: "P", domain_id: null, created_by: uid });
    const v = store.addVersion(p.id, 1, "", join(dir, "projects", p.id, "v1"), uid);
    expect(v.dir).toBe(join(dir, "projects", p.id, "v1"));
    expect(store.one<{ dir: string }>("SELECT dir FROM versions WHERE id = ?", v.id)!.dir).toBe(`projects/${p.id}/v1`);
    // A database written by an older version, on a server where the data lived elsewhere.
    store.run("INSERT INTO versions (project_id, number, changelog, dir, published_by, published_at) VALUES (?, 2, '', ?, ?, '')", p.id, `/var/lib/prototyper/projects/${p.id}/v2`, uid);
    store.close();
    store = new Store(join(dir, "prototyper.db"));
    expect(store.versions(p.id).map((x) => x.dir)).toEqual([join(dir, "projects", p.id, "v1"), join(dir, "projects", p.id, "v2")]);
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
