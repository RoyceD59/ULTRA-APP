/**
 * Regression tests: a background refetch must not overwrite a just-saved
 * water-test status after the PATCH succeeds.
 *
 * The fix in handleTestUpdate calls:
 *   1. queryClient.cancelQueries({ queryKey })   ← aborts any in-flight refetch
 *   2. queryClient.setQueryData(queryKey, …)     ← writes the PATCH result
 *
 * Without step 1, a refetch that started before the PATCH committed could
 * resolve *after* setQueryData and restore the stale "pending" status.
 *
 * Assertions use within() scoped to the "Move to:" status-control row so
 * they don't clash with identically-labelled filter-tab buttons.
 */
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
    json: async () => body,
  } as Response;
}

function makeWaterTest(status: string) {
  return {
    id: "wt-1",
    userId: "user-abc-123",
    name: "Jane Doe",
    address: "123 Main St",
    phone: "+254700000001",
    waterSource: "Borehole",
    concerns: "Taste and odour",
    photos: [],
    videos: [],
    status,
    createdAt: new Date().toISOString(),
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <WaterTestsPage />
    </QueryClientProvider>,
  );
}

/**
 * Returns the "Move to:" controls container so button assertions are scoped to
 * the card's status-control row and don't match the filter-tab buttons above.
 */
function getStatusControls() {
  const moveToLabel = screen.getByText(/move to:/i);
  return moveToLabel.parentElement!;
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  global.fetch = vi.fn();
  sessionStorage.clear();
});

describe("Water Tests – status PATCH wins over concurrent refetch", () => {
  it("keeps the PATCH status when a background refetch resolves with stale data", async () => {
    // ── Phase 1: initial load → status = "pending" ─────────────────────────
    const refetchDeferred = deferred<Response>();

    vi.mocked(global.fetch)
      // First call: initial GET /admin/water-tests
      .mockResolvedValueOnce(jsonOk([makeWaterTest("pending")]))
      // Second call: GET triggered by Refresh button (kept pending)
      .mockReturnValueOnce(refetchDeferred.promise)
      // Third call: PATCH → returns updated water test with "scheduled"
      .mockResolvedValueOnce(jsonOk(makeWaterTest("scheduled")));

    renderPage();

    // Wait for initial data and verify "Pending" is the current status
    await waitFor(() => {
      const controls = getStatusControls();
      expect(within(controls).getByRole("button", { name: /pending/i })).toBeDisabled();
    });

    // ── Phase 2: user clicks Refresh → refetch is now in flight ────────────
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));

    // ── Phase 3: while refetch is pending, change status to "Scheduled" ────
    const controls = getStatusControls();
    fireEvent.click(within(controls).getByRole("button", { name: /scheduled/i }));

    // PATCH completes; the "Scheduled" move-to button becomes disabled and
    // "Pending" becomes an available option.
    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /scheduled/i })).toBeDisabled();
      expect(within(c).getByRole("button", { name: /pending/i })).not.toBeDisabled();
    });

    // ── Phase 4: stale refetch resolves with the OLD "pending" payload ──────
    refetchDeferred.resolve(jsonOk([makeWaterTest("pending")]));

    // Give React time to process any would-be cache update
    await new Promise(r => setTimeout(r, 80));

    // The PATCH result must survive — "Scheduled" is still current (disabled)
    // and "Pending" is still available as a move-to option.
    const finalControls = getStatusControls();
    expect(within(finalControls).getByRole("button", { name: /scheduled/i })).toBeDisabled();
    expect(within(finalControls).getByRole("button", { name: /pending/i })).not.toBeDisabled();
  });

  it("keeps the PATCH status after the user clicks Refresh post-save", async () => {
    // User saves, then manually clicks Refresh. The Refresh must not revert
    // the just-saved status back to what was on the server before the PATCH.
    vi.mocked(global.fetch)
      // Initial load
      .mockResolvedValueOnce(jsonOk([makeWaterTest("pending")]))
      // PATCH → scheduled
      .mockResolvedValueOnce(jsonOk(makeWaterTest("scheduled")))
      // Manual Refresh → server also returns scheduled (PATCH already committed)
      .mockResolvedValueOnce(jsonOk([makeWaterTest("scheduled")]));

    renderPage();

    await waitFor(() => {
      const controls = getStatusControls();
      expect(within(controls).getByRole("button", { name: /pending/i })).toBeDisabled();
    });

    // Change status to "Scheduled"
    const controls = getStatusControls();
    fireEvent.click(within(controls).getByRole("button", { name: /scheduled/i }));

    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /scheduled/i })).toBeDisabled();
    });

    // Manual Refresh — server returns in_progress (already committed)
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));

    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /scheduled/i })).toBeDisabled();
      expect(within(c).getByRole("button", { name: /pending/i })).not.toBeDisabled();
    });
  });

  it("keeps the PATCH status when moving from scheduled to completed", async () => {
    // Covers the second PATCH path (scheduled → completed).
    const refetchDeferred = deferred<Response>();

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonOk([makeWaterTest("scheduled")]))
      .mockReturnValueOnce(refetchDeferred.promise)
      .mockResolvedValueOnce(jsonOk(makeWaterTest("completed")));

    renderPage();

    await waitFor(() => {
      const controls = getStatusControls();
      expect(within(controls).getByRole("button", { name: /scheduled/i })).toBeDisabled();
    });

    // Trigger in-flight refetch
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));

    // Change status to "Completed" while refetch is in flight
    const controls = getStatusControls();
    fireEvent.click(within(controls).getByRole("button", { name: /completed/i }));

    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /completed/i })).toBeDisabled();
      expect(within(c).getByRole("button", { name: /scheduled/i })).not.toBeDisabled();
    });

    // Stale refetch resolves with "scheduled"
    refetchDeferred.resolve(jsonOk([makeWaterTest("scheduled")]));

    await new Promise(r => setTimeout(r, 80));

    // "Completed" must still be the current status
    const finalControls = getStatusControls();
    expect(within(finalControls).getByRole("button", { name: /completed/i })).toBeDisabled();
    expect(within(finalControls).getByRole("button", { name: /scheduled/i })).not.toBeDisabled();
  });
});
