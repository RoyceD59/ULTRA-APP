import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Contacts from "./contacts";

vi.mock("@workspace/api-client-react", () => ({
  useListContacts: () => ({ data: [], isLoading: false }),
  useCreateContact: () => ({}),
  useDeleteContact: () => ({}),
  useGetContact: () => ({}),
  useUpdateContact: () => ({}),
  useAddContactMethod: () => ({}),
  useDeleteContactMethod: () => ({}),
  getListContactsQueryKey: () => ["contacts"],
  getGetContactQueryKey: () => ["contact"],
}));
vi.mock("@/lib/team-auth", () => ({ getAuthHeaders: () => ({ Authorization: "Bearer test-team" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function mount(reconnectRequired: boolean) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => Response.json(
    String(url).endsWith("/google/status")
      ? { connected: true, oauthConfigured: true, googleEmail: "team@example.com" }
      : { connected: true, sheetLabel: "Team sheet", sheetUrl: "https://docs.google.com/spreadsheets/d/test",
        lastError: reconnectRequired ? "invalid_grant" : "Sheet not found", reconnectRequired },
  )));
  render(<QueryClientProvider client={new QueryClient()}><Contacts /></QueryClientProvider>);
}

describe("Contacts reconnect status", () => {
  it("shows a prominent reconnect action that opens Google account recovery", async () => {
    mount(true);
    fireEvent.click(await screen.findByTestId("button-reconnect-google"));
    expect(await screen.findByTestId("button-dialog-reconnect-google")).toBeInTheDocument();
  });

  it("leaves generic sync failures as generic warnings", async () => {
    mount(false);
    await screen.findByText("Last sync failed");
    expect(screen.queryByTestId("button-reconnect-google")).not.toBeInTheDocument();
  });

  it("opens the connection dialog from the email deep link", async () => {
    window.history.replaceState({}, "", "/contacts?reconnectGoogle=1");
    mount(true);
    expect(await screen.findByTestId("button-dialog-reconnect-google")).toBeInTheDocument();
  });
});