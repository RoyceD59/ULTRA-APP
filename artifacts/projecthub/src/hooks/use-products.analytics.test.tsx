import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUpdateProduct } from "./use-products";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/team-auth", () => ({ apiFetch }));

afterEach(() => {
  apiFetch.mockReset();
  delete window.umami;
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("product and stock analytics success boundaries", () => {
  it("counts a stock edit only after a successful response and excludes product text", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    const track = vi.fn();
    window.umami = { track };
    const { result } = renderHook(() => useUpdateProduct(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 12, data: { stockStatus: "onbackorder", name: "Private product draft" } });
    });
    expect(track).toHaveBeenCalledWith("product_saved", { productId: 12, fieldCount: 2 });
    expect(track).toHaveBeenCalledWith("inventory_updated", { productId: 12, stockStatus: "onbackorder" });
    expect(track.mock.calls).toHaveLength(2);
  });

  it("does not track failed edits", async () => {
    apiFetch.mockRejectedValueOnce(new Error("Save failed"));
    const track = vi.fn();
    window.umami = { track };
    const { result } = renderHook(() => useUpdateProduct(), { wrapper });
    act(() => result.current.mutate({ id: 12, data: { stockQuantity: 5 } }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(track).not.toHaveBeenCalled();
  });
});