"""
The helper's web service, listening on this computer only (127.0.0.1). The
ConceptAI server calls it; if it isn't running, every feature here is simply
skipped and lessons work as before.

    uv run uvicorn helper.app:app --host 127.0.0.1 --port 3110
"""

from __future__ import annotations

from fastapi import FastAPI, File, Form, UploadFile
from pydantic import BaseModel, Field

from . import coderun, mathcheck, traces

app = FastAPI(title="ConceptAI helper")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "tools": ["math", "trace", "ocr", "code"]}


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
