import { extractText, MAX_UPLOAD } from "@/lib/server/extract";
import { jsonError, rateLimit } from "@/lib/server/http";

/** Turn an uploaded syllabus / PDF / slide deck into plain text for the prompts. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "extract", 20);
  if (limited) return limited;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD + 100_000) {
    return jsonError(413, "too_large", "Files up to 15 MB are supported.");
  }
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(400, "bad_request", "No file received.");
    if (file.size > MAX_UPLOAD) return jsonError(413, "too_large", "Files up to 15 MB are supported.");
    const buf = new Uint8Array(await file.arrayBuffer());
    const { text, pages, truncated } = await extractText(file.name, file.type, buf);
    if (!text.trim()) {
      return jsonError(422, "no_text", "No readable text found (scanned PDFs need OCR first).");
    }
    return Response.json({ name: file.name.slice(0, 200), text, chars: text.length, pages, truncated });
  } catch (err) {
    return jsonError(422, "extract_failed", err instanceof Error ? err.message : "Couldn't read that file.");
  }
}
