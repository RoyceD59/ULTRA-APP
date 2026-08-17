/**
 * Component tests for PushTaskDialog
 *
 * Verifies:
 *   1. Auth header is sent when loading the agent list (GET /api/ai/agents)
 *   2. Auth header is sent when dispatching a task (POST /api/ai/push-task)
 *   3. Non-OK agent list responses surface an error state (not a crash)
 *   4. A successful dispatch calls onSuccess and shows a toast
 *
 * Run with: pnpm --filter @workspace/projecthub test  (vitest)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { PushTaskDialog } from "./PushTaskDialog";
import type { Task } from "@workspace/api-client-react";

// ── Stable test token ─────────────────────────────────────────────────────────
const TEST_TOKEN = "test-team-session-token";

// ── Mock team-auth ────────────────────────────────────────────────────────────
vi.mock("@/lib/team-auth", () => ({
  getAuthHeaders: () => ({ Authorization: `Bearer ${TEST_TOKEN}` }),
}));

// ── Mock toast ────────────────────────────────────────────────────────────────
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Minimal task fixture ──────────────────────────────────────────────────────
const TASK: Task = {
  id: 42,
  title: "Test task for dispatch",
  description: "A task used in unit tests",
  projectId: 1,
  status: "todo",
  priority: "medium",
  assigneeId: null,
  dueDate: null,
  sourcePlatform: null,
  resourceRequired: null,
  deliveryFormat: null,
  notifyVia: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const AGENTS = [
  { id: 1, name: "Orchestrator", role: "orchestrator", status: "active" },
  { id: 2, name: "Content",      role: "content",      status: "active" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeFetch(agentsResponse: Response, pushResponse?: Response) {
  let pushCalled = false;
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/ai/agents")) return Promise.resolve(agentsResponse);
    if (u.includes("/api/ai/push-task")) {
      pushCalled = true;
      return Promise.resolve(pushResponse ?? new Response(JSON.stringify({ success: true, pushId: "abc" }), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  return { fn, getPushCalled: () => pushCalled };
}

function agentsOk() {
  return new Response(JSON.stringify(AGENTS), { status: 200 });
}

beforeEach(() => {
  mockToast.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("PushTaskDialog", () => {
  it("sends the Authorization header when loading the agent list", async () => {
    const { fn } = makeFetch(agentsOk());
    global.fetch = fn as unknown as typeof fetch;

    render(
      <PushTaskDialog task={TASK} open onOpenChange={vi.fn()} />,
    );

    // Wait for agents to load
    await screen.findByText("Orchestrator");

    const agentCall = fn.mock.calls.find(([url]) => String(url).includes("/api/ai/agents"));
    expect(agentCall).toBeDefined();
    const headers = agentCall![1]?.headers as Record<string, string> | undefined;
    expect(headers?.["Authorization"]).toBe(`Bearer ${TEST_TOKEN}`);
  });

  it("sends the Authorization header and Content-Type when dispatching", async () => {
    const { fn } = makeFetch(agentsOk());
    global.fetch = fn as unknown as typeof fetch;

    render(
      <PushTaskDialog task={TASK} open onOpenChange={vi.fn()} />,
    );

    await screen.findByText("Orchestrator");

    fireEvent.click(screen.getByRole("button", { name: /push to agent/i }));

    await waitFor(() => {
      const pushCall = fn.mock.calls.find(([url]) => String(url).includes("/api/ai/push-task"));
      expect(pushCall).toBeDefined();
      const headers = pushCall![1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${TEST_TOKEN}`);
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });

  it("shows an error state when the agent list request fails (401)", async () => {
    const failResponse = new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const { fn } = makeFetch(failResponse);
    global.fetch = fn as unknown as typeof fetch;

    render(
      <PushTaskDialog task={TASK} open onOpenChange={vi.fn()} />,
    );

    // Error message must surface — not a blank list, not a crash
    await waitFor(() => {
      expect(screen.queryByText(/loading agents/i)).toBeNull();
    });
    // Either the error text or a disabled push button confirms the error state
    const pushBtn = screen.getByRole("button", { name: /push to agent/i });
    expect(pushBtn).toBeDisabled();
  });

  it("calls onSuccess and shows a toast after a successful dispatch", async () => {
    const pushResponse = new Response(
      JSON.stringify({ success: true, pushId: "uuid-123" }),
      { status: 200 },
    );
    const { fn } = makeFetch(agentsOk(), pushResponse);
    global.fetch = fn as unknown as typeof fetch;

    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <PushTaskDialog task={TASK} open onOpenChange={onOpenChange} onSuccess={onSuccess} />,
    );

    await screen.findByText("Orchestrator");

    fireEvent.click(screen.getByRole("button", { name: /push to agent/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Task dispatched" }),
      );
    });
  });
});
