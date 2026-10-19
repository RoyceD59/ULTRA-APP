import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MonitoringPage from "./pages/monitoring";
import { RuntimeDiagnosticsPanel, runtimeFreshness } from "./components/monitoring/RuntimeDiagnosticsPanel";
import { RuntimeErrorBoundary } from "./components/RuntimeErrorBoundary";

const state = vi.hoisted(() => ({ edit: true }));
vi.mock("@/lib/team-auth", () => ({
  canEdit: () => state.edit,
  apiFetch: (path: string, init?: RequestInit) => fetch(path, init).then(async res => {
    if (!res.ok) throw new Error("Unavailable");
    return res.json();
  }),
}));
vi.mock("./lib/runtime-diagnostics", () => ({ projecthubReporter: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  getGetMonitoringSnapshotQueryKey: () => ["monitoring"],
  useGetMonitoringSnapshot: () => ({
    data: {
      generatedAt: new Date().toISOString(),
      site: [{ key: "store", label: "Store", url: "https://store.invalid/", ok: null, httpStatus: null, responseMs: null, checkedAt: null, history: [], coverage: "Expected response only" }],
      payments: { paystack: true, mpesaMode: "live", stripe: true, cod: true }, services: [],
      problems: { recoveryOrders: null, notificationFailures7d: null },
    }, isLoading: false, isError: false, isFetching: false, dataUpdatedAt: Date.now(),
  }),
}));
function runtime(overrides = {}) {
  return {
    environment: "development", retentionDays: 14, windowMinutes: 15, truncated: false,
    collector: { state: "current", lastAt: new Date().toISOString(), local: { available: true, dropped: 0 } },
    events: [{
      metadata: { app: "companion", environment: "development", platform: "web", browser: "chrome", release: "development", routeClass: "orders", category: "render", frames: [] },
      count: 1, last_at: new Date().toISOString(),
    }],
    api: [{ route: "/api/uc/orders/*", method: "GET", volume: 2, expected: 1, unexpected: 1, statuses: { "4xx": 1, "5xx": 1 }, meanMs: 100, maxMs: 200, correlationId: null }],
    incidents: [], alertConfig: { mode: "off", destination: "slack" }, ...overrides,
  };
}
function mount(component = <RuntimeDiagnosticsPanel />) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{component}</QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); state.edit = true; vi.restoreAllMocks(); });

describe("Monitoring honest runtime presentation", () => {
  it("shows null site/problem states as unknown and credentials as unverified, not Live", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(runtime()))));
    mount(<MonitoringPage />);
    expect(screen.getByText("UNKNOWN / STALE")).toBeVisible();
    expect(screen.getByText("Recovery order count unknown")).toBeVisible();
    expect(screen.getByText("Notification failure count unknown")).toBeVisible();
    expect(screen.getAllByText("Credentials present · unverified")).toHaveLength(2);
    expect(screen.queryByText("Live")).toBeNull();
    expect(screen.queryByText("No failed notifications (7 days)")).toBeNull();
    await screen.findByText("Recent client failures");
  });
  it("shows stale samples and storage failures as unknown rather than healthy zeroes", async () => {
    expect(runtimeFreshness("current", new Date(Date.now()-180000).toISOString())).toBe("unknown");
    expect(runtimeFreshness("current", null)).toBe("unknown");
    expect(runtimeFreshness("current", "invalid")).toBe("unknown");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(runtime({
      collector: { state: "stale", lastAt: null, local: { available: false, dropped: 8 } }, events: [], api: [],
    })))));
    mount();
    await screen.findByText(/Collection unavailable or stale/);
    expect(screen.getByText("Client failure count unknown.")).toBeVisible();
    expect(screen.getByText(/8 API observations dropped/)).toBeVisible();
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    mount();
    await screen.findByText(/Collection unavailable or stale/);
    expect(screen.queryByText(/No collected failures/)).toBeNull();
  });
  it("updates app/environment/release filters and shows the loaded release without raw content", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(runtime())));
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("Recent client failures");
    fireEvent.change(screen.getByLabelText("App"), { target: { value: "companion" } });
    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "preview" } });
    fireEvent.change(screen.getByLabelText("Loaded release"), { target: { value: "unknown" } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("app=companion&environment=preview&release=unknown"), undefined));
    expect(await screen.findByText("GET /api/uc/orders/*")).toBeVisible();
    expect(screen.getByText(/Loaded release:/)).toBeVisible();
  });
  it("hides edit actions from viewers and tests without sending even when live is selected", async () => {
    const fetcher = vi.fn(async (path: string) => new Response(JSON.stringify(path.endsWith("/test") ? { delivered: false, message: "Safe operational preview" } : runtime())));
    vi.stubGlobal("fetch", fetcher);
    state.edit = false; mount();
    await screen.findByText("Operational alerts");
    expect(screen.queryByRole("button", { name: "Test without sending" })).toBeNull();
    cleanup(); state.edit = true; mount();
    await screen.findByRole("button", { name: "Test without sending" });
    fireEvent.change(screen.getByLabelText("Alert mode"), { target: { value: "live" } });
    fireEvent.click(screen.getByRole("button", { name: "Test without sending" }));
    await screen.findByText(/No notification sent/);
    expect(fetcher.mock.calls.some(([path]) => path.endsWith("/config"))).toBe(false);
  });
  it("keeps the ProjectHub render fallback usable when diagnostic collection is unavailable", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never { throw new Error("Private entered text"); }
    render(<RuntimeErrorBoundary><Broken /></RuntimeErrorBoundary>);
    expect(screen.getByRole("button", { name: "Reload page" })).toBeVisible();
    expect(screen.queryByText("Private entered text")).toBeNull();
  });
});