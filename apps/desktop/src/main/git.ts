import { simpleGit, type SimpleGit } from "simple-git";

/** Per-demo git repository: one commit per change, one tag (`v1`, `v2`, …) per version. */
export class DemoRepo {
  private readonly git: SimpleGit;

  constructor(readonly dir: string) {
    this.git = simpleGit(dir);
  }

  async init(): Promise<void> {
    await this.git.init(["-b", "main"]);
    // Commits must work even on machines without a global git identity.
    const name = await this.git.getConfig("user.name");
    if (!name.value) await this.git.addConfig("user.name", "Prototyper");
    const email = await this.git.getConfig("user.email");
    if (!email.value) await this.git.addConfig("user.email", "prototyper@localhost");
  }

  /** Commit everything; returns the commit hash, or undefined when there was nothing to commit. */
  async commitAll(message: string): Promise<string | undefined> {
    await this.git.add(["-A"]);
    const status = await this.git.status();
    if (status.staged.length === 0 && status.files.length === 0) return undefined;
    const result = await this.git.commit(message);
    return result.commit || (await this.head());
  }

  async head(): Promise<string> {
    return (await this.git.revparse(["HEAD"])).trim();
  }

  async tag(name: string, message: string): Promise<void> {
    await this.git.addAnnotatedTag(name, message);
  }

  /** Number of commits after the given tag (0 when HEAD is the tag). */
  async commitsSince(tag: string): Promise<number> {
    const out = await this.git.raw(["rev-list", "--count", `${tag}..HEAD`]);
    return Number(out.trim()) || 0;
  }
}
