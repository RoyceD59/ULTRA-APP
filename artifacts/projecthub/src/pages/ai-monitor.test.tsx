import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatPanel } from "./ai-monitor";

// ── Mock API client hooks used by ChatPanel ─────────────────────────────────
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useListAnthropicConversations: vi.fn(() => ({ data: [], isLoading: false })),
    getListAnthropicConversationsQueryKey: vi.fn(() => ["anthropic", "conversations"]),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

const CONV_KEY = "projecthub-ai-monitor-conversation-id";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderChatPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChatPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

// ── Restore tests ──────────────────────────────────────────────────────────

describe("ChatPanel conversation restore", () => {
  it("starts fresh (input enabled, no fetch) when no conversation is stored", () => {
    renderChatPanel();
    const input = screen.getByPlaceholderText(/ask about tasks/i);
    expect(input).not.toBeDisabled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("disables sending until the restore settles — a send attempt mid-restore must not create a conversation", async () => {
    localStorage.setItem(CONV_KEY, "7");
    const restore = deferred<Response>();
    vi.mocked(global.fetch).mockReturnValueOnce(restore.promise);

    renderChatPanel();

    const input = screen.getByPlaceholderText(/restoring previous conversation/i);
    expect(input).toBeDisabled();

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toMatch(/\/api\/anthropic\/conversations\/7$/);

    restore.resolve(jsonResponse(200, {
      id: 7,
      title: "ProjectHub Monitor Chat",
      messages: [
        { id: 1, role: "user", content: "What is blocked?" },
        { id: 2, role: "assistant", content: "Two tasks are blocked on review." },
      ],
    }));

    await waitFor(() => expect(screen.getByPlaceholderText(/ask about tasks/i)).not.toBeDisabled());
    expect(screen.getByText("What is blocked?")).toBeInTheDocument();
    expect(screen.getByText("Two tasks are blocked on review.")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("clears the stored id and starts fresh when the conversation no longer exists", async () => {
    localStorage.setItem(CONV_KEY, "99");
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(404, { error: "Conversation not found" }));

    renderChatPanel();

    await waitFor(() => expect(screen.getByPlaceholderText(/ask about tasks/i)).not.toBeDisabled());
    expect(localStorage.getItem(CONV_KEY)).toBeNull();
    expect(screen.getByText(/i'm the projecthub ai monitor/i)).toBeInTheDocument();
  });

  it("re-enables sending even when the restore fetch fails", async () => {
    localStorage.setItem(CONV_KEY, "7");
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("network down"));

    renderChatPanel();

    await waitFor(() => expect(screen.getByPlaceholderText(/ask about tasks/i)).not.toBeDisabled());
  });
});

// ── Send-in-progress guard tests ───────────────────────────────────────────

describe("ChatPanel send-in-progress guard", () => {
  it("disables New chat and History while a message is streaming so no conversation can be abandoned mid-send", async () => {
    // No stored conversation — start fresh.
    const sendDeferred = deferred<Response>();
    vi.mocked(global.fetch)
      // POST /conversations — creates a new conversation
      .mockResolvedValueOnce(jsonResponse(201, { id: 42 }))
      // POST /conversations/42/messages — slow stream; resolve later
      .mockReturnValueOnce(sendDeferred.promise);

    renderChatPanel();

    const input = screen.getByPlaceholderText(/ask about tasks/i);
    fireEvent.change(input, { target: { value: "What is the status?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Give react time to set streaming=true
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /history/i })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: /new chat/i })).toBeDisabled();

    // Resolve the stream so the component settles cleanly.
    sendDeferred.resolve({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"done":true}\n\n'));
          c.close();
        },
      }),
    } as unknown as Response);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /history/i })).not.toBeDisabled();
    });
    expect(screen.getByRole("button", { name: /new chat/i })).not.toBeDisabled();
  });
});

// ── Race condition tests ────────────────────────────────────────────────────

describe("ChatPanel race conditions", () => {
  it("New chat during an in-flight restore stays fresh and ignores the late response", async () => {
    localStorage.setItem(CONV_KEY, "7");
    const restore = deferred<Response>();
    vi.mocked(global.fetch).mockReturnValueOnce(restore.promise);

    renderChatPanel();

    // Still restoring — input is disabled.
    expect(screen.getByPlaceholderText(/restoring previous conversation/i)).toBeDisabled();

    // User clicks "New chat" while restore is still in flight.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /new chat/i }));
    });

    // New chat must immediately unblock the input and clear state.
    const input = screen.getByPlaceholderText(/ask about tasks/i);
    expect(input).not.toBeDisabled();
    expect(localStorage.getItem(CONV_KEY)).toBeNull();

    // Now the slow restore resolves — its result must be ignored.
    await act(async () => {
      restore.resolve(jsonResponse(200, {
        id: 7,
        title: "ProjectHub Monitor Chat",
        messages: [
          { id: 1, role: "user", content: "Old message that must not appear" },
        ],
      }));
    });

    // Give any queued microtasks a chance to settle.
    await waitFor(() => {
      expect(screen.queryByText("Old message that must not appear")).not.toBeInTheDocument();
    });
    // Input must still be enabled — restore result did not overwrite fresh state.
    expect(screen.getByPlaceholderText(/ask about tasks/i)).not.toBeDisabled();
  });

  it("out-of-order conversation selections display only the latest choice", async () => {
    const { useListAnthropicConversations } = await import("@workspace/api-client-react");
    vi.mocked(useListAnthropicConversations).mockReturnValue({
      data: [
        { id: 1, title: "Conversation A", createdAt: "2026-08-17T10:00:00Z" },
        { id: 2, title: "Conversation B", createdAt: "2026-08-17T11:00:00Z" },
      ],
      isLoading: false,
    } as ReturnType<typeof useListAnthropicConversations>);

    renderChatPanel();

    // Open the history picker.
    fireEvent.click(screen.getByRole("button", { name: /history/i }));

    // Set up two deferred fetches: A is slow, B resolves immediately.
    const fetchA = deferred<Response>();
    const fetchBResponse = jsonResponse(200, {
      id: 2,
      title: "Conversation B",
      messages: [{ id: 10, role: "assistant", content: "This is B content" }],
    });

    vi.mocked(global.fetch)
      .mockReturnValueOnce(fetchA.promise)        // A — slow
      .mockResolvedValueOnce(fetchBResponse);     // B — fast

    // Click A (slow fetch starts).
    fireEvent.click(screen.getByRole("button", { name: /conversation a/i }));

    // Immediately click B (fast fetch starts, gen advances past A).
    // Picker closed after clicking A; re-open.
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    fireEvent.click(screen.getByRole("button", { name: /conversation b/i }));

    // B resolves first — wait for it to land.
    await waitFor(() => expect(screen.getByText("This is B content")).toBeInTheDocument());

    // Now A's slow fetch resolves — its result must be discarded.
    await act(async () => {
      fetchA.resolve(jsonResponse(200, {
        id: 1,
        title: "Conversation A",
        messages: [{ id: 9, role: "assistant", content: "Stale A content" }],
      }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Stale A content")).not.toBeInTheDocument();
    });
    // B remains the active transcript.
    expect(screen.getByText("This is B content")).toBeInTheDocument();
  });
});

// ── Conversation picker tests ───────────────────────────────────────────────

describe("ChatPanel conversation picker", () => {
  it("loads and renders an older conversation from a long history list", async () => {
    const { useListAnthropicConversations } = await import("@workspace/api-client-react");
    const conversations = Array.from({ length: 40 }, (_, index) => ({
      id: index + 1,
      title: index === 0 ? "Oldest retained conversation" : `Recent conversation ${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 7, index + 1, 10)).toISOString(),
    }));
    vi.mocked(useListAnthropicConversations).mockReturnValue({
      data: conversations,
      isLoading: false,
    } as ReturnType<typeof useListAnthropicConversations>);
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(200, {
      id: 1,
      title: "Oldest retained conversation",
      messages: [
        { id: 101, role: "user", content: "Show me the original blockers" },
        { id: 102, role: "assistant", content: "The original blocker was approval." },
      ],
    }));

    renderChatPanel();
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    fireEvent.click(screen.getByRole("button", { name: /oldest retained conversation/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/anthropic\/conversations\/1$/),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });
    expect(await screen.findByText("Show me the original blockers")).toBeInTheDocument();
    expect(screen.getByText("The original blocker was approval.")).toBeInTheDocument();
    expect(localStorage.getItem(CONV_KEY)).toBe("1");
  });

  it("clears the active conversation and restores the greeting when New chat is clicked", async () => {
    localStorage.setItem(CONV_KEY, "7");
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(200, {
      id: 7,
      title: "Existing conversation",
      messages: [
        { id: 201, role: "user", content: "Message from the existing chat" },
      ],
    }));

    renderChatPanel();
    expect(await screen.findByText("Message from the existing chat")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /new chat/i }));

    expect(localStorage.getItem(CONV_KEY)).toBeNull();
    expect(screen.queryByText("Message from the existing chat")).not.toBeInTheDocument();
    expect(screen.getByText(/i'm the projecthub ai monitor/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask about tasks/i)).not.toBeDisabled();
  });

  it("closes the picker on an outside click without switching conversations", async () => {
    const { useListAnthropicConversations } = await import("@workspace/api-client-react");
    vi.mocked(useListAnthropicConversations).mockReturnValue({
      data: [
        { id: 3, title: "Conversation to leave untouched", createdAt: "2026-08-17T10:00:00Z" },
      ],
      isLoading: false,
    } as ReturnType<typeof useListAnthropicConversations>);

    renderChatPanel();
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(screen.getByText("Past conversations")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByText("Past conversations")).not.toBeInTheDocument();
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(CONV_KEY)).toBeNull();
    expect(screen.getByText(/i'm the projecthub ai monitor/i)).toBeInTheDocument();
  });
});
