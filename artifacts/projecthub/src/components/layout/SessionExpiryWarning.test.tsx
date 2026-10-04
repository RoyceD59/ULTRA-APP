import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionExpiryWarning } from "./SessionExpiryWarning";

const auth = vi.hoisted(() => ({
  remaining: 900_001 as number | null,
  renew: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/team-auth", () => ({
  getTeamSessionRemainingMs: () => auth.remaining,
  getTeamUser: () => ({ email: "team@example.com" }),
  renewTeamSession: auth.renew,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: auth.toast }) }));

beforeEach(() => {
  auth.remaining = 900_001;
  auth.renew.mockReset();
  auth.toast.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("session expiry header warning", () => {
  it("is hidden above 15 minutes and appears at the exact threshold on a timer", () => {
    vi.useFakeTimers();
    render(<SessionExpiryWarning />);
    expect(screen.queryByRole("button", { name: "Renew session" })).toBeNull();
    auth.remaining = 900_000;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Session expires in 15 min.")).toBeTruthy();
    auth.remaining = 60_000;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Session expires in 1 min.")).toBeTruthy();
    auth.remaining = 0;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Session expired.")).toBeTruthy();
  });

  it("does not show a warning for unknown expiry", () => {
    auth.remaining = null;
    render(<SessionExpiryWarning />);
    expect(screen.queryByRole("button", { name: "Renew session" })).toBeNull();
  });

  it("updates after another tab renews or the page resumes", () => {
    auth.remaining = 900_000;
    render(<SessionExpiryWarning />);
    auth.remaining = 8 * 60 * 60_000;
    fireEvent(window, new Event("storage"));
    expect(screen.queryByRole("button", { name: "Renew session" })).toBeNull();
    auth.remaining = 120_000;
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByText("Session expires in 2 min.")).toBeTruthy();
  });

  it("renews without remounting or losing the underlying unsaved form", async () => {
    auth.remaining = 600_000;
    auth.renew.mockImplementation(async () => { auth.remaining = 8 * 60 * 60_000; });
    const initialUrl = window.location.href;
    render(<><SessionExpiryWarning /><input aria-label="Unsaved task" defaultValue="" /></>);
    const draft = screen.getByLabelText("Unsaved task");
    fireEvent.change(draft, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Renew session" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm password" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(auth.renew).toHaveBeenCalledWith("password");
    expect(screen.queryByRole("button", { name: "Renew session" })).toBeNull();
    expect(screen.getByLabelText("Unsaved task")).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe("Keep this draft");
    expect(window.location.href).toBe(initialUrl);
    expect(auth.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Session renewed" }));
  });

  it("shows errors in place and permits retry; cancel clears password and error", async () => {
    auth.remaining = 600_000;
    auth.renew.mockRejectedValue(new Error("Invalid email or password."));
    render(<SessionExpiryWarning />);
    fireEvent.click(screen.getByRole("button", { name: "Renew session" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "incorrect" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Renew session" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm password" })).toBeDisabled();
  });

  it("prevents duplicate submissions while renewal is pending", async () => {
    auth.remaining = 600_000;
    let finish!: () => void;
    auth.renew.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<SessionExpiryWarning />);
    fireEvent.click(screen.getByRole("button", { name: "Renew session" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm password" }));
    expect(screen.getByRole("button", { name: "Renewing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(auth.renew).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
  });
});