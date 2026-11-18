import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";

/**
 * Admin tokens, encrypted with the OS keychain (Electron safeStorage) and never sent to the renderer.
 * Stored as { [targetId]: base64(ciphertext) }.
 */
export class SecretStore {
  private data: Record<string, string> = {};

  constructor(private readonly file: string) {
    try {
      this.data = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      /* none yet */
    }
  }

  get(id: string): string | undefined {
    const enc = this.data[id];
    if (!enc) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(enc, "base64"));
    } catch {
      return undefined;
    }
  }

  has(id: string): boolean {
    return id in this.data;
  }

  async set(id: string, secret: string | undefined): Promise<void> {
    if (secret === undefined) delete this.data[id];
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is not available on this system.");
      this.data[id] = safeStorage.encryptString(secret).toString("base64");
    }
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.data), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
}
