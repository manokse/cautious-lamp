function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
    },
  });
}

function withPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}

export default {
  async fetch(request, env) {
    const path = withPath(request.url);

    if (path === "/api/test-proxy" || path === "/api/test-proxy/") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type, authorization",
          },
        });
      }

      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
      }

      let body = {};
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
      }

      const { url, method, headers, body: targetBody, timeoutMs } = body;
      if (!url) {
        return jsonResponse({ ok: false, error: "Target URL is required" }, 400);
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs || 30000);

        const response = await fetch(url, {
          method: method || "GET",
          headers: headers || {},
          body: targetBody ? (typeof targetBody === "string" ? targetBody : JSON.stringify(targetBody)) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const contentType = response.headers.get("content-type") || "";
        const responseHeaders = Object.fromEntries(response.headers.entries());
        let sizeBytes = Number.parseInt(response.headers.get("content-length") || "0", 10) || 0;

        if (contentType.includes("application/json")) {
          const rawText = await response.text();
          sizeBytes = sizeBytes || new TextEncoder().encode(rawText).length;
          let data = {};
          try {
            data = JSON.parse(rawText);
          } catch {
            data = rawText;
          }
          return jsonResponse({
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            data,
            rawText,
            responseType: "json",
            sizeBytes,
          }, 200);
        } else if (contentType.includes("image/") || contentType.includes("application/pdf")) {
          const blob = await response.arrayBuffer();
          sizeBytes = sizeBytes || blob.byteLength;
          const base64 = btoa(String.fromCharCode(...new Uint8Array(blob)));
          const responseType = contentType.includes("pdf") ? "pdf" : "image";
          return jsonResponse({
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            data: `data:${contentType};base64,${base64}`,
            rawText: `${responseType.toUpperCase()} binary payload (${sizeBytes} bytes)`,
            responseType,
            sizeBytes,
          }, 200);
        } else {
          const rawText = await response.text();
          sizeBytes = sizeBytes || new TextEncoder().encode(rawText).length;
          return jsonResponse({
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            data: rawText,
            rawText,
            responseType: "text",
            sizeBytes,
          }, 200);
        }
      } catch (error) {
        return jsonResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Proxy request failed",
        }, 500);
      }
    }

    if (path === "/api/generate" || path === "/api/generate/") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type, authorization",
          },
        });
      }

      if (request.method === "GET") {
        return jsonResponse({
          ok: true,
          service: "browserless-generator",
          runtime: "worker",
          forwardProxySupported: false,
        }, 200);
      }

      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
      }

      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }

      try {
        const { generateBrowserlessAccount } = await import("./shared/browserless-generator.js");
        const result = await generateBrowserlessAccount({
          requestUrl: request.url,
          profile: body.profile || {},
          preferredToken: body.preferredToken || "",
          maxOtpWaitSeconds: body.maxOtpWaitSeconds,
          proxyEnabled: Boolean(body.proxyEnabled),
          proxyUrl: body.proxyUrl || "",
          proxyUrls: body.proxyUrls || [],
          proxyMaxAttempts: body.proxyMaxAttempts ?? 2,
          requestTimeoutMs: body.requestTimeoutMs ?? 15000,
          anonKey: env.BROWSERLESS_SUPABASE_ANON_KEY || "",
        });

        return jsonResponse({ ok: true, result }, 200);
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          500,
        );
      }
    }

    // Serve static assets for all non-API routes
    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }

    return new Response("Asset binding ASSETS is not configured", { status: 500 });
  },
};
