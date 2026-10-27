import { jsonError } from "@/lib/server/http";
import { helperVideo, JOB_ID } from "@/lib/server/video";

/** The finished MP4, streamed from the helper as a download. */
export async function GET(_req: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  if (!JOB_ID.test(job)) return jsonError(404, "not_found", "No such video.");
  // A long video takes a while to stream; the default 30 s would cut it off.
  const res = await helperVideo(`/video/${job}/file`, undefined, 600_000);
  if (!res.ok || !res.body) return res;
  return new Response(res.body, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": res.headers.get("content-disposition") ?? `attachment; filename="lesson.mp4"`,
      ...(res.headers.get("content-length") ? { "Content-Length": res.headers.get("content-length")! } : {}),
      "Cache-Control": "no-store",
    },
  });
}
