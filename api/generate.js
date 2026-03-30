export const config = {
  runtime: "nodejs",
  maxDuration: 300,
};

let NODE_PROXY_TRANSPORT = "unknown";
let NODE_PROXY_TRANSPORT_ERROR = "";
const NODE_PROXY_TRANSPORT_PROBE = import("https-proxy-agent")
  .then((module) => {
    const HttpsProxyAgent =
      module?.HttpsProxyAgent || module?.default?.HttpsProxyAgent || module?.default;

    NODE_PROXY_TRANSPORT =
      typeof HttpsProxyAgent === "function"
        ? HttpsProxyAgent.name || "HttpsProxyAgent"
        : "module-loaded";

    return true;
  })
  .catch((error) => {
    NODE_PROXY_TRANSPORT = "unavailable";
    NODE_PROXY_TRANSPORT_ERROR = error instanceof Error ? error.message : String(error || "unknown");
    return false;
  });

async function settleProxyTransportProbe() {
  try {
    await NODE_PROXY_TRANSPORT_PROBE;
  } catch {
    // Promise rejection is already handled in probe initialization.
  }
}

function commonHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}

function jsonResponseFetch(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: commonHeaders(),
  });
}

function writeNodeJson(res, payload, status = 200) {
  const headers = commonHeaders();
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  res.statusCode = status;
  res.end(JSON.stringify(payload, null, 2));
}

function writeNodeOptions(res) {
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };

  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  res.statusCode = 204;
  res.end();
}

function safeParseJson(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return {};
  }

  if (typeof rawValue === "object") {
    return rawValue;
  }

  const text = String(rawValue).trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function readNodeRequestBody(req) {
  if (req.body !== undefined) {
    return safeParseJson(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf-8");
  return safeParseJson(text);
}

async function runGenerate(body, requestUrl, anonKey) {
  const { generateBrowserlessAccount } = await import("../shared/browserless-generator.js");

  return generateBrowserlessAccount({
    requestUrl,
    profile: body.profile || {},
    preferredToken: body.preferredToken || "",
    maxOtpWaitSeconds: body.maxOtpWaitSeconds,
    proxyEnabled: Boolean(body.proxyEnabled),
    proxyUrl: body.proxyUrl || "",
    proxyUrls: body.proxyUrls || [],
    proxyMaxAttempts: body.proxyMaxAttempts ?? 2,
    requestTimeoutMs: body.requestTimeoutMs ?? 15000,
    anonKey,
  });
}

function healthPayload() {
  const payload = {
    ok: true,
    service: "browserless-generator",
    method: "GET",
    runtime: "nodejs",
    forwardProxySupported: true,
    proxyTransport: NODE_PROXY_TRANSPORT,
  };

  if (NODE_PROXY_TRANSPORT_ERROR) {
    payload.proxyTransportError = NODE_PROXY_TRANSPORT_ERROR;
  }

  return payload;
}

async function handleFetchRequest(request) {
  await settleProxyTransportProbe();

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
    return jsonResponseFetch(healthPayload(), 200);
  }

  if (request.method !== "POST") {
    return jsonResponseFetch({ ok: false, error: "Method not allowed" }, 405);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const envAnonKey =
      typeof process !== "undefined" && process?.env?.BROWSERLESS_SUPABASE_ANON_KEY
        ? process.env.BROWSERLESS_SUPABASE_ANON_KEY
        : "";

    const result = await runGenerate(body, request.url, envAnonKey);
    return jsonResponseFetch({ ok: true, result }, 200);
  } catch (error) {
    return jsonResponseFetch(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

async function handleNodeRequest(req, res) {
  await settleProxyTransportProbe();

  if (req.method === "OPTIONS") {
    writeNodeOptions(res);
    return;
  }

  if (req.method === "GET") {
    writeNodeJson(res, healthPayload(), 200);
    return;
  }

  if (req.method !== "POST") {
    writeNodeJson(res, { ok: false, error: "Method not allowed" }, 405);
    return;
  }

  const body = await readNodeRequestBody(req);
  const host = req.headers?.host ? String(req.headers.host) : "localhost";
  const protocol = String(req.headers?.["x-forwarded-proto"] || "https");
  const requestUrl = `${protocol}://${host}${req.url || "/api/generate"}`;

  try {
    const envAnonKey =
      typeof process !== "undefined" && process?.env?.BROWSERLESS_SUPABASE_ANON_KEY
        ? process.env.BROWSERLESS_SUPABASE_ANON_KEY
        : "";

    const result = await runGenerate(body, requestUrl, envAnonKey);
    writeNodeJson(res, { ok: true, result }, 200);
  } catch (error) {
    writeNodeJson(
      res,
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

export default async function handler(request, response) {
  if (response && typeof response.setHeader === "function") {
    return handleNodeRequest(request, response);
  }

  return handleFetchRequest(request);
}
