import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTeamSessionRemainingMs, getTeamToken, getTeamUser, renewTeamSession } from "./team-auth";

const user = { id: "team-1", email: "team@example.com", name: "Team", role: "member", permissions: { tasks: "edit" } };
const jwt = (exp: unknown) => `header.${btoa(JSON.stringify({ exp }))}.signature`;
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("projecthub:user", JSON.stringify(user));
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("team session expiry", () => {
  it("reads expiry in milliseconds and clamps expired sessions to zero", () => {
    localStorage.setItem("projecthub:token", jwt(1000));
    expect(getTeamSessionRemainingMs(100_000)).toBe(900_000);
    expect(getTeamSessionRemainingMs(1_100_000)).toBe(0);
  });

  it("does not invent an expiry for absent, malformed, or non-numeric tokens", () => {
    expect(getTeamSessionRemainingMs()).toBeNull();
    for (const token of ["invalid", jwt("1000"), jwt(null), `header.${btoa("null")}.signature`]) {
      localStorage.setItem("projecthub:token", token);
      expect(getTeamSessionRemainingMs()).toBeNull();
    }
  });
});

describe("in-place team renewal", () => {
  it("uses the existing account login and stores the fresh token and live permissions", async () => {
    localStorage.setItem("projecthub:token", jwt(1));
    const renewedToken = jwt(Math.floor(Date.now() / 1000) + 8 * 60 * 60);
    const freshUser = { ...user, permissions: { tasks: "view" } };
    vi.mocked(fetch).mockResolvedValue(response(200, { token: renewedToken, user: freshUser }));
    await expect(renewTeamSession("password")).resolves.toEqual(freshUser);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: "password" }),
    });
    expect(getTeamToken()).toBe(renewedToken);
    expect(getTeamUser()).toEqual(freshUser);
  });

  it("keeps auth and does not request navigation when the password is incorrect", async () => {
    const oldToken = jwt(Math.floor(Date.now() / 1000) + 600);
    localStorage.setItem("projecthub:token", oldToken);
    const unauthorized = vi.fn();
    window.addEventListener("projecthub:unauthorized", unauthorized);
    try {
      vi.mocked(fetch).mockResolvedValue(response(401, { error: "Invalid email or password." }));
      await expect(renewTeamSession("incorrect")).rejects.toThrow("Invalid email or password.");
      expect(getTeamToken()).toBe(oldToken);
      expect(getTeamUser()).toEqual(user);
      expect(unauthorized).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("projecthub:unauthorized", unauthorized);
    }
  });

  it("preserves the old session on a network failure", async () => {
    localStorage.setItem("projecthub:token", "old-token");
    vi.mocked(fetch).mockRejectedValue(new Error("Network unavailable"));
    await expect(renewTeamSession("password")).rejects.toThrow("Network unavailable");
    expect(getTeamToken()).toBe("old-token");
  });

  it("rejects invalid, expired, or wrong-account renewal responses", async () => {
    localStorage.setItem("projecthub:token", "old-token");
    for (const body of [
      {},
      { token: jwt(1), user },
      { token: jwt(Math.floor(Date.now() / 1000) + 3600), user: { ...user, id: "another-user" } },
    ]) {
      vi.mocked(fetch).mockResolvedValue(response(200, body));
      await expect(renewTeamSession("password")).rejects.toThrow("valid renewed session");
      expect(getTeamToken()).toBe("old-token");
    }
  });

  it("does not undo a concurrent sign-out", async () => {
    localStorage.setItem("projecthub:token", "old-token");
    vi.mocked(fetch).mockImplementation(async () => {
      localStorage.removeItem("projecthub:token");
      return response(200, { token: jwt(Math.floor(Date.now() / 1000) + 3600), user });
    });
    await expect(renewTeamSession("password")).rejects.toThrow("Your session changed");
    expect(getTeamToken()).toBeNull();
  });
});