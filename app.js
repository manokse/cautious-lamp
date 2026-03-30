import { faker } from "https://esm.sh/@faker-js/faker@9.8.0";

const ui = {
  apiKeyCount: document.getElementById("apiKeyCount"),
  executionMode: document.getElementById("executionMode"),
  workerCount: document.getElementById("workerCount"),
  otpWaitSeconds: document.getElementById("otpWaitSeconds"),
  plan: document.getElementById("plan"),
  useCase: document.getElementById("useCase"),
  proxyEnabled: document.getElementById("proxyEnabled"),
  proxyUrl: document.getElementById("proxyUrl"),
  proxyPool: document.getElementById("proxyPool"),
  keyExportFormat: document.getElementById("keyExportFormat"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  downloadKeysBtn: document.getElementById("downloadKeysBtn"),
  statusText: document.getElementById("statusText"),
  summaryText: document.getElementById("summaryText"),
  resultsBody: document.getElementById("resultsBody"),
  lastLog: document.getElementById("lastLog"),
};

const projectTypes = ["newProject", "existingProject", "migration"];
const API_ENDPOINTS = ["/api/generate", "/api/generate/"];

const state = {
  running: false,
  stopRequested: false,
  results: [],
  activeControllers: new Set(),
  inFlight: 0,
  totalTarget: 0,
  runMode: "sequential",
  workers: 1,
  backendCaps: {
    runtime: "unknown",
    forwardProxySupported: null,
  },
};

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function buildFakeProfile() {
  return {
    fullName: faker.person.fullName(),
    company: faker.company.name(),
    plan: ui.plan.value,
    useCase: ui.useCase.value,
    projectType: pick(projectTypes),
    // Known-good enum from observed Browserless signup traffic.
    attribution: "searchEngine",
    frontendUrl: "https://www.browserless.io/signup/payment-completed",
    line1: faker.location.streetAddress(),
    line2: "",
    postalCode: faker.location.zipCode(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: faker.location.country(),
    taxId: "",
  };
}

function makePreferredToken() {
  return faker.string.alphanumeric(48).toLowerCase();
}

function normalizeProxyToken(token) {
  const text = String(token || "").trim();
  if (!text) {
    return "";
  }

  const stripped = text.replace(/^['\"]|['\"]$/g, "").trim();
  if (!stripped || stripped.startsWith("#")) {
    return "";
  }

  return stripped;
}

function parseProxyPool(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) {
    return [];
  }

  // Support JSON arrays so users can paste proxy lists directly.
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const unique = [];
        for (const item of parsed) {
          const normalized = normalizeProxyToken(item);
          if (normalized && !unique.includes(normalized)) {
            unique.push(normalized);
          }
        }

        return unique;
      }
    } catch {
      // Fall back to string split parser.
    }
  }

  const unique = [];
  const looksJsonish = raw.includes("{") && raw.includes("}");
  const hasNewline = /\r|\n/.test(raw);
  const splitPattern = hasNewline
    ? /[\r\n;|]+/
    : looksJsonish
      ? /[;|]+/
      : /[,;|]+/;

  const tokens = raw.split(splitPattern);
  for (const token of tokens) {
    const normalized = normalizeProxyToken(token);
    if (normalized && !unique.includes(normalized)) {
      unique.push(normalized);
    }
  }

  return unique;
}

function hasTemplateToken(value) {
  const text = String(value || "");
  return /\{\{?url\}?\}|\{\{?target\}?\}|\{\{?raw_url\}?\}|\{\{?base64_url\}?\}|\{\{?url_b64\}?\}|%url%|\$URL/i.test(text);
}

function isForwardProxyLike(value) {
  const text = String(value || "").trim();
  if (!text || hasTemplateToken(text) || text.startsWith("{")) {
    return false;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) {
    try {
      const parsed = new URL(text);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return false;
      }

      const path = parsed.pathname || "/";
      const hasPath = path && path !== "/";
      const hasKnownGatewayQuery = ["url", "target", "destination", "dest", "u", "endpoint"]
        .some((key) => parsed.searchParams.has(key));

      return !hasPath && !hasKnownGatewayQuery;
    } catch {
      return false;
    }
  }

  const compact = text.replace(/\s+/g, "");
  if (/^[^:\/?#@]+:\d{2,5}$/.test(compact)) {
    return true;
  }

  if (/^[^:\/?#@]+:[^\/?#@]+@[^:\/?#@]+:\d{2,5}$/.test(compact)) {
    return true;
  }

  if (/^[^:\/?#@]+:\d{2,5}:[^:\/?#@]+:.+$/.test(compact)) {
    return true;
  }

  return false;
}

async function detectBackendCapabilities() {
  for (const endpoint of API_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json().catch(() => ({}));
      const runtime = String(data?.runtime || "unknown");
      const forwardProxySupported = typeof data?.forwardProxySupported === "boolean"
        ? data.forwardProxySupported
        : null;

      state.backendCaps = {
        runtime,
        forwardProxySupported,
      };
      return;
    } catch {
      // Try next endpoint.
    }
  }
}

function setStatus(text) {
  ui.statusText.textContent = `Status: ${text}`;
}

function sortedResults() {
  return [...state.results].sort((a, b) => a.index - b.index);
}

function updateSummary() {
  const success = state.results.filter((item) => item.status === "success").length;
  const failed = state.results.filter((item) => item.status === "failed").length;
  const stopped = state.results.filter((item) => item.status === "stopped").length;
  ui.summaryText.textContent =
    `Success: ${success} | Failed: ${failed} | Stopped: ${stopped} | Total: ${state.results.length}`;
}

function formatLog(logItems) {
  if (!Array.isArray(logItems) || logItems.length === 0) {
    return "Tidak ada log";
  }

  return logItems.join("\n");
}

function maskApiKey(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 10) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function statusMeta(status) {
  if (status === "success") {
    return { label: "SUCCESS", className: "tag-ok" };
  }

  if (status === "stopped") {
    return { label: "STOPPED", className: "tag-stop" };
  }

  return { label: "FAILED", className: "tag-fail" };
}

function renderResults() {
  ui.resultsBody.innerHTML = "";
  const labels = ["#", "Email", "OTP", "API Key", "Proxy", "Status", "Catatan"];

  for (const result of sortedResults()) {
    const tr = document.createElement("tr");
    const statusInfo = statusMeta(result.status);

    const apiCell = document.createElement("td");
    apiCell.setAttribute("data-label", "API Key");
    apiCell.textContent = maskApiKey(result.apiKey || "");

    if (result.apiKey) {
      const copyButton = document.createElement("button");
      copyButton.className = "copy-btn";
      copyButton.textContent = "Copy";
      copyButton.addEventListener("click", () => {
        navigator.clipboard.writeText(result.apiKey);
        copyButton.textContent = "Copied";
        setTimeout(() => {
          copyButton.textContent = "Copy";
        }, 900);
      });

      const wrapper = document.createElement("div");
      wrapper.className = "api-key-wrap";
      const span = document.createElement("span");
      span.textContent = maskApiKey(result.apiKey);
      wrapper.appendChild(span);
      wrapper.appendChild(copyButton);
      apiCell.innerHTML = "";
      apiCell.appendChild(wrapper);
    }

    const note = result.note || "";

    tr.innerHTML = `
      <td>${result.index}</td>
      <td>${result.email || "-"}</td>
      <td>${result.otpCode || "-"}</td>
      <td></td>
      <td>${result.proxyUsed ? "yes" : "no"}</td>
      <td class="${statusInfo.className}">${statusInfo.label}</td>
      <td>${note}</td>
    `;

    tr.children[3].replaceWith(apiCell);

    Array.from(tr.children).forEach((cell, index) => {
      cell.setAttribute("data-label", labels[index] || "Field");
    });

    ui.resultsBody.appendChild(tr);
  }

  updateSummary();
}

function isAbortError(error) {
  if (!error) {
    return false;
  }

  const name = String(error.name || "");
  const message = String(error.message || "");
  return name === "AbortError" || /aborted|abort/i.test(message);
}

function refreshRunStatus(config) {
  if (!state.running) {
    return;
  }

  const done = state.results.length;
  const workerText = config.executionMode === "async_pool" ? ` workers ${config.effectiveWorkers}` : "";
  setStatus(
    `running ${done}/${state.totalTarget} | in-flight ${state.inFlight} | mode ${config.executionMode}${workerText}`,
  );
}

async function callGenerateApi(payload, signal) {
  const failures = [];

  for (const endpoint of API_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal,
      });

      const rawText = await response.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }

      if (response.ok && data.ok && data.result) {
        return data.result;
      }

      const errorMessage =
        data.error ||
        (rawText ? rawText.slice(0, 200) : "") ||
        `HTTP ${response.status}`;

      if ([404, 405, 501].includes(response.status)) {
        failures.push({
          endpoint,
          message: errorMessage,
          kind: "route",
        });
        continue;
      }

      throw new Error(errorMessage);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : "unknown error";
      const kind = /\b404\b|\b405\b|method not allowed|not found/i.test(message)
        ? "route"
        : "runtime";

      if (kind === "runtime") {
        throw new Error(`Generate gagal dari backend. Detail: ${endpoint} -> ${message}`);
      }

      failures.push({
        endpoint,
        message,
        kind,
      });
    }
  }

  const detailText = failures.map((item) => `${item.endpoint} -> ${item.message}`).join(" | ");
  const routeOnly = failures.length > 0 && failures.every((item) => item.kind === "route");

  if (routeOnly) {
    throw new Error(`Backend /api belum aktif atau routing belum benar. Detail: ${detailText}`);
  }

  throw new Error(`Generate gagal dari backend. Detail: ${detailText}`);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function triggerDownload(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getApiKeyRows() {
  const byKey = new Map();

  for (const item of sortedResults()) {
    if (item.status !== "success" || !item.apiKey) {
      continue;
    }

    if (!byKey.has(item.apiKey)) {
      byKey.set(item.apiKey, {
        index: item.index,
        email: item.email || "",
        apiKey: item.apiKey,
        proxyUsed: item.proxyUsed ? "yes" : "no",
        proxyUrl: item.proxyUrlUsed || "",
        note: item.note || "",
      });
    }
  }

  return [...byKey.values()];
}

function exportTxt() {
  if (!state.results.length) {
    setStatus("belum ada hasil untuk di-download");
    return;
  }

  const modeInfo = state.runMode === "async_pool"
    ? `${state.runMode} workers=${state.workers}`
    : state.runMode;

  const lines = [
    "BROWSERLESS AUTO GENERATOR REPORT",
    "================================",
    "",
    `Generated At: ${new Date().toISOString()}`,
    `Mode: ${modeInfo}`,
    `Total Items: ${state.results.length}`,
    "",
  ];

  for (const result of sortedResults()) {
    lines.push(`ITEM ${result.index}`);
    lines.push(`Status: ${result.status}`);
    lines.push(`Email: ${result.email || "-"}`);
    lines.push(`OTP: ${result.otpCode || "-"}`);
    lines.push(`API Key: ${result.apiKey || "-"}`);
    lines.push(`Proxy: ${result.proxyUsed ? "yes" : "no"}`);
    lines.push(`Proxy URL: ${result.proxyUrlUsed || "-"}`);
    lines.push(`Note: ${result.note || "-"}`);
    lines.push("");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  triggerDownload(
    lines.join("\n"),
    `browserless-auto-report-${stamp}.txt`,
    "text/plain;charset=utf-8",
  );
}

function exportApiKeys() {
  const rows = getApiKeyRows();
  if (!rows.length) {
    setStatus("belum ada API key sukses untuk di-download");
    return;
  }

  const format = ui.keyExportFormat.value;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (format === "json") {
    triggerDownload(
      JSON.stringify(rows, null, 2),
      `browserless-api-keys-${stamp}.json`,
      "application/json;charset=utf-8",
    );
    return;
  }

  if (format === "csv") {
    const header = "index,email,apiKey,proxyUsed,proxyUrl,note";
    const body = rows.map((row) => [
      row.index,
      csvEscape(row.email),
      csvEscape(row.apiKey),
      row.proxyUsed,
      csvEscape(row.proxyUrl),
      csvEscape(row.note),
    ].join(",")).join("\n");

    triggerDownload(
      `${header}\n${body}\n`,
      `browserless-api-keys-${stamp}.csv`,
      "text/csv;charset=utf-8",
    );
    return;
  }

  const lines = [
    "# Browserless API Keys",
    `# Generated: ${new Date().toISOString()}`,
    "",
  ];

  for (const row of rows) {
    lines.push(`# index=${row.index} email=${row.email} proxy=${row.proxyUsed} proxyUrl=${row.proxyUrl || "-"}`);
    lines.push(row.apiKey);
    lines.push("");
  }

  triggerDownload(
    lines.join("\n"),
    `browserless-api-keys-${stamp}.txt`,
    "text/plain;charset=utf-8",
  );
}

function buildRunConfig() {
  const count = Math.max(1, Math.min(80, Number.parseInt(ui.apiKeyCount.value, 10) || 1));
  const maxOtpWaitSeconds = Math.max(
    15,
    Math.min(180, Number.parseInt(ui.otpWaitSeconds.value, 10) || 60),
  );
  const executionMode = ui.executionMode.value === "async_pool" ? "async_pool" : "sequential";
  const workerCount = Math.max(1, Math.min(12, Number.parseInt(ui.workerCount.value, 10) || 1));
  const effectiveWorkers = executionMode === "async_pool" ? Math.min(workerCount, count) : 1;

  const proxyEnabled = ui.proxyEnabled.checked;
  const proxyUrl = normalizeProxyToken(ui.proxyUrl.value);
  const proxyUrls = parseProxyPool(ui.proxyPool.value);

  return {
    count,
    maxOtpWaitSeconds,
    executionMode,
    workerCount,
    effectiveWorkers,
    proxyEnabled,
    proxyUrl,
    proxyUrls,
  };
}

async function processSingleItem(currentIndex, config) {
  if (state.stopRequested) {
    return;
  }

  const payload = {
    maxOtpWaitSeconds: config.maxOtpWaitSeconds,
    proxyEnabled: config.proxyEnabled,
    proxyUrl: config.proxyUrl,
    proxyUrls: config.proxyUrls,
    preferredToken: makePreferredToken(),
    profile: buildFakeProfile(),
  };

  const controller = new AbortController();
  state.activeControllers.add(controller);
  state.inFlight += 1;
  refreshRunStatus(config);

  try {
    const result = await callGenerateApi(payload, controller.signal);
    state.results.push({
      index: currentIndex,
      status: "success",
      email: result.email,
      otpCode: result.otpCode,
      apiKey: result.apiKey,
      proxyUsed: result.proxyUsed,
      proxyUrlUsed: result.proxyUrlUsed || "",
      note:
        result.inboxMeta?.subject ||
        (result.proxyUrlUsed ? `proxy: ${result.proxyUrlUsed}` : "ok"),
      log: result.operationLog || [],
    });

    ui.lastLog.textContent = formatLog(result.operationLog);
  } catch (error) {
    if (state.stopRequested && isAbortError(error)) {
      state.results.push({
        index: currentIndex,
        status: "stopped",
        email: "",
        otpCode: "",
        apiKey: "",
        proxyUsed: config.proxyEnabled,
        proxyUrlUsed: "",
        note: "dibatalkan user",
        log: [],
      });
    } else {
      state.results.push({
        index: currentIndex,
        status: "failed",
        email: "",
        otpCode: "",
        apiKey: "",
        proxyUsed: config.proxyEnabled,
        proxyUrlUsed: "",
        note: error instanceof Error ? error.message : "unknown error",
        log: [],
      });

      ui.lastLog.textContent =
        `Error item ${currentIndex}: ${error instanceof Error ? error.message : "unknown"}`;
    }
  } finally {
    state.activeControllers.delete(controller);
    state.inFlight = Math.max(0, state.inFlight - 1);
    renderResults();
    refreshRunStatus(config);
  }
}

async function runSequential(config) {
  for (let index = 1; index <= config.count; index += 1) {
    if (state.stopRequested) {
      break;
    }

    await processSingleItem(index, config);
  }
}

async function runAsyncPool(config) {
  let cursor = 1;

  async function workerLoop() {
    while (true) {
      if (state.stopRequested) {
        return;
      }

      const current = cursor;
      cursor += 1;
      if (current > config.count) {
        return;
      }

      await processSingleItem(current, config);
    }
  }

  const workers = Array.from({ length: config.effectiveWorkers }, () => workerLoop());
  await Promise.all(workers);
}

async function runBatchGeneration() {
  if (state.running) {
    return;
  }

  let config = buildRunConfig();

  if (config.proxyEnabled && !config.proxyUrl && config.proxyUrls.length === 0) {
    setStatus("proxy aktif tapi Proxy URL/Proxy Pool kosong");
    return;
  }

  if (config.proxyEnabled && state.backendCaps.forwardProxySupported === false) {
    const allProxyInputs = [config.proxyUrl, ...config.proxyUrls].filter(Boolean);
    const forwardLike = allProxyInputs.filter((item) => isForwardProxyLike(item));
    const templateLike = allProxyInputs.filter((item) => !isForwardProxyLike(item));

    if (forwardLike.length) {
      if (templateLike.length) {
        config = {
          ...config,
          proxyEnabled: true,
          proxyUrl: templateLike[0],
          proxyUrls: templateLike.slice(1),
        };

        setStatus(
          `runtime ${state.backendCaps.runtime}: ${forwardLike.length} forward proxy di-skip, lanjut pakai ${templateLike.length} proxy template kompatibel`,
        );
        ui.lastLog.textContent =
          `Proxy compatibility check: runtime=${state.backendCaps.runtime}, skipped_forward=${forwardLike.length}, kept_template=${templateLike.length}`;
      } else {
        config = {
          ...config,
          proxyEnabled: false,
          proxyUrl: "",
          proxyUrls: [],
        };

        setStatus(
          `runtime ${state.backendCaps.runtime} tidak mendukung forward proxy host:port. Proxy otomatis dinonaktifkan, lanjut direct fallback.`,
        );
        ui.lastLog.textContent =
          `Proxy compatibility check: runtime=${state.backendCaps.runtime}, skipped_forward=${forwardLike.length}, fallback=direct`;
      }
    }
  }

  state.running = true;
  state.stopRequested = false;
  state.results = [];
  state.inFlight = 0;
  state.activeControllers.clear();
  state.totalTarget = config.count;
  state.runMode = config.executionMode;
  state.workers = config.effectiveWorkers;

  ui.lastLog.textContent = "Menunggu proses...";
  renderResults();
  refreshRunStatus(config);

  try {
    if (config.executionMode === "async_pool") {
      await runAsyncPool(config);
    } else {
      await runSequential(config);
    }
  } finally {
    state.running = false;
    state.activeControllers.clear();

    const success = state.results.filter((item) => item.status === "success").length;
    const failed = state.results.filter((item) => item.status === "failed").length;
    const stopped = state.results.filter((item) => item.status === "stopped").length;

    if (state.stopRequested) {
      setStatus(`dihentikan | success ${success} | failed ${failed} | stopped ${stopped}`);
    } else {
      setStatus(`selesai | success ${success} | failed ${failed}`);
    }
  }
}

function stopBatchGeneration() {
  if (!state.running) {
    return;
  }

  state.stopRequested = true;

  for (const controller of state.activeControllers) {
    controller.abort();
  }

  setStatus(`menghentikan proses... in-flight ${state.activeControllers.size}`);
}

function syncProxyControls() {
  const enabled = ui.proxyEnabled.checked;
  ui.proxyUrl.disabled = !enabled;
  ui.proxyPool.disabled = !enabled;
}

function syncExecutionControls() {
  const isAsyncMode = ui.executionMode.value === "async_pool";
  ui.workerCount.disabled = !isAsyncMode;
}

ui.proxyEnabled.addEventListener("change", () => {
  syncProxyControls();
});

ui.executionMode.addEventListener("change", () => {
  syncExecutionControls();
});

ui.startBtn.addEventListener("click", () => {
  runBatchGeneration();
});

ui.stopBtn.addEventListener("click", () => {
  stopBatchGeneration();
});

ui.downloadBtn.addEventListener("click", () => {
  exportTxt();
});

ui.downloadKeysBtn.addEventListener("click", () => {
  exportApiKeys();
});

syncProxyControls();
syncExecutionControls();
setStatus("idle");
updateSummary();
detectBackendCapabilities();
