/**
 * Lesson videos are made by the Python helper (python/helper/video.py): it
 * speaks every beat with the offline voice, records the app's /render page in
 * headless Chromium, and joins both into an MP4. These routes only pass
 * requests through, so the helper's own messages ("too long", "not ready")
 * reach the student unchanged.
 */
import { BASE, helperUp, startHelper } from "./helper";
import { jsonError } from "./http";

/** Video job ids are 16 hex characters (helper/video.py). */
export const JOB_ID = /^[0-9a-f]{16}$/;

export async function helperVideo(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<Response> {
  if (!(await helperUp())) {
    void startHelper();
    return jsonError(503, "helper_down", "The Python tools aren't running, so a video can't be made right now. They start with the app; try again in a minute.");
  }
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return res;
    // FastAPI errors are {"detail": "..."}.
    const detail = await res.json().then((j: { detail?: unknown }) => (typeof j.detail === "string" ? j.detail : undefined)).catch(() => undefined);
    return jsonError(res.status, "video_failed", detail ?? `The video helper answered ${res.status}.`);
  } catch {
    return jsonError(503, "helper_down", "The video helper didn't answer.");
  }
}
