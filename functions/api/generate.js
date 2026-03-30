import { generateBrowserlessAccount } from "../../shared/browserless-generator.js";

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

export async function onRequest(context) {
  const { request, env } = context;

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
    return jsonResponse({ ok: true, service: "browserless-generator", method: "GET" }, 200);
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
    const result = await generateBrowserlessAccount({
      requestUrl: request.url,
      profile: body.profile || {},
      preferredToken: body.preferredToken || "",
      maxOtpWaitSeconds: body.maxOtpWaitSeconds,
      proxyEnabled: Boolean(body.proxyEnabled),
      proxyUrl: body.proxyUrl || "",
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
