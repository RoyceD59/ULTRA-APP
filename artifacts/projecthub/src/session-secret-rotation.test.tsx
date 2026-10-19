import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import App from "./App";
import { apiFetch, isTeamAuthenticated } from "./lib/team-auth";

// Keep the real router, AuthGuard, storage, 401 handler, and login form.
// Only replace the protected content and layout with a small request fixture.
vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/pages/projects", () => ({
  default: function ProtectedPage() {
    return <button onClick={() => void apiFetch("/projects").catch(() => undefined)}>Load projects</button>;
  },
}));

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/projects?status=active");
  // A syntactically valid, unexpired JWT with a deliberately stale signature.
  const payload = btoa(JSON.stringify({
    id: "rotation-user", email: "rotation@example.com", type: "team-session",
    role: "admin", exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  localStorage.setItem("projecthub:token", `eyJhbGciOiJIUzI1NiJ9.${payload}.old-signature`);
  localStorage.setItem("projecthub:user", JSON.stringify({
    id: "rotation-user", email: "rotation@example.com", name: "Rotation test",
    role: "admin", permissions: {},
  }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("stored session invalidated by secret rotation", () => {
  it("clears the stale session and renders the real login page after an API 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Authentication required. Sign in at /login." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const oldToken = localStorage.getItem("projecthub:token");
    expect(isTeamAuthenticated()).toBe(true); // Expiry alone cannot validate a signature.
    render(<App />);
    expect(screen.getByRole("button", { name: "Load projects" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Load projects" }));
    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/projects"), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${oldToken}` }),
    }));
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/projects?status=active");
    expect(localStorage.getItem("projecthub:token")).toBeNull();
    expect(localStorage.getItem("projecthub:user")).toBeNull();
    expect(isTeamAuthenticated()).toBe(false);
    expect(screen.getByLabelText("Email")).toBeVisible();
    expect(screen.getByLabelText("Password")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Load projects" })).toBeNull();

    // Reloading the original URL must not restore the revoked session.
    cleanup();
    window.history.replaceState(null, "", "/projects?status=active");
    render(<App />);
    await screen.findByRole("button", { name: "Sign in" });
    expect(window.location.pathname).toBe("/login");
  });

  it("does not sign out a valid session for a permission denial (403)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Access restricted" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    )));
    render(<App />);
    await expect(apiFetch("/projects")).rejects.toThrow("Access restricted");
    expect(isTeamAuthenticated()).toBe(true);
    expect(window.location.pathname).toBe("/projects");
    expect(screen.getByRole("button", { name: "Load projects" })).toBeVisible();
  });
});