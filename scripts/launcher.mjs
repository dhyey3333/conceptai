/**
 * Run ConceptAI without a terminal (the desktop shortcut calls this through
 * scripts/windows/ConceptAI.vbs, which hides the console window).
 *
 *   node scripts/launcher.mjs               start if needed, then open the app in the browser
 *   node scripts/launcher.mjs --background  start if needed, open nothing (for starting with Windows)
 *   node scripts/launcher.mjs --stop        stop the app
 *
 * The app runs in production mode (faster and lighter than `next dev`) in the
 * background on port 3100 (CONCEPTAI_PORT). If the code changed since the last
 * build, it is rebuilt first, so the shortcut always runs the latest version.
 * While it starts, the browser shows a "Starting ConceptAI…" page that turns
 * into the app as soon as it answers. Output goes to the logs/ folder.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.CONCEPTAI_PORT) || 3100;
const APP_URL = `http://localhost:${PORT}`;
const LOGS = path.join(root, "logs");
const NEXT_BIN = path.join(root, "node_modules", "next", "dist", "bin", "next");
const RECORD = path.join(LOGS, "server.json");
const WIN = process.platform === "win32";
mkdirSync(LOGS, { recursive: true });

const log = (msg) => appendFileSync(path.join(LOGS, "launcher.log"), `${new Date().toISOString()}  ${msg}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isUp() {
  try {
    return (await fetch(`${APP_URL}/api/status`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

/** PID of whatever listens on the app's port, if anything. */
function listenerPid() {
  try {
    if (WIN) {
      const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
      const line = out.split(/\r?\n/).find((l) => /LISTENING/.test(l) && new RegExp(`:${PORT}\\s`).test(l.trim().split(/\s+/)[1] + " "));
      return line ? Number(line.trim().split(/\s+/).pop()) : null;
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
    return out ? Number(out.split("\n")[0]) : null;
  } catch {
    return null;
  }
}

/** Only ever stop a Node process (the app), never something else that took the port. */
function isNode(pid) {
  try {
    if (!WIN) return /node/.test(execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }));
    return /node\.exe/i.test(execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8", windowsHide: true }));
  } catch {
    return false;
  }
}

/** Newest change to anything that goes into the build. */
function newestSource() {
  let newest = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(path.join(root, "src"));
  for (const f of ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs", ".env.local"]) {
    const p = path.join(root, f);
    if (existsSync(p)) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

function buildIsStale() {
  const id = path.join(root, ".next", "BUILD_ID");
  return !existsSync(id) || newestSource() > statSync(id).mtimeMs;
}

function run(cmd, args, label) {
  const out = openSync(path.join(LOGS, `${label}.log`), "w");
  log(`${label}: ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: ["ignore", out, out], windowsHide: true, shell: WIN && cmd === "npm" });
  return r.status === 0;
}

function build() {
  if (!existsSync(NEXT_BIN) && !run("npm", ["install"], "install")) return "Installing the app's packages failed.";
  return run(process.execPath, [NEXT_BIN, "build"], "build") ? null : "Building the app failed.";
}

async function start() {
  const out = openSync(path.join(LOGS, "server.log"), "a");
  // Detached so it keeps running after this launcher exits.
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT)], {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, NODE_ENV: "production" },
  });
  child.unref();
  writeFileSync(RECORD, JSON.stringify({ pid: child.pid, startedAt: Date.now() }));
  log(`started the app (pid ${child.pid}) on ${APP_URL}`);
  for (let i = 0; i < 120; i++) {
    if (await isUp()) return true;
    await sleep(500);
  }
  return false;
}

function stop() {
  const pid = listenerPid();
  if (!pid) return log("stop: nothing is running");
  if (!isNode(pid)) return log(`stop: port ${PORT} is used by another program (pid ${pid}); left alone`);
  if (WIN) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  else process.kill(pid);
  log(`stopped the app (pid ${pid})`);
}

/** The app we started (rather than, say, a dev server someone runs on the same port). */
function runningIsOurs() {
  try {
    return JSON.parse(readFileSync(RECORD, "utf8")).pid === listenerPid();
  } catch {
    return false;
  }
}

function open(target) {
  if (WIN) spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
}

/** A local page that waits for the app and then turns into it, so a double-click always shows something. */
function waitingPage(title, error) {
  const file = path.join(LOGS, "starting.html");
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#07090e;color:#e8e6f0;font:16px system-ui,sans-serif}
.box{text-align:center;max-width:420px;padding:24px}.logo{width:56px;height:56px;border-radius:16px;margin:0 auto 18px;background:linear-gradient(135deg,#a597ff,#7c6cff,#2dd4bf)}
.spin{width:22px;height:22px;margin:18px auto 0;border:3px solid #ffffff22;border-top-color:#a597ff;border-radius:50%;animation:s 0.9s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
small{display:block;margin-top:10px;color:#8b8799;line-height:1.5}.err{color:#ff8080}</style>
<div class="box"><div class="logo"></div><div>${error ? `<span class="err">${error}</span>` : title}</div>
${error ? `<small>Details are in ${path.join(LOGS, "build.log")}</small>` : `<div class="spin"></div><small id="hint">The first start after an update takes about a minute.</small>`}</div>
${error ? "" : `<script>
// Ping the app by loading its icon: a local file may always load images, while fetch() from file:// is restricted.
const t0 = Date.now();
function poll() {
  const img = new Image();
  img.onload = () => location.replace("${APP_URL}");
  img.onerror = () => {
    if (Date.now() - t0 > 180000) document.getElementById("hint").textContent = "This is taking longer than usual. See ${path.join(LOGS, "server.log").replace(/\\/g, "\\\\")}";
    setTimeout(poll, 1000);
  };
  img.src = "${APP_URL}/icon.svg?" + Date.now();
}
poll();
</script>`}`;
  writeFileSync(file, html);
  return file;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--stop")) return stop();
  const show = !args.has("--background");
  const up = await isUp();
  const stale = buildIsStale();
  // Already running and up to date (or a server we didn't start, e.g. a dev server): just open it.
  if (up && !(stale && runningIsOurs())) {
    log(up && stale ? "running (not ours to restart); opening it" : "already running; opening it");
    if (show) open(APP_URL);
    return;
  }
  if (show) open(waitingPage(up ? "Updating ConceptAI…" : "Starting ConceptAI…"));
  if (up) stop();
  if (stale) {
    log("the code changed since the last build: rebuilding");
    const error = build();
    if (error) {
      log(error);
      if (show) open(waitingPage("ConceptAI couldn't start", error));
      return;
    }
  }
  if (!(await start())) log("the app didn't answer within a minute; see server.log");
}

main().catch((err) => log(`launcher error: ${err?.stack ?? err}`));
