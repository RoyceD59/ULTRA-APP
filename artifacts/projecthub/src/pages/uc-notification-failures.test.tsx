import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UcNotificationFailuresPage from "./uc-notification-failures";

vi.mock("@/lib/team-auth", () => ({ getTeamToken: () => "test-only" }));

const logs = [
  { id: 1, channel: "sms", recipient: "+254712345678", template: "order_confirmation" },
  { id: 2, channel: "email", recipient: "Customer@example.com", template: "order_confirmation" },
  { id: 3, channel: "email", recipient: "other@example.com", template: "filter_reminder" },
].map(log => ({
  ...log, provider: "test", messageBody: "", orderId: null, ticketId: null,
  testId: null, status: "failed", errorMessage: "Delivery failed",
  sentAt: "2026-10-04T10:00:00Z",
}));

describe("notification failure search", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } },
    });
    client.setQueryData(["uc-notification-failures", "test-only"], logs);
    client.setQueryData(["uc-notification-prune-preview", "test-only"], {
      eligibleSuccess: 0, eligibleFailure: 0, eligibleTotal: 0,
    });
    vi.stubGlobal("fetch", vi.fn());
    render(<QueryClientProvider client={client}><UcNotificationFailuresPage /></QueryClientProvider>);
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.unstubAllGlobals();
  });

  function search(value: string) {
    fireEvent.change(screen.getByRole("searchbox", { name: "Search recipient or template" }), {
      target: { value },
    });
  }

  it("matches partial phone and email recipients, ignoring case and surrounding spaces", () => {
    search("71234");
    expect(screen.getByText("+254712345678")).toBeInTheDocument();
    expect(screen.queryByText("Customer@example.com")).not.toBeInTheDocument();
    search("  CUSTOMER@EXAMPLE  ");
    expect(screen.getByText("Customer@example.com")).toBeInTheDocument();
    expect(screen.queryByText("+254712345678")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("combines template search with channel filtering and restores rows when cleared", () => {
    search("CONFIRM");
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Email\s*\(2\)/ }));
    expect(screen.getByText("Customer@example.com")).toBeInTheDocument();
    expect(screen.queryByText("+254712345678")).not.toBeInTheDocument();
    search("");
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "All channels" }));
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a useful no-match message rather than the no-failures state", () => {
    search("missing");
    expect(screen.getByText("No failures match your search and channel filter.")).toBeInTheDocument();
    expect(screen.queryByText("No failures on record")).not.toBeInTheDocument();
    search("   ");
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(3);
  });
});