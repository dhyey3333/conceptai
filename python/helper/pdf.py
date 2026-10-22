"""
OCR for pages of a PDF that have no text layer (scanned or photographed
pages), so they can be taught like any other. Each page is rendered to an image
with PyMuPDF and read by RapidOCR, which runs on the CPU with its models
bundled: nothing to install separately and nothing sent anywhere.
"""

from __future__ import annotations

import threading

import pymupdf
import numpy as np

_engine = None
_lock = threading.Lock()


def _ocr():
    # Loading the models takes a second or two, so it happens once, on first use.
    global _engine
    with _lock:
        if _engine is None:
            from rapidocr_onnxruntime import RapidOCR

            _engine = RapidOCR()
        return _engine


def _read(image: np.ndarray) -> str:
    result, _ = _ocr()(image)
    if not result:
        return ""
    # Each result is (box, text, score); order lines top to bottom, then left to right.
    lines = sorted(result, key=lambda r: (round(min(p[1] for p in r[0]) / 12), min(p[0] for p in r[0])))
    return "\n".join(r[1] for r in lines if r[2] >= 0.5)


def ocr_pages(pdf: bytes, pages: list[int] | None = None, dpi: int = 200, limit: int = 300) -> list[dict]:
    """Text of the given pages (1-based; all pages without text when None), read by OCR."""
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    try:
        wanted = pages or [i + 1 for i in range(doc.page_count) if len(doc[i].get_text("text").strip()) < 30]
        out = []
        for n in wanted[:limit]:
            if not 1 <= n <= doc.page_count:
                continue
            pix = doc[n - 1].get_pixmap(dpi=dpi)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            if pix.n == 4:
                img = img[:, :, :3]
            out.append({"n": n, "text": _read(img[:, :, ::-1].copy())})  # RGB -> BGR, as OpenCV expects
        return out
    finally:
        doc.close()
