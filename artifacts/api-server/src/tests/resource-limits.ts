/** Bound test workers independently of the host's advertised CPU count. */
export function testResourceLimits(env: NodeJS.ProcessEnv): {
  concurrency: number;
  goMaxProcs: string;
} {
  const concurrency = Number(env.TEST_CONCURRENCY ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("TEST_CONCURRENCY must be an integer between 1 and 16.");
  }
  return { concurrency, goMaxProcs: env.GOMAXPROCS || "2" };
}