import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginPage from "./login";
import RegisterPage from "./register";
import ForgotPasswordPage from "./forgot-password";
import ResetPasswordPage from "./reset-password";
import { forgotPassword, loginWithEmail, register, resetPassword } from "@/lib/team-auth";

vi.mock("@/lib/team-auth", () => ({
  forgotPassword: vi.fn(),
  loginWithEmail: vi.fn(),
  register: vi.fn(),
  resetPassword: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/");
});

function expectSingleLinkControls(container: HTMLElement) {
  expect(container.querySelector("a button, button a")).toBeNull();
}

describe("auth feedback and navigation accessibility", () => {
  it("announces sign-in failures", async () => {
    vi.mocked(loginWithEmail).mockRejectedValue(new Error("Incorrect credentials"));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect credentials");
  });

  it("connects registration validation to the affected field", () => {
    window.history.replaceState(null, "", "/register?token=example");
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Test Person" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "longpassword" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "otherpassword" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-describedby", "register-error");
  });

  it("announces registration failures that replace the form with one link", async () => {
    window.history.replaceState(null, "", "/register?token=example");
    vi.mocked(register).mockRejectedValue(new Error("Already exists"));
    const { container } = render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Test Person" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You already have an account");
    expect(screen.getByRole("link", { name: "Sign in instead" })).toHaveAttribute("href", "/login");
    expectSingleLinkControls(container);
  });

  it("announces recovery failures and has one control per navigation action", async () => {
    vi.mocked(forgotPassword).mockRejectedValue(new Error("Service unavailable"));
    const { container } = render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable");
    expectSingleLinkControls(container);
  });

  it("announces recovery success and moves focus to the new heading", async () => {
    vi.mocked(forgotPassword).mockResolvedValue(undefined);
    const { container } = render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("reset link");
    expect(screen.getByRole("heading", { name: "Check your email" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
    expectSingleLinkControls(container);
  });

  it("announces reset errors and connects validation to the affected field", async () => {
    window.history.replaceState(null, "", "/reset-password?token=example");
    vi.mocked(resetPassword).mockRejectedValue(new Error("Link expired"));
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "mismatch123" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-describedby", "reset-error");
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Link expired"));
  });

  it("announces reset success with focus and avoids nested controls", async () => {
    window.history.replaceState(null, "", "/reset-password?token=example");
    vi.mocked(resetPassword).mockResolvedValue(undefined);
    const { container } = render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("status")).toHaveTextContent("password has been changed");
    expect(screen.getByRole("heading", { name: "Password updated" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expectSingleLinkControls(container);
  });

  it("keeps the missing-token recovery link as a single anchor", () => {
    const { container } = render(<ResetPasswordPage />);
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
    expectSingleLinkControls(container);
  });
});