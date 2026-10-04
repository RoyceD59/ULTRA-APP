import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrdersPage from "./orders";

vi.mock("@/lib/team-auth", () => ({ getTeamToken: () => "test-only-token" }));

const fixture = () => ({
  id: 94001, userId: "customer@example.invalid", status: "paid",
  dateCreated: "2026-10-04T06:00:00Z", total: "3000", currency: "KES",
  paymentMethod: "paystack", paymentReference: "recovery-fixture",
  webhookRecovery: true, recoveryEnrichedAt: null as string | null,
  shippingAddress: { shippingAmount: "500" } as Record<string, string>,
  lineItems: [] as { productId: number; name: string; quantity: number; total: string }[],
});

describe("recovery order enrichment UI contract", () => {
  let order: ReturnType<typeof fixture>;
  let client: QueryClient;
  let failNextSave: boolean;
  let patches: Record<string, unknown>[];
  beforeEach(() => {
    order = fixture(); failNextSave = false; patches = [];
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        if (failNextSave) {
          failNextSave = false;
          return new Response(JSON.stringify({ error: "Temporary save failure" }), { status: 500 });
        }
        order = { ...order, ...body, shippingAddress: { ...order.shippingAddress, ...(body.shippingAddress ?? {}) },
          recoveryEnrichedAt: body.lineItems ? "2026-10-04T06:30:00Z" : order.recoveryEnrichedAt };
        return new Response(JSON.stringify({ ok: true, status: order.status, recoveryEnrichedAt: order.recoveryEnrichedAt }));
      }
      return new Response(JSON.stringify(url.includes("reminder-gaps") ? { orders: [], checkedOrders: 0 } : [order]));
    }));
  });
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
  function mount() { return render(<QueryClientProvider client={client}><OrdersPage /></QueryClientProvider>); }
  async function openAndFill() {
    fireEvent.click(await screen.findByRole("button", { name: "Enrich", exact: true }));
    const dialog = within(screen.getByRole("dialog"));
    const values = {
      "First name": "Customer", Phone: "+254700000000", "Street / delivery address": "Delivery street",
      City: "Nairobi", Country: "KE", "Product ID": "123", "Product name": "Confirmed filter",
      Quantity: "2", "Line total (KES)": "2500.00",
    };
    for (const [label, value] of Object.entries(values)) {
      fireEvent.change(dialog.getByLabelText(label, { exact: true }), { target: { value } });
    }
    return dialog;
  }
  it("requires enrichment, saves the endpoint contract, refreshes the list and dispatches independently of customer updates", async () => {
    const view = mount();
    expect(await screen.findByRole("button", { name: "Mark dispatched", exact: true })).toBeDisabled();
    const dialog = await openAndFill();
    fireEvent.click(dialog.getByRole("button", { name: "Add item", exact: true }));
    fireEvent.click(dialog.getByRole("button", { name: "Remove item 2", exact: true }));
    fireEvent.click(dialog.getByRole("button", { name: "Save enrichment", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await screen.findByText(/ready to dispatch\./);
    expect(patches[0]!.lineItems).toEqual([{ productId: 123, name: "Confirmed filter", quantity: 2, total: "2500.00" }]);
    expect(patches[0]!.shippingAddress).toMatchObject({ firstName: "Customer", city: "Nairobi", shippingAmount: "500" });
    fireEvent.click(screen.getByRole("button", { name: "Edit enrichment", exact: true }));
    expect(screen.getByLabelText("Product ID", { exact: true })).toHaveValue(123);
    expect(screen.getByLabelText("City", { exact: true })).toHaveValue("Nairobi");
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Mark dispatched", exact: true }));
    await screen.findByText("dispatched", { exact: true });
    expect(patches.at(-1)).toEqual({ status: "dispatched" });
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => init?.method === "PATCH").every(([url]) => String(url).endsWith("/api/uc/admin/orders/94001"))).toBe(true);
    view.unmount(); mount();
    await screen.findByText("dispatched", { exact: true });
    expect(screen.queryByRole("button", { name: "Mark dispatched", exact: true })).not.toBeInTheDocument();
  });
  it("retains entered details and shows server errors until a retry succeeds", async () => {
    mount(); const dialog = await openAndFill();
    failNextSave = true;
    fireEvent.click(dialog.getByRole("button", { name: "Save enrichment", exact: true }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporary save failure");
    expect(screen.getByLabelText("City", { exact: true })).toHaveValue("Nairobi");
    expect(screen.getByRole("button", { name: "Mark dispatched", exact: true, hidden: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save enrichment", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await screen.findByText(/ready to dispatch\./);
  });
});