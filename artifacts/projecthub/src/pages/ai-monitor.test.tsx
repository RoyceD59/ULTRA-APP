import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ChatPanel } from "./ai-monitor";

// ── Helpers ────────────────────────────────────────────────────────────────

const CONV_KEY = "projecthub-ai-monitor-conversation-id";

/** A fetch Response-like object. */
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Deferred promise so tests control exactly when the restore fetch settles. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
  // jsdom does not implement scrollIntoView (used by the chat autoscroll).
  Element.prototype.scrollIntoView = vi.fn();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ChatPanel conversation restore", () => {
  it("starts fresh (input enabled, no fetch) when no conversation is stored", () => {
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/ask about tasks/i);
    expect(input).not.toBeDisabled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("disables sending until the restore settles — a send attempt mid-restore must not create a conversation", async () => {
    localStorage.setItem(CONV_KEY, "7");
    const restore = deferred<Response>();
    vi.mocked(global.fetch).mockReturnValueOnce(restore.promise);

    render(<ChatPanel />);

    // While restoring: input disabled with an explanatory placeholder.
    const input = screen.getByPlaceholderText(/restoring previous conversation/i);
    expect(input).toBeDisabled();

    // Regression: user mashes Enter before the restore completes — no POST
    // /conversations may fire (that would create a NEW conversation the late
    // restore response could then clobber).
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(global.fetch).toHaveBeenCalledTimes(1); // only the restore GET
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toMatch(/\/api\/anthropic\/conversations\/7$/);

    // Restore settles → transcript rehydrated, sending re-enabled.
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
    // Still only the restore GET — no stray conversation creation.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("clears the stored id and starts fresh when the conversation no longer exists", async () => {
    localStorage.setItem(CONV_KEY, "99");
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(404, { error: "Conversation not found" }));

    render(<ChatPanel />);

    await waitFor(() => expect(screen.getByPlaceholderText(/ask about tasks/i)).not.toBeDisabled());
    expect(localStorage.getItem(CONV_KEY)).toBeNull();
    // Greeting only — no restored transcript.
    expect(screen.getByText(/i'm the projecthub ai monitor/i)).toBeInTheDocument();
  });

  it("re-enables sending even when the restore fetch fails", async () => {
    localStorage.setItem(CONV_KEY, "7");
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("network down"));

    render(<ChatPanel />);

    await waitFor(() => expect(screen.getByPlaceholderText(/ask about tasks/i)).not.toBeDisabled());
  });
});
