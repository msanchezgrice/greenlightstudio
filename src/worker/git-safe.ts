import { spawn } from "node:child_process";

export function githubRepository(value: unknown): string {
  if (typeof value !== "string" || value.length > 300) throw new Error("Invalid GitHub repository");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Invalid GitHub repository"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Invalid GitHub repository");
  const match = /^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_][A-Za-z0-9_.-]{0,99})$/.exec(parsed.pathname);
  if (!match || match[2].endsWith(".") || match[2].includes("..")) throw new Error("Invalid GitHub repository");
  return `https://github.com/${match[1]}/${match[2]}`;
}

export function gitBranch(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) || value.includes("..") || value.includes("//") || value.endsWith("/") || value.endsWith(".") || value.split("/").some(part => part.startsWith(".") || part.endsWith(".lock"))) throw new Error("Invalid Git branch");
  return value;
}

export type GitOptions = { cwd?: string; token?: string; allowExit?: number[]; timeoutMs?: number };
type GitRunner = (args: string[], options: GitOptions) => Promise<number>;

// Git receives the secret only through its child environment, scoped to github.com;
// it is never part of argv, a remote URL, Git configuration on disk, or emitted output.
export const runGit: GitRunner = async (args, options) => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG, LC_ALL: process.env.LC_ALL,
    GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TRACE: "0", GIT_TRACE_CURL: "0", GIT_CURL_VERBOSE: "0",
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
  };
  if (options.token) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${options.token}`).toString("base64")}`;
  }
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "http.followRedirects=false", ...args], {
      cwd: options.cwd, env, shell: false, detached: process.platform !== "win32", stdio: "ignore",
    });
    let timedOut = false;
    const killGroup = (signal: NodeJS.Signals) => {
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already exited */ }
    };
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => { timedOut = true; killGroup("SIGTERM"); forceKill = setTimeout(() => killGroup("SIGKILL"), 2_000); }, options.timeoutMs ?? 60_000);
    child.once("error", () => { clearTimeout(timer); if (forceKill) clearTimeout(forceKill); reject(new Error("Git operation failed")); });
    child.once("close", (code) => {
      clearTimeout(timer); if (forceKill && !timedOut) clearTimeout(forceKill);
      if (timedOut || code === null || (code !== 0 && !options.allowExit?.includes(code))) reject(new Error("Git operation failed")); else resolve(code);
    });
  });
};

export function gitOperations(runner: GitRunner = runGit) {
  return {
    clone: (repo: string, directory: string, token?: string) => runner(["clone", "--depth", "1", "--", githubRepository(repo), directory], { token }),
    checkout: (directory: string, branch: string) => runner(["checkout", "-b", gitBranch(branch)], { cwd: directory, timeoutMs: 10_000 }),
    async push(directory: string, repo: string, branch: string, token: string) {
      const ref = gitBranch(branch);
      const destination = githubRepository(repo);
      if (!token.trim()) throw new Error("Git operation failed");
      await runner(["add", "-A"], { cwd: directory, timeoutMs: 15_000 });
      const changed = await runner(["diff", "--cached", "--quiet", "--exit-code"], { cwd: directory, allowExit: [1], timeoutMs: 10_000 });
      if (changed === 1) await runner(["commit", "-m", "Greenlight MVP generation"], { cwd: directory, timeoutMs: 30_000 });
      await runner(["push", destination, ref], { cwd: directory, token, timeoutMs: 60_000 });
    },
  };
}
