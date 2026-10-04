import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectSheetDialog } from "./ConnectSheetDialog";

vi.mock("@/lib/team-auth", () => ({
  getAuthHeaders: () => ({ Authorization: "Bearer test-team-token" }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function renderDialog(reconnectRequired: boolean, onStatusChange = vi.fn()) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ConnectSheetDialog open onOpenChange={vi.fn()} onStatusChange={onStatusChange}
        syncStatus={{ connected: true, sheetUrl: "https://docs.google.com/spreadsheets/d/test", reconnectRequired }} />
    </QueryClientProvider>,
  );
}

describe("Google reconnect action", () => {
  it("replaces the connected badge with an actionable reconnect warning and starts OAuth", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/google/auth")) {
        return Response.json({ authUrl: "https://accounts.google.com/test-consent" });
      }
      return Response.json({ connected: true, googleEmail: "team@example.com", oauthConfigured: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const openPopup = vi.spyOn(window, "open").mockReturnValue(null);
    renderDialog(true);
    const button = await screen.findByRole("button", { name: "Reconnect Google account" });
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(openPopup).toHaveBeenCalledWith(
      "https://accounts.google.com/test-consent", "google-oauth", expect.any(String),
    ));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/google/auth"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-team-token" }) }));
  });

  it("refreshes sheet status after successful reauthorization", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      connected: true, googleEmail: "team@example.com", oauthConfigured: true,
    })));
    const refresh = vi.fn();
    renderDialog(true, refresh);
    await screen.findByRole("button", { name: "Reconnect Google account" });
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "google-oauth-result", payload: { success: true, googleEmail: "team@example.com" } },
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("keeps the normal connected state for non-authorization failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      connected: true, googleEmail: "team@example.com", oauthConfigured: true,
    })));
    renderDialog(false);
    await screen.findByRole("button", { name: "Disconnect" });
    expect(screen.queryByRole("button", { name: "Reconnect Google account" })).not.toBeInTheDocument();
  });
});