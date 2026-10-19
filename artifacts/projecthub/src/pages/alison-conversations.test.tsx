import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlisonMachineApiError } from "@/lib/alison-machine-api";
import AlisonConversationsPage from "./alison-conversations";

const { issueAlisonMachineToken, listAlisonMachineChats } = vi.hoisted(() => ({
  issueAlisonMachineToken: vi.fn(),
  listAlisonMachineChats: vi.fn(),
}));

vi.mock("@/lib/alison-machine-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alison-machine-api")>();
  return {
    ...actual,
    issueAlisonMachineToken,
    listAlisonMachineChats,
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AlisonConversationsPage />
    </QueryClientProvider>,
  );
}

function enterMachineCredentials() {
  fireEvent.change(screen.getByTestId("input-alison-client-id"), {
    target: { value: "agent_test" },
  });
  fireEvent.change(screen.getByTestId("input-alison-client-secret"), {
    target: { value: "secret" },
  });
  fireEvent.click(screen.getByTestId("button-connect-alison-client"));
}

afterEach(() => { delete window.umami; });

describe("Alison conversation machine authorization", () => {
  beforeEach(() => {
    issueAlisonMachineToken.mockReset();
    listAlisonMachineChats.mockReset();
    localStorage.setItem("projecthub:token", "team-session-stays-active");
  });

  it("shows invalid machine credentials locally without clearing the team session", async () => {
    issueAlisonMachineToken.mockRejectedValueOnce(
      new AlisonMachineApiError(401, "invalid_client"),
    );
    renderPage();
    enterMachineCredentials();

    expect(await screen.findByTestId("status-machine-authorization-error")).toHaveTextContent(
      "Authorization failed",
    );
    expect(localStorage.getItem("projecthub:token")).toBe("team-session-stays-active");
    expect(screen.getByTestId("status-machine-authorization-error")).toHaveTextContent("matching pair");
  });

  it("explains missing scope without suggesting that rotation will add permissions", async () => {
    issueAlisonMachineToken.mockRejectedValueOnce(new AlisonMachineApiError(400, "invalid_scope"));
    renderPage();
    enterMachineCredentials();
    expect(await screen.findByTestId("status-machine-authorization-error")).toHaveTextContent("Create Alison viewer");
    expect(screen.getByTestId("status-machine-authorization-error")).toHaveTextContent("Rotating the secret does not add scopes");
  });

  it("normalizes pasted credentials and clears the secret after connecting", async () => {
    issueAlisonMachineToken.mockResolvedValueOnce({ access_token: "fixture-token", token_type: "Bearer", expires_in: 900, scope: "alison.read" });
    listAlisonMachineChats.mockResolvedValue({ chats: [], nextCursor: null });
    renderPage();
    fireEvent.change(screen.getByTestId("input-alison-client-id"), { target: { value: " agent_fixture " } });
    fireEvent.change(screen.getByTestId("input-alison-client-secret"), { target: { value: " fixture-secret " } });
    fireEvent.click(screen.getByTestId("button-connect-alison-client"));
    await screen.findByTestId("status-machine-session-active");
    expect(issueAlisonMachineToken).toHaveBeenCalledWith("agent_fixture", "fixture-secret");
    fireEvent.click(screen.getByTestId("button-disconnect-alison-client"));
    expect(await screen.findByTestId("input-alison-client-secret")).toHaveValue("");
    expect(localStorage.getItem("projecthub:token")).toBe("team-session-stays-active");
  });

  it("does not reuse cached transcripts when reconnecting with a different client", async () => {
    issueAlisonMachineToken.mockResolvedValue({ access_token: "fixture-token", token_type: "Bearer", expires_in: 900, scope: "alison.read" });
    listAlisonMachineChats.mockResolvedValueOnce({
      chats: [{ conversationId: "previous-client-chat", createdAt: "2026-10-02T12:00:00Z", updatedAt: "2026-10-02T12:00:00Z", messages: [] }],
      nextCursor: null,
    });
    renderPage();
    enterMachineCredentials();
    await screen.findByTestId("button-alison-conversation-previous-client-chat");
    fireEvent.click(screen.getByTestId("button-disconnect-alison-client"));
    listAlisonMachineChats.mockRejectedValueOnce(new AlisonMachineApiError(403, "insufficient_scope"));
    enterMachineCredentials();
    await screen.findByTestId("status-alison-conversations-error");
    expect(screen.queryByTestId("button-alison-conversation-previous-client-chat")).not.toBeInTheDocument();
  });

  it("shows reconnect recovery when a machine token is revoked", async () => {
    issueAlisonMachineToken.mockResolvedValueOnce({
      access_token: "revoked-token",
      token_type: "Bearer",
      expires_in: 900,
      scope: "alison.read",
    });
    listAlisonMachineChats.mockRejectedValueOnce(
      new AlisonMachineApiError(401, "invalid_token"),
    );
    renderPage();
    enterMachineCredentials();

    await waitFor(() => expect(listAlisonMachineChats).toHaveBeenCalled());
    expect(await screen.findByTestId("status-alison-conversations-error")).toHaveTextContent(
      "Machine authorization failed",
    );
    expect(screen.getByTestId("button-recover-alison-conversations")).toHaveTextContent("Reconnect");
    expect(localStorage.getItem("projecthub:token")).toBe("team-session-stays-active");
  });

  it("counts transcript opens without sending credentials, IDs or message content", async () => {
    issueAlisonMachineToken.mockResolvedValueOnce({
      access_token: "test-token", token_type: "Bearer", expires_in: 900, scope: "alison.read",
    });
    listAlisonMachineChats.mockResolvedValue({
      chats: [{
        conversationId: "private-conversation",
        createdAt: "2026-10-02T12:00:00Z",
        updatedAt: "2026-10-02T12:00:00Z",
        messages: [],
      }],
      nextCursor: null,
    });
    const track = vi.fn();
    window.umami = { track };
    renderPage();
    enterMachineCredentials();
    const conversation = await screen.findByTestId("button-alison-conversation-private-conversation");
    fireEvent.click(conversation);
    fireEvent.click(conversation);
    expect(track).toHaveBeenCalledExactlyOnceWith("alison_conversation_opened", { messageCount: 0 });
  });
});