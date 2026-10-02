type AnalyticsData = Record<string, string | number | boolean>;

export type AnalyticsPayloadMap = {
  product_saved: { productId: number; fieldCount: number };
  inventory_updated: { productId: number; stockQuantity?: number; stockStatus?: "instock" | "outofstock" | "onbackorder" };
  blog_saved: { action: "create" | "update"; sourceCount: number };
  blog_published: { sourceCount: number };
  alison_conversation_opened: { messageCount: number };
  whatsapp_connect_requested: Record<string, never>;
};

export type AnalyticsEvent = keyof AnalyticsPayloadMap;
const EVENT_FIELDS: Record<AnalyticsEvent, readonly string[]> = {
  product_saved: ["productId", "fieldCount"],
  inventory_updated: ["productId", "stockQuantity", "stockStatus"],
  blog_saved: ["action", "sourceCount"],
  blog_published: ["sourceCount"],
  alison_conversation_opened: ["messageCount"],
  whatsapp_connect_requested: [],
};

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void | Promise<unknown>;
    };
  }
}

/** No script/config here: Replit injects the tracker into supported published websites. */
export function trackEvent<E extends AnalyticsEvent>(name: E, data: AnalyticsPayloadMap[E]): void {
  if (typeof window === "undefined") return;
  try {
    if (!Object.prototype.hasOwnProperty.call(EVENT_FIELDS, name)) return;
    const safe: AnalyticsData = {};
    for (const field of EVENT_FIELDS[name]) {
      const value = (data as AnalyticsData)[field];
      if (typeof value === "string" || typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value))) {
        safe[field] = value;
      }
    }
    // Both synchronous errors and rejected tracker requests must stay harmless.
    const pending = window.umami?.track(name, safe);
    if (pending) void Promise.resolve(pending).catch(() => {});
  } catch {
    // Analytics must never prevent the team from completing an action.
  }
}