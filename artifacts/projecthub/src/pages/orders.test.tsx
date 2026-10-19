import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrdersPage from "./orders";

vi.mock("@/lib/team-auth", () => ({ getTeamToken: () => "test-team-token" }));
vi.mock("@/components/shared/badges", () => ({ formatRelativeDate: () => "just now" }));

const makeOrder = (id: number, recovery?: boolean) => ({
  id, userId: `customer-${id}`, status: "processing", dateCreated: "2026-10-04T10:00:00Z",
  total: "2500", currency: "KES", paymentMethod: "paystack", paymentReference: `ref-${id}`,
  ...(recovery === undefined ? {} : { webhookRecovery: recovery }),
  lineItems: [{ productId: 1, name: "Filter", quantity: 1, total: "2500" }],
});

function renderOrders(orders: ReturnType<typeof makeOrder>[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input.includes("/reminder-gaps")) {
      return new Response(JSON.stringify({ orders: [], checkedOrders: 0 }), { status: 200 });
    }
    if (input.endsWith("/api/uc/admin/orders")) {
      return new Response(JSON.stringify(orders), { status: 200 });
    }
    throw new Error(`Unexpected request: ${input}`);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><OrdersPage /></QueryClientProvider>);
}

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Webhook recovery orders", () => {
  it("shows the API-flagged badge and an enrichment banner when opening details", async () => {
    renderOrders([makeOrder(1, true), makeOrder(2, false)]);
    const badge = await screen.findByText("Webhook recovery");
    expect(badge.className).toContain("bg-amber-100");
    expect(screen.getAllByText("Webhook recovery")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View details for order #1" }));
    const dialog = await screen.findByRole("dialog", { name: "Order #1" });
    const warning = within(dialog).getByRole("note", { name: "Webhook recovery warning" });
    expect(warning.textContent).toContain("enrich the order before dispatch");
    expect(within(dialog).getByText("ref-1")).toBeTruthy();
    expect(within(dialog).getByText("Filter × 1")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([false, undefined])("does not infer recovery when the flag is %s", async (flag) => {
    const order = makeOrder(3, flag);
    order.lineItems = [];
    renderOrders([order]);
    await screen.findByText("Order #3");
    expect(screen.queryByText("Webhook recovery")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View details for order #3" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("note", { name: "Webhook recovery warning" })).toBeNull();
    expect(within(dialog).getByText("No line items recorded.")).toBeTruthy();
  });

  it("keeps the warning for a recovered order with no line items or payment reference", async () => {
    const order = makeOrder(4, true);
    order.lineItems = [];
    order.paymentReference = "";
    renderOrders([order]);
    fireEvent.click(await screen.findByRole("button", { name: "View details for order #4" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("note", { name: "Webhook recovery warning" })).toBeTruthy();
    expect(within(dialog).getByText("No line items recorded.")).toBeTruthy();
    expect(within(dialog).getByText("Not recorded")).toBeTruthy();
  });
});