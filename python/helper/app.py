"""
The helper's web service, listening on this computer only (127.0.0.1). The
ConceptAI server calls it; if it isn't running, every feature here is simply
skipped and lessons work as before.

    uv run uvicorn helper.app:app --host 127.0.0.1 --port 3110
"""

from __future__ import annotations

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from . import coderun, mathcheck, traces, tts, video

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # The offline voice is a one-time ~120 MB download: start it now, so it's there when a lesson or video wants it.
    threading.Thread(target=tts.prefetch, daemon=True).start()
    yield


app = FastAPI(title="ConceptAI helper", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "tools": ["math", "trace", "ocr", "code", "tts", "video"], "tts": tts.state()}


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="english", max_length=20)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


@app.post("/tts")
def speak(req: TtsRequest) -> Response:
    """The narration as a WAV file, spoken on this computer (the first call downloads the voice)."""
    try:
        with tts.live():  # a lesson is waiting: background videos give way
            samples, rate = tts.synthesize(req.text, req.language, req.speed)
    except Exception as e:
        raise HTTPException(503, f"The offline voice isn't available: {e}"[:300]) from e
    duration = round(len(samples) / rate * 1000)
    return Response(tts.to_wav(samples, rate), media_type="audio/wav", headers={"X-Duration-Ms": str(duration)})


class MathItem(BaseModel):
    id: str = Field(max_length=40)
    latex: str | None = Field(default=None, max_length=2000)
    lines: list[str] | None = Field(default=None, max_length=12)


class MathRequest(BaseModel):
    items: list[MathItem] = Field(max_length=200)


@app.post("/math/check")
def math_check(req: MathRequest) -> dict:
    """Exact checks of equations and derivations; returns only what is definitely wrong."""
    findings = []
    for item in req.items:
        if item.lines:
            findings += mathcheck.check_steps(item.id, [l[:400] for l in item.lines])
        elif item.latex:
            findings += mathcheck.check_equation(item.id, item.latex[:400])
    return {"findings": [f.__dict__ for f in findings]}


class TraceRequest(BaseModel):
    text: str = Field(default="", max_length=4000)
    algorithm: str | None = Field(default=None, max_length=40)
    input: list[float] | None = Field(default=None, max_length=50)
    target: int | None = None


@app.post("/trace")
def trace(req: TraceRequest) -> dict:
    """A real run of the algorithm the text is about (or the one named), or null if it isn't one we run."""
    name = req.algorithm or traces.detect(req.text)
    return {"trace": traces.run(name, req.input, req.target) if name else None}


class CodeRequest(BaseModel):
    cells: list[str] = Field(max_length=20)


@app.post("/code/run")
def code_run(req: CodeRequest) -> dict:
    """Run lesson snippets in order (later ones may use what earlier ones define); one result each."""
    return {"results": [r.__dict__ for r in coderun.run_cells([c[: coderun.MAX_CHARS + 1] for c in req.cells])]}


@app.post("/pdf/ocr")
async def pdf_ocr(file: UploadFile = File(...), pages: str = Form("")) -> dict:
    """OCR the given pages ("3,5,7"), or every page without a text layer."""
    from .pdf import ocr_pages  # loads PyMuPDF and the OCR models only when needed

    data = await file.read(16 * 1024 * 1024)
    wanted = [int(p) for p in pages.split(",") if p.strip().isdigit()] or None
    return {"pages": ocr_pages(data, wanted)}


class VideoBeat(BaseModel):
    say: str = Field(default="", max_length=1200)
    speech: str = Field(default="", max_length=1200)
    draw: list[dict] = Field(default_factory=list, max_length=8)
    point: str | None = Field(default=None, max_length=40)


class VideoPart(BaseModel):
    title: str = Field(max_length=200)
    beats: list[VideoBeat] = Field(max_length=60)


class VideoLesson(BaseModel):
    title: str = Field(max_length=200)
    language: str = Field(default="english", max_length=20)
    parts: list[VideoPart] = Field(min_length=1, max_length=60)


class VideoRequest(BaseModel):
    lesson: VideoLesson
    appUrl: str = Field(max_length=60)
    # Started by the app on its own (the lesson was just written), not by a click.
    auto: bool = False


def _job(jid: str) -> video.Job:
    job = video.get(jid)
    if not job:
        raise HTTPException(404, "No such video (videos are kept for an hour).")
    return job


@app.post("/video/start")
def video_start(req: VideoRequest) -> dict:
    """Start making a lesson video; poll /video/{id} for progress."""
    if sum(len(p.beats) for p in req.lesson.parts) > 400:
        raise HTTPException(413, "The lesson is too long for one video.")
    try:
        job = video.start(req.lesson.model_dump(), req.appUrl, auto=req.auto)
    except video.Busy as e:
        raise HTTPException(429, "Other videos are being made; this one will be made later.") from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return job.status()


@app.get("/video/{jid}")
def video_status(jid: str) -> dict:
    return _job(jid).status()


@app.get("/video/{jid}/data")
def video_data(jid: str) -> dict:
    """The lesson and beat lengths, for the app's /render page that is being recorded."""
    return video.render_data(_job(jid))


@app.get("/video/{jid}/file")
def video_file(jid: str) -> FileResponse:
    job = _job(jid)
    if job.state != "done" or not job.file:
        raise HTTPException(409, "The video isn't ready yet.")
    return FileResponse(job.file, media_type="video/mp4", filename=job.download_name())
