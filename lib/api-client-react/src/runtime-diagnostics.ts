/** First-party operational diagnostics. Never serialize error messages, identities or URLs. */
export type RuntimeCategory = "render" | "unhandled_error" | "unhandled_rejection" | "api_read_failed" | "api_read_timeout";
export type RuntimeRoute = "home" | "catalogue" | "product" | "cart" | "checkout" | "orders" | "account" | "auth" | "care" | "guides" | "impact" | "rewards" | "support" | "admin" | "monitoring" | "projects" | "tasks" | "other";
export function diagnosticRoute(path: string): RuntimeRoute {
  const clean = path.split(/[?#]/, 1)[0]!.replace(/^\/uc-companion\/?/, "/").replace(/\/\(tabs\)/, "");
  const segment = clean.split("/").filter(Boolean)[0] || "";
  const map: Record<string, RuntimeRoute> = {
    "": "home", index: "home", products: "catalogue", product: "product", cart: "cart", checkout: "checkout",
    orders: "orders", order: "orders", profile: "account", account: "account", auth: "auth", login: "auth",
    register: "auth", "forgot-password": "auth", "reset-password": "auth", care: "care", guides: "guides",
    guide: "guides", learn: "guides", blog: "guides", impact: "impact", rewards: "rewards", ticket: "support",
    "water-test": "support", review: "support", admin: "admin", monitoring: "monitoring", projects: "projects", tasks: "tasks",
  };
  return map[segment] || "other";
}
export function diagnosticBrowser(ua: string): "chrome" | "safari" | "firefox" | "edge" | "other" {
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}
export function safeRelease(value: unknown): string {
  return typeof value === "string" && /^(?:development|[0-9]{10,16}-[0-9]{1,10}|[a-f0-9]{40})$/.test(value) ? value : "unknown";
}
export function sanitizedFrames(error: unknown) {
  // Numeric locations only. No file paths, function names, URL queries or source code.
  try {
    const stack = error instanceof Error && typeof error.stack === "string" ? error.stack.slice(0, 4000) : "";
    return stack.split("\n").slice(1).filter(line => /^\s*(?:at\s|[^\s@]+@)/.test(line))
      .map(line => line.match(/:(\d{1,7}):(\d{1,7})\)?$/)).filter(m => m !== null).slice(0, 5)
      .map(m => ({ asset: "bundle" as const, line: Number(m![1]), column: Number(m![2]) }));
  } catch { return []; }
}
export interface RuntimeContext {
  app: "companion" | "projecthub"; environment: "production" | "development" | "preview";
  platform: "web" | "android" | "ios" | "other";
  browser: "chrome" | "safari" | "firefox" | "edge" | "other" | "native";
  release: string; routeClass: RuntimeRoute;
}
export function createRuntimeReporter(options: {
  endpoint: string; context: () => RuntimeContext; fetcher?: typeof fetch; now?: () => number;
}) {
  const transport = options.fetcher || fetch;
  const now = options.now || Date.now;
  const recent = new Map<string, number>();
  let inFlight = false; let sent = 0; let since = now(); let disabledUntil = 0;
  return (category: RuntimeCategory, error?: unknown, correlationId?: string): void => {
    try {
      if (inFlight || now() < disabledUntil) return;
      if (now() - since >= 60000) { sent = 0; since = now(); recent.clear(); }
      if (sent >= 10) return;
      const context = options.context();
      const payload = {
        schema: 1, app: context.app, environment: context.environment, platform: context.platform,
        browser: context.browser, release: safeRelease(context.release), routeClass: context.routeClass, category,
        frames: sanitizedFrames(error),
        ...(correlationId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(correlationId) ? { correlationId } : {}),
      };
      const key = JSON.stringify({ ...payload, correlationId: undefined });
      if (recent.has(key)) return; // One group/minute; do not sample away the first render failure.
      recent.set(key, now()); sent++; inFlight = true;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      // No auth, cookies, storage, retries, offline replay or shared API mutator.
      void Promise.resolve().then(() => transport(options.endpoint, {
        method: "POST", credentials: "omit", referrer: "", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: ctrl.signal,
      })).then(async response => {
        if (!response.ok) disabledUntil = now() + 60000;
        await response.body?.cancel().catch(() => {});
      }).catch(() => { disabledUntil = now() + 60000; })
        .finally(() => { clearTimeout(timer); inFlight = false; });
    } catch { /* Collector failure must never escape into application behavior. */ }
  };
}
export type RuntimeReporter = ReturnType<typeof createRuntimeReporter>;
let readReporter: RuntimeReporter | null = null;
export function setRuntimeReadReporter(reporter: RuntimeReporter): () => void {
  readReporter = reporter;
  return () => { if (readReporter === reporter) readReporter = null; };
}
export function reportRuntimeReadFailure(category: "api_read_failed" | "api_read_timeout", correlationId?: string) {
  try { readReporter?.(category, undefined, correlationId); } catch { /* isolation */ }
}
export function installWebRuntimeDiagnostics(reporter: RuntimeReporter, target: Window = window): () => void {
  const onError = (event: ErrorEvent) => reporter("unhandled_error", event.error);
  const onRejection = (event: PromiseRejectionEvent) => reporter("unhandled_rejection", event.reason);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => { target.removeEventListener("error", onError); target.removeEventListener("unhandledrejection", onRejection); };
}

/** Dependency-injected native hooks. Preserve existing error handling; no OS crash claims. */
export function installNativeRuntimeDiagnostics(reporter: RuntimeReporter, runtime: {
  errorUtils?: { getGlobalHandler(): (error: Error, fatal?: boolean) => void; setGlobalHandler(handler: (error: Error, fatal?: boolean) => void): void };
  rejectionTracker?: { enablePromiseRejectionTracker(options: { allRejections: boolean; onUnhandled(id: number, error: unknown): void; onHandled(id: number): void }): void };
}): () => void {
  let remove = () => {};
  try {
    const utils = runtime.errorUtils;
    if (utils) {
      const previous = utils.getGlobalHandler();
      const handler = (error: Error, fatal?: boolean) => { reporter("unhandled_error", error); previous(error, fatal); };
      utils.setGlobalHandler(handler);
      remove = () => { if (utils.getGlobalHandler() === handler) utils.setGlobalHandler(previous); };
    }
    // Hermes supports this JS channel. Production RN does not install its dev tracker.
    // Callers must omit this when another tracker (including RN dev) owns the runtime.
    runtime.rejectionTracker?.enablePromiseRejectionTracker({
      allRejections: true, onUnhandled: (_id, error) => reporter("unhandled_rejection", error), onHandled: () => {},
    });
  } catch { /* Hook availability cannot prevent root mounting. */ }
  return remove;
}