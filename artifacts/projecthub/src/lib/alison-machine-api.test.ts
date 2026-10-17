import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlisonMachineApiError,
  alisonConnectionHelp,
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

  it("trims copy/paste whitespace and requests only alison.read using Basic authentication", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(200, {
      access_token: "fixture-token", token_type: "Bearer", expires_in: 900, scope: "alison.read",
    }));
    await issueAlisonMachineToken(" agent_fixture \n", " fixture-secret \n");
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/oauth\/token$/);
    expect(init?.headers).toEqual({
      Authorization: `Basic ${btoa("agent_fixture:fixture-secret")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(String(init?.body)).toBe("grant_type=client_credentials&scope=alison.read");
    expect(String(init?.body)).not.toContain("fixture-secret");
  });

  it.each([
    ["missing token", { token_type: "Bearer", expires_in: 900, scope: "alison.read" }],
    ["expired token", { access_token: "fixture", token_type: "Bearer", expires_in: 0, scope: "alison.read" }],
    ["wrong scope", { access_token: "fixture", token_type: "Bearer", expires_in: 900, scope: "companion.monitor.read" }],
  ])("rejects a successful but unusable response: %s", async (_name, body) => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(200, body));
    await expect(issueAlisonMachineToken("agent_fixture", "fixture")).rejects.toBeInstanceOf(AlisonMachineApiError);
  });

  it("rejects HTML or an empty success response instead of treating it as a login", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("<html>Proxy error</html>", { status: 200 }));
    await expect(issueAlisonMachineToken("agent_fixture", "fixture")).rejects.toEqual(expect.objectContaining({ status: 502, message: "invalid_response" }));
  });

  it.each([
    [new AlisonMachineApiError(400, "invalid_scope"), "Rotating the secret does not add scopes"],
    [new AlisonMachineApiError(401, "invalid_client"), "matching pair"],
    [new AlisonMachineApiError(429, "slow_down"), "Wait one minute"],
    [new AlisonMachineApiError(503, "unavailable"), "service is unavailable"],
    [new TypeError("Failed to fetch"), "Check your connection"],
  ])("offers actionable safe help for %s", (error, expected) => {
    expect(alisonConnectionHelp(error)).toContain(expected);
  });
});