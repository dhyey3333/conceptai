import { jsonError } from "@/lib/server/http";
import { helperVideo, JOB_ID } from "@/lib/server/video";

/** The lesson and beat lengths the /render page plays while it is recorded. */
export async function GET(_req: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  if (!JOB_ID.test(job)) return jsonError(404, "not_found", "No such video.");
  return helperVideo(`/video/${job}/data`);
}
