import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminInventoryPage from "../inventory";

vi.mock("@/lib/team-auth", () => ({
  isTeamAdmin: () => true,
  getAuthHeaders: () => ({ Authorization: "Bearer test-token" }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/hooks/use-products", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-products")>(),
  useProducts: () => ({ data: [] }),
  useUpdateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));

function product(id: number, name: string, sku: string, stockStatus: string, stockQuantity: number) {
  return { id, name, sku, stockStatus, stockQuantity, permalink: null, syncedAt: "2026-10-04T00:00:00Z" };
}

function inventoryFixture() {
  return [
    product(1, "Hydra Flux", "UC-HF", "instock", 20),
    product(2, "Hydra Cartridge", "UC-HC", "instock", 2),
    // Quantity zero counts as out of stock even if Woo's status hasn't caught up.
    product(3, "Zero Bottle", "ZERO", "instock", 0),
    // Explicit Woo status counts as out of stock even with positive quantity.
    product(4, "Hydra Housing", "UC-HH", "outofstock", 8),
    product(5, "Hydra Reserve", "UC-HR", "onbackorder", 0),
    product(6, "Travel Kit", "TK", "onbackorder", 7),
  ];
}

let products: ReturnType<typeof inventoryFixture>;
let inventoryReads: number;
let stockWrites: Array<{ id: number; stockQuantity: number }>;
let queryClient: QueryClient;

beforeEach(() => {
  products = inventoryFixture();
  inventoryReads = 0;
  stockWrites = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const pathname = new URL(String(input), "http://localhost").pathname;
    if (pathname === "/api/uc/admin/inventory" && (!init?.method || init.method === "GET")) {
      inventoryReads += 1;
      // Return a detached snapshot: mutating server fixtures must not update the cache.
      return Response.json({ products: products.map((item) => ({ ...item })), source: "woocommerce" });
    }
    const stockEdit = pathname.match(/^\/api\/uc\/admin\/inventory\/(\d+)$/);
    if (stockEdit && init?.method === "PATCH") {
      const id = Number(stockEdit[1]);
      const { stockQuantity } = JSON.parse(String(init.body)) as { stockQuantity: number };
      stockWrites.push({ id, stockQuantity });
      products = products.map((item) => item.id === id
        ? { ...item, stockQuantity, stockStatus: stockQuantity === 0 ? "outofstock" : "instock" }
        : item);
      return Response.json({ success: true });
    }
    if (pathname === "/api/admin/inventory-settings") {
      return Response.json({
        lowStockThreshold: { value: 5, source: "db" },
        restockDemandThreshold: { value: 5, source: "db" },
      });
    }
    if (pathname === "/api/uc/admin/inventory/wishlist-demand") {
      return Response.json([]);
    }
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${pathname}`);
  }));
});

afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllGlobals();
});

async function renderPage() {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(<QueryClientProvider client={queryClient}><AdminInventoryPage /></QueryClientProvider>);
  await screen.findByRole("radio", { name: "All" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled());
}

function selectStatus(name: string) {
  fireEvent.click(screen.getByRole("radio", { name, exact: true }));
  expect(screen.getByRole("radio", { name, exact: true })).toBeChecked();
}

function search(value: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search inventory by product name or SKU" }), {
    target: { value },
  });
}

function expectRows(names: string[], total = products.length) {
  const table = screen.getByRole("table");
  for (const item of inventoryFixture()) {
    if (names.includes(item.name)) {
      expect(within(table).getByText(item.name, { exact: true })).toBeInTheDocument();
    } else {
      expect(within(table).queryByText(item.name, { exact: true })).not.toBeInTheDocument();
    }
  }
  expect(within(table).getAllByRole("row")).toHaveLength(1 + Math.max(names.length, 1));
  expect(screen.getByText(`Showing ${names.length} of ${total} product${total === 1 ? "" : "s"}`)).toBeInTheDocument();
  expect(screen.queryByText("No products match the selected filters.") !== null)
    .toBe(names.length === 0 && total > 0);
}

const statusCases = [
  { status: "All", names: inventoryFixture().map((item) => item.name) },
  { status: "In stock", names: ["Hydra Flux", "Hydra Cartridge"] },
  { status: "Out of stock", names: ["Zero Bottle", "Hydra Housing", "Hydra Reserve"] },
  { status: "On backorder", names: ["Hydra Reserve", "Travel Kit"] },
];

describe("inventory status and search filters", () => {
  it.each(statusCases)("shows the correct rows and count for $status", async ({ status, names }) => {
    await renderPage();
    selectStatus(status);
    expectRows(names);
    selectStatus("All");
    expectRows(inventoryFixture().map((item) => item.name));
  });

  it.each(["  hYdRa  ", "  uC-h  "])("combines case-insensitive name/SKU search %s with every status", async (term) => {
    await renderPage();
    search(term);
    for (const { status, names } of statusCases) {
      selectStatus(status);
      expectRows(names.filter((name) => name.startsWith("Hydra")));
    }
    search("");
    expectRows(["Hydra Reserve", "Travel Kit"]);
    selectStatus("All");
    expectRows(inventoryFixture().map((item) => item.name));
  });

  it("updates the no-match message and count without clearing the active search or status", async () => {
    await renderPage();
    search("uc-hf");
    expectRows(["Hydra Flux"]);
    selectStatus("Out of stock");
    expectRows([]);
    selectStatus("In stock");
    expectRows(["Hydra Flux"]);
    search("does not exist");
    expectRows([]);
    search("   ");
    expectRows(["Hydra Flux", "Hydra Cartridge"]);
  });

  it("distinguishes an empty inventory from a filter with no matches", async () => {
    products = [];
    await renderPage();
    expectRows([], 0);
    expect(screen.getByText("No products found.")).toBeInTheDocument();
    selectStatus("On backorder");
    search("hydra");
    expectRows([], 0);
    expect(screen.getByText("No products found.")).toBeInTheDocument();
  });
});

describe("inventory filter freshness", () => {
  it.each([
    { id: 1, name: "Hydra Flux", sku: "uc-hf", from: "In stock", to: "Out of stock", quantity: 0 },
    { id: 4, name: "Hydra Housing", sku: "uc-hh", from: "Out of stock", to: "In stock", quantity: 12 },
  ])("moves $name from $from to $to after a quantity edit and refetch", async ({ id, name, sku, from, to, quantity }) => {
    await renderPage();
    search(sku);
    selectStatus(from);
    expectRows([name]);
    const row = screen.getByText(name, { exact: true }).closest("tr")!;
    fireEvent.click(within(row).getByTitle("Edit stock quantity"));
    const input = within(row).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: String(quantity) } });
    const readsBeforeEdit = inventoryReads;
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(stockWrites).toEqual([{ id, stockQuantity: quantity }]);
      expect(inventoryReads).toBeGreaterThan(readsBeforeEdit);
      expectRows([]);
    });
    expect(screen.getByRole("radio", { name: from, exact: true })).toBeChecked();
    expect(screen.getByRole("searchbox")).toHaveValue(sku);
    selectStatus(to);
    expectRows([name]);
    const updatedRow = screen.getByText(name, { exact: true }).closest("tr")!;
    const quantityHeader = screen.getByRole("columnheader", { name: "Stock qty", exact: true });
    const quantityColumn = within(quantityHeader.closest("tr")!).getAllByRole("columnheader").indexOf(quantityHeader);
    expect(within(updatedRow).getAllByRole("cell")[quantityColumn]).toHaveTextContent(String(quantity));

    const readsBeforeRefresh = inventoryReads;
    fireEvent.click(screen.getByRole("button", { name: "Refresh", exact: true }));
    await waitFor(() => expect(inventoryReads).toBeGreaterThan(readsBeforeRefresh));
    await waitFor(() => expectRows([name]));
    selectStatus(from);
    expectRows([]);
  });

  it("reapplies the selected status and SKU search when Refresh receives changed inventory", async () => {
    await renderPage();
    search("UC-HF");
    selectStatus("In stock");
    expectRows(["Hydra Flux"]);
    products = products.map((item) => item.id === 1
      ? { ...item, stockQuantity: 0, stockStatus: "outofstock" }
      : item);
    const readsBeforeRefresh = inventoryReads;
    fireEvent.click(screen.getByRole("button", { name: "Refresh", exact: true }));
    await waitFor(() => {
      expect(inventoryReads).toBeGreaterThan(readsBeforeRefresh);
      expectRows([]);
    });
    expect(screen.getByRole("radio", { name: "In stock", exact: true })).toBeChecked();
    expect(screen.getByRole("searchbox")).toHaveValue("UC-HF");
    selectStatus("Out of stock");
    expectRows(["Hydra Flux"]);
  });
});
