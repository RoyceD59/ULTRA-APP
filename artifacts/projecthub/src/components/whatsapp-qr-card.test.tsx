import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WhatsAppQrCard } from "./whatsapp-qr-card";

vi.mock("@/lib/team-auth", () => ({
  getAuthHeaders: () => ({ Authorization: "Bearer test-session" }),
  isTeamAuthenticated: () => true,
  clearTeamToken: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/team-auth-dialog", () => ({ TeamAuthDialog: () => null }));

let status: { state: string; qr: string | null; error: { code: string; message: string } | null };
let resetFails: boolean;
let connects: number;
let disconnects: number;
let client: QueryClient;

beforeEach(() => {
  status = { state: "disconnected", qr: null, error: null };
  resetFails = false;
  connects = disconnects = 0;
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/disconnect")) {
      disconnects++;
      if (resetFails) return new Response(JSON.stringify({ error: "Stored session cleanup failed. Retry before pairing." }), { status: 503 });
      status = { state: "disconnected", qr: null, error: null };
      return new Response(JSON.stringify({ ok: true, state: "disconnected" }));
    }
    if (url.endsWith("/connect")) {
      connects++;
      status = { state: "qr", qr: "data:image/png;base64,dGVzdA==", error: null };
    }
    return new Response(JSON.stringify(status));
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function showCard() {
  render(<QueryClientProvider client={client}><WhatsAppQrCard /></QueryClientProvider>);
}

describe("WhatsApp stuck pairing recovery", () => {
  it("allows reset while disconnected, then shows a fresh QR and Connected only after pairing", async () => {
    showCard();
    await screen.findByText("Not connected");
    fireEvent.click(screen.getByTestId("button-disconnect-whatsapp"));
    await waitFor(() => expect(disconnects).toBe(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));
    await screen.findByAltText("WhatsApp QR code");
    expect(screen.getByText(/Linked Devices/)).toBeInTheDocument();
    expect(screen.queryByText("Session active")).not.toBeInTheDocument();
    status = { state: "connected", qr: null, error: null };
    await client.invalidateQueries({ queryKey: ["whatsapp-status"] });
    await screen.findByText("Session active");
    expect(screen.queryByAltText("WhatsApp QR code")).not.toBeInTheDocument();
    expect(connects).toBe(1);
  });

  it("blocks pairing after cleanup fails and retries cleanup instead of connect", async () => {
    resetFails = true;
    showCard();
    await screen.findByText("Not connected");
    fireEvent.click(screen.getByTestId("button-disconnect-whatsapp"));
    await screen.findByText("Stored session cleanup failed. Retry before pairing.");
    expect(screen.queryByRole("button", { name: "Connect WhatsApp" })).not.toBeInTheDocument();
    resetFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry Disconnect" }));
    await waitFor(() => expect(disconnects).toBe(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeEnabled());
    expect(connects).toBe(0);
  });

  it("can reset a stuck connecting state and respects cancellation", async () => {
    status.state = "connecting";
    showCard();
    await screen.findByText("Connecting to WhatsApp servers…");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId("button-disconnect-whatsapp"));
    expect(disconnects).toBe(0);
    fireEvent.click(screen.getByTestId("button-disconnect-whatsapp"));
    await screen.findByText("Not connected");
    expect(disconnects).toBe(1);
  });

  it("honours a cleanup-required state after page reload", async () => {
    status = { state: "error", qr: null, error: { code: "SESSION_CLEANUP_REQUIRED", message: "Retry Disconnect before pairing again." } };
    showCard();
    await screen.findByText("Retry Disconnect before pairing again.");
    fireEvent.click(screen.getByRole("button", { name: "Retry Disconnect" }));
    await screen.findByText("Not connected");
    expect(disconnects).toBe(1);
    expect(connects).toBe(0);
  });
});