"""Lesson videos: the whiteboard lesson as an MP4 with the teacher's voice.

A job has four steps:
1. Voice: every beat's narration is spoken by the offline voice (tts.py), which
   also fixes how long each beat lasts.
2. Recording: headless Chromium opens the app's /render/<job> page, which plays
   the lesson on the whiteboard with exactly those durations. Frames come from
   Chromium's screencast and are fed to ffmpeg at a steady 30 fps by wall
   clock, so video time is real time.
3. The page notes when each beat really started; each voice clip is placed at
   that moment in one narration track.
4. Encoding: ffmpeg puts video and narration together in an MP4.

Recording runs in real time (a 10-minute lesson takes about 10 minutes), so
the app starts a lesson's video by itself as soon as the lesson is written
("auto"), and a click on Download later finds it ready. Finished videos are
kept in python/videos/ (the newest 40), named by a hash of the lesson's
content: asking again for the same lesson is instant, and a changed lesson
gets a new video. One video is made at a time, a second request for one being
made joins it, and a background video gives way to the lesson's own voice.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import tts

FPS = 30
SIZE = (1280, 720)
LEAD_MS = 1500  # the title card before the first beat
TAIL_MS = 2000  # the last board stays up a moment
KEEP_S = 3600  # finished or failed jobs are forgotten after an hour (their videos stay in VIDEOS)
VIDEOS = Path(__file__).resolve().parent.parent / "videos"
KEEP_VIDEOS = 40
VERSION = 1  # part of every video's key: bump when the video's look changes, so old ones are remade
MAX_AUTO_WAITING = 2  # background videos queued at once; more are refused (the app asks again later)
APP_URL = re.compile(r"^http://(127\.0\.0\.1|localhost):\d{2,5}$")


@dataclass
class Job:
    id: str
    lesson: dict
    app_url: str
    created: float = field(default_factory=time.time)
    state: str = "waiting"  # waiting | voice | recording | encoding | done | error
    done: int = 0
    total: int = 0
    error: str | None = None
    durations: list[list[int]] = field(default_factory=list)
    key: str = ""
    auto: bool = False
    dir: Path | None = None  # working files while it is made
    file: Path | None = None
    length_ms: int = 0
    recorded_ms: int = 0

    def status(self) -> dict:
        return {
            "id": self.id,
            "state": self.state,
            "done": self.done,
            "total": self.total,
            "error": self.error,
            "lengthMs": self.length_ms,
            "recordedMs": self.recorded_ms,
            # The first video may be waiting for the one-time voice download.
            "voiceDownload": None if tts.installed() else tts.state()["progress"],
        }

    def download_name(self) -> str:
        safe = re.sub(r"[^A-Za-z0-9 _-]+", "", self.lesson["title"]).strip()[:60] or "lesson"
        return f"{safe}.mp4"


class Busy(Exception):
    """Too many background videos already waiting."""


_jobs: dict[str, Job] = {}
_one_at_a_time = threading.Lock()


def _cleanup() -> None:
    for jid, job in list(_jobs.items()):
        if time.time() - job.created > KEEP_S and job.state in ("done", "error"):
            _jobs.pop(jid, None)


def content_key(lesson: dict) -> str:
    """Same lesson content, same voice, same look: same video."""
    language = lesson.get("language", "english")
    what = {
        "v": VERSION,
        "title": lesson["title"],
        "language": language,
        "voice": tts.voice_for(language)[0],
        "parts": [{"title": p["title"], "beats": [{k: b.get(k) for k in ("say", "speech", "draw", "point")} for b in p["beats"]]} for p in lesson["parts"]],
    }
    return hashlib.sha256(json.dumps(what, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:32]


def start(lesson: dict, app_url: str, auto: bool = False) -> Job:
    """A video of `lesson` ({title, language, parts:[{title, beats:[{say, speech, draw, point}]}]}): already made, being made, or queued now."""
    if not APP_URL.match(app_url):
        raise ValueError("the app must be on this computer")
    _cleanup()
    key = content_key(lesson)
    made = VIDEOS / f"{key}.mp4"
    if made.exists():
        made.touch()  # recently wanted: kept longest
        job = Job(id=uuid.uuid4().hex[:16], lesson=lesson, app_url=app_url, key=key, state="done", done=1, total=1, file=made)
        _jobs[job.id] = job
        return job
    for job in _jobs.values():
        if job.key == key and job.state != "error":
            job.auto = job.auto and auto  # a person is waiting for it now
            return job
    if auto and sum(1 for j in _jobs.values() if j.auto and j.state == "waiting") >= MAX_AUTO_WAITING:
        raise Busy()
    job = Job(id=uuid.uuid4().hex[:16], lesson=lesson, app_url=app_url, key=key, auto=auto)
    job.total = sum(len(p["beats"]) for p in lesson["parts"])
    _jobs[job.id] = job
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return job


def get(jid: str) -> Job | None:
    return _jobs.get(jid)


def render_data(job: Job) -> dict:
    """What the /render page plays: the lesson (without the speech text) and each beat's length."""
    parts = [{"title": p["title"], "beats": [{k: b.get(k) for k in ("say", "draw", "point")} for b in p["beats"]]} for p in job.lesson["parts"]]
    return {"title": job.lesson["title"], "parts": parts, "durations": job.durations, "leadMs": LEAD_MS, "tailMs": TAIL_MS}


def _run(job: Job) -> None:
    with _one_at_a_time:
        job.dir = Path(tempfile.mkdtemp(prefix="conceptai-video-"))
        try:
            clips = _voice(job)
            starts, t0, frames = _record(job)
            job.state, job.done, job.total = "encoding", 0, 1
            job.file = _encode(job, clips, starts, t0, frames)
            job.state = "done"
            _prune()
        except Exception as e:
            job.state, job.error = "error", f"{type(e).__name__}: {e}"[:400]
        finally:
            shutil.rmtree(job.dir, ignore_errors=True)


def _prune() -> None:
    """Keep the newest KEEP_VIDEOS videos (a video used again counts as new)."""
    videos = sorted(VIDEOS.glob("*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True)
    for old in videos[KEEP_VIDEOS:]:
        old.unlink(missing_ok=True)


def _voice(job: Job) -> list[tuple[np.ndarray, int] | None]:
    job.state, job.done = "voice", 0
    language = job.lesson.get("language", "english")
    clips: list[tuple[np.ndarray, int] | None] = []
    for part in job.lesson["parts"]:
        lengths = []
        for beat in part["beats"]:
            text = (beat.get("speech") or "").strip()
            # A background video waits while the lesson being watched needs its voice.
            while job.auto and tts.live_busy():
                time.sleep(0.2)
            clip = tts.synthesize(text, language) if text else None
            clips.append(clip)
            lengths.append(round(len(clip[0]) / clip[1] * 1000) if clip else 0)
            job.done += 1
        job.durations.append(lengths)
    return clips


def _record(job: Job) -> tuple[list[float], float, int]:
    """Play the lesson in headless Chromium and record it. Returns beat start times, the video's start, and its frame count."""
    from playwright.sync_api import sync_playwright

    job.state, job.done = "recording", 0
    raw = job.dir / "video.mp4"
    ffmpeg = subprocess.Popen(
        [_ffmpeg(), "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
         "-vf", f"scale={SIZE[0]}:{SIZE[1]}:force_original_aspect_ratio=decrease,pad={SIZE[0]}:{SIZE[1]}:(ow-iw)/2:(oh-ih)/2",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", str(raw)],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    latest: dict[str, bytes | None] = {"frame": None}
    stop = threading.Event()
    written = {"n": 0}
    t0 = 0.0
    thread: threading.Thread | None = None

    def writer() -> None:
        # One frame every 1/30 s of wall clock, repeating the latest screenshot, so video time is real time.
        while not stop.is_set():
            due = int((time.time() - t0) * FPS) + 1
            while written["n"] < due and latest["frame"]:
                ffmpeg.stdin.write(latest["frame"])
                written["n"] += 1
            time.sleep(1 / (FPS * 2))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": SIZE[0], "height": SIZE[1]}, device_scale_factor=1)
            cdp = page.context.new_cdp_session(page)

            def on_frame(params: dict) -> None:
                import base64

                latest["frame"] = base64.b64decode(params["data"])
                cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]})

            cdp.on("Page.screencastFrame", on_frame)
            page.goto(f"{job.app_url}/render/{job.id}")
            page.wait_for_function("window.__render && window.__render.ready", timeout=60_000)
            cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 90, "maxWidth": SIZE[0], "maxHeight": SIZE[1], "everyNthFrame": 1})
            # Wait for the first frame, then start the clock and the lesson together.
            deadline = time.time() + 10
            while not latest["frame"] and time.time() < deadline:
                page.wait_for_timeout(50)
            t0 = time.time()
            thread = threading.Thread(target=writer, daemon=True)
            thread.start()
            page.evaluate("window.__render.start()")
            speech_ms = sum(sum(d) for d in job.durations)
            job.length_ms = LEAD_MS + TAIL_MS + speech_ms
            give_up = time.time() + speech_ms / 1000 * 3 + 600
            while time.time() < give_up:
                page.wait_for_timeout(250)
                info = page.evaluate("({ done: window.__render.done, index: window.__render.index })")
                job.done = info["index"]
                job.recorded_ms = round((time.time() - t0) * 1000)
                if info["done"]:
                    break
            else:
                raise TimeoutError("the lesson didn't finish playing")
            starts = page.evaluate("window.__render.starts")
            cdp.send("Page.stopScreencast")
        except BaseException:
            ffmpeg.kill()
            raise
        finally:
            stop.set()
            browser.close()
            if thread:
                thread.join(timeout=5)
    ffmpeg.stdin.close()
    if ffmpeg.wait(timeout=300) != 0:
        raise RuntimeError(f"ffmpeg: {ffmpeg.stderr.read().decode(errors='replace')[-300:]}")
    # A beat that never started (none should) gets no voice rather than a wrong place.
    return [s / 1000 if s else None for s in starts], t0, written["n"]


def narration_track(clips: list, starts: list[float | None], t0: float, seconds: float) -> tuple[np.ndarray, int]:
    """One audio track as long as the video, with each beat's clip placed where that beat started (seconds since t0)."""
    rate = next((c[1] for c in clips if c), 24000)
    track = np.zeros(int(seconds * rate) + rate, dtype=np.float32)
    for clip, start in zip(clips, starts):
        if not clip or start is None:
            continue
        at = max(0, int((start - t0) * rate))
        seg = clip[0][: max(0, len(track) - at)]
        track[at : at + len(seg)] += seg
    return track, rate


def _encode(job: Job, clips: list, starts: list[float | None], t0: float, frames: int) -> Path:
    """Lay each voice clip where its beat started, then join narration and video."""
    track, rate = narration_track(clips, starts, t0, frames / FPS)
    narration = job.dir / "narration.wav"
    narration.write_bytes(tts.to_wav(track, rate))
    out = job.dir / "lesson.mp4"
    done = subprocess.run(
        [_ffmpeg(), "-y", "-loglevel", "error", "-i", str(job.dir / "video.mp4"), "-i", str(narration),
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(out)],
        capture_output=True,
    )
    if done.returncode != 0:
        raise RuntimeError(f"ffmpeg: {done.stderr.decode(errors='replace')[-300:]}")
    VIDEOS.mkdir(parents=True, exist_ok=True)
    kept = VIDEOS / f"{job.key}.mp4"
    shutil.move(str(out), kept)  # only a finished video ever has this name
    job.done = 1
    return kept


def _ffmpeg() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()
