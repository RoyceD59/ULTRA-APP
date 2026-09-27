import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlisonMachineApiError,
  issueAlisonMachineToken,
  listAlisonMachineChats,
} from "./alison-machine-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Alison machine API", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("keeps invalid machine credentials local instead of expiring the ProjectHub session", async () => {
    const unauthorized = vi.fn();
    window.addEventListener("projecthub:unauthorized", unauthorized);
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(401, { error: "invalid_client" }));

    await expect(issueAlisonMachineToken("agent_test", "bad-secret"))
      .rejects.toEqual(expect.objectContaining<Partial<AlisonMachineApiError>>({
        status: 401,
        message: "invalid_client",
      }));
    expect(unauthorized).not.toHaveBeenCalled();

    window.removeEventListener("projecthub:unauthorized", unauthorized);
  });

  it("reports an expired or revoked machine token without dispatching a team-session logout", async () => {
    const unauthorized = vi.fn();
    window.addEventListener("projecthub:unauthorized", unauthorized);
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(401, { error: "invalid_token" }));

    await expect(listAlisonMachineChats("expired-token"))
      .rejects.toEqual(expect.objectContaining<Partial<AlisonMachineApiError>>({
        status: 401,
        message: "invalid_token",
      }));
    expect(unauthorized).not.toHaveBeenCalled();

    window.removeEventListener("projecthub:unauthorized", unauthorized);
  });
});