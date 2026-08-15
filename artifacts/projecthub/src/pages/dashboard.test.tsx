import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LifespanAuditWarning } from "./dashboard";

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
