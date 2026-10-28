"""The teacher's voice, made on this computer: Kokoro (Apache-2.0 model, MIT runtime).

Free and offline after a one-time download of about 120 MB (the int8 model and
the voice styles) into python/models/, made the first time a voice is asked
for. Used for lesson videos (a browser voice can't be saved to a file) and,
when no cloud voice is set up, for normal lessons too.
"""

from __future__ import annotations

import io
import os
import threading
import time
import urllib.request
import wave
from contextlib import contextmanager
from pathlib import Path

import numpy as np

MODELS = Path(__file__).resolve().parent.parent / "models"
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
FILES = {"kokoro-v1.0.int8.onnx": 92_361_271, "voices-v1.0.bin": 28_214_398}

# Voices by lesson language; PY_TTS_VOICE overrides the English one.
VOICES = {"english": ("af_heart", "en-us"), "hinglish": ("af_heart", "en-us"), "hindi": ("hf_alpha", "hi")}

_lock = threading.Lock()
_engine = None
_state = {"downloading": False, "error": None, "progress": 0.0}


def _fetch(url: str, path: Path, size: int, before: int) -> None:
    """Download with a timeout, retries, and resuming where it stopped (slow or flaky connections)."""
    part = path.with_suffix(path.suffix + ".part")
    if part.exists() and part.stat().st_size > size:
        part.unlink()  # can't be right: start this file again
    for attempt in range(40):
        have = part.stat().st_size if part.exists() else 0
        if have >= size:
            break
        try:
            req = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {})
            with urllib.request.urlopen(req, timeout=30) as r:
                resumed = have and r.status == 206
                with open(part, "ab" if resumed else "wb") as f:
                    got = have if resumed else 0
                    touched = time.time()
                    while chunk := r.read(1 << 16):
                        f.write(chunk)
                        got += len(chunk)
                        _state["progress"] = round((before + got) / sum(FILES.values()), 3)
                        if time.time() - touched > 10:
                            os.utime(LOCK)  # still downloading: the lock isn't stale
                            touched = time.time()
        except OSError:  # timeouts and dropped connections included
            time.sleep(min(30, 2**attempt))
    if not part.exists() or part.stat().st_size != size:
        raise RuntimeError(f"couldn't download {path.name} (the connection kept failing)")
    part.replace(path)


LOCK = MODELS / ".download.lock"


def _take_lock() -> bool:
    """Only one process downloads (two writing one file would corrupt it). A lock untouched for 2 minutes was left by a process that died."""
    try:
        os.close(os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        return True
    except FileExistsError:
        if time.time() - LOCK.stat().st_mtime > 120:
            LOCK.unlink(missing_ok=True)
            return _take_lock()
        return False


def _download() -> None:
    MODELS.mkdir(parents=True, exist_ok=True)
    while not installed() and not _take_lock():
        time.sleep(5)  # another process is downloading: wait for it
    if installed():
        return
    try:
        before = 0
        for name, size in FILES.items():
            path = MODELS / name
            if not (path.exists() and path.stat().st_size == size):
                _fetch(f"{RELEASE}/{name}", path, size, before)
            before += size
    finally:
        LOCK.unlink(missing_ok=True)


def engine():
    """The loaded voice model (downloaded first if needed). Thread-safe; loads once."""
    global _engine
    with _lock:
        if _engine is None:
            _state["downloading"] = True
            try:
                _download()
                from kokoro_onnx import Kokoro

                _engine = Kokoro(str(MODELS / "kokoro-v1.0.int8.onnx"), str(MODELS / "voices-v1.0.bin"))
                _state["error"] = None
            except Exception as e:  # reported by /health, retried on the next request
                _state["error"] = str(e)[:200]
                raise
            finally:
                _state["downloading"] = False
        return _engine


def installed() -> bool:
    """Both model files are fully on disk (the voice can answer in a second or two, without a download)."""
    return all((MODELS / name).exists() and (MODELS / name).stat().st_size == size for name, size in FILES.items())


def prefetch() -> None:
    """Download and load the voice in the background (when the helper starts), so it is ready when wanted."""
    if os.environ.get("PY_TTS", "").strip().lower() == "off":
        return
    try:
        engine()
    except Exception:
        pass  # reported by state(); tried again on the next request


def state() -> dict:
    return {
        "ready": _engine is not None,
        "installed": installed(),
        "downloading": _state["downloading"],
        "progress": _state["progress"],
        "error": _state["error"],
    }


def voice_for(language: str) -> tuple[str, str]:
    """(Kokoro voice, phoneme language) for a lesson language."""
    voice, lang = VOICES.get(language, VOICES["english"])
    return (voice if language == "hindi" else os.environ.get("PY_TTS_VOICE", voice)), lang


_live = {"n": 0}
_live_lock = threading.Lock()


@contextmanager
def live():
    """Marks speech a lesson is waiting for right now (background videos give way to it)."""
    with _live_lock:
        _live["n"] += 1
    try:
        yield
    finally:
        with _live_lock:
            _live["n"] -= 1


def live_busy() -> bool:
    return _live["n"] > 0


def synthesize(text: str, language: str = "english", speed: float = 1.0) -> tuple[np.ndarray, int]:
    """Speech for one piece of narration: float samples in [-1, 1] and the sample rate."""
    voice, lang = voice_for(language)
    samples, rate = engine().create(text[:2000], voice=voice, speed=max(0.5, min(2.0, speed)), lang=lang)
    return np.asarray(samples, dtype=np.float32), rate


def to_wav(samples: np.ndarray, rate: int) -> bytes:
    """16-bit mono WAV bytes."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()
