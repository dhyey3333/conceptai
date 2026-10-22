/** Runs once when the server starts: bring up the Python helper in the background. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startHelper } = await import("./lib/server/helper");
  void startHelper();
}
