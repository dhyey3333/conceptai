/**
 * Keeping the local model available.
 *
 * The local Ollama model is the last fallback, so it must not depend on
 * someone having started Ollama. When a request finds no server on this
 * computer, start one (`ollama serve`) and wait for it to answer (~8 s). On
 * Windows it stops with this app and is simply started again when needed.
 * OLLAMA_AUTOSTART=off disables this; OLLAMA_BIN names the executable when it
 * isn't on the PATH.
 */
import { spawn } from "node:child_process";

let starting: Promise<"started" | "missing" | "failed"> | null = null;

const isThisComputer = (baseUrl: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(baseUrl);

export async function ollamaUp(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start Ollama on this computer if it isn't running. Resolves "started" once
 * it answers, "missing" if Ollama isn't installed, "failed" otherwise.
 * Concurrent callers share one attempt.
 */
export function startOllama(baseUrl: string): Promise<"started" | "missing" | "failed"> {
  if (process.env.OLLAMA_AUTOSTART?.trim().toLowerCase() === "off" || !isThisComputer(baseUrl)) return Promise.resolve("failed");
  starting ??= (async () => {
    if (await ollamaUp(baseUrl)) return "started" as const;
    let missing = false;
    try {
      // `ollama` is a program on this computer, not a project file: don't let the bundler trace it.
      const child = spawn(/*turbopackIgnore: true*/ process.env.OLLAMA_BIN?.trim() || "ollama", ["serve"], {
        // Measured on Windows: a detached Ollama took ~65 s to start, an
        // attached one ~6 s, so it is only detached elsewhere.
        detached: process.platform !== "win32",
        stdio: "ignore",
        windowsHide: true,
        // Serve on the address the app expects.
        env: { ...process.env, OLLAMA_HOST: new URL(baseUrl).host },
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        missing = err.code === "ENOENT";
      });
      child.unref();
    } catch {
      return "failed" as const;
    }
    console.warn(`[conceptai] Ollama wasn't running; starting it at ${baseUrl}.`);
    // It usually answers within ~6 s; give a slow disk 30.
    const giveUp = Date.now() + 30_000;
    while (Date.now() < giveUp) {
      await new Promise((r) => setTimeout(r, 300));
      if (missing) return "missing" as const;
      if (await ollamaUp(baseUrl, 800)) return "started" as const;
    }
    return "failed" as const;
  })().finally(() => {
    starting = null;
  });
  return starting;
}
