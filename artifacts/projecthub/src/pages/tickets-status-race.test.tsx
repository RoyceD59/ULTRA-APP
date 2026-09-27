/**
 * Regression tests: a background refetch must not overwrite a just-saved
 * ticket status after the PATCH succeeds.
 *
 * The fix in handleTicketUpdate calls:
 *   1. queryClient.cancelQueries({ queryKey })   ← aborts any in-flight refetch
 *   2. queryClient.setQueryData(queryKey, …)     ← writes the PATCH result
 *
 * Without step 1, a refetch that started before the PATCH committed could
 * resolve *after* setQueryData and restore the stale "submitted" status.
 *
 * Assertions use within() scoped to the "Move to:" status-control row so
 * they don't clash with identically-labelled filter-tab buttons.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TicketsPage from "./tickets";

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

function makeTicket(status: string) {
  return {
    id: "t-1",
    userId: "user-abc-123",
    productModel: "UC-100",
    issueDescription: "Water leaking from bottom",
    preferredContactTime: "Morning",
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
      <TicketsPage />
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

describe("Tickets – status PATCH wins over concurrent refetch", () => {
  it("keeps the PATCH status when a background refetch resolves with stale data", async () => {
    // ── Phase 1: initial load → status = "submitted" ───────────────────────
    const refetchDeferred = deferred<Response>();

    vi.mocked(global.fetch)
      // First call: initial GET /admin/tickets
      .mockResolvedValueOnce(jsonOk([makeTicket("submitted")]))
      // Second call: GET triggered by Refresh button (kept pending)
      .mockReturnValueOnce(refetchDeferred.promise)
      // Third call: PATCH → returns updated ticket with "in_progress"
      .mockResolvedValueOnce(jsonOk(makeTicket("in_progress")));

    renderPage();

    // Wait for initial data and verify "Submitted" is the current status
    await waitFor(() => {
      const controls = getStatusControls();
      expect(within(controls).getByRole("button", { name: /submitted/i })).toBeDisabled();
    });

    // ── Phase 2: user clicks Refresh → refetch is now in flight ────────────
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));

    // ── Phase 3: while refetch is pending, change status to "In Progress" ──
    const controls = getStatusControls();
    fireEvent.click(within(controls).getByRole("button", { name: /in progress/i }));

    // PATCH completes; the "In Progress" move-to button becomes disabled
    // (it's now the current status) and "Submitted" is enabled.
    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /in progress/i })).toBeDisabled();
      expect(within(c).getByRole("button", { name: /submitted/i })).not.toBeDisabled();
    });

    // ── Phase 4: stale refetch resolves with the OLD "submitted" payload ────
    refetchDeferred.resolve(jsonOk([makeTicket("submitted")]));

    // Give React time to process any would-be cache update
    await new Promise(r => setTimeout(r, 80));

    // The PATCH result must survive — "In Progress" is still the current
    // status (disabled) and "Submitted" is still an available move-to option.
    const finalControls = getStatusControls();
    expect(within(finalControls).getByRole("button", { name: /in progress/i })).toBeDisabled();
    expect(within(finalControls).getByRole("button", { name: /submitted/i })).not.toBeDisabled();
  });

  it("keeps the PATCH status after the user clicks Refresh post-save", async () => {
    // User saves, then manually clicks Refresh. The Refresh must not revert
    // the just-saved status back to what was on the server before the PATCH.
    vi.mocked(global.fetch)
      // Initial load
      .mockResolvedValueOnce(jsonOk([makeTicket("submitted")]))
      // PATCH → in_progress
      .mockResolvedValueOnce(jsonOk(makeTicket("in_progress")))
      // Manual Refresh → server also returns in_progress (PATCH already committed)
      .mockResolvedValueOnce(jsonOk([makeTicket("in_progress")]));

    renderPage();

    await waitFor(() => {
      const controls = getStatusControls();
      expect(within(controls).getByRole("button", { name: /submitted/i })).toBeDisabled();
    });

    // Change status to "In Progress"
    const controls = getStatusControls();
    fireEvent.click(within(controls).getByRole("button", { name: /in progress/i }));

    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /in progress/i })).toBeDisabled();
    });

    // Manual Refresh
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));

    await waitFor(() => {
      const c = getStatusControls();
      expect(within(c).getByRole("button", { name: /in progress/i })).toBeDisabled();
      expect(within(c).getByRole("button", { name: /submitted/i })).not.toBeDisabled();
    });
  });
});
