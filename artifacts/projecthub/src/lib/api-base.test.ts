import { describe, expect, it } from "vitest";
import { apiUrl, resolveApiOrigin } from "./api-base";

describe("ProjectHub API base", () => {
  it("uses same-origin API paths in development by default", () => {
    expect(resolveApiOrigin({ PROD: false })).toBe("");
  });

  it("uses the production API hostname when production has no override", () => {
    expect(resolveApiOrigin({ PROD: true })).toBe("https://api.ucfilters.com");
  });

  it("normalizes domain and base-url overrides", () => {
    expect(resolveApiOrigin({ VITE_API_DOMAIN: "api.example.test/" })).toBe("https://api.example.test");
    expect(resolveApiOrigin({ VITE_API_BASE_URL: "https://api.example.test/api/" })).toBe("https://api.example.test");
    expect(resolveApiOrigin({ VITE_API_BASE_URL: "/api", PROD: false })).toBe("");
  });

  it("builds paths with exactly one /api prefix", () => {
    expect(apiUrl("/uc/impact")).toMatch(/\/api\/uc\/impact$/);
    expect(apiUrl("/api/uc/impact")).toMatch(/\/api\/uc\/impact$/);
  });
});