import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dashboard, { LifespanAuditWarning } from "./dashboard";

vi.mock("@workspace/api-client-react", () => ({
  useGetDashboardSummary: () => ({
    data: {
      activeProjects: 2,
      totalProjects: 3,
      tasksDueThisWeek: 4,
      overdueTasks: 1,
      totalTasks: 10,
      statusBreakdown: { todo: 3, in_progress: 2, in_review: 1, done: 4 },
    },
    isLoading: false,
  }),
  useGetDashboardActivity: () => ({
    data: [],
    isLoading: false,
  }),
}));

// ── Silence fetch (the component calls it inside useQuery) ─────────────────
beforeEach(() => {
  global.fetch = vi.fn();
});

// ── Mock team-auth so getAuthHeaders always returns a valid object ──────────
vi.mock("@/lib/team-auth", () => ({
  getAuthHeaders: () => ({ Authorization: "Bearer test-token" }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<{
  id: number;
  name: string;
  sku: string;
  categories: string[];
  alertCount: number | null;
  resolvedAt: string | null;
}> = {}) {
  return {
    id: 1,
    name: "Test Filter",
    sku: "UC-TEST-001",
    categories: ["Bottles & Portable"],
    alertCount: null,
    resolvedAt: null,
    ...overrides,
  };
}

function makeAudit(products: ReturnType<typeof makeProduct>[]) {
  return {
    source: "woocommerce",
    checkedAt: new Date().toISOString(),
    checkedCount: 30,
    missing: products,
  };
}

/**
 * Renders LifespanAuditWarning with a fresh QueryClient whose cache is
 * pre-seeded with `auditData`, bypassing the actual fetch call entirely.
 */
function renderWithData(auditData: ReturnType<typeof makeAudit> | null) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(["uc-lifespan-audit"], auditData);

  return render(
    <QueryClientProvider client={qc}>
      <LifespanAuditWarning />
    </QueryClientProvider>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("LifespanAuditWarning – repeat-offender badge", () => {
  it("hides the badge when alertCount is null", () => {
    renderWithData(makeAudit([makeProduct({ alertCount: null })]));
    expect(screen.queryByText(/alerted/i)).not.toBeInTheDocument();
  });

  it("hides the badge when alertCount is 1", () => {
    renderWithData(makeAudit([makeProduct({ alertCount: 1 })]));
    expect(screen.queryByText(/alerted/i)).not.toBeInTheDocument();
  });

  it("shows the badge with the correct label when alertCount is 3", () => {
    renderWithData(makeAudit([makeProduct({ alertCount: 3 })]));
    const badge = screen.getByText(/alerted 3×/i);
    expect(badge).toBeInTheDocument();
  });

  it("shows badge only for the repeat product when multiple products are mixed", () => {
    renderWithData(
      makeAudit([
        makeProduct({ id: 1, name: "First Time", alertCount: 1 }),
        makeProduct({ id: 2, name: "Repeat Offender", alertCount: 2 }),
      ]),
    );
    // Badge present for alertCount = 2
    expect(screen.getByText(/alerted 2×/i)).toBeInTheDocument();
    // Both products listed by name
    expect(screen.getByText("First Time")).toBeInTheDocument();
    expect(screen.getByText("Repeat Offender")).toBeInTheDocument();
  });

  it("renders nothing when there are no missing products", () => {
    const { container } = renderWithData(makeAudit([]));
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the query returns null (non-admin / API error)", () => {
    const { container } = renderWithData(null);
    expect(container.firstChild).toBeNull();
  });
});

// ── Helpers for live-fetch tests ───────────────────────────────────────────

/**
 * Renders LifespanAuditWarning with a fresh QueryClient that has NO pre-seeded
 * cache, so the real queryFn runs against the mocked `global.fetch`.
 * Returns both the render result and the QueryClient so tests can wait for
 * the query to settle before asserting.
 */
function renderWithLiveFetch() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={qc}>
      <LifespanAuditWarning />
    </QueryClientProvider>,
  );
  return { ...result, qc };
}

describe("Dashboard – registered customers", () => {
  it.each([
    { failure: "403 forbidden", status: 403 },
    { failure: "500 server error", status: 500 },
    { failure: "network error", status: null },
  ])("hides the customer card after a $failure response", async ({ status }) => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/uc/admin/customers/count")) {
        if (status === null) throw new Error("Network error");
        return new Response(null, { status });
      }
      if (url.includes("/api/uc/admin/products/lifespan-audit")) {
        return new Response(null, { status: 403 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <Dashboard />
      </QueryClientProvider>,
    );

    // Do not let an assertion during loading pass before the request settles.
    await waitFor(() => {
      const state = qc.getQueryState(["uc-customers-count"]);
      expect(state?.status).toBe(status === null ? "error" : "success");
      expect(state?.fetchStatus).toBe("idle");
      expect(state?.data).toBe(status === null ? undefined : null);
      expect(screen.queryByText("Registered Customers")).not.toBeInTheDocument();
      expect(screen.queryByText("UC Companion app sign-ups")).not.toBeInTheDocument();
    });
  });

  it("shows admin customer totals after a successful count response", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/uc/admin/customers/count")) {
        return new Response(
          JSON.stringify({ count: 42, newThisWeek: 5, newThisMonth: 18 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/uc/admin/products/lifespan-audit")) {
        return new Response(null, { status: 403 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <Dashboard />
      </QueryClientProvider>,
    );

    const total = await screen.findByText("42");
    const card = total.closest(".rounded-xl");
    expect(card).not.toBeNull();

    const customerCard = within(card as HTMLElement);
    expect(customerCard.getByText("Registered Customers")).toBeInTheDocument();
    expect(total).toBeInTheDocument();
    expect(customerCard.getByText("5")).toBeInTheDocument();
    expect(customerCard.getByText("this week")).toBeInTheDocument();
    expect(customerCard.getByText("18")).toBeInTheDocument();
    expect(customerCard.getByText("this month")).toBeInTheDocument();
  });
});

describe("LifespanAuditWarning – hidden on auth or network failure", () => {
  it("renders nothing when the store returns 403 (non-admin member)", async () => {
    // Simulate an HTTP 403 response — the queryFn returns null on !res.ok,
    // so the query settles with status "success" and data === null.
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(null, { status: 403 }),
    );

    const { container, qc } = renderWithLiveFetch();

    // Wait until the query has finished (status "success" — queryFn returned null)
    await waitFor(() => {
      const state = qc.getQueryState(["uc-lifespan-audit"]);
      expect(state?.status).toBe("success");
    });

    // Now that the query is settled, the card must still be absent
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the fetch throws (store unreachable)", async () => {
    // Simulate a network-level failure — the queryFn throws, so the query
    // settles with status "error" and data === undefined.
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network error"));

    const { container, qc } = renderWithLiveFetch();

    // Wait until the query has finished (status "error" — queryFn threw)
    await waitFor(() => {
      const state = qc.getQueryState(["uc-lifespan-audit"]);
      expect(state?.status).toBe("error");
    });

    // Now that the query is settled, the card must still be absent
    expect(container.firstChild).toBeNull();
  });
});
