/**
 * Refuse to execute integration fixtures unless the API harness selected its
 * per-run database. Never print DATABASE_URL here because it contains
 * credentials.
 */
export function assertIsolatedApiTestDatabase(env: NodeJS.ProcessEnv = process.env): void {
  let target: URL;
  try {
    target = new URL(env["DATABASE_URL"] ?? "");
  } catch {
    throw new Error("API integration tests require the isolated test database created by src/tests/run.ts.");
  }
  if (!/^\/test_api_\d+_\d+$/.test(target.pathname)) {
    throw new Error("API integration tests refuse databases not created by the isolated test harness.");
  }
  if (env["NODE_ENV"] !== undefined && env["NODE_ENV"] !== "test") {
    throw new Error("API integration tests require NODE_ENV=test when NODE_ENV is set.");
  }
}