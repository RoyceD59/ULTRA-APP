/** Guard a disposable preview API from accidentally targeting live systems. */
export function assertPreviewIsolation(env: NodeJS.ProcessEnv): void {
  if (env["PREVIEW_SAFE_MODE"] !== "1") return;
  const raw = env["DATABASE_URL"];
  let database: URL;
  try { database = new URL(raw ?? ""); }
  catch { throw new Error("Preview requires a local, disposable DATABASE_URL"); }
  if (!/^(postgres|postgresql):$/.test(database.protocol)
      || !["db", "localhost", "127.0.0.1"].includes(database.hostname)
      || database.pathname !== "/ultra_preview") {
    throw new Error("Preview refuses a database outside the disposable ultra_preview instance");
  }
  const forbiddenNames = [
    "CLERK_SECRET_KEY", "SENDGRID_API_KEY", "RESEND_API_KEY", "AT_API_KEY",
    "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET", "MPESA_PASSKEY", "MPESA_CONSUMER_KEY",
    "MPESA_CONSUMER_SECRET", "STRIPE_SECRET_KEY", "PAYSTACK_SECRET_KEY",
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "WHATSAPP_SESSION_DIR",
  ];
  const populated = forbiddenNames.filter(name => !!env[name]?.trim());
  if (populated.length) throw new Error(`Preview refuses live-capable credentials: ${populated.join(", ")}`);
  if (env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] && env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] !== "preview-no-external-ai") {
    throw new Error("Preview refuses a real Anthropic integration key");
  }
  if (env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] && env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] !== "http://team-ai-mock:6060/anthropic") {
    throw new Error("Preview requires the local mock Anthropic endpoint");
  }
  const forbiddenHosts = /(?:^|[/.])(?:ucfilters\.com|ucfilters\.co\.ke|replit\.app)(?:[/:]|$)/i;
  for (const name of ["AI_ORCHESTRATOR_WEBHOOK_URL", "WC_BASE_URL", "PROJECTHUB_URL", "COMPANION_ALISON_BASE_URL"]) {
    if (forbiddenHosts.test(env[name] ?? "")) throw new Error(`Preview refuses a live endpoint in ${name}`);
  }
}
