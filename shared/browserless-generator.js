const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjZGVpZ3p3ZHRzZHVienRja3dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI5MzE1NDYsImV4cCI6MjA1ODUwNzU0Nn0.QixgX2_e_T1cfKXKsxVNMx9isiE3Y-DBkU5NPziyZek";

const DEFAULT_DOMAINS = [
  "ji-a.cc",
  "waroengin.com",
  "sumberakun.com",
  "bosakun.com",
  "otpku.com",
];

const SIGNUP_MUTATION = `
mutation signup($user: signUpSession, $completedActionId: String, $promoCode: String, $referralCode: String, $frontendUrl: String) {
  signupCloudUnits(
    user: $user
    completedActionId: $completedActionId
    promoCode: $promoCode
    referralCode: $referralCode
    frontendUrl: $frontendUrl
  ) {
    authToken
    paymentLink
    __typename
  }
}
`;

const CHANGE_TOKEN_MUTATION = `
mutation changeToken($token: String!, $authToken: String) {
  changeToken(token: $token, authToken: $authToken) {
    token
    __typename
  }
}
`;

const GET_ACCOUNT_QUERY = `
query getAccount($authToken: String) {
  account(authToken: $authToken) {
    email
    ownerEmail
    apiKey
    plan
    maxConcurrent
    maxQueued
    __typename
  }
}
`;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(values) {
  return values[randomInt(0, values.length - 1)];
}

function randomString(size) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let output = "";
  for (let i = 0; i < size; i += 1) {
    output += alphabet[randomInt(0, alphabet.length - 1)];
  }
  return output;
}

function randomApiToken() {
  const alphabet = "abcdef0123456789";
  let output = "";
  for (let i = 0; i < 48; i += 1) {
    output += alphabet[randomInt(0, alphabet.length - 1)];
  }
  return output;
}

function normalizeTokenInput(token) {
  const normalized = String(token || "").trim().replace(/[^a-zA-Z0-9]/g, "");
  if (normalized.length < 16) {
    return "";
  }

  return normalized.slice(0, 64);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function pickFirstString(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return "";
}

function parseDomainList(text) {
  const domains = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes(".")) {
      continue;
    }

    if (line.includes(". ")) {
      const domain = line.split(". ", 2)[1].trim();
      if (domain.includes(".")) {
        domains.push(domain);
      }
      continue;
    }

    domains.push(line);
  }

  return [...new Set(domains)];
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractInboxMeta(html) {
  const fromMatch = html.match(/From:\s*<\/span>\s*<span>([^<]+)/i);
  const toMatch = html.match(/To:\s*<\/span>\s*<span>([^<]+)/i);
  const subjectHeader = html.match(/Subject:[\s\S]{0,240}?<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const subjectInline = html.match(/Subject:\s*<\/span>\s*<div[^>]*>([\s\S]*?)<\/div>/i);
  const receivedMatch = html.match(/Received:\s*<\/span>\s*<span>([^<]+)/i);

  return {
    from: fromMatch ? stripTags(fromMatch[1]) : "",
    to: toMatch ? stripTags(toMatch[1]) : "",
    subject: subjectHeader
      ? stripTags(subjectHeader[1])
      : subjectInline
        ? stripTags(subjectInline[1])
        : "",
    received: receivedMatch ? stripTags(receivedMatch[1]) : "",
  };
}

function pushUniqueOtp(candidates, code, reason) {
  const normalized = String(code || "").replace(/\D/g, "");
  if (normalized.length !== 6) {
    return;
  }

  if (candidates.some((item) => item.code === normalized)) {
    return;
  }

  candidates.push({
    code: normalized,
    reason,
  });
}

function extractOtpCandidatesFromInboxHtml(html) {
  const candidates = [];
  const patterns = [
    {
      reason: "copy_code_block",
      pattern: /Please copy or use the code below[\s\S]{0,1400}?\b(\d{6})\b/i,
    },
    {
      reason: "action_required",
      pattern: /\[Action required\]\s*Verify your email address[\s\S]{0,2800}?\b(\d{6})\b/i,
    },
    {
      reason: "monospace_code",
      pattern: /font-family:\s*monospace[\s\S]{0,260}?>\s*(\d{6})\s*<\/div>/i,
    },
    {
      reason: "verify_block",
      pattern: /Verify your email[\s\S]{0,2400}?\b(\d{6})\b/i,
    },
  ];

  for (const item of patterns) {
    const match = html.match(item.pattern);
    if (match) {
      pushUniqueOtp(candidates, match[1], item.reason);
    }
  }

  // Conservative fallback: only inspect the local "verify your email" section, never full-page numbers.
  const verifySection = html.match(/Verify your email[\s\S]{0,3200}/i);
  if (verifySection) {
    const sectionCodes = [...verifySection[0].matchAll(/\b(\d{6})\b/g)].map((item) => item[1]);
    for (const code of sectionCodes) {
      pushUniqueOtp(candidates, code, "verify_section_scan");
    }
  }

  return candidates;
}

function extractOtpFromInboxHtml(html) {
  const candidates = extractOtpCandidatesFromInboxHtml(html);
  return candidates.length ? candidates[0].code : null;
}

function scoreOtpCandidate(candidate) {
  const from = String(candidate?.inboxMeta?.from || "").toLowerCase();
  const subject = String(candidate?.inboxMeta?.subject || "").toLowerCase();
  const reason = String(candidate?.reason || "");

  let score = 0;
  if (from.includes("browserless.io")) {
    score += 6;
  }

  if (subject.includes("verify your email")) {
    score += 6;
  }

  if (subject.includes("action required")) {
    score += 2;
  }

  if (reason === "copy_code_block") {
    score += 5;
  }

  if (reason === "monospace_code") {
    score += 4;
  }

  if (reason === "action_required") {
    score += 3;
  }

  if (reason === "verify_block") {
    score += 2;
  }

  return score;
}

function normalizeProfile(profile) {
  const fullName = String(profile.fullName || "").trim() || `User ${randomString(6)}`;
  const company = String(profile.company || "").trim();
  const projectType = String(profile.projectType || "newProject").trim() || "newProject";
  const useCases = Array.isArray(profile.useCases) && profile.useCases.length
    ? profile.useCases.map((value) => String(value)).filter(Boolean)
    : [String(profile.useCase || "scraping")];

  // Browserless currently accepts this enum value from observed traffic.
  const attribution = "searchEngine";

  return {
    fullName,
    company,
    projectType,
    useCases,
    attribution,
    plan: String(profile.plan || "free"),
    frontendUrl: String(profile.frontendUrl || "https://www.browserless.io/signup/payment-completed"),
    address: {
      line1: String(profile.line1 || ""),
      line2: String(profile.line2 || ""),
      postalCode: String(profile.postalCode || ""),
      country: String(profile.country || ""),
      state: String(profile.state || ""),
      city: String(profile.city || ""),
      taxId: String(profile.taxId || ""),
    },
  };
}

async function readJsonSafe(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text };
  }
}

function toBase64(value) {
  const text = String(value || "");
  if (typeof btoa === "function") {
    return btoa(text);
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf-8").toString("base64");
  }

  return text;
}

function buildProxyUrlFromParts(protocol, host, port, username, password) {
  const safeProtocol = protocol === "https" ? "https" : "http";
  const safeHost = String(host || "").trim();
  const safePort = String(port || "").trim();
  if (!safeHost || !safePort) {
    return "";
  }

  if (username || password) {
    const userPart = encodeURIComponent(String(username || ""));
    const passPart = encodeURIComponent(String(password || ""));
    return `${safeProtocol}://${userPart}:${passPart}@${safeHost}:${safePort}`;
  }

  return `${safeProtocol}://${safeHost}:${safePort}`;
}

function normalizeProxyEndpointInput(proxyUrlRaw) {
  const raw = String(proxyUrlRaw || "").trim();
  if (!raw) {
    return "";
  }

  // Support JSON style proxy objects from rotating-proxy providers.
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      const host = String(parsed.host || parsed.hostname || "").trim();
      const port = String(parsed.port || "").trim();
      const protocolRaw = String(parsed.protocol || parsed.scheme || "http").toLowerCase();
      const protocol = protocolRaw.startsWith("https") ? "https" : "http";
      const username = String(parsed.username || parsed.user || "").trim();
      const password = String(parsed.password || parsed.pass || "").trim();
      const fromJson = buildProxyUrlFromParts(protocol, host, port, username, password);
      if (fromJson) {
        return fromJson;
      }
    } catch {
      // Ignore invalid JSON and continue with other formats.
    }
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    return raw;
  }

  const compact = raw.replace(/\s+/g, "");

  // Format: ip:port:user:pass
  const ipPortUserPass = compact.match(/^([^:\/?#@]+):(\d{2,5}):([^:\/?#@]+):(.+)$/);
  if (ipPortUserPass) {
    const [, host, port, username, password] = ipPortUserPass;
    return buildProxyUrlFromParts("http", host, port, username, password);
  }

  // Format: user:pass@host:port
  const userPassHostPort = compact.match(/^([^:\/?#@]+):([^\/?#@]+)@([^:\/?#@]+):(\d{2,5})$/);
  if (userPassHostPort) {
    const [, username, password, host, port] = userPassHostPort;
    return buildProxyUrlFromParts("http", host, port, username, password);
  }

  // Format: host:port
  const hostPort = compact.match(/^([^:\/?#@]+):(\d{2,5})$/);
  if (hostPort) {
    const [, host, port] = hostPort;
    return buildProxyUrlFromParts("http", host, port, "", "");
  }

  if (compact.includes("/") && !compact.startsWith("/")) {
    return `https://${compact}`;
  }

  return raw;
}

function applyProxyTemplate(proxyUrl, targetUrl) {
  const encoded = encodeURIComponent(targetUrl);
  const base64 = toBase64(targetUrl);

  const replacements = [
    ["{{url}}", encoded],
    ["{url}", encoded],
    ["%url%", encoded],
    ["$URL", encoded],
    ["{{target}}", encoded],
    ["{target}", encoded],
    ["{{raw_url}}", targetUrl],
    ["{raw_url}", targetUrl],
    ["{{base64_url}}", base64],
    ["{base64_url}", base64],
    ["{{url_b64}}", base64],
    ["{url_b64}", base64],
  ];

  let output = proxyUrl;
  let replaced = false;
  for (const [token, value] of replacements) {
    if (output.includes(token)) {
      output = output.split(token).join(value);
      replaced = true;
    }
  }

  if (replaced) {
    return output;
  }

  try {
    const url = new URL(proxyUrl);
    const keys = ["url", "target", "destination", "dest", "u", "endpoint"];
    const existingKey = keys.find((key) => url.searchParams.has(key));
    if (existingKey) {
      url.searchParams.set(existingKey, targetUrl);
    } else {
      url.searchParams.set("url", targetUrl);
    }

    return url.toString();
  } catch {
    const separator = proxyUrl.includes("?") ? "&" : "?";
    return `${proxyUrl}${separator}url=${encoded}`;
  }
}

function buildProxyAuthorizationHeader(proxyUrl) {
  try {
    const normalized = normalizeProxyEndpointInput(proxyUrl);
    const parsed = new URL(normalized);
    if (!parsed.username && !parsed.password) {
      return "";
    }

    const user = decodeURIComponent(parsed.username || "");
    const pass = decodeURIComponent(parsed.password || "");
    return `Basic ${toBase64(`${user}:${pass}`)}`;
  } catch {
    return "";
  }
}

function buildProxyTarget(proxyUrl, targetUrl) {
  if (!proxyUrl) {
    return targetUrl;
  }

  const normalized = normalizeProxyEndpointInput(proxyUrl);
  return applyProxyTemplate(normalized, targetUrl);
}

async function requestWithProxy(targetUrl, init, options) {
  const useProxy = options?.proxyEnabled && options?.proxyUrl;
  if (!useProxy) {
    return fetch(targetUrl, init);
  }

  const proxyTarget = buildProxyTarget(String(options.proxyUrl), targetUrl);
  const headers = new Headers(init?.headers || {});
  headers.set("x-target-url", targetUrl);

  const proxyAuth = buildProxyAuthorizationHeader(String(options.proxyUrl));
  if (proxyAuth && !headers.has("proxy-authorization")) {
    headers.set("proxy-authorization", proxyAuth);
  }

  return fetch(proxyTarget, {
    ...init,
    headers,
  });
}

async function loadDomains(requestUrl, proxyOptions) {
  try {
    const url = new URL(requestUrl);
    const domainTxtUrl = `${url.origin}/domain.txt`;
    const response = await requestWithProxy(
      domainTxtUrl,
      {
        method: "GET",
        cache: "no-store",
      },
      proxyOptions,
    );

    if (!response.ok) {
      return DEFAULT_DOMAINS;
    }

    const text = await response.text();
    const domains = parseDomainList(text);
    return domains.length ? domains : DEFAULT_DOMAINS;
  } catch {
    return DEFAULT_DOMAINS;
  }
}

function buildCookieHeader(user, domain, email) {
  const surl = encodeURIComponent(`${domain}/${user}`);
  const embx = encodeURIComponent(`["${email}"]`);
  return `surl=${surl}; embx=${embx}`;
}

async function setupEmailfakeMailbox(mailbox, proxyOptions) {
  const cookieHeader = buildCookieHeader(mailbox.user, mailbox.domain, mailbox.email);
  const body = new URLSearchParams({
    usr: mailbox.user,
    dmn: mailbox.domain,
  });

  const response = await requestWithProxy(
    "https://emailfake.com/check_adres_validation3.php",
    {
      method: "POST",
      headers: {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "origin": "https://emailfake.com",
        "referer": `https://emailfake.com/${mailbox.domain}/${mailbox.user}`,
        "cookie": cookieHeader,
      },
      body: body.toString(),
    },
    proxyOptions,
  );

  if (!response.ok) {
    throw new Error(`emailfake setup failed: ${response.status}`);
  }

  const setupData = await readJsonSafe(response);
  return {
    cookieHeader,
    setupStatus: setupData?.status || "unknown",
  };
}

async function fetchEmailfakeInboxHtml(mailbox, cookieHeader, channelId, proxyOptions) {
  const response = await requestWithProxy(
    `https://emailfake.com/channel${channelId}/`,
    {
      method: "GET",
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "referer": "https://emailfake.com/",
        "cookie": cookieHeader,
      },
    },
    proxyOptions,
  );

  if (!response.ok) {
    throw new Error(`emailfake inbox request failed: ${response.status}`);
  }

  return response.text();
}

async function pollOtpFromEmailfake(mailbox, cookieHeader, maxWaitSeconds, proxyOptions, operationLog) {
  const intervalSeconds = 5;
  const attempts = Math.max(1, Math.ceil(maxWaitSeconds / intervalSeconds));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const discovered = [];

    for (let channelId = 1; channelId <= 8; channelId += 1) {
      try {
        const inboxHtml = await fetchEmailfakeInboxHtml(mailbox, cookieHeader, channelId, proxyOptions);
        const inboxMeta = extractInboxMeta(inboxHtml);
        const otpCandidates = extractOtpCandidatesFromInboxHtml(inboxHtml);

        operationLog.push(
          `[${nowIso()}] poll ${attempt}/${attempts} channel=${channelId} candidates=${otpCandidates.length}`,
        );

        for (const otpCandidate of otpCandidates) {
          discovered.push({
            code: otpCandidate.code,
            reason: otpCandidate.reason,
            channelId,
            inboxMeta,
          });
        }
      } catch (error) {
        operationLog.push(
          `[${nowIso()}] poll ${attempt}/${attempts} channel=${channelId} failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    if (discovered.length) {
      const dedupMap = new Map();
      for (const item of discovered) {
        const score = scoreOtpCandidate(item);
        const existing = dedupMap.get(item.code);
        if (!existing || score > existing.score) {
          dedupMap.set(item.code, {
            ...item,
            score,
          });
        }
      }

      const ranked = [...dedupMap.values()].sort((a, b) => b.score - a.score);
      const best = ranked[0];

      return {
        otpCode: best.code,
        channelId: best.channelId,
        inboxMeta: best.inboxMeta,
        otpCandidates: ranked.map((entry) => ({
          code: entry.code,
          reason: entry.reason,
          channelId: entry.channelId,
          inboxMeta: entry.inboxMeta,
        })),
      };
    }

    if (attempt < attempts) {
      await sleep(intervalSeconds * 1000);
    }
  }

  return {
    otpCode: null,
    channelId: null,
    otpCandidates: [],
    inboxMeta: {
      from: "",
      to: mailbox.email,
      subject: "",
      received: "",
    },
  };
}

async function postDataBrowserless(path, payload, context) {
  const anonKey = context.anonKey || DEFAULT_SUPABASE_ANON_KEY;
  const headers = {
    "accept": "*/*",
    "content-type": "application/json;charset=UTF-8",
    "apikey": anonKey,
    "authorization": `Bearer ${anonKey}`,
    "origin": "https://www.browserless.io",
    "referer": "https://www.browserless.io/",
    "x-client-info": "supabase-js-web/2.100.0",
    "x-supabase-api-version": "2024-01-01",
  };

  const response = await requestWithProxy(
    `https://data.browserless.io${path}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    context.proxy,
  );

  const data = await readJsonSafe(response);
  if (!response.ok) {
    const detail = pickFirstString([
      data?.error_description,
      data?.message,
      data?.error,
      data?.msg,
      data?.rawText,
    ]);

    const suffix = detail ? ` (${String(detail).slice(0, 180)})` : "";
    throw new Error(`data.browserless.io ${path} failed: ${response.status}${suffix}`);
  }

  return data;
}

async function postGraphql(operationName, query, variables, context) {
  const headers = {
    "accept": "*/*",
    "content-type": "application/json",
    "origin": "https://www.browserless.io",
    "referer": "https://www.browserless.io/",
  };

  if (context.accessToken) {
    headers.authorization = `Bearer ${context.accessToken}`;
  }

  const response = await requestWithProxy(
    "https://api.browserless.io/graphql",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        operationName,
        query,
        variables,
      }),
    },
    context.proxy,
  );

  const body = await readJsonSafe(response);

  if (!response.ok) {
    throw new Error(`api.browserless.io/graphql failed: ${response.status}`);
  }

  if (body?.errors?.length) {
    const msg = body.errors[0].message || "unknown";
    if (/2 free accounts per ip address/i.test(msg)) {
      throw new Error(
        `GraphQL ${operationName} error: ${msg}. Gunakan proxy/residential IP berbeda atau akun berbayar untuk lanjut generate.`,
      );
    }

    throw new Error(`GraphQL ${operationName} error: ${msg}`);
  }

  return body;
}

function normalizeProxyUrlsInput(proxyUrls) {
  if (Array.isArray(proxyUrls)) {
    return proxyUrls
      .map((item) => String(item || "").trim())
      .filter((item) => item && !item.startsWith("#"))
      .filter(Boolean);
  }

  const raw = String(proxyUrls || "");
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split(/[\r\n;|]+/)
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith("#"))
    .filter(Boolean);
}

function buildProxyCandidates(options) {
  const proxyEnabled = Boolean(options.proxyEnabled);
  const merged = [];
  const singleProxy = normalizeProxyEndpointInput(options.proxyUrl || "");
  const proxyPool = normalizeProxyUrlsInput(options.proxyUrls);

  if (singleProxy) {
    merged.push(singleProxy);
  }

  for (const item of proxyPool) {
    const normalized = normalizeProxyEndpointInput(item);
    if (normalized && !merged.includes(normalized)) {
      merged.push(normalized);
    }
  }

  if (!proxyEnabled) {
    return [{ proxyEnabled: false, proxyUrl: "", label: "direct" }];
  }

  if (!merged.length) {
    return [{ proxyEnabled: false, proxyUrl: "", label: "direct" }];
  }

  const candidates = merged.map((proxyUrl) => ({
    proxyEnabled: true,
    proxyUrl,
    label: proxyUrl,
  }));

  candidates.push({ proxyEnabled: false, proxyUrl: "", label: "direct-fallback" });
  return candidates;
}

function isRetryableAttemptError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("2 free accounts per ip address") ||
    text.includes("otp verify failed") ||
    text.includes("failed: 403") ||
    text.includes("failed: 429") ||
    text.includes("failed: 500") ||
    text.includes("failed: 502") ||
    text.includes("failed: 503") ||
    text.includes("failed: 504") ||
    text.includes("network") ||
    text.includes("timeout") ||
    text.includes("unable to extract browserless api key")
  );
}

async function generateBrowserlessAccountSingle(options = {}, proxyOptions, proxyMeta) {
  const effectiveProxy = proxyOptions || { proxyEnabled: false, proxyUrl: "" };
  const effectiveMeta = proxyMeta || { attempt: 1, total: 1, label: "direct" };

  const maxOtpWaitSeconds = Math.max(
    15,
    Math.min(180, Number.parseInt(String(options.maxOtpWaitSeconds || 60), 10) || 60),
  );

  const operationLog = [];
  operationLog.push(
    `[${nowIso()}] proxy attempt ${effectiveMeta.attempt}/${effectiveMeta.total}: ${effectiveMeta.label}`,
  );

  const requestUrl = String(options.requestUrl || "https://localhost");
  const domains = await loadDomains(requestUrl, { proxyEnabled: false, proxyUrl: "" });
  const profile = normalizeProfile(options.profile || {});

  const user = randomString(10);
  const domain = randomChoice(domains);
  const email = `${user}@${domain}`;

  const mailbox = {
    user,
    domain,
    email,
  };

  operationLog.push(`[${nowIso()}] mailbox prepared: ${email}`);

  const setupResult = await setupEmailfakeMailbox(mailbox, effectiveProxy);
  operationLog.push(`[${nowIso()}] emailfake setup status: ${setupResult.setupStatus}`);

  await postDataBrowserless(
    "/auth/v1/otp",
    {
      email,
      data: {},
      create_user: true,
      gotrue_meta_security: {},
      code_challenge: null,
      code_challenge_method: null,
    },
    {
      anonKey: options.anonKey,
      proxy: effectiveProxy,
    },
  );
  operationLog.push(`[${nowIso()}] otp requested`);

  const otpResult = await pollOtpFromEmailfake(
    mailbox,
    setupResult.cookieHeader,
    maxOtpWaitSeconds,
    effectiveProxy,
    operationLog,
  );

  if (!otpResult.otpCode) {
    throw new Error("OTP not found in emailfake inbox within timeout");
  }

  const verifyCandidates = otpResult.otpCandidates?.length
    ? otpResult.otpCandidates
    : [{ code: otpResult.otpCode, reason: "single_candidate", channelId: otpResult.channelId, inboxMeta: otpResult.inboxMeta }];

  let verifyData = null;
  let verifiedOtpCode = "";

  for (const candidate of verifyCandidates) {
    try {
      verifyData = await postDataBrowserless(
        "/auth/v1/verify",
        {
          email,
          token: candidate.code,
          type: "email",
          gotrue_meta_security: {},
        },
        {
          anonKey: options.anonKey,
          proxy: effectiveProxy,
        },
      );

      verifiedOtpCode = candidate.code;
      operationLog.push(
        `[${nowIso()}] otp verified using ${candidate.code} channel=${candidate.channelId || "?"} reason=${candidate.reason || "unknown"}`,
      );
      break;
    } catch (error) {
      operationLog.push(
        `[${nowIso()}] otp verify failed for ${candidate.code}: ${error instanceof Error ? error.message : "unknown"}`,
      );

      if (!(error instanceof Error) || !error.message.includes("failed: 403")) {
        throw error;
      }
    }
  }

  if (!verifyData || !verifiedOtpCode) {
    throw new Error(`OTP verify failed after trying ${verifyCandidates.length} candidate(s)`);
  }

  let accessToken = pickFirstString([
    verifyData?.access_token,
    verifyData?.session?.access_token,
  ]);
  let refreshToken = pickFirstString([
    verifyData?.refresh_token,
    verifyData?.session?.refresh_token,
  ]);

  let refreshedSession = {};
  if (refreshToken) {
    refreshedSession = await postDataBrowserless(
      "/auth/v1/token?grant_type=refresh_token",
      {
        refresh_token: refreshToken,
      },
      {
        anonKey: options.anonKey,
        proxy: effectiveProxy,
      },
    );

    accessToken = pickFirstString([
      accessToken,
      refreshedSession?.access_token,
      refreshedSession?.session?.access_token,
    ]);
    refreshToken = pickFirstString([
      refreshedSession?.refresh_token,
      refreshedSession?.session?.refresh_token,
      refreshToken,
    ]);

    operationLog.push(`[${nowIso()}] refresh token exchange completed`);
  }

  const oauthUserId = pickFirstString([
    verifyData?.user?.id,
    refreshedSession?.user?.id,
    crypto.randomUUID(),
  ]);

  const desiredToken = normalizeTokenInput(options.preferredToken) || randomApiToken();

  const signupVariables = {
    user: {
      fullName: profile.fullName,
      company: profile.company,
      attribution: profile.attribution,
      email,
      oauthUserId,
      plan: profile.plan,
      projectType: profile.projectType,
      useCases: profile.useCases,
      address: {
        ...profile.address,
      },
    },
    frontendUrl: profile.frontendUrl,
  };

  let signupResult = {};
  let signupError = "";
  try {
    signupResult = await postGraphql(
      "signup",
      SIGNUP_MUTATION,
      signupVariables,
      {
        proxy: effectiveProxy,
        accessToken,
      },
    );
    operationLog.push(`[${nowIso()}] signup mutation completed`);
  } catch (error) {
    signupError = error instanceof Error ? error.message : "unknown";
    operationLog.push(`[${nowIso()}] signup mutation failed: ${signupError}`);
  }

  const signupAuthToken = pickFirstString([
    signupResult?.data?.signupCloudUnits?.authToken,
  ]);

  let accountResult = {};
  if (signupAuthToken) {
    try {
      accountResult = await postGraphql(
        "getAccount",
        GET_ACCOUNT_QUERY,
        {
          authToken: signupAuthToken,
        },
        {
          proxy: effectiveProxy,
          accessToken: "",
        },
      );
      operationLog.push(`[${nowIso()}] getAccount with authToken completed`);
    } catch (error) {
      operationLog.push(
        `[${nowIso()}] getAccount authToken failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  } else {
    operationLog.push(`[${nowIso()}] getAccount authToken skipped: empty signup authToken`);
  }

  if (!accountResult?.data?.account) {
    try {
      accountResult = await postGraphql(
        "getAccount",
        GET_ACCOUNT_QUERY,
        {
          authToken: null,
        },
        {
          proxy: effectiveProxy,
          accessToken,
        },
      );
      operationLog.push(`[${nowIso()}] getAccount with session fallback completed`);
    } catch (error) {
      operationLog.push(
        `[${nowIso()}] getAccount session fallback failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  const existingApiKey = pickFirstString([
    accountResult?.data?.account?.apiKey,
  ]);

  const forceChangeToken = Boolean(options.forceChangeToken);
  let changeTokenResult = {};
  if (signupAuthToken && (!existingApiKey || forceChangeToken)) {
    const mutationVariables = {
      token: desiredToken,
      authToken: signupAuthToken,
    };

    const attemptContexts = [
      {
        proxy: effectiveProxy,
        accessToken: "",
        label: "authToken-only",
      },
      {
        proxy: effectiveProxy,
        accessToken,
        label: "authToken+session",
      },
    ];

    let changeOk = false;
    for (const contextTry of attemptContexts) {
      try {
        changeTokenResult = await postGraphql(
          "changeToken",
          CHANGE_TOKEN_MUTATION,
          mutationVariables,
          {
            proxy: contextTry.proxy,
            accessToken: contextTry.accessToken,
          },
        );
        operationLog.push(`[${nowIso()}] changeToken mutation completed via ${contextTry.label}`);
        changeOk = true;
        break;
      } catch (error) {
        operationLog.push(
          `[${nowIso()}] changeToken attempt ${contextTry.label} failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    if (!changeOk) {
      operationLog.push(`[${nowIso()}] changeToken skipped after retries`);
    }
  } else if (existingApiKey && !forceChangeToken) {
    operationLog.push(`[${nowIso()}] changeToken skipped: existing apiKey already available`);
  } else {
    operationLog.push(`[${nowIso()}] changeToken skipped: empty signup authToken`);
  }

  const apiKey = pickFirstString([
    accountResult?.data?.account?.apiKey,
    changeTokenResult?.data?.changeToken?.token,
  ]);

  if (!apiKey) {
    const reasons = [
      signupError && `signup=${signupError}`,
      !accessToken && "missing_access_token",
      "no_api_key_in_account_or_changeToken",
    ].filter(Boolean);

    throw new Error(`Unable to extract Browserless API key (${reasons.join("; ")})`);
  }

  return {
    generatedAt: nowIso(),
    proxyUsed: Boolean(effectiveProxy.proxyEnabled && effectiveProxy.proxyUrl),
    proxyUrlUsed: effectiveProxy.proxyUrl || "",
    proxyAttempt: effectiveMeta.attempt,
    proxyAttemptTotal: effectiveMeta.total,
    email,
    user,
    domain,
    otpCode: verifiedOtpCode,
    inboxMeta: otpResult.inboxMeta,
    channelId: otpResult.channelId,
    apiKey,
    refreshToken,
    profileUsed: {
      ...profile,
    },
    payloads: {
      otp: {
        email,
        data: {},
        create_user: true,
        gotrue_meta_security: {},
        code_challenge: null,
        code_challenge_method: null,
      },
      verify: {
        email,
        token: verifiedOtpCode,
        type: "email",
        gotrue_meta_security: {},
      },
      refresh: refreshToken
        ? {
            refresh_token: refreshToken,
          }
        : null,
      signup: {
        operationName: "signup",
        variables: signupVariables,
      },
      changeToken: {
        operationName: "changeToken",
        variables: {
          token: desiredToken,
        },
      },
      getAccount: {
        operationName: "getAccount",
      },
    },
    operationLog,
  };
}

export async function generateBrowserlessAccount(options = {}) {
  const proxyCandidates = buildProxyCandidates(options);
  const errors = [];

  for (let index = 0; index < proxyCandidates.length; index += 1) {
    const candidate = proxyCandidates[index];

    try {
      return await generateBrowserlessAccountSingle(options, candidate, {
        attempt: index + 1,
        total: proxyCandidates.length,
        label: candidate.label,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      errors.push(`[${candidate.label}] ${message}`);

      const hasNext = index < proxyCandidates.length - 1;
      if (!hasNext) {
        break;
      }

      if (!isRetryableAttemptError(message)) {
        break;
      }
    }
  }

  throw new Error(`All attempts failed: ${errors.join(" | ")}`);
}
