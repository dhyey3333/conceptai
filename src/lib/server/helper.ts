/**
 * ConceptAI's Python helper (the python/ folder): exact maths checks with
 * SymPy, real algorithm traces for worked examples, running the Python code
 * lessons show (python/helper/coderun.py), and OCR for scanned PDF
 * pages. The server starts it in the background when it starts
 * (`uv run uvicorn` on 127.0.0.1:3110; the first run installs its packages).
 *
 * Everything it does is optional: if uv or Python isn't installed, or the
 * helper isn't up yet, those features are skipped and lessons work as before.
 * PY_HELPER=off turns it off; PY_HELPER_URL points at one running elsewhere.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.PY_HELPER_URL ?? "http://127.0.0.1:3110").replace(/\/$/, "");
const enabled = () => process.env.PY_HELPER?.trim().toLowerCase() !== "off";

/** Environment variables the helper must not see (keys, tokens, and the AI and database settings). */
export const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|COOKIE|^(LLM|GEMINI|GROQ|OPENAI|ANTHROPIC|SUPABASE|STT|TTS)_/i;

let starting: Promise<boolean> | null = null;
let lastUp = 0;

export async function helperUp(): Promise<boolean> {
  if (!enabled()) return false;
  if (Date.now() - lastUp < 30_000) return true;
  try {
    const ok = (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(800) })).ok;
    if (ok) lastUp = Date.now();
    return ok;
  } catch {
    return false;
  }
}

/** Start the helper if it isn't running. Resolves true once it answers. */
export function startHelper(): Promise<boolean> {
  if (!enabled()) return Promise.resolve(false);
  starting ??= (async () => {
    if (await helperUp()) return true;
    const root = process.cwd();
    const dir = path.join(/*turbopackIgnore: true*/ root, "python");
    if (!existsSync(/*turbopackIgnore: true*/ path.join(dir, "pyproject.toml"))) return false;
    const logs = path.join(/*turbopackIgnore: true*/ root, "logs");
    mkdirSync(logs, { recursive: true });
    const out = openSync(path.join(logs, "python.log"), "a");
    let missing = false;
    const port = new URL(BASE).port || "3110";
    // `uv run` creates the environment and installs the packages on the first start.
    const child = spawn(/*turbopackIgnore: true*/ process.env.UV_BIN?.trim() || "uv", ["run", "--project", dir, "uvicorn", "helper.app:app", "--host", "127.0.0.1", "--port", port], {
      cwd: dir,
      // The helper runs lesson code: it gets none of the API keys this server holds.
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET_ENV.test(k))) as NodeJS.ProcessEnv,
      stdio: ["ignore", out, out],
      windowsHide: true,
      // Lives as long as this server (see ollama.ts for why it isn't detached on Windows).
      detached: process.platform !== "win32",
    });
    child.on("error", () => (missing = true));
    child.unref();
    const giveUp = Date.now() + 180_000;
    while (Date.now() < giveUp) {
      await new Promise((r) => setTimeout(r, 700));
      if (missing) {
        console.warn("[conceptai] the Python helper needs uv (https://docs.astral.sh/uv/); its tools are off.");
        return false;
      }
      if (await helperUp()) {
        console.warn("[conceptai] Python helper is up (maths checks, algorithm traces, OCR).");
        return true;
      }
    }
    return false;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/** Call a helper route; null when the helper is off, down or slow (the caller then skips that feature). */
export async function callHelper<T>(route: string, body: object | FormData, timeoutMs = 10_000): Promise<T | null> {
  if (!(await helperUp())) {
    void startHelper();
    return null;
  }
  try {
    const form = body instanceof FormData;
    const res = await fetch(`${BASE}${route}`, {
      method: "POST",
      headers: form ? undefined : { "Content-Type": "application/json" },
      body: form ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** A real run of the algorithm a lesson part is about, as text for the prompt (or undefined). */
export async function workedExample(text: string): Promise<string | undefined> {
  const r = await callHelper<{ trace: { text: string } | null }>("/trace", { text: text.slice(0, 4000) }, 3000);
  return r?.trace?.text;
}

export interface PythonRun {
  ok: boolean;
  output: string;
  error?: string | null;
  line?: number | null;
  /** Not run: why (it imports something not allowed, say). */
  refused?: string | null;
}

/**
 * Run Python snippets in order in one fresh process, like notebook cells (a later
 * one may use what an earlier one defined). null when the helper is down or
 * PY_RUN_CODE=off: then no output is shown rather than an unverified one.
 */
export async function runPython(cells: string[]): Promise<PythonRun[] | null> {
  if (!cells.length || process.env.PY_RUN_CODE?.trim().toLowerCase() === "off") return null;
  const r = await callHelper<{ results: PythonRun[] }>("/code/run", { cells: cells.slice(-20) }, 12_000);
  return r?.results?.length === Math.min(cells.length, 20) ? r.results : null;
}

export interface MathFinding {
  id: string;
  latex: string;
  message: string;
}

/** Exact checks of equations ({id, latex}) and derivations ({id, lines}); only definite errors come back. */
export async function mathFindings(items: { id: string; latex?: string; lines?: string[] }[]): Promise<MathFinding[]> {
  if (!items.length) return [];
  const r = await callHelper<{ findings: MathFinding[] }>("/math/check", { items: items.slice(0, 200) }, 8000);
  return r?.findings ?? [];
}
