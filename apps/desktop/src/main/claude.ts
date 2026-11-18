import { execFile, spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { ClaudeCheck } from "../common/types";

const execFileAsync = promisify(execFile);

/**
 * Apps launched from Finder don't inherit the user's shell PATH, so `claude`
 * (usually in ~/.local/bin or a Homebrew/npm prefix) wouldn't be found.
 * Ask the login shell once.
 */
let shellPath: Promise<string> | undefined;
export function getShellPath(): Promise<string> {
  shellPath ??= (async () => {
    const shell = process.env.SHELL || "/bin/zsh";
    try {
      const { stdout } = await execFileAsync(shell, ["-ilc", 'printf "__PATH__%s" "$PATH"'], { timeout: 10_000 });
      const path = stdout.split("__PATH__").pop()?.trim();
      if (path) return path;
    } catch {
      /* fall through */
    }
    return [process.env.PATH, join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":");
  })();
  return shellPath;
}

export async function claudeEnv(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: await getShellPath() };
  // When the app itself is launched from a Claude Code session, don't let the child think it is nested.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export async function findClaude(explicit?: string): Promise<string | undefined> {
  const candidates = explicit
    ? [explicit]
    : [
        ...(await getShellPath()).split(":").map((d) => join(d, "claude")),
        join(homedir(), ".claude/local/claude"),
      ];
  for (const c of candidates) {
    try {
      await access(c, constants.X_OK);
      return c;
    } catch {
      /* next */
    }
  }
  return undefined;
}

export async function checkClaude(explicit?: string): Promise<ClaudeCheck> {
  const path = await findClaude(explicit);
  if (!path) {
    return { ok: false, error: "Claude Code not found. Install it from https://claude.com/claude-code or set its path in Settings." };
  }
  try {
    const { stdout } = await execFileAsync(path, ["--version"], { env: await claudeEnv(), timeout: 15_000 });
    return { ok: true, path, version: stdout.trim() };
  } catch (e) {
    return { ok: false, path, error: `Could not run ${path}: ${(e as Error).message}` };
  }
}

export interface ClaudeRunOptions {
  bin: string;
  cwd: string;
  prompt: string;
  /** Session to create (`resume: false`) or continue (`resume: true`). */
  sessionId: string;
  resume: boolean;
  appendSystemPrompt: string;
  addDirs?: string[];
  model?: string;
  allowedTools?: string[];
  /** Ignore the user's global settings, hooks, plugins and MCP servers (login is kept). */
  isolated?: boolean;
  signal?: AbortSignal;
}

export type ClaudeStreamEvent =
  | { type: "init"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: Record<string, unknown> };

export interface ClaudeRunResult {
  ok: boolean;
  text: string;
  sessionId: string;
  costUsd?: number;
  durationMs?: number;
  /** True when `--resume` failed because the session no longer exists. */
  sessionMissing?: boolean;
  stderr: string;
}

export const DEFAULT_TOOLS = ["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "TodoWrite"];

export function buildArgs(o: ClaudeRunOptions): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"];
  args.push("--append-system-prompt", o.appendSystemPrompt);
  args.push(...(o.resume ? ["--resume", o.sessionId] : ["--session-id", o.sessionId]));
  if (o.model) args.push("--model", o.model);
  if (o.isolated) args.push("--setting-sources", "project,local", "--strict-mcp-config");
  // Variadic options last-but-one, each terminated by the next option.
  args.push("--allowedTools", ...(o.allowedTools ?? DEFAULT_TOOLS));
  for (const d of o.addDirs ?? []) args.push("--add-dir", d);
  return args;
}

/** Run `claude -p` headless; the prompt goes through stdin, events are parsed from stream-json. */
export async function runClaude(o: ClaudeRunOptions, onEvent: (e: ClaudeStreamEvent) => void): Promise<ClaudeRunResult> {
  const child = spawn(o.bin, buildArgs(o), { cwd: o.cwd, env: await claudeEnv(), stdio: ["pipe", "pipe", "pipe"] });
  const abort = () => child.kill("SIGTERM");
  o.signal?.addEventListener("abort", abort, { once: true });

  child.stdin.end(o.prompt);
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-20_000);
  });

  let result: Omit<ClaudeRunResult, "stderr"> | undefined;
  let lastText = "";
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === "system" && msg.subtype === "init") {
      onEvent({ type: "init", sessionId: msg.session_id });
    } else if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text?.trim()) {
          lastText = block.text;
          onEvent({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          onEvent({ type: "tool", name: block.name, input: block.input ?? {} });
        }
      }
    } else if (msg.type === "result") {
      result = {
        ok: !msg.is_error && msg.subtype === "success",
        text: typeof msg.result === "string" ? msg.result : lastText,
        sessionId: msg.session_id ?? o.sessionId,
        ...(typeof msg.total_cost_usd === "number" ? { costUsd: msg.total_cost_usd } : {}),
        ...(typeof msg.duration_ms === "number" ? { durationMs: msg.duration_ms } : {}),
      };
    }
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => o.signal?.removeEventListener("abort", abort));

  if (o.signal?.aborted) return { ok: false, text: "Cancelled.", sessionId: o.sessionId, stderr };
  if (result) return { ...result, ok: result.ok && code === 0, stderr };
  const sessionMissing = o.resume && /no conversation found|session.*not found/i.test(stderr);
  return {
    ok: false,
    text: stderr.trim().split("\n").slice(-5).join("\n") || `claude exited with code ${code}`,
    sessionId: o.sessionId,
    ...(sessionMissing ? { sessionMissing } : {}),
    stderr,
  };
}

/** Short, human-readable description of a tool call for the activity log. */
export function describeTool(name: string, input: Record<string, unknown>, cwd: string): string {
  const path = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : undefined;
  if (path) return path.startsWith(cwd + "/") ? path.slice(cwd.length + 1) : path;
  if (typeof input.pattern === "string") return input.pattern;
  if (name === "TodoWrite" && Array.isArray(input.todos)) return `${input.todos.length} tasks`;
  return "";
}
