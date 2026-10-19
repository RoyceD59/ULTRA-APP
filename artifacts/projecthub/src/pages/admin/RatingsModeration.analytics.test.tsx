import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RatingsModeration } from "./RatingsModeration";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/team-auth", () => ({ getAuthHeaders: () => ({}) }));

beforeEach(() => toast.mockReset());
afterEach(() => {
  vi.unstubAllGlobals();
  delete window.umami;
});

function setup(failUpdate = false) {
  const track = vi.fn();
  window.umami = { track };
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const patch = init?.method === "PATCH";
    return {
      ok: !patch || !failUpdate,
      json: async () => patch ? { ok: true } : { reports: [{
        id: "report-private", ratingId: "rating-private", reporterUserId: "reporter-private",
        reason: "Private reason", detail: "Private detail", createdAt: "2026-10-02T12:00:00Z",
      }] },
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={client}><RatingsModeration /></QueryClientProvider>);
  return { track, fetchMock };
}

describe("staff moderation analytics", () => {
  it.each([
    ["Hide Rating", "hidden"],
    ["Remove Rating", "removed"],
    ["Resolve (Keep Published)", "published"],
  ])("counts successful %s exactly once without sending report identity or text", async (label, status) => {
    const { track, fetchMock } = setup();
    fireEvent.click(await screen.findByRole("button", { name: label }));
    await waitFor(() => expect(track).toHaveBeenCalledExactlyOnceWith("review_moderation_saved", {
      reviewType: "location", status,
    }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/location-ratings/rating-private/moderation"), {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
  });

  it("does not count rejected moderation as a saved change", async () => {
    const { track } = setup(true);
    fireEvent.click(await screen.findByRole("button", { name: "Hide Rating" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: "Failed to apply moderation", variant: "destructive",
    }));
    expect(track).not.toHaveBeenCalled();
  });
});