import pymupdf

from helper.pdf import ocr_pages


def scanned_pdf(text_lines: list[str]) -> bytes:
    """A one-page PDF whose page is only an image of text (no text layer), like a scan."""
    src = pymupdf.open()
    page = src.new_page(width=595, height=842)
    y = 80
    for line in text_lines:
        page.insert_text((60, y), line, fontsize=16)
        y += 30
    pix = page.get_pixmap(dpi=150)
    scan = pymupdf.open()
    p = scan.new_page(width=595, height=842)
    p.insert_image(p.rect, stream=pix.tobytes("png"))
    assert p.get_text().strip() == ""  # really no text layer
    return scan.tobytes()


def test_reads_a_scanned_page():
    pdf = scanned_pdf(["Chapter 3: Edge Detection", "The Sobel operator estimates the image gradient.", "Threshold the magnitude to find edges."])
    [page] = ocr_pages(pdf)
    assert page["n"] == 1
    text = page["text"].lower()
    for word in ("edge detection", "sobel", "gradient", "threshold"):
        assert word in text, (word, page["text"])
