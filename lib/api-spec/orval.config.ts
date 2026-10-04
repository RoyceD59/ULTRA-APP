import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

// Generation-only domains: do not change backend tags/contracts to tune bundles.
// In particular password change has an admin tag and hydration has no tag.
const companionTransformer: InputTransformerFn = (config) => {
  titleTransformer(config);
  for (const [route, item] of Object.entries(config.paths ?? {})) {
    if (!item || /^\/uc\/(?:admin|editor|offline-clients)(?:\/|$)/.test(route)) continue;
    const domain = route.startsWith("/water-check/") || route.includes("/water-check/")
      ? "water-check"
      : route.startsWith("/uc/auth/")
        ? "auth"
        : route.startsWith("/uc/me/hydration/")
          ? "hydration"
          : route.startsWith("/uc/")
            ? "customer"
            : null;
    if (!domain) continue;
    for (const method of ["get", "post", "put", "patch", "delete", "options", "head"] as const) {
      if (item[method]) item[method].tags = [`companion-${domain}`];
    }
  }
  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      // No workspace barrel: keep the existing public index stable.
      target: path.resolve(apiClientReactSrc, "generated/api.ts"),
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  "companion-client": {
    input: {
      target: "./openapi.yaml",
      override: { transformer: companionTransformer },
      filters: {
        mode: "include",
        tags: ["companion-auth", "companion-customer", "companion-hydration", "companion-water-check"],
      },
    },
    output: {
      workspace: path.resolve(apiClientReactSrc, "companion-generated"),
      target: "api.ts",
      schemas: "models",
      client: "react-query",
      mode: "tags-split",
      baseUrl: "/api",
      // The root client's clean must never delete this separate output.
      clean: [path.resolve(apiClientReactSrc, "companion-generated")],
      prettier: true,
      override: {
        fetch: { includeHttpResponseReturnType: false },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
