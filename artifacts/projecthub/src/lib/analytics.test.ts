import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent, type AnalyticsEvent } from "./analytics";

afterEach(() => {
  delete window.umami;
});

describe("privacy-safe custom analytics", () => {
  it("does nothing when the injected tracker is missing", () => {
    delete window.umami;
    expect(() => trackEvent("product_saved", { productId: 12, fieldCount: 2 })).not.toThrow();
  });

  it("strips unknown properties, nested values and nonfinite numbers", () => {
    const track = vi.fn();
    window.umami = { track };
    const data = { productId: 12, fieldCount: 2, email: "private@example.test", content: "private text" };
    trackEvent("product_saved", data);
    expect(track).toHaveBeenCalledWith("product_saved", { productId: 12, fieldCount: 2 });
    trackEvent("inventory_updated", { productId: NaN, stockQuantity: Infinity });
    expect(track).toHaveBeenLastCalledWith("inventory_updated", {});
  });

  it("ignores event names not in the contract", () => {
    const track = vi.fn();
    window.umami = { track };
    trackEvent("unknown" as AnalyticsEvent, {});
    trackEvent("toString" as AnalyticsEvent, {});
    expect(track).not.toHaveBeenCalled();
  });

  it("keeps review moderation free of review, reporter and staff identity", () => {
    const track = vi.fn();
    window.umami = { track };
    trackEvent("review_moderation_saved", {
      reviewType: "location", status: "hidden", reviewId: "private-review",
      reporterId: "private-reporter", staffEmail: "private@example.test", reason: "Private report",
    } as never);
    expect(track).toHaveBeenCalledExactlyOnceWith("review_moderation_saved", {
      reviewType: "location", status: "hidden",
    });
    trackEvent("review_moderation_saved", { reviewType: "location", status: "private text" } as never);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("does not let synchronous or asynchronous tracker failures interrupt the app", async () => {
    window.umami = { track: () => { throw new Error("offline"); } };
    expect(() => trackEvent("whatsapp_connect_requested", {})).not.toThrow();
    window.umami = { track: () => Promise.reject(new Error("offline")) };
    expect(() => trackEvent("whatsapp_connect_requested", {})).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});