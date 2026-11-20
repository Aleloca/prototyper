import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Where the MCP keeps its login: one token per server, file readable only by the user. */
export const CREDENTIALS_FILE = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "prototyper", "credentials.json");

export interface ServerCredentials {
  token: string;
  email: string;
  name: string;
  expiresAt: string;
}

export interface Credentials {
  default?: string;
  servers: Record<string, ServerCredentials>;
}

export async function readCredentials(): Promise<Credentials> {
  try {
    const c = JSON.parse(await readFile(CREDENTIALS_FILE, "utf8")) as Credentials;
    return { servers: c.servers ?? {}, ...(c.default ? { default: c.default } : {}) };
  } catch {
    return { servers: {} };
  }
}

export async function saveCredentials(c: Credentials): Promise<void> {
  await mkdir(dirname(CREDENTIALS_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${CREDENTIALS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, CREDENTIALS_FILE);
}

/** `prototyper.example.com` or `https://prototyper.example.com/` → `https://prototyper.example.com`. */
export function normalizeServer(input: string): string {
  const raw = input.trim().replace(/\/+$/, "");
  const u = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname) && !u.hostname.endsWith(".localhost")) {
    throw new Error("The server must use https.");
  }
  return u.origin;
}

// --- per-project link -------------------------------------------------------------------------

/** `.prototyper.json` in the project root: which Prototyper project this folder publishes to. */
export interface ProjectLink {
  server: string;
  projectId: string;
  name?: string;
}

export const PROJECT_FILE = ".prototyper.json";

export function projectRoot(dir?: string): string {
  return resolve(dir || process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

export async function readProjectLink(root: string): Promise<ProjectLink | undefined> {
  try {
    const p = JSON.parse(await readFile(join(root, PROJECT_FILE), "utf8")) as ProjectLink;
    return p.server && p.projectId ? p : undefined;
  } catch {
    return undefined;
  }
}

export async function writeProjectLink(root: string, link: ProjectLink): Promise<void> {
  await writeFile(join(root, PROJECT_FILE), JSON.stringify(link, null, 2) + "\n");
}
