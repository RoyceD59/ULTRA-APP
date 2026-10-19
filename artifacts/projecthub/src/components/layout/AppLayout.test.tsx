import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { AppLayout } from "./AppLayout";

// ── Mock team-auth: admin user, full page access ────────────────────────────
vi.mock("@/lib/team-auth", () => ({
  isTeamAdmin: () => true,
  getTeamUser: () => ({ name: "Admin", email: "admin@example.com", role: "admin" }),
  canView: () => true,
  getTeamToken: () => "test-token",
  getAuthHeaders: () => ({ Authorization: "Bearer test-token" }),
  clearTeamAuth: vi.fn(),
  changePassword: vi.fn(),
  getTeamSessionRemainingMs: () => null,
  renewTeamSession: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const DISMISS_KEY = "ph_sec_mpesa_dismissed";
const BANNER_TEXT = /Security misconfiguration/i;

type FetchMock = ReturnType<typeof vi.fn>;

/** Mock fetch: payment-settings returns the given secret source (or never resolves). */
function mockFetch(secretSource: string | "pending"): FetchMock {
  const fn = vi.fn((url: string) => {
    if (String(url).includes("/api/admin/payment-settings")) {
      if (secretSource === "pending") return new Promise(() => {});
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ mpesaWebhookSecret: { source: secretSource } }),
      });
    }
    // badge endpoints — return empty payloads
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 0, orders: [] }) });
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("security banner dismissal persistence", () => {
  it("shows the banner when the secret is missing, and dismiss stores the flag in sessionStorage", async () => {
    mockFetch("none");
    render(<AppLayout>content</AppLayout>);

    await screen.findByText(BANNER_TEXT);

    fireEvent.click(screen.getByLabelText("Dismiss security warning"));

    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    expect(sessionStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("keeps the banner dismissed across a remount while the status response is still pending", async () => {
    // First mount: secret missing → dismiss
    mockFetch("none");
    const first = render(<AppLayout>content</AppLayout>);
    await screen.findByText(BANNER_TEXT);
    fireEvent.click(screen.getByLabelText("Dismiss security warning"));
    first.unmount();

    // Remount before any status response arrives (fetch never resolves)
    mockFetch("pending");
    render(<AppLayout>content</AppLayout>);

    // Give effects a chance to run; the stored dismissal must survive
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    expect(sessionStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("keeps the banner dismissed on remount when the secret is confirmed still missing", async () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    mockFetch("none");
    render(<AppLayout>content</AppLayout>);

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    expect(sessionStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("clears the stored dismissal once polling confirms the secret is configured", async () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    mockFetch("env");
    render(<AppLayout>content</AppLayout>);

    await waitFor(() => {
      expect(sessionStorage.getItem(DISMISS_KEY)).toBeNull();
    });
    // Secret is set, so no banner either way
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
  });
});

describe("mobile navigation", () => {
  it("opens a keyboard-accessible navigation drawer", async () => {
    mockFetch("env");
    render(<AppLayout>content</AppLayout>);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    const drawer = await screen.findByRole("dialog");
    expect(screen.getAllByRole("navigation", { name: "Primary navigation" }).length).toBeGreaterThan(0);
    expect(within(drawer).getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: "Dashboard" })).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
