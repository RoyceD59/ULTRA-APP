import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminRewardsPage from "./rewards";
import { Toaster } from "@/components/ui/toaster";
import decodeQr from "jsqr";

vi.mock("jsqr", () => ({ default: vi.fn() }));

const scannerAdapter = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(),
  destroy: vi.fn(),
  onResult: null as null | ((value: string) => void),
  onDecodeError: null as null | ((error: Error | string) => void),
}));

vi.mock("@/lib/qr-scanner-adapter", () => ({
  createQrScannerAdapter: vi.fn(() =>
    (onResult: (value: string) => void, onDecodeError: (error: Error | string) => void) => {
      scannerAdapter.onResult = onResult;
      scannerAdapter.onDecodeError = onDecodeError;
      return { start: scannerAdapter.start, destroy: scannerAdapter.destroy };
    }),
}));

vi.mock("@/lib/team-auth", () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: "Bearer test-token", "Content-Type": "application/json" })),
  getTeamUser: vi.fn(() => ({ id: 1, name: "Admin" })),
  isTeamAdmin: vi.fn(() => true),
}));

describe("Admin Rewards Page", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    vi.resetAllMocks();
    scannerAdapter.start.mockResolvedValue();
    scannerAdapter.onResult = null;
    scannerAdapter.onDecodeError = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as Document & { permissionsPolicy?: unknown }).permissionsPolicy;
  });

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <AdminRewardsPage />
        <Toaster />
      </QueryClientProvider>
    );
  }

  function mockPageFetch() {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/conversion")) {
        return new Response(JSON.stringify({ conversion: { active: true, mode: "kes", value: 1 }, canEdit: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/rules")) {
        return new Response(JSON.stringify({ rules: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/balances")) {
        return new Response(JSON.stringify({ customers: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/resolve")) {
        return new Response(JSON.stringify({
          customer: { id: 1, firstName: "Scanned", email: "scan@example.com", phone: "+254" },
          balance: 500,
          impact: { filters: [] },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  }

  it("offers rear-camera photo capture and keeps manual lookup usable when live scanning is unsupported", async () => {
    mockPageFetch();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

    renderPage();
    const photoInput = screen.getByLabelText(/Take a customer QR photo/i);
    const clickPhotoInput = vi.spyOn(photoInput, "click");
    fireEvent.click(screen.getByRole("button", { name: /Scan customer/i }));

    expect(await screen.findByText(/Use your rear camera to photograph/i)).toBeInTheDocument();
    expect(clickPhotoInput).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Take QR photo/i })).toBeVisible();
    const lookupInput = screen.getByLabelText(/Phone, email, customer code, or QR value/i);
    fireEvent.change(lookupInput, { target: { value: "manual@example.com" } });
    expect(screen.getByRole("button", { name: /Find customer/i })).toBeEnabled();
  });

  it("uses rear-camera photo capture when browser policy blocks embedded camera access", async () => {
    mockPageFetch();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    Object.defineProperty(document, "permissionsPolicy", {
      configurable: true,
      value: { allowsFeature: vi.fn(() => false) },
    });

    renderPage();
    const photoInput = screen.getByLabelText(/Take a customer QR photo/i);
    const clickPhotoInput = vi.spyOn(photoInput, "click");
    fireEvent.click(screen.getByRole("button", { name: /Scan customer/i }));

    expect(clickPhotoInput).toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Take QR photo/i })).toBeVisible();
    expect(screen.getByLabelText(/Phone, email, customer code, or QR value/i)).toBeVisible();
  });

  it("decodes a QR photo when live camera scanning is unsupported", async () => {
    mockPageFetch();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    delete (window as Window & { BarcodeDetector?: unknown }).BarcodeDetector;
    const frame = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({ drawImage: vi.fn(), getImageData: () => frame })),
    });
    Object.defineProperties(HTMLImageElement.prototype, {
      naturalWidth: { configurable: true, get: () => 640 },
      naturalHeight: { configurable: true, get: () => 640 },
      src: {
        configurable: true,
        set() { queueMicrotask(() => this.onload?.(new Event("load"))); },
      },
    });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(decodeQr).mockReturnValue({
      data: "uc-rewards:photo",
      binaryData: [],
      chunks: [],
      version: 1,
      location: {} as ReturnType<typeof decodeQr>["location"],
    });

    renderPage();
    const photoInput = screen.getByLabelText(/Take a customer QR photo/i);
    fireEvent.change(photoInput, { target: { files: [new File(["qr"], "qr.png", { type: "image/png" })] } });

    await waitFor(() => expect(screen.getByLabelText(/Phone, email, customer code, or QR value/i)).toHaveValue("uc-rewards:photo"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("resolves a live QR result and destroys the scanner session", async () => {
    mockPageFetch();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Scan customer/i }));
    await screen.findByRole("button", { name: /Cancel/i });
    act(() => scannerAdapter.onResult?.("uc-rewards:test"));

    await waitFor(() => expect(scannerAdapter.destroy).toHaveBeenCalled());
    expect(screen.getByLabelText(/Phone, email, customer code, or QR value/i)).toHaveValue("uc-rewards:test");
  });

  it("falls back to photo or manual lookup after a live decoder failure", async () => {
    mockPageFetch();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Scan customer/i }));
    await screen.findByRole("button", { name: /Cancel/i });
    act(() => scannerAdapter.onDecodeError?.(new Error("decoder unavailable")));

    expect(await screen.findByRole("button", { name: /Take QR photo/i })).toBeVisible();
    expect(screen.getByLabelText(/Phone, email, customer code, or QR value/i)).toBeVisible();
  });

  it("destroys the scanner when the page moves to the background", async () => {
    mockPageFetch();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Scan customer/i }));
    await screen.findByRole("button", { name: /Cancel/i });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));

    expect(scannerAdapter.destroy).toHaveBeenCalled();
    expect(await screen.findByText(/Camera paused while this page was in the background/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Phone, email, customer code, or QR value/i)).toBeVisible();
  });

  it("should send litre additions to /impact, not /water", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options: any) => {
      if (url.includes("/conversion")) {
        return new Response(JSON.stringify({ conversion: { active: true, mode: "kes", value: 1 }, canEdit: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/resolve")) {
        return new Response(JSON.stringify({
          customer: { id: 1, firstName: "Test", email: "test@example.com", phone: "+254" },
          balance: 1000,
          impact: { filters: [{ id: 100, productName: "Test Filter", remainingCapacityLitres: 1000 }] }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/uc/admin/rewards/rules")) {
         return new Response(JSON.stringify({ rules: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/uc/admin/rewards/impact")) {
        return new Response(JSON.stringify({
          newBalance: 1000,
          impact: { filters: [] }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/uc/admin/rewards/balances")) {
        return new Response(JSON.stringify({ customers: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/uc/admin/rewards/water")) {
        return new Response(JSON.stringify({ error: "Regression" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    global.fetch = fetchMock;

    renderPage();

    // Find customer lookup input
    const lookupInput = screen.getByLabelText(/Phone, email, customer code, or QR value/i);
    fireEvent.change(lookupInput, { target: { value: "test@example.com" } });

    const findButton = screen.getByRole("button", { name: /Find customer/i });
    fireEvent.click(findButton);

    // Wait for resolution
    await waitFor(() => {
      expect(screen.getByText("Test")).toBeInTheDocument();
    });

    // Click "Add litres" tab
    const addLitresBtn = screen.getByRole("button", { name: /Add litres/i });
    fireEvent.click(addLitresBtn);

    // Enter amount and reason
    const amountInput = screen.getByLabelText(/Whole litres/i);
    fireEvent.change(amountInput, { target: { value: "5" } });

    const reasonInput = screen.getByPlaceholderText("Required for the receipt");
    fireEvent.change(reasonInput, { target: { value: "Test reason" } });

    // Click "Review contribution"
    const reviewBtn = screen.getByRole("button", { name: /Review contribution/i });
    fireEvent.click(reviewBtn);

    // Click "Confirm"
    const confirmBtn = screen.getByRole("button", { name: /Confirm/i });
    fireEvent.click(confirmBtn);

    // Wait for the mutation to finish
    await waitFor(() => {
      // Find the fetch call that sent the litres
      const impactCall = fetchMock.mock.calls.find(call => 
        call[0].includes("/api/uc/admin/rewards/impact") && call[1]?.method === "POST"
      );
      expect(impactCall).toBeDefined();
      
      const waterCall = fetchMock.mock.calls.find(call => 
        call[0].includes("/api/uc/admin/rewards/water") && call[1]?.method === "POST"
      );
      expect(waterCall).toBeUndefined();
    });
  });
});
