import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Settings } from "../common/types";

export class SettingsStore {
  private current: Settings;

  constructor(private readonly file: string) {
    this.current = { libraryRoot: join(homedir(), "Prototyper") };
    try {
      this.current = { ...this.current, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>) };
    } catch {
      /* first run */
    }
  }

  get(): Settings {
    return { ...this.current };
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    this.current = { ...this.current, ...patch };
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.current, null, 2));
    await rename(`${this.file}.tmp`, this.file);
    return this.get();
  }
}
