import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminCustomersPage from "./customers";
import { issueUcTemporaryPassword } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  issueUcTemporaryPassword: vi.fn(),
}));

vi.mock("@/lib/team-auth", () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: "Bearer test-token" })),
  isTeamAdmin: vi.fn(() => true),
}));

const issuePassword = vi.mocked(issueUcTemporaryPassword);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminCustomersPage />
    </QueryClientProvider>,
  );
}

describe("admin customer temporary password", () => {
  beforeEach(() => {
    issuePassword.mockReset();
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/api/uc/admin/customers/42")) {
        return jsonResponse({
          customer: {
            id: 42,
            email: "customer@example.com",
            firstName: "Amina",
            lastName: "Otieno",
            name: "Amina Otieno",
            phone: "+254712345678",
            joinedAt: "2026-01-01T00:00:00.000Z",
            authProvider: "password",
          },
          orders: [],
          tickets: [],
        });
      }
      return jsonResponse({
        customers: [{
          id: 42,
          email: "customer@example.com",
          firstName: "Amina",
          lastName: "Otieno",
          name: "Amina Otieno",
          phone: "+254712345678",
          joinedAt: "2026-01-01T00:00:00.000Z",
          orderCount: 0,
          products: [],
        }],
        total: 1,
        page: 1,
        limit: 50,
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues through the generated client, shows the plaintext once, and clears it on close", async () => {
    issuePassword.mockResolvedValue({
      ok: true,
      temporaryPassword: "R4ndom-Temporary-Only-Once",
      expiresAt: "2026-01-02T00:00:00.000Z",
      delivery: { channel: "whatsapp", delivered: true },
    });

    renderPage();
    await screen.findByText("Amina Otieno");
    fireEvent.click(screen.getByText("Amina Otieno"));

    const action = await screen.findByRole("button", { name: /Generate temporary password/i });
    fireEvent.click(action);
    fireEvent.click(screen.getByRole("radio", { name: /WhatsApp/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate temporary password/i }));

    await waitFor(() => expect(issuePassword).toHaveBeenCalledWith(42, { channel: "whatsapp" }));
    expect(await screen.findByDisplayValue("R4ndom-Temporary-Only-Once")).toBeInTheDocument();
    expect(screen.getAllByText((_, node) => node?.textContent?.includes("Delivery confirmed via") ?? false).length).toBeGreaterThan(0);
    expect(screen.getByText(/Expires Jan 2, 2026/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByDisplayValue("R4ndom-Temporary-Only-Once")).not.toBeInTheDocument();
    });
  });

  it("keeps WhatsApp unavailable when the customer has no phone number", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/api/uc/admin/customers/42")) {
        return jsonResponse({
          customer: {
            id: 42,
            email: "customer@example.com",
            firstName: "Amina",
            lastName: "Otieno",
            name: "Amina Otieno",
            phone: "",
            joinedAt: "2026-01-01T00:00:00.000Z",
            authProvider: "password",
          },
          orders: [],
          tickets: [],
        });
      }
      return jsonResponse({
        customers: [{
          id: 42,
          email: "customer@example.com",
          firstName: "Amina",
          lastName: "Otieno",
          name: "Amina Otieno",
          phone: "",
          joinedAt: "2026-01-01T00:00:00.000Z",
          orderCount: 0,
          products: [],
        }],
        total: 1,
        page: 1,
        limit: 50,
      });
    }) as typeof fetch;

    renderPage();
    await screen.findByText("Amina Otieno");
    fireEvent.click(screen.getByText("Amina Otieno"));
    fireEvent.click(await screen.findByRole("button", { name: /Generate temporary password/i }));

    expect(screen.getByRole("radio", { name: /WhatsApp/ })).toBeDisabled();
    expect(screen.getByText("No phone number on this account")).toBeInTheDocument();
  });
});