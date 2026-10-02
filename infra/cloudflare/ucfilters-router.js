const REPLIT_ORIGIN = "https://team-horizon--jerryaroyce.replit.app";
const COMPANION_ASSET_PATH = /^\/uc-companion\/\d+-\d+\//;
const ALLOWED_API_ORIGINS = new Set([
  "https://app.ucfilters.com",
  "https://hub.ucfilters.com",
]);

addEventListener("fetch", (event) => {
  event.respondWith(routeRequest(event.request));
});

async function routeRequest(request) {
  const incoming = new URL(request.url);
  const upstream = new URL(request.url);
  upstream.protocol = "https:";
  upstream.host = new URL(REPLIT_ORIGIN).host;

  const isApiHost = incoming.hostname === "api.ucfilters.com";
  const isHubHost = incoming.hostname === "hub.ucfilters.com";
  const isCompanionHost = incoming.hostname === "app.ucfilters.com";

  if (!isApiHost && !isHubHost && !isCompanionHost) {
    return new Response("Unknown host", { status: 421 });
  }

  const requestOrigin = request.headers.get("Origin");
  // This one aggregate is public and credential-free. Never widen private API CORS.
  const isPublicForestRead = incoming.pathname === "/api/uc/impact/forest" &&
    (request.method === "GET" || request.method === "HEAD" ||
      (request.method === "OPTIONS" && ["GET", "HEAD"].includes(request.headers.get("Access-Control-Request-Method"))));
  const isAllowedApiOrigin = ALLOWED_API_ORIGINS.has(requestOrigin);
  const isApiPath =
    incoming.pathname === "/api" || incoming.pathname.startsWith("/api/");

  if (isApiHost && !isApiPath) {
    return new Response("Not found", {
      status: 404,
      headers: apiNoStoreHeaders(),
    });
  }

  if (
    isHubHost &&
    (incoming.pathname === "/uc-companion" ||
      incoming.pathname.startsWith("/uc-companion/"))
  ) {
    return new Response("Not found", { status: 404 });
  }

  if (
    isApiHost &&
    request.method === "OPTIONS" &&
    request.headers.has("Access-Control-Request-Method")
  ) {
    const headers = apiNoStoreHeaders();
    if (isPublicForestRead) {
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    } else if (isAllowedApiOrigin) {
      applyApiCors(headers, requestOrigin);
    }
    return new Response(null, { status: 204, headers });
  }

  if (isCompanionHost) {
    const isSharedApi = isApiPath;

    if (!isSharedApi) {
      if (
        (incoming.pathname === "/uc-companion" ||
          incoming.pathname === "/uc-companion/") &&
        request.method === "GET"
      ) {
        return Response.redirect(`${incoming.origin}/`, 308);
      }

      if (
        incoming.pathname.startsWith("/uc-companion/") &&
        !COMPANION_ASSET_PATH.test(incoming.pathname) &&
        request.method === "GET"
      ) {
        const cleanPath = incoming.pathname.slice("/uc-companion".length) || "/";
        return Response.redirect(
          `${incoming.origin}${cleanPath}${incoming.search}`,
          308,
        );
      }

      if (!COMPANION_ASSET_PATH.test(incoming.pathname)) {
        upstream.pathname = `/uc-companion${
          incoming.pathname === "/" ? "/" : incoming.pathname
        }`;
      }
    }
  }

  const upstreamRequest = new Request(upstream, request);
  upstreamRequest.headers.set("X-Forwarded-Host", incoming.host);
  upstreamRequest.headers.set("X-Forwarded-Proto", incoming.protocol.slice(0, -1));
  upstreamRequest.headers.set("X-UC-Public-Host", incoming.host);

  const upstreamResponse = await fetch(upstreamRequest, {
    cf: {
      cacheEverything: false,
      cacheTtl: 0,
    },
  });

  const headers = new Headers(upstreamResponse.headers);
  const isApiResponse =
    isApiHost ||
    (isCompanionHost &&
      (incoming.pathname === "/api" || incoming.pathname.startsWith("/api/")));

  if (isApiResponse) {
    for (const [name, value] of apiNoStoreHeaders()) {
      headers.set(name, value);
    }
  }

  if (isApiHost) {
    headers.delete("Access-Control-Allow-Origin");
    headers.delete("Access-Control-Allow-Credentials");
    if (isPublicForestRead) {
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    } else if (isAllowedApiOrigin) {
      applyApiCors(headers, requestOrigin);
    }
  }

  const location = headers.get("Location");
  if (location) {
    const rewrittenLocation = location
      .replace(REPLIT_ORIGIN, incoming.origin)
      .replace(
        isCompanionHost ? `${incoming.origin}/uc-companion` : "\u0000",
        incoming.origin,
      );
    headers.set("Location", rewrittenLocation);
  }

  const contentType = headers.get("Content-Type") || "";
  // HTML and release metadata must always reflect the current deployment.
  // A cached shell can point at removed bundles and hide newly shipped tabs.
  if (contentType.includes("text/html") || incoming.pathname === "/version.json") {
    headers.set("Cache-Control", "no-store");
    headers.set("Cloudflare-CDN-Cache-Control", "no-store");
    headers.delete("Expires");
  }
  const isExpoManifest =
    isCompanionHost &&
    contentType.includes("application/json") &&
    Boolean(request.headers.get("expo-platform"));

  if (isExpoManifest) {
    const manifest = await upstreamResponse.text();
    return new Response(manifest.replaceAll(REPLIT_ORIGIN, incoming.origin), {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

function apiNoStoreHeaders() {
  return new Headers({
    "Cache-Control":
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
}

function applyApiCors(headers, origin) {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Requested-With",
  );
  headers.append("Vary", "Origin");
}
