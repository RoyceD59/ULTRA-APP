import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import App from "./App";
import { apiFetch, type TeamUser } from "./lib/team-auth";

// Exercise the real route, AuthGuard, PageGuard, feedback page, login page,
// storage and unauthorized handler. Layout requests are unrelated to this flow.
vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const feedbackPath = "/alison-feedback?keyword=filter";
const feedback = {
  totalInLog: 1,
  weekStats: { total: 1, up: 0, down: 1 },
  count: 1,
  keyword: "filter",
  items: [{
    id: 1,
    ts: "2026-10-01T12:00:00Z",
    rating: "down",
    question: "When should I replace my filter?",
    answer: "Check the approved replacement schedule.",
  }],
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function storeSession(
  role: TeamUser["role"] = "admin",
  permissions: TeamUser["permissions"] = {},
  expiresInSeconds = 3600,
) {
  const user: TeamUser = {
    id: "feedback-auth-fixture",
    email: "feedback-auth@example.com",
    name: "Feedback auth fixture",
    role,
    permissions,
  };
  // Client integration fixture only: JWT signatures are verified by the API,
  // whose acceptance/rejection is stubbed here. No real credentials are used.
  const payload = btoa(JSON.stringify({
    ...user,
    type: "team-session",
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  }));
  const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`;
  localStorage.setItem("projecthub:token", token);
  localStorage.setItem("projecthub:user", JSON.stringify(user));
  return token;
}

async function expectLoginRedirect() {
  await screen.findByRole("button", { name: "Sign in" });
  expect(window.location.pathname).toBe("/login");
  expect(new URLSearchParams(window.location.search).get("next")).toBe(feedbackPath);
  expect(screen.getByLabelText("Email")).toBeVisible();
  expect(screen.getByLabelText("Password")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Alison Feedback" })).not.toBeInTheDocument();
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", feedbackPath);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === "/api/uc/ai/chat-feedback/topics") {
      return jsonResponse({ keywords: [], totalDown: 0, mostFlagged: null });
    }
    if (path === "/api/uc/ai/chat-feedback") return jsonResponse(feedback);
    throw new Error(`Unexpected request in feedback auth test: ${input}`);
  }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Alison Feedback standard team authentication", () => {
  it("redirects a signed-out visitor to login with the full return URL before fetching feedback", async () => {
    render(<App />);
    await expectLoginRedirect();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redirects an expired team session to login before fetching feedback", async () => {
    storeSession("admin", {}, -120);
    render(<App />);
    await expectLoginRedirect();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", {}],
    ["member", { "alison-feedback": "view" }],
  ] as const)("opens feedback directly for a permitted %s without a second login", async (role, permissions) => {
    const token = storeSession(role, permissions);
    render(<App />);
    expect(await screen.findByText(feedback.items[0]!.answer)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Alison Feedback" })).toBeVisible();
    expect(window.location.pathname + window.location.search).toBe(feedbackPath);
    expect(screen.queryByLabelText(/password|passcode/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in|log in|connect/i })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/uc/ai/chat-feedback?keyword=filter"),
      expect.objectContaining({ headers: { Authorization: `Bearer ${token}` } }),
    );
  });

  it("keeps a member without view permission out of feedback without asking for another login", () => {
    storeSession("member");
    render(<App />);
    expect(screen.getByText("Access restricted")).toBeVisible();
    expect(window.location.pathname).toBe("/alison-feedback");
    expect(screen.queryByRole("heading", { name: "Alison Feedback" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fires the unauthorized event and redirects when a feedback refresh returns 401 mid-session", async () => {
    const token = storeSession();
    const unauthorized = vi.fn();
    window.addEventListener("projecthub:unauthorized", unauthorized);
    try {
      render(<App />);
      await screen.findByText(feedback.items[0]!.answer);
      await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "Session expired" }, 401));
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

      await expectLoginRedirect();
      expect(unauthorized).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem("projecthub:token")).toBeNull();
      expect(localStorage.getItem("projecthub:user")).toBeNull();
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("/api/uc/ai/chat-feedback?keyword=filter"),
        expect.objectContaining({ headers: { Authorization: `Bearer ${token}` } }),
      );
    } finally {
      window.removeEventListener("projecthub:unauthorized", unauthorized);
    }
  });

  it("also redirects the mounted feedback route when the shared API helper receives a 401", async () => {
    storeSession();
    const unauthorized = vi.fn();
    window.addEventListener("projecthub:unauthorized", unauthorized);
    try {
      render(<App />);
      await screen.findByText(feedback.items[0]!.answer);
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "Session revoked" }, 401));
      await expect(apiFetch("/auth/me")).rejects.toThrow("Session revoked");
      await expectLoginRedirect();
      expect(unauthorized).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem("projecthub:token")).toBeNull();
      expect(localStorage.getItem("projecthub:user")).toBeNull();
    } finally {
      window.removeEventListener("projecthub:unauthorized", unauthorized);
    }
  });
});