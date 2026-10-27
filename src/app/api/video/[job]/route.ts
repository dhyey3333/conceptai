import { jsonError } from "@/lib/server/http";
import { helperVideo, JOB_ID } from "@/lib/server/video";

/** A video's progress: {state: waiting|voice|recording|encoding|done|error, done, total, lengthMs, recordedMs}. */
export async function GET(_req: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  if (!JOB_ID.test(job)) return jsonError(404, "not_found", "No such video.");
  return helperVideo(`/video/${job}`);
}
