import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * The project's sources, kept in a private git repository inside the project (`.prototyper/git`, work
 * tree = the project folder) and pushed to the project's git on the Prototyper server. It never
 * touches the user's own `.git`: no branches, index or commits of theirs are changed.
 *
 * `refs/prototyper/base` is the server commit the local files were last in sync with (after a
 * publish, a clone or a pull). Publishing is refused when the server moved past it.
 */

export const GIT_DIR = join(".prototyper", "git");
const BASE = "refs/prototyper/base";
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;

/** Never part of the sources, whatever .gitignore says: dependencies, secrets, Prototyper's own files. */
const EXCLUDES = [
  "node_modules/",
  ".astro/",
  ".cache/",
  ".parcel-cache/",
  ".turbo/",
  ".env",
  ".env.*",
  "!.env.example",
  "*.pem",
  "*.key",
  "*.p12",
  "id_rsa*",
  ".npmrc",
  ".DS_Store",
  "/.prototyper/",
  "/.prototyper.json",
];

export class GitMissingError extends Error {}
export class BehindError extends Error {}

export interface Remote {
  url: string;
  token: string;
}

export interface Author {
  name: string;
  email: string;
}

export class SourceRepo {
  private constructor(readonly root: string) {}

  /** Open (or create) the private repository of a project folder. */
  static async open(root: string): Promise<SourceRepo> {
    const repo = new SourceRepo(root);
    await repo.git(["--version"]).catch(() => {
      throw new GitMissingError("git is not installed on this computer, so the sources were not saved on Prototyper (the site was still published).");
    });
    if (!(await stat(join(root, GIT_DIR, "HEAD")).then(() => true, () => false))) {
      await mkdir(join(root, ".prototyper"), { recursive: true });
      // Keep everything in .prototyper/ out of the user's own git.
      await writeFile(join(root, ".prototyper", ".gitignore"), "*\n");
      await repo.git(["init", "--quiet", "--initial-branch=main"]);
    }
    await writeFile(join(root, GIT_DIR, "info", "exclude"), EXCLUDES.join("\n") + "\n");
    return repo;
  }

  async git(args: string[], opts: { remote?: Remote; author?: Author; input?: string; okExit?: number[] } = {}): Promise<string> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_DIR: join(this.root, GIT_DIR),
      GIT_WORK_TREE: this.root,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    if (opts.remote) {
      // The token goes through the environment, not the command line or .git/config.
      env.GIT_CONFIG_COUNT = "2";
      env.GIT_CONFIG_KEY_0 = "http.extraHeader";
      env.GIT_CONFIG_VALUE_0 = `Authorization: Bearer ${opts.remote.token}`;
      env.GIT_CONFIG_KEY_1 = "credential.helper";
      env.GIT_CONFIG_VALUE_1 = "";
    }
    if (opts.author) {
      env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = opts.author.name || opts.author.email;
      env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = opts.author.email || "prototyper@localhost";
    }
    return new Promise((resolve, reject) => {
      const child = execFile("git", args, { cwd: this.root, env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = (err as { code?: unknown } | null)?.code;
        if (err && typeof code === "number" && opts.okExit?.includes(code)) return resolve(stdout);
        if (err) {
          const e = new Error(`git ${args[0]}: ${(stderr || err.message).trim()}`) as Error & { code?: unknown };
          e.code = (err as { code?: unknown }).code;
          reject(e);
        } else resolve(stdout);
      });
      if (opts.input !== undefined) child.stdin?.end(opts.input);
    });
  }

  private async ref(name: string): Promise<string | undefined> {
    const out = await this.git(["rev-parse", "--verify", "--quiet", `${name}^{commit}`]).catch(() => "");
    return out.trim() || undefined;
  }

  base(): Promise<string | undefined> {
    return this.ref(BASE);
  }

  async setBase(sha: string): Promise<void> {
    await this.git(["update-ref", BASE, sha]);
  }

  /** The commit `main` is at on the server (undefined: nothing pushed yet). */
  async remoteHead(remote: Remote): Promise<string | undefined> {
    const out = await this.git(["ls-remote", remote.url, "refs/heads/main"], { remote });
    return out.split(/\s/)[0] || undefined;
  }

  async fetch(remote: Remote, sha: string): Promise<void> {
    if (await this.ref(sha)) return;
    await this.git(["fetch", "--quiet", "--no-tags", remote.url, `+refs/heads/main:refs/prototyper/remote`], { remote });
  }

  /**
   * Commit the current files (as git sees them: .gitignore and the excludes apply) on top of `parent`.
   * `buildDir` (the build output, when it is a subfolder) is left out. Returns the parent itself when
   * nothing changed.
   */
  async snapshot(message: string, author: Author, parent: string | undefined, buildDir?: string): Promise<string> {
    await this.git(["read-tree", "--empty"]);
    await this.git(["add", "--all", "--", "."]);
    if (buildDir) {
      const rel = relative(this.root, buildDir).split(sep).join("/");
      if (rel && !rel.startsWith("..")) await this.git(["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", rel]);
    }
    await this.checkSize();
    const tree = (await this.git(["write-tree"])).trim();
    if (parent && (await this.git(["rev-parse", `${parent}^{tree}`])).trim() === tree) return parent;
    const args = ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-F", "-"];
    return (await this.git(args, { author, input: message })).trim();
  }

  private async checkSize(): Promise<void> {
    const staged = (await this.git(["ls-files", "--stage", "-z"])).split("\0").filter(Boolean);
    // "<mode> <object> <stage>\t<path>"
    const entries = staged.map((l) => ({ object: l.split(" ")[1]!, path: l.slice(l.indexOf("\t") + 1) }));
    const sizes = entries.length ? (await this.git(["cat-file", "--batch-check=%(objectsize)"], { input: entries.map((e) => e.object).join("\n") + "\n" })).split("\n") : [];
    let total = 0;
    const files: [number, string][] = entries.map((e, i) => {
      const size = Number(sizes[i]) || 0;
      total += size;
      return [size, e.path];
    });
    if (total > MAX_SOURCE_BYTES) {
      const biggest = files.sort((a, b) => b[0] - a[0]).slice(0, 5).map(([s, p]) => `${p} (${Math.round(s / 1024 / 1024)} MB)`);
      await this.git(["read-tree", "--empty"]);
      throw new Error(`The sources are over ${MAX_SOURCE_BYTES / 1024 / 1024} MB. Add large files to .gitignore. Biggest: ${biggest.join(", ")}.`);
    }
  }

  async push(remote: Remote, sha: string): Promise<void> {
    try {
      await this.git(["push", "--quiet", remote.url, `${sha}:refs/heads/main`], { remote });
    } catch (e) {
      if (/non-fast-forward|fetch first|rejected/i.test((e as Error).message)) {
        throw new BehindError("Someone else published newer sources meanwhile. Run pull_sources, check the result, then publish again.");
      }
      throw e;
    }
  }

  /** Write a commit's files into the project folder (files of `from` that `to` doesn't have are deleted). */
  async checkout(to: string, from?: string): Promise<void> {
    if (from) {
      const out = await this.git(["diff-tree", "-r", "--no-renames", "--name-only", "--diff-filter=D", "-z", from, to]);
      for (const path of out.split("\0").filter(Boolean)) await rm(join(this.root, path), { force: true });
    }
    await this.git(["read-tree", to]);
    await this.git(["checkout-index", "--all", "--force"]);
  }

  /**
   * Merge the server's `head` into the local files: three-way, with the last synced commit as base.
   * Conflicting files get the usual conflict markers. Returns the conflicting paths.
   */
  async merge(head: string, author: Author): Promise<string[]> {
    const base = await this.base();
    const local = await this.snapshot("Local changes (before pull)", author, base);
    if (local === head) return [];
    // Exit code 1 means merged with conflicts (the tree then holds files with conflict markers).
    const out = await this.git(["merge-tree", "--write-tree", "--name-only", "--no-messages", ...(base ? [] : ["--allow-unrelated-histories"]), local, head], {
      okExit: [1],
    }).catch((e: Error) => {
      throw /usage|unknown option|write-tree/i.test(e.message) ? new Error(`Merging needs git 2.38 or newer (${e.message}).`) : e;
    });
    const [tree, ...conflicts] = out.split("\n").filter(Boolean);
    if (!tree) throw new Error("git merge-tree gave no result");
    await this.checkout(tree, local);
    await this.setBase(head);
    return conflicts;
  }

  /** Read a file of the project (for messages). */
  read(path: string): Promise<string> {
    return readFile(join(this.root, path), "utf8");
  }
}
