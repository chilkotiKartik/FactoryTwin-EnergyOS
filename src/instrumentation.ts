/** Runs once when the Node.js server starts: check configuration and start background jobs. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv } = await import("./server/env");
  const { warnings } = checkEnv();
  for (const w of warnings) console.warn(`[energyos] ${w}`);
  if (process.env.ENERGYOS_JOBS === "false") return;
  const { startBackgroundJobs } = await import("./server/services/jobs");
  startBackgroundJobs();
}
