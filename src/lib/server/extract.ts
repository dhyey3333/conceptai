/**
 * Text extraction from uploaded study material: PDF (via unpdf / pdf.js),
 * PowerPoint and Word (they're zip files of XML; we read the text runs),
 * and plain text / Markdown. Nothing is executed and nothing is stored.
 */
import { strFromU8, unzipSync } from "fflate";
import { callHelper } from "./helper";

export const MAX_UPLOAD = 15 * 1024 * 1024;
const MAX_UNZIPPED_FILE = 25 * 1024 * 1024;
// About 250 pages: the whole of a typical module or deck. Lessons read it through a page map (see lib/source/document).
const MAX_TEXT = 400_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** Text runs of an OOXML part, with paragraph breaks. */
function ooxmlText(xml: string, runTag: "a:t" | "w:t", paraTag: "a:p" | "w:p"): string {
  const withBreaks = xml.replace(new RegExp(`</${paraTag}>`, "g"), "\n");
  const runs = withBreaks.match(new RegExp(`<${runTag}(?:\\s[^>]*)?>[^<]*</${runTag}>|\\n`, "g")) ?? [];
  return runs
    .map((r) => (r === "\n" ? "\n" : decodeXml(r.replace(/<[^>]+>/g, ""))))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unzip(buf: Uint8Array, want: (name: string) => boolean) {
  // The size filter guards against zip bombs.
  return unzipSync(buf, { filter: (f) => want(f.name) && f.originalSize < MAX_UNZIPPED_FILE });
}

async function pdfText(buf: Uint8Array): Promise<{ text: string; pages: number; ocr: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf.slice());
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? [...text] : [text];
  // Scanned or photographed pages have no text layer: read them by OCR (Python helper), when it's running.
  const empty = pages.flatMap((t, i) => (t.trim().length < 30 ? [i + 1] : []));
  let ocr = 0;
  if (empty.length) {
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(buf)], { type: "application/pdf" }), "document.pdf");
    form.append("pages", empty.join(","));
    const r = await callHelper<{ pages: { n: number; text: string }[] }>("/pdf/ocr", form, 20_000 + empty.length * 5_000);
    for (const p of r?.pages ?? []) {
      if (p.text.trim().length >= 10 && p.n >= 1 && p.n <= pages.length) {
        pages[p.n - 1] = p.text;
        ocr++;
      }
    }
  }
  // Mark every page, so lessons can be planned and taught page by page.
  return { text: pages.map((t, i) => `[page ${i + 1}]\n${t.trim()}`).join("\n\n"), pages: totalPages, ocr };
}

function pptxText(buf: Uint8Array): { text: string; pages: number } {
  const files = unzip(buf, (n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
  const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)![1]);
  const slides = Object.keys(files)
    .filter((n) => n.startsWith("ppt/slides/"))
    .sort((a, b) => num(a) - num(b));
  const parts = slides.map((name) => {
    const body = ooxmlText(strFromU8(files[name]), "a:t", "a:p");
    const notesName = `ppt/notesSlides/notesSlide${num(name)}.xml`;
    const notes = files[notesName] ? ooxmlText(strFromU8(files[notesName]), "a:t", "a:p").replace(/^\d+\s*$/m, "").trim() : "";
    return `--- Slide ${num(name)} ---\n${body}${notes ? `\nSpeaker notes: ${notes}` : ""}`;
  });
  return { text: parts.join("\n\n"), pages: slides.length };
}

function docxText(buf: Uint8Array): { text: string; pages: number } {
  const files = unzip(buf, (n) => n === "word/document.xml");
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("This Word file has no document body.");
  return { text: ooxmlText(strFromU8(xml), "w:t", "w:p"), pages: 0 };
}

export async function extractText(name: string, type: string, buf: Uint8Array): Promise<{ text: string; pages: number; truncated: boolean; ocr: number }> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  let out: { text: string; pages: number; ocr?: number };
  if (ext === "pdf" || type === "application/pdf") out = await pdfText(buf);
  else if (ext === "pptx") out = pptxText(buf);
  else if (ext === "docx") out = docxText(buf);
  else if (["txt", "md", "markdown", "csv"].includes(ext) || type.startsWith("text/")) out = { text: new TextDecoder().decode(buf), pages: 0 };
  else throw new Error("Unsupported file type. Upload a PDF, PPTX, DOCX, TXT or MD file.");

  // eslint-disable-next-line no-control-regex
  const clean = out.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[ \t]+\n/g, "\n").trim();
  return { text: clean.slice(0, MAX_TEXT), pages: out.pages, truncated: clean.length > MAX_TEXT, ocr: out.ocr ?? 0 };
}
