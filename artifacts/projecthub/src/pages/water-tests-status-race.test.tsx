import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WaterTestsPage from "./water-tests";

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/team-auth", () => ({
  getTeamToken: () => "test-admin-token",
  getAuthHeaders: () => ({ Authorization: "Bearer test-admin-token" }),
}));

vi.mock("@/components/shared/badges", () => ({
  formatRelativeDate: () => "just now",
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([JSON.stringify(body)]),
  } as unknown as Response;
}

function makeWaterTestSummary(status: string) {
  return {
    assessmentId: "wt-1",
    reference: "WT-12345",
    firstName: "Jane Doe",
    area: "123 Main St",
    country: "Kenya",
    maskedPhone: "+254700***001",
    source: "borehole",
    concern: "taste",
    bands: { hardness: "Low", taste: "High", sediment: "Low", microbial: "Moderate" },
    serviceState: status,
    accountLinkState: "attached",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeWaterTestDetail(status: string) {
  return {
    ...makeWaterTestSummary(status),
    phone: "+254700000001",
    serviceAddress: "123 Main St",
    preferredContactTime: "Morning",
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <WaterTestsPage />
    </QueryClientProvider>,
  );
}

function getStatusControls() {
  const moveToLabel = screen.getByText(/update status/i);
  return moveToLabel.parentElement!;
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((input: any, init: any) => {
    console.log("Mock fetch called with:", input);
    return Promise.resolve(jsonOk({ items: [], total: 0 }));
  });
  sessionStorage.clear();
});

describe("Water Tests – status PATCH wins over concurrent refetch", () => {
  it("keeps the PATCH status when a background refetch resolves with stale data", async () => {
    const refetchDeferred = deferred<Response>();

    vi.mocked(global.fetch)
      // List
      .mockResolvedValueOnce(jsonOk({ items: [makeWaterTestSummary("instant_result_ready")], total: 1, page: 1, limit: 50 }))
      // Detail
      .mockResolvedValueOnce(jsonOk(makeWaterTestDetail("instant_result_ready")))
      // List refetch
      .mockReturnValueOnce(refetchDeferred.promise)
      // PATCH update
      .mockResolvedValueOnce(jsonOk(makeWaterTestDetail("scheduled")));

    renderPage();

    await screen.findByText("WT-12345");
    fireEvent.click(screen.getByText("WT-12345"));

    await waitFor(() => {
      const controls = getStatusControls();
      expect(within(controls).getByRole("button", { name: /scheduled/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByText("Refresh").closest("button")!);

    const controls = getStatusControls();
    fireEvent.click(within(controls).getByRole("button", { name: /scheduled/i }));

    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /scheduled/i })).toBeDisabled();
      expect(within(c).getByRole("button", { name: /follow-up requested/i })).not.toBeDisabled();
    });

    refetchDeferred.resolve(jsonOk({ items: [makeWaterTestSummary("instant_result_ready")], total: 1, page: 1, limit: 50 }));
    await new Promise(r => setTimeout(r, 80));

    const finalControls = getStatusControls();
    expect(within(finalControls).getByRole("button", { name: /scheduled/i })).toBeDisabled();
    expect(within(finalControls).getByRole("button", { name: /follow-up requested/i })).not.toBeDisabled();
  });

  it("keeps the PATCH status after the user clicks Refresh post-save", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonOk({ items: [makeWaterTestSummary("instant_result_ready")], total: 1, page: 1, limit: 50 }))
      .mockResolvedValueOnce(jsonOk(makeWaterTestDetail("instant_result_ready")))
      .mockResolvedValueOnce(jsonOk(makeWaterTestDetail("scheduled")))
      .mockResolvedValueOnce(jsonOk({ items: [makeWaterTestSummary("scheduled")], total: 1, page: 1, limit: 50 }));

    renderPage();

    await screen.findByText("WT-12345");
    fireEvent.click(screen.getByText("WT-12345"));

    await waitFor(() => {
      const controls = getStatusControls();
      expect(within(controls).getByRole("button", { name: /scheduled/i })).not.toBeDisabled();
    });

    const controls = getStatusControls();
    fireEvent.click(within(controls).getByRole("button", { name: /scheduled/i }));

    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /scheduled/i })).toBeDisabled();
    });

    fireEvent.click(screen.getByText("Refresh").closest("button")!);

    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /scheduled/i })).toBeDisabled();
      expect(within(c).getByRole("button", { name: /follow-up requested/i })).not.toBeDisabled();
    });
  });

  it("keeps the PATCH status when moving from scheduled to completed", async () => {
    const refetchDeferred = deferred<Response>();

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonOk({ items: [makeWaterTestSummary("scheduled")], total: 1, page: 1, limit: 50 }))
      .mockResolvedValueOnce(jsonOk(makeWaterTestDetail("scheduled")))
      .mockReturnValueOnce(refetchDeferred.promise)
      .mockResolvedValueOnce(jsonOk(makeWaterTestDetail("completed")));

    renderPage();

    await screen.findByText("WT-12345");
    fireEvent.click(screen.getByText("WT-12345"));

    await waitFor(() => {
      const controls = getStatusControls();
      expect(within(controls).getByRole("button", { name: /scheduled/i })).toBeDisabled();
    });

    fireEvent.click(screen.getByText("Refresh").closest("button")!);

    const controls = getStatusControls();
    fireEvent.click(within(controls).getByRole("button", { name: /completed/i }));

    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /completed/i })).toBeDisabled();
      expect(within(c).getByRole("button", { name: /scheduled/i })).not.toBeDisabled();
    });

    refetchDeferred.resolve(jsonOk({ items: [makeWaterTestSummary("scheduled")], total: 1, page: 1, limit: 50 }));
    await new Promise(r => setTimeout(r, 80));

    const finalControls = getStatusControls();
    expect(within(finalControls).getByRole("button", { name: /completed/i })).toBeDisabled();
    expect(within(finalControls).getByRole("button", { name: /scheduled/i })).not.toBeDisabled();
  });
});
