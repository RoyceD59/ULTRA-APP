import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AgentOperationsPage from "./agent-operations";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/team-auth", () => ({ getAuthHeaders: () => ({ Authorization: "Bearer fixture-admin" }) }));

const client = (id = "agent_fixture", status = "active") => ({
  id, name: `Viewer ${id}`, scopes: ["alison.read"], status, expiresAt: null, lastUsedAt: null,
});
const response = (body: unknown, status = 200) => new Response(
  status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } },
);
let clients: ReturnType<typeof client>[];
let deleteStatus: number;

beforeEach(() => {
  toast.mockReset();
  clients = [];
  deleteStatus = 204;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === "DELETE") {
      if (deleteStatus === 409) return response({ error: "client_must_be_inactive" }, 409);
      clients = [];
      return response(null, 204);
    }
    if (path.endsWith("/rotate")) return response({ client: client("agent_rotated"), clientSecret: "rotated-fixture-secret" });
    if (path.endsWith("/suspend")) {
      clients = clients.map((row) => ({ ...row, status: "suspended" }));
      return response({ client: clients[0] });
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const created = { ...client(), name: body.name, scopes: body.scopes };
      clients = [created];
      return response({ client: created, clientSecret: "one-time-fixture-secret" }, 201);
    }
    return response({ clients });
  }));
});

describe("Agent operations client safeguards", () => {
  it("quick-creates an Alison-only viewer and displays its matching ID and one-time secret", async () => {
    render(<AgentOperationsPage />);
    await screen.findByText("No private agent clients registered.");
    fireEvent.click(screen.getByTestId("button-create-alison-viewer"));
    expect(await screen.findByTestId("input-agent-issued-id")).toHaveValue("agent_fixture");
    expect(screen.getByTestId("input-agent-secret")).toHaveValue("one-time-fixture-secret");
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ name: "Alison conversation viewer", scopes: ["alison.read"] });
    expect(post[1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer fixture-admin" }));
    expect(JSON.stringify(localStorage)).not.toContain("one-time-fixture-secret");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss credentials" }));
    expect(screen.queryByTestId("agent-credentials")).not.toBeInTheDocument();
  });

  it("never offers deletion for an active client; suspension makes the action available", async () => {
    clients = [client()];
    render(<AgentOperationsPage />);
    await screen.findByTestId("agent-client-agent_fixture");
    expect(screen.queryByRole("button", { name: "Delete Viewer agent_fixture" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Suspend Viewer agent_fixture" }));
    expect(await screen.findByRole("button", { name: "Delete Viewer agent_fixture" })).toBeEnabled();
  });

  it("requires confirmation, respects cancellation, and removes a deleted client from the list", async () => {
    clients = [client("agent_unused", "suspended")];
    render(<AgentOperationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Viewer agent_unused" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Audit history will be kept");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete Viewer agent_unused" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.queryByTestId("agent-client-agent_unused")).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Client deleted" }));
    expect(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "DELETE")?.[0]).toMatch(/\/oauth\/clients\/agent_unused$/);
  });

  it("keeps a client when server-side deletion is refused and refreshes stale status", async () => {
    clients = [client("agent_in_use", "suspended")];
    deleteStatus = 409;
    render(<AgentOperationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Viewer agent_in_use" }));
    clients = [client("agent_in_use", "active")];
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Client not deleted", description: expect.stringContaining("Suspend this client") })));
    expect(await screen.findByRole("button", { name: "Suspend Viewer agent_in_use" })).toBeEnabled();
    expect(screen.getByTestId("agent-client-agent_in_use")).toBeInTheDocument();
  });

  it("shows the rotated secret with the returned client ID, not another listed client", async () => {
    clients = [client("agent_rotated"), client("agent_other")];
    render(<AgentOperationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Rotate secret for Viewer agent_rotated" }));
    expect(await screen.findByTestId("input-agent-issued-id")).toHaveValue("agent_rotated");
    expect(screen.getByTestId("input-agent-secret")).toHaveValue("rotated-fixture-secret");
  });
});
