import { faker } from "https://esm.sh/@faker-js/faker@9.8.0";

const ui = {
  // Core controls
  apiKeyCount: document.getElementById("apiKeyCount"),
  executionMode: document.getElementById("executionMode"),
  workerCount: document.getElementById("workerCount"),
  workerCountOutput: document.getElementById("workerCountOutput"),
  otpWaitSeconds: document.getElementById("otpWaitSeconds"),
  requestTimeoutMs: document.getElementById("requestTimeoutMs"),
  plan: document.getElementById("plan"),
  useCase: document.getElementById("useCase"),
  proxyEnabled: document.getElementById("proxyEnabled"),
  proxyUrl: document.getElementById("proxyUrl"),
  proxyPool: document.getElementById("proxyPool"),
  proxyMaxAttempts: document.getElementById("proxyMaxAttempts"),
  keyExportFormat: document.getElementById("keyExportFormat"),
  
  // Buttons
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  downloadKeysBtn: document.getElementById("downloadKeysBtn"),
  clearResults: document.getElementById("clearResults"),
  clearLogs: document.getElementById("clearLogs"),
  
  // Status elements
  statusText: document.getElementById("statusText"),
  statusIndicator: document.getElementById("statusIndicator"),
  summaryText: document.getElementById("summaryText"),
  resultsBody: document.getElementById("resultsBody"),
  lastLog: document.getElementById("lastLog"),
  
  // Progress
  progressContainer: document.getElementById("progressContainer"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  
  // Live stats
  liveSuccess: document.getElementById("liveSuccess"),
  liveFailed: document.getElementById("liveFailed"),
  liveRunning: document.getElementById("liveRunning"),
  
  // Filter counts
  countAll: document.getElementById("countAll"),
  countSuccess: document.getElementById("countSuccess"),
  countFailed: document.getElementById("countFailed"),
  countRunning: document.getElementById("countRunning"),
  
  // New UI controls
  themeToggle: document.getElementById("themeToggle"),
  proxyConfig: document.getElementById("proxyConfig"),
  searchInput: document.getElementById("searchInput"),
  autoScroll: document.getElementById("autoScroll"),
  
  // Proxifly controls
  fetchProxifly: document.getElementById("fetchProxifly"),
  proxiflyStatus: document.getElementById("proxiflyStatus"),
  proxiflyProtocol: document.getElementById("proxiflyProtocol"),
  proxiflyCountry: document.getElementById("proxiflyCountry"),
  proxiflyAnonymity: document.getElementById("proxiflyAnonymity"),
  proxiflyLimit: document.getElementById("proxiflyLimit"),
  
  // Pagination
  pagination: document.getElementById("pagination"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  currentPage: document.getElementById("currentPage"),
  totalPages: document.getElementById("totalPages"),
  pageSize: document.getElementById("pageSize"),
};

// UI State
const uiState = {
  currentFilter: 'all',
  currentPage: 1,
  pageSize: 25,
  searchQuery: '',
  sortField: null,
  sortDirection: 'asc',
};

const projectTypes = ["newProject", "existingProject"];
const API_ENDPOINTS = buildApiEndpoints();

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

function buildApiEndpoints() {
  const params = new URLSearchParams(window.location.search);
  const rawApiBase = String(params.get("apiBase") || "").trim();

  if (!rawApiBase) {
    return ["/api/generate", "/api/generate/"];
  }

  const normalized = rawApiBase.replace(/\/+$/, "");
  if (/\/api\/generate$/i.test(normalized)) {
    return [normalized, `${normalized}/`];
  }

  return [`${normalized}/api/generate`, `${normalized}/api/generate/`];
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let response;
      try {
        response = await fetch(endpoint, {
          method: "GET",
          headers: {
            accept: "application/json",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

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
  ui.statusText.textContent = text;
}

function sortedResults() {
  return [...state.results].sort((a, b) => a.index - b.index);
}

function updateSummary() {
  const success = state.results.filter((item) => item.status === "success").length;
  const failed = state.results.filter((item) => item.status === "failed").length;
  const stopped = state.results.filter((item) => item.status === "stopped").length;
  const running = state.results.filter((item) => item.status === "running").length;
  
  ui.summaryText.textContent =
    `Success: ${success} | Failed: ${failed} | Stopped: ${stopped} | Total: ${state.results.length}`;
  
  // Update live stats in header
  if (ui.liveSuccess) ui.liveSuccess.textContent = success;
  if (ui.liveFailed) ui.liveFailed.textContent = failed;
  if (ui.liveRunning) ui.liveRunning.textContent = state.inFlight || running;
  
  // Update filter counts
  if (ui.countAll) ui.countAll.textContent = state.results.length;
  if (ui.countSuccess) ui.countSuccess.textContent = success;
  if (ui.countFailed) ui.countFailed.textContent = failed + stopped;
  if (ui.countRunning) ui.countRunning.textContent = state.inFlight || running;
  
  // Update progress bar
  if (ui.progressContainer && state.running) {
    ui.progressContainer.style.display = 'flex';
    const total = state.totalTarget || 1;
    const done = state.results.length;
    const percent = Math.round((done / total) * 100);
    ui.progressFill.style.width = `${percent}%`;
    ui.progressText.textContent = `${done} / ${total}`;
  } else if (ui.progressContainer && !state.running) {
    ui.progressContainer.style.display = 'none';
  }
  
  // Update status indicator
  if (ui.statusIndicator) {
    ui.statusIndicator.classList.remove('idle', 'running', 'success', 'error');
    if (state.running) {
      ui.statusIndicator.classList.add('running');
    } else if (state.results.length === 0) {
      ui.statusIndicator.classList.add('idle');
    } else if (failed > 0) {
      ui.statusIndicator.classList.add('error');
    } else {
      ui.statusIndicator.classList.add('success');
    }
  }
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
    return { label: "Success", className: "status-badge success" };
  }

  if (status === "stopped") {
    return { label: "Stopped", className: "status-badge error" };
  }
  
  if (status === "running") {
    return { label: "Running", className: "status-badge running" };
  }

  return { label: "Failed", className: "status-badge error" };
}

function getFilteredResults() {
  let filtered = sortedResults();
  
  // Apply status filter
  if (uiState.currentFilter === 'success') {
    filtered = filtered.filter(r => r.status === 'success');
  } else if (uiState.currentFilter === 'error') {
    filtered = filtered.filter(r => r.status === 'failed' || r.status === 'stopped');
  } else if (uiState.currentFilter === 'running') {
    filtered = filtered.filter(r => r.status === 'running');
  }
  
  // Apply search
  if (uiState.searchQuery) {
    const query = uiState.searchQuery.toLowerCase();
    filtered = filtered.filter(r => 
      (r.email && r.email.toLowerCase().includes(query)) ||
      (r.apiKey && r.apiKey.toLowerCase().includes(query)) ||
      (r.note && r.note.toLowerCase().includes(query))
    );
  }
  
  return filtered;
}

function renderResults() {
  const filtered = getFilteredResults();
  const totalPages = Math.max(1, Math.ceil(filtered.length / uiState.pageSize));
  
  // Ensure current page is valid
  if (uiState.currentPage > totalPages) {
    uiState.currentPage = totalPages;
  }
  
  const startIndex = (uiState.currentPage - 1) * uiState.pageSize;
  const pageResults = filtered.slice(startIndex, startIndex + uiState.pageSize);
  
  ui.resultsBody.innerHTML = "";
  
  // Show empty state if no results
  if (filtered.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.className = "empty-state";
    emptyRow.innerHTML = `
      <td colspan="8">
        <div class="empty-content">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            <path d="M9 10h.01M15 10h.01M9.5 15.5a3.5 3.5 0 017 0"/>
          </svg>
          <p>${state.results.length === 0 ? 'No results yet' : 'No matching results'}</p>
          <span>${state.results.length === 0 ? 'Configure settings and click "Start Generation"' : 'Try adjusting your filters'}</span>
        </div>
      </td>
    `;
    ui.resultsBody.appendChild(emptyRow);
    
    // Hide pagination
    if (ui.pagination) ui.pagination.style.display = 'none';
    updateSummary();
    refreshTesterGeneratedKeys();
    updateAnalytics();
    return;
  }
  
  // Show pagination
  if (ui.pagination) {
    ui.pagination.style.display = filtered.length > uiState.pageSize ? 'flex' : 'none';
    ui.currentPage.textContent = uiState.currentPage;
    ui.totalPages.textContent = totalPages;
    ui.prevPage.disabled = uiState.currentPage <= 1;
    ui.nextPage.disabled = uiState.currentPage >= totalPages;
  }

  for (const result of pageResults) {
    const tr = document.createElement("tr");
    tr.className = "new-row";
    const statusInfo = statusMeta(result.status);

    // Build API Key cell with copy button
    let apiKeyHtml = '-';
    if (result.apiKey) {
      apiKeyHtml = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="truncate" style="max-width: 150px;" title="${result.apiKey}">${maskApiKey(result.apiKey)}</span>
          <button class="copy-btn" data-copy="${result.apiKey}" title="Copy API Key">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>
      `;
    }

    const proxyDisplay = result.proxyUsed 
      ? `<span class="truncate" style="max-width: 120px;" title="${result.proxyUrlUsed || 'Yes'}">${result.proxyUrlUsed ? 'Yes' : 'Yes'}</span>`
      : '<span style="color: var(--text-tertiary);">No</span>';

    tr.innerHTML = `
      <td class="col-num">${result.index}</td>
      <td class="col-email"><span class="truncate" style="max-width: 180px;" title="${result.email || ''}">${result.email || "-"}</span></td>
      <td class="col-otp">${result.otpCode || "-"}</td>
      <td class="col-key">${apiKeyHtml}</td>
      <td class="col-proxy">${proxyDisplay}</td>
      <td class="col-status"><span class="${statusInfo.className}"><span class="badge-dot"></span>${statusInfo.label}</span></td>
      <td class="col-note"><span class="truncate" style="max-width: 150px;" title="${result.note || ''}">${result.note || "-"}</span></td>
      <td class="col-actions">
        ${result.apiKey ? `<button class="copy-btn" data-copy="${result.apiKey}" title="Copy API Key">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>` : ''}
      </td>
    `;

    ui.resultsBody.appendChild(tr);
  }

  // Attach copy handlers
  document.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.getAttribute('data-copy');
      navigator.clipboard.writeText(text).then(() => {
        showToast('API Key copied to clipboard', 'success');
      });
    });
  });

  updateSummary();
  refreshTesterGeneratedKeys();
  updateAnalytics();
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
  const workerText = config.executionMode === "async_pool" ? `, ${config.effectiveWorkers} workers` : "";
  setStatus(
    `Generating ${done}/${state.totalTarget}${workerText}`,
  );
}

async function callGenerateApi(payload, signal) {
  const failures = [];
  const requestTimeoutMs = Math.max(
    45000,
    ((Number.parseInt(String(payload?.maxOtpWaitSeconds || 60), 10) || 60) * 1000) + 45000,
  );

  for (const endpoint of API_ENDPOINTS) {
    try {
      const requestController = new AbortController();
      const onAbort = () => requestController.abort();
      if (signal) {
        if (signal.aborted) {
          requestController.abort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      const timeoutId = setTimeout(() => requestController.abort(), requestTimeoutMs);
      let response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: requestController.signal,
        });
      } finally {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      }

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
        if (signal?.aborted) {
          throw error;
        }

        throw new Error(
          `Request timeout (${Math.round(requestTimeoutMs / 1000)}s). Turunkan jumlah akun/proxy attempts atau kecilkan OTP timeout.`,
        );
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
  const requestTimeoutMs = Math.max(
    5000,
    Math.min(60000, Number.parseInt(ui.requestTimeoutMs.value, 10) || 15000),
  );
  const executionMode = ui.executionMode.value === "async_pool" ? "async_pool" : "sequential";
  const workerCount = Math.max(1, Math.min(12, Number.parseInt(ui.workerCount.value, 10) || 1));
  const effectiveWorkers = executionMode === "async_pool" ? Math.min(workerCount, count) : 1;

  const proxyEnabled = ui.proxyEnabled.checked;
  const proxyUrl = normalizeProxyToken(ui.proxyUrl.value);
  const proxyUrls = parseProxyPool(ui.proxyPool.value);
  const proxyMaxAttempts = Math.max(
    1,
    Math.min(12, Number.parseInt(ui.proxyMaxAttempts.value, 10) || 2),
  );

  return {
    count,
    maxOtpWaitSeconds,
    requestTimeoutMs,
    executionMode,
    workerCount,
    effectiveWorkers,
    proxyEnabled,
    proxyUrl,
    proxyUrls,
    proxyMaxAttempts,
  };
}

async function processSingleItem(currentIndex, config) {
  if (state.stopRequested) {
    return;
  }

  const payload = {
    maxOtpWaitSeconds: config.maxOtpWaitSeconds,
    requestTimeoutMs: config.requestTimeoutMs,
    proxyEnabled: config.proxyEnabled,
    proxyUrl: config.proxyUrl,
    proxyUrls: config.proxyUrls,
    proxyMaxAttempts: config.proxyMaxAttempts,
    preferredToken: makePreferredToken(),
    profile: buildFakeProfile(),
  };

  const controller = new AbortController();
  const startedAt = performance.now();
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
      durationMs: Math.round(performance.now() - startedAt),
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
        durationMs: Math.round(performance.now() - startedAt),
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
        durationMs: Math.round(performance.now() - startedAt),
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
    setStatus("Proxy enabled but no proxy URL/pool provided");
    showToast("Please add proxy URL or pool", "error");
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
          proxyMaxAttempts: Math.max(1, Math.min(config.proxyMaxAttempts, templateLike.length)),
        };

        setStatus(
          `Runtime ${state.backendCaps.runtime}: ${forwardLike.length} forward proxy skipped`,
        );
        ui.lastLog.textContent =
          `Proxy compatibility check: runtime=${state.backendCaps.runtime}, skipped_forward=${forwardLike.length}, kept_template=${templateLike.length}`;
      } else {
        config = {
          ...config,
          proxyEnabled: false,
          proxyUrl: "",
          proxyUrls: [],
          proxyMaxAttempts: 1,
        };

        setStatus(
          `Runtime doesn't support forward proxy. Using direct connection.`,
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

  // Update button states
  ui.startBtn.disabled = true;
  ui.stopBtn.disabled = false;

  ui.lastLog.textContent = "Starting generation...";
  renderResults();
  refreshRunStatus(config);
  showToast(`Starting generation of ${config.count} API keys`, "info");

  try {
    if (config.executionMode === "async_pool") {
      await runAsyncPool(config);
    } else {
      await runSequential(config);
    }
  } finally {
    state.running = false;
    state.activeControllers.clear();

    // Update button states
    ui.startBtn.disabled = false;
    ui.stopBtn.disabled = true;

    const success = state.results.filter((item) => item.status === "success").length;
    const failed = state.results.filter((item) => item.status === "failed").length;
    const stopped = state.results.filter((item) => item.status === "stopped").length;

    if (state.stopRequested) {
      setStatus(`Stopped — ${success} success, ${failed} failed, ${stopped} stopped`);
      showToast("Generation stopped by user", "info");
    } else {
      setStatus(`Complete — ${success} success, ${failed} failed`);
      if (success > 0) {
        showToast(`Successfully generated ${success} API keys!`, "success");
      } else {
        showToast("Generation complete with no successful keys", "error");
      }
    }
    
    updateSummary();
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

  setStatus(`Stopping... ${state.activeControllers.size} in-flight`);
}

function syncProxyControls() {
  const enabled = ui.proxyEnabled.checked;
  ui.proxyUrl.disabled = !enabled;
  ui.proxyPool.disabled = !enabled;
  ui.proxyMaxAttempts.disabled = !enabled;
  
  // Enable/disable proxy config panel
  if (ui.proxyConfig) {
    ui.proxyConfig.classList.toggle('enabled', enabled);
  }
}

function syncExecutionControls() {
  const isAsyncMode = ui.executionMode.value === "async_pool";
  ui.workerCount.disabled = !isAsyncMode;
}

// Toast notification system
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// Theme Toggle
function initTheme() {
  const saved = localStorage.getItem('browserless-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('browserless-theme', next);
}

// Proxifly Integration
async function fetchProxiflyProxies() {
  const protocol = ui.proxiflyProtocol?.value || 'http';
  const country = ui.proxiflyCountry?.value || '';
  const anonymity = ui.proxiflyAnonymity?.value || '';
  const limit = parseInt(ui.proxiflyLimit?.value || '20', 10);
  
  if (ui.proxiflyStatus) {
    ui.proxiflyStatus.textContent = 'Fetching proxies...';
    ui.proxiflyStatus.className = 'proxifly-status loading';
  }
  
  try {
    // Using the proxifly free-proxy-list raw data
    const url = `https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/${protocol}/data.json`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch proxy list');
    
    const data = await response.json();
    let proxies = Array.isArray(data) ? data : [];
    
    // Filter by country if specified
    if (country) {
      proxies = proxies.filter(p => p.geolocation?.country === country);
    }
    
    // Filter by anonymity if specified
    if (anonymity) {
      proxies = proxies.filter(p => p.anonymity === anonymity);
    }
    
    // Limit results
    proxies = proxies.slice(0, limit);
    
    if (proxies.length === 0) {
      throw new Error('No proxies found matching criteria');
    }
    
    // Format proxies for the pool
    const formattedProxies = proxies.map(p => {
      if (p.protocol === 'http' || p.protocol === 'https') {
        return `${p.ip}:${p.port}`;
      }
      return `${p.protocol}://${p.ip}:${p.port}`;
    });
    
    // Add to proxy pool
    const currentPool = ui.proxyPool.value.trim();
    const newPool = currentPool 
      ? `${currentPool}\n${formattedProxies.join('\n')}`
      : formattedProxies.join('\n');
    ui.proxyPool.value = newPool;
    
    if (ui.proxiflyStatus) {
      ui.proxiflyStatus.textContent = `✓ Added ${formattedProxies.length} proxies`;
      ui.proxiflyStatus.className = 'proxifly-status success';
    }
    
    showToast(`Added ${formattedProxies.length} proxies from Proxifly`, 'success');
    
  } catch (error) {
    if (ui.proxiflyStatus) {
      ui.proxiflyStatus.textContent = `✗ ${error.message}`;
      ui.proxiflyStatus.className = 'proxifly-status error';
    }
    showToast(`Failed to fetch proxies: ${error.message}`, 'error');
  }
}

// Initialize UI event listeners
function initUI() {
  // Theme toggle
  if (ui.themeToggle) {
    ui.themeToggle.addEventListener('click', toggleTheme);
  }
  initTheme();
  
  // Proxy toggle
  ui.proxyEnabled.addEventListener("change", syncProxyControls);
  
  // Execution mode
  ui.executionMode.addEventListener("change", syncExecutionControls);
  
  // Sync execution mode with segmented control
  document.querySelectorAll('input[name="execMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      ui.executionMode.value = e.target.value;
      syncExecutionControls();
    });
  });
  
  // Sync export format with segmented control
  document.querySelectorAll('input[name="exportFmt"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      ui.keyExportFormat.value = e.target.value;
    });
  });
  
  // Worker count slider
  if (ui.workerCount && ui.workerCountOutput) {
    ui.workerCount.addEventListener('input', () => {
      ui.workerCountOutput.textContent = ui.workerCount.value;
    });
  }
  
  // Stepper buttons
  document.querySelectorAll('.stepper-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      
      const step = parseInt(target.step || '1', 10);
      const min = parseInt(target.min || '0', 10);
      const max = parseInt(target.max || '999', 10);
      let value = parseInt(target.value || '0', 10);
      
      if (btn.dataset.action === 'increment') {
        value = Math.min(max, value + step);
      } else {
        value = Math.max(min, value - step);
      }
      
      target.value = value;
    });
  });
  
  // Collapsible panels
  document.querySelectorAll('.panel-header.collapsible').forEach(header => {
    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
      const body = document.getElementById(header.dataset.target);
      if (body) body.classList.toggle('collapsed');
    });
  });
  
  // Proxy source tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      // Update active tab button
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update active tab content
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tab}`);
      });
    });
  });
  
  // Proxifly fetch button
  if (ui.fetchProxifly) {
    ui.fetchProxifly.addEventListener('click', fetchProxiflyProxies);
  }
  
  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      uiState.currentFilter = btn.dataset.filter;
      uiState.currentPage = 1;
      renderResults();
    });
  });
  
  // Search input
  if (ui.searchInput) {
    let searchTimeout;
    ui.searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        uiState.searchQuery = e.target.value;
        uiState.currentPage = 1;
        renderResults();
      }, 300);
    });
  }
  
  // Pagination
  if (ui.prevPage) {
    ui.prevPage.addEventListener('click', () => {
      if (uiState.currentPage > 1) {
        uiState.currentPage--;
        renderResults();
      }
    });
  }
  
  if (ui.nextPage) {
    ui.nextPage.addEventListener('click', () => {
      const filtered = getFilteredResults();
      const totalPages = Math.ceil(filtered.length / uiState.pageSize);
      if (uiState.currentPage < totalPages) {
        uiState.currentPage++;
        renderResults();
      }
    });
  }
  
  if (ui.pageSize) {
    ui.pageSize.addEventListener('change', () => {
      uiState.pageSize = parseInt(ui.pageSize.value, 10);
      uiState.currentPage = 1;
      renderResults();
    });
  }
  
  // Clear results
  if (ui.clearResults) {
    ui.clearResults.addEventListener('click', () => {
      if (state.running) {
        showToast('Cannot clear while running', 'error');
        return;
      }
      state.results = [];
      renderResults();
      showToast('Results cleared', 'info');
    });
  }
  
  // Clear logs
  if (ui.clearLogs) {
    ui.clearLogs.addEventListener('click', () => {
      ui.lastLog.textContent = 'Logs cleared.';
    });
  }
  
  // Main action buttons
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
  
  // Update button states
  function updateButtonStates() {
    ui.startBtn.disabled = state.running;
    ui.stopBtn.disabled = !state.running;
  }
  
  // Observe state changes
  const originalRunBatch = runBatchGeneration;
  window.runBatchGenerationOriginal = originalRunBatch;
  
  initVideyScraper();
  syncProxyControls();
  syncExecutionControls();
  setStatus("Ready to start");
  updateSummary();
  detectBackendCapabilities();
}

// Initialize on DOM ready
initUI();

// ═══════════════════════════════════════════════════════════════════════════════
// VIEW SWITCHING & NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

function initViewSwitching() {
  const navTabs = document.querySelectorAll('.nav-tab');
  const views = document.querySelectorAll('.view');
  
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetView = tab.dataset.view;
      
      // Update active tab
      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update active view
      views.forEach(view => {
        view.classList.remove('active');
        if (view.id === `view-${targetView}`) {
          view.classList.add('active');
        }
      });

      // Refresh Videy keys if needed
      if (targetView === 'videy-scraper' && typeof window.updateVideyKeys === 'function') {
        window.updateVideyKeys();
      }
      // Close mobile sidebar if open
      closeMobileSidebar();
    });
  });
}

// Mobile Sidebar Toggle
function initMobileSidebar() {
  const menuToggle = document.getElementById('mobileMenuToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const closeBtn = document.getElementById('sidebarClose');
  
  if (menuToggle && sidebar && overlay) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  }
  
  if (overlay) {
    overlay.addEventListener('click', closeMobileSidebar);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeMobileSidebar);
  }
  
  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileSidebar();
      if (typeof closeImageModal === 'function') closeImageModal();
    }
  });
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEY SCRAPER
// ═══════════════════════════════════════════════════════════════════════════════

function temp_initVideyScraper() {
  const scrapeBtn = document.getElementById('scrapeVideyBtn');
  const urlInput = document.getElementById('videyUrl');
  const apiKeyInput = document.getElementById('videyApiKey');
  const selectKeyEl = document.getElementById('videySelectKey');
  const copyBtn = document.getElementById('copyVideyLink');

  // Update select options from successful generator results
  const updateKeyOptions = () => {
    if (!selectKeyEl) return;
    const currentVal = selectKeyEl.value;
    selectKeyEl.innerHTML = '<option value="">-- Select Key --</option>';
    
    state.results.filter(r => r.status === 'success' && r.apiKey).forEach(r => {
      const option = document.createElement('option');
      option.value = r.apiKey;
      option.textContent = `${r.email.split('@')[0]} (${r.apiKey.substring(0, 8)}...)`;
      selectKeyEl.appendChild(option);
    });
    
    selectKeyEl.value = currentVal;
  };

  // Sync manual input with select
  selectKeyEl?.addEventListener('change', () => {
    if (apiKeyInput && selectKeyEl.value) {
      apiKeyInput.value = selectKeyEl.value;
    }
  });

  // Observe state.results to update options
  const observer = new MutationObserver(() => updateKeyOptions());
  // Since state.results is a plain array, we'll manually call it on view change or periodic
  
  scrapeBtn?.addEventListener('click', async () => {
    const url = String(urlInput?.value || '').trim();
    const apiKey = String(apiKeyInput?.value || '').trim();

    if (!url) {
      showToast('Please enter a Videy URL', 'error');
      return;
    }

    if (!apiKey) {
      showToast('Please enter or select a Browserless API key', 'error');
      return;
    }

    setVideyStatus('loading', 'Automating browser...');
    
    try {
      const result = await scrapeVideyDirectLink(url, apiKey);
      if (result && result.videoUrl) {
        displayVideyResult(result.videoUrl, url);
        setVideyStatus('success', 'Video extracted');
        showToast('Video source extracted successfully', 'success');
      } else {
        throw new Error('Could not find video source on page');
      }
    } catch (error) {
      setVideyStatus('error', error instanceof Error ? error.message : 'Scraping failed');
      showToast(error instanceof Error ? error.message : 'Failed to scrape video', 'error');
    }
  });

  copyBtn?.addEventListener('click', () => {
    const link = document.getElementById('videyDirectLink')?.textContent;
    if (link && link !== '-') {
      navigator.clipboard.writeText(link);
      showToast('Direct link copied to clipboard', 'success');
    }
  });

  // Initial update
  updateKeyOptions();
}

function setVideyStatus(status, text) {
  const card = document.getElementById('videyStatus');
  const icon = document.getElementById('videyStatusIcon');
  const textEl = document.getElementById('videyStatusText');

  if (!card || !icon || !textEl) return;

  card.style.display = 'flex';
  textEl.textContent = text;
  
  icon.className = 'api-status-icon ' + status;
  if (status === 'loading') {
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>';
  } else {
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
  }
}

async function scrapeVideyDirectLink(videyUrl, apiKey) {
  // Use Browserless /content endpoint to get the HTML and find the video tag
  // Videy typically has a <video> with a direct <source> or src attribute
  const proxyEndpoint = API_ENDPOINTS[0].replace(/\/generate\/?$/, '/test-proxy');
  
  const payload = {
    url: `https://chrome.browserless.io/content?token=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      url: videyUrl,
      waitFor: 'video'
    },
    timeoutMs: 30000
  };

  const response = await fetch(proxyEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to connect to Browserless');
  }

  const result = await response.json();
  if (!result.ok || !result.data) {
    throw new Error(result.error || 'Failed to extract content');
  }

  // Parse HTML to find the video source
  const parser = new DOMParser();
  const doc = parser.parseFromString(result.data, 'text/html');
  const video = doc.querySelector('video');
  const source = doc.querySelector('video source');
  
  const videoUrl = source?.getAttribute('src') || video?.getAttribute('src');
  
  if (!videoUrl) {
    throw new Error('Video source not found on page. Make sure the URL is correct.');
  }

  // Resolve relative URLs
  try {
    return { videoUrl: new URL(videoUrl, videyUrl).toString() };
  } catch {
    return { videoUrl };
  }
}

function displayVideyResult(videoUrl, originalUrl) {
  const container = document.getElementById('videyPlayerContainer');
  const info = document.getElementById('videyVideoInfo');
  const sourceUrlEl = document.getElementById('videySourceUrl');
  const directLinkEl = document.getElementById('videyDirectLink');

  if (!container || !info || !sourceUrlEl || !directLinkEl) return;

  container.innerHTML = `
    <video controls autoplay playsinline>
      <source src="${videoUrl}" type="video/mp4">
      Your browser does not support the video tag.
    </video>
  `;

  info.style.display = 'flex';
  sourceUrlEl.textContent = originalUrl;
  directLinkEl.textContent = videoUrl;
}

// Update the initApp function or call this manually
// (I will add it to the existing view switch logic)
// ═══════════════════════════════════════════════════════════════════════════════

const apiTesterState = {
  requestTab: 'body',
  responseTab: 'preview',
  isSending: false,
  suiteRunning: false,
  suiteAbortController: null,
  currentResponse: null,
  currentBlobUrl: '',
  suiteResults: [],
  suiteCompleted: 0,
  suiteTotal: 0,
};

const BROWSERLESS_TEST_CASES = {
  screenshot: {
    label: 'Screenshot',
    method: 'POST',
    path: '/screenshot',
    buildBody: (targetUrl) => ({
      url: targetUrl,
      options: {
        type: 'png',
        fullPage: true,
      },
    }),
  },
  pdf: {
    label: 'PDF',
    method: 'POST',
    path: '/pdf',
    buildBody: (targetUrl) => ({
      url: targetUrl,
      options: {
        format: 'A4',
        printBackground: true,
      },
    }),
  },
  content: {
    label: 'Content',
    method: 'POST',
    path: '/content',
    buildBody: (targetUrl) => ({
      url: targetUrl,
    }),
  },
  scrape: {
    label: 'Scrape',
    method: 'POST',
    path: '/scrape',
    buildBody: (targetUrl) => ({
      url: targetUrl,
      elements: [
        { selector: 'title' },
        { selector: 'h1' },
        { selector: 'meta[name="description"]', attribute: 'content' },
      ],
    }),
  },
  function: {
    label: 'Function',
    method: 'POST',
    path: '/function',
    buildBody: (targetUrl) => ({
      code: `export default async function ({ page }) {
  await page.goto('${targetUrl}', { waitUntil: 'domcontentloaded' });
  const title = await page.title();
  const links = await page.$$eval('a', (items) => items.length);
  return { title, links };
}`,
    }),
  },
  performance: {
    label: 'Performance',
    method: 'POST',
    path: '/performance',
    buildBody: (targetUrl) => ({
      url: targetUrl,
    }),
  },
};

function testerEl(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let current = size;
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024;
    idx += 1;
  }

  const rounded = idx === 0 ? Math.round(current) : current.toFixed(1);
  return `${rounded} ${units[idx]}`;
}

function getTesterTimeoutMs() {
  return Math.max(
    5000,
    Math.min(120000, Number.parseInt(String(testerEl('apiRequestTimeout')?.value || '30000'), 10) || 30000),
  );
}

function getActiveApiKey() {
  return String(testerEl('testApiKey')?.value || '').trim();
}

function toggleCustomBaseUrlRow() {
  const row = testerEl('customBaseUrlRow');
  const select = testerEl('testBaseUrl');
  if (!row || !select) {
    return;
  }

  row.style.display = select.value === 'custom' ? 'flex' : 'none';
}

function getActiveBaseUrl() {
  const selectValue = String(testerEl('testBaseUrl')?.value || '').trim();
  if (!selectValue) {
    return '';
  }

  if (selectValue !== 'custom') {
    return selectValue.replace(/\/+$/, '');
  }

  const custom = String(testerEl('customBaseUrl')?.value || '').trim();
  return custom.replace(/\/+$/, '');
}

function setApiStatus(status, text) {
  const icon = testerEl('apiStatusIcon');
  const value = testerEl('apiStatusValue');

  if (icon) {
    icon.classList.remove('idle', 'loading', 'success', 'error');
    icon.classList.add(status);
  }

  if (value) {
    value.textContent = text;
  }
}

function collectEditorPairs(editorId) {
  const editor = testerEl(editorId);
  if (!editor) {
    return {};
  }

  const pairs = {};
  const rows = editor.querySelectorAll('.key-value-row');
  for (const row of rows) {
    const inputs = row.querySelectorAll('input');
    if (inputs.length < 2) {
      continue;
    }

    const key = String(inputs[0].value || '').trim();
    const value = String(inputs[1].value || '').trim();
    if (!key) {
      continue;
    }

    pairs[key] = value;
  }

  return pairs;
}

function appendEditorRow(editorId) {
  const editor = testerEl(editorId);
  if (!editor) {
    return;
  }

  const firstInputPlaceholder = editorId === 'paramsEditor' ? 'Parameter name' : 'Header name';
  const row = document.createElement('div');
  row.className = 'key-value-row';
  row.innerHTML = `
    <input type="text" placeholder="${firstInputPlaceholder}" />
    <input type="text" placeholder="Value" />
    <button class="btn btn-ghost btn-xs remove-row" type="button">×</button>
  `;

  editor.appendChild(row);
}

function parseBodyPayload(method, strict = true) {
  const requestBody = testerEl('requestBody');
  if (!requestBody) {
    return null;
  }

  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD') {
    return null;
  }

  const raw = String(requestBody.value || '').trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    if (strict) {
      throw new Error('Invalid JSON body. Please fix JSON syntax.');
    }

    return raw;
  }
}

function buildRequestUrl(baseUrl, endpoint, apiKey, params = {}) {
  const rawEndpoint = String(endpoint || '').trim();
  if (!rawEndpoint) {
    throw new Error('Request endpoint is required.');
  }

  const hasAbsoluteUrl = /^https?:\/\//i.test(rawEndpoint);
  const base = hasAbsoluteUrl
    ? rawEndpoint
    : new URL(rawEndpoint.startsWith('/') ? rawEndpoint : `/${rawEndpoint}`, baseUrl).toString();
  const url = new URL(base);

  Object.entries(params).forEach(([key, value]) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      return;
    }

    url.searchParams.set(normalizedKey, String(value || ''));
  });

  if (apiKey) {
    url.searchParams.set('token', apiKey);
  }

  return url;
}

function setRequestTab(tabName) {
  apiTesterState.requestTab = tabName;

  document.querySelectorAll('.request-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.requestTab === tabName);
  });

  document.querySelectorAll('.request-tab-content').forEach((content) => {
    content.classList.toggle('active', content.id === `request-tab-${tabName}`);
  });
}

function setResponseTab(tabName) {
  apiTesterState.responseTab = tabName;

  document.querySelectorAll('.response-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.responseTab === tabName);
  });

  document.querySelectorAll('.response-tab-content').forEach((content) => {
    content.classList.toggle('active', content.id === `response-${tabName}`);
  });
}

function resetResponseSurface() {
  const placeholder = testerEl('responsePlaceholder');
  const imageWrap = testerEl('responseImage');
  const imageEl = testerEl('responseImageEl');
  const jsonEl = testerEl('responseJson');

  if (placeholder) {
    placeholder.style.display = 'flex';
  }

  if (imageWrap) {
    imageWrap.style.display = 'none';
    imageWrap.innerHTML = '<img id="responseImageEl" alt="Response preview" />';
  }

  if (imageEl) {
    imageEl.removeAttribute('src');
  }

  if (jsonEl) {
    jsonEl.style.display = 'none';
    jsonEl.textContent = '';
  }
}

function updateResponseMeta(response) {
  const statusEl = testerEl('responseStatus');
  const timeEl = testerEl('responseTime');
  const sizeEl = testerEl('responseSize');

  if (!statusEl || !timeEl || !sizeEl) {
    return;
  }

  if (!response) {
    statusEl.className = 'response-status';
    statusEl.textContent = '--';
    timeEl.textContent = '-- ms';
    sizeEl.textContent = '-- bytes';
    return;
  }

  const statusClass = response.ok ? 'success' : 'error';
  statusEl.className = `response-status ${statusClass}`;
  statusEl.textContent = response.status ? `${response.status} ${response.statusText}` : response.statusText;
  timeEl.textContent = `${response.durationMs} ms`;
  sizeEl.textContent = formatBytes(response.sizeBytes);
}

function setCurrentApiResponse(response) {
  if (apiTesterState.currentBlobUrl) {
    URL.revokeObjectURL(apiTesterState.currentBlobUrl);
    apiTesterState.currentBlobUrl = '';
  }

  apiTesterState.currentResponse = response;
  if (response && (response.responseType === 'image' || response.responseType === 'pdf') && typeof response.data === 'string') {
    apiTesterState.currentBlobUrl = response.data;
  }

  updateResponseMeta(response);
  renderApiResponse();
}

function cleanupSuiteResponseBlobs() {
  for (const item of apiTesterState.suiteResults) {
    const response = item?.response;
    if (!response) {
      continue;
    }

    if ((response.responseType === 'image' || response.responseType === 'pdf')
      && typeof response.data === 'string'
      && response.data !== apiTesterState.currentBlobUrl) {
      URL.revokeObjectURL(response.data);
    }
  }
}

function renderApiResponse() {
  const response = apiTesterState.currentResponse;
  const placeholder = testerEl('responsePlaceholder');
  const imageWrap = testerEl('responseImage');
  const jsonEl = testerEl('responseJson');
  const rawEl = testerEl('responseRaw');
  const headersEl = testerEl('responseHeaders');

  if (!response) {
    resetResponseSurface();
    if (rawEl) {
      rawEl.textContent = 'No response yet';
    }

    if (headersEl) {
      headersEl.textContent = 'No headers yet';
    }

    updateResponseMeta(null);
    return;
  }

  if (rawEl) {
    if (response.responseType === 'json' && typeof response.data === 'object') {
      rawEl.textContent = JSON.stringify(response.data, null, 2);
    } else if (response.rawText) {
      rawEl.textContent = response.rawText;
    } else if (typeof response.data === 'string') {
      rawEl.textContent = response.data;
    } else {
      rawEl.textContent = JSON.stringify(response.data ?? {}, null, 2);
    }
  }

  if (headersEl) {
    const entries = Object.entries(response.headers || {});
    headersEl.innerHTML = entries.length
      ? entries.map(([key, value]) => `
        <div class="header-row">
          <span class="header-key">${escapeHtml(key)}</span>
          <span class="header-value">${escapeHtml(value)}</span>
        </div>
      `).join('')
      : 'No headers yet';
  }

  resetResponseSurface();
  if (placeholder) {
    placeholder.style.display = 'none';
  }

  if (response.responseType === 'image') {
    const imageEl = testerEl('responseImageEl');
    if (imageWrap) {
      imageWrap.style.display = 'flex';
    }

    if (imageEl) {
      imageEl.src = response.data;
      imageEl.onclick = () => openImageModal(response.data);
    }
  } else if (response.responseType === 'pdf') {
    if (imageWrap) {
      imageWrap.style.display = 'flex';
      imageWrap.innerHTML = `
        <a href="${response.data}" target="_blank" rel="noreferrer" class="btn btn-primary">
          Open PDF in new tab
        </a>
      `;
      }
  } else {
    if (jsonEl) {
      jsonEl.style.display = 'block';
      if (response.responseType === 'json' && typeof response.data === 'object') {
        jsonEl.textContent = JSON.stringify(response.data, null, 2);
      } else {
        jsonEl.textContent = response.rawText || String(response.data || '');
      }
    }
  }
}

function setSendRequestBusy(busy) {
  const sendBtn = testerEl('sendRequest');
  if (!sendBtn) {
    return;
  }

  sendBtn.disabled = busy;
  if (busy) {
    sendBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4m0 12v4m-8-10h4m12 0h4" stroke-linecap="round"/>
      </svg>
      Sending...
    `;
  } else {
    sendBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      Send
    `;
  }
}

function setSuiteBusy(busy) {
  const runBtn = testerEl('runSuiteBtn');
  const stopBtn = testerEl('stopSuiteBtn');

  if (runBtn) {
    runBtn.disabled = busy;
  }

  if (stopBtn) {
    stopBtn.disabled = !busy;
  }
}

function refreshTesterGeneratedKeys() {
  const select = testerEl('selectGeneratedKey');
  if (!select) {
    return;
  }

  const previous = select.value;
  const keys = [];
  for (const item of sortedResults()) {
    if (item.status === 'success' && item.apiKey && !keys.includes(item.apiKey)) {
      keys.push(item.apiKey);
    }
  }

  select.innerHTML = '<option value="">-- Select from successful results --</option>';
  keys.forEach((key, index) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `#${index + 1} ${maskApiKey(key)}`;
    select.appendChild(option);
  });

  if (previous && keys.includes(previous)) {
    select.value = previous;
  }
}

function updateSuiteProgress() {
  const fill = testerEl('suiteProgressFill');
  const text = testerEl('suiteProgressText');

  const total = apiTesterState.suiteTotal || apiTesterState.suiteResults.length;
  const completed = Math.min(apiTesterState.suiteCompleted, total);
  const percent = total ? Math.round((completed / total) * 100) : 0;

  if (fill) {
    fill.style.width = `${percent}%`;
  }

  if (text) {
    text.textContent = `${completed} / ${total}`;
  }
}

function suiteStatusBadge(status) {
  if (status === 'pass') {
    return '<span class="suite-status pass">Pass</span>';
  }

  if (status === 'running') {
    return '<span class="suite-status running">Running</span>';
  }

  if (status === 'cancelled') {
    return '<span class="suite-status cancelled">Cancelled</span>';
  }

  if (status === 'queued') {
    return '<span class="suite-status queued">Queued</span>';
  }

  return '<span class="suite-status fail">Fail</span>';
}

function renderSuiteResults() {
  const body = testerEl('suiteResultsBody');
  if (!body) {
    return;
  }

  if (!apiTesterState.suiteResults.length) {
    body.innerHTML = '<tr><td colspan="6" class="suite-empty">No suite run yet.</td></tr>';
    return;
  }

  body.innerHTML = apiTesterState.suiteResults.map((result, index) => {
    const definition = BROWSERLESS_TEST_CASES[result.testName] || { label: result.testName };
    return `
      <tr>
        <td>${escapeHtml(definition.label || result.testName)}</td>
        <td>${suiteStatusBadge(result.status)}</td>
        <td>${escapeHtml(result.http || '--')}</td>
        <td>${result.durationMs ? `${result.durationMs} ms` : '--'}</td>
        <td>${formatBytes(result.sizeBytes || 0)}</td>
        <td>
          ${result.response
            ? `<button class="btn btn-ghost btn-xs suite-inspect" data-index="${index}" type="button">Inspect</button>`
            : '<span class="suite-na">--</span>'}
        </td>
      </tr>
    `;
  }).join('');

  body.querySelectorAll('.suite-inspect').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number.parseInt(button.dataset.index || '-1', 10);
      const selected = apiTesterState.suiteResults[index];
      if (!selected?.response) {
        return;
      }

      setCurrentApiResponse(selected.response);
      setResponseTab('preview');
      showToast(`Loaded ${selected.testName} response`, 'info');
    });
  });
}

function getSuiteSelection() {
  return [...document.querySelectorAll('.suite-case:checked')]
    .map((input) => String(input.getAttribute('data-test') || '').trim())
    .filter(Boolean)
    .filter((name) => Boolean(BROWSERLESS_TEST_CASES[name]));
}

function getTargetUrl() {
  return String(testerEl('testTargetUrl')?.value || '').trim() || 'https://example.com';
}

function readRequestBuilderConfig(strictBody = true) {
  const apiKey = getActiveApiKey();
  const baseUrl = getActiveBaseUrl();
  const method = String(testerEl('requestMethod')?.value || 'GET').toUpperCase();
  const endpoint = String(testerEl('requestEndpoint')?.value || '').trim();
  const timeoutMs = getTesterTimeoutMs();

  if (!apiKey) {
    throw new Error('API key is required.');
  }

  if (!baseUrl) {
    throw new Error('Base URL is required.');
  }

  if (!endpoint) {
    throw new Error('Request endpoint is required.');
  }

  const headers = collectEditorPairs('headersEditor');
  const params = collectEditorPairs('paramsEditor');
  const body = parseBodyPayload(method, strictBody);

  return {
    apiKey,
    baseUrl,
    method,
    endpoint,
    headers,
    params,
    body,
    timeoutMs,
  };
}

function buildCurlPreview() {
  const method = String(testerEl('requestMethod')?.value || 'GET').toUpperCase();
  const endpoint = String(testerEl('requestEndpoint')?.value || '').trim() || '/';
  const baseUrl = getActiveBaseUrl() || 'https://chrome.browserless.io';
  const key = getActiveApiKey() || 'YOUR_API_KEY';
  const headers = collectEditorPairs('headersEditor');
  const params = collectEditorPairs('paramsEditor');
  const body = parseBodyPayload(method, false);

  let url = '';
  try {
    url = buildRequestUrl(baseUrl, endpoint, key, params).toString();
  } catch {
    url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  }

  const lines = [`curl -X ${method} "${url}"`];
  Object.entries(headers).forEach(([headerKey, headerValue]) => {
    lines.push(`  -H "${headerKey}: ${String(headerValue).replace(/"/g, '\\"')}"`);
  });

  if (body !== null && method !== 'GET' && method !== 'HEAD') {
    const serialized = typeof body === 'string' ? body : JSON.stringify(body);
    lines.push(`  --data "${serialized.replace(/"/g, '\\"')}"`);
  }

  return lines.join(' \\\n');
}

function updateCurlPreview() {
  const preview = testerEl('curlPreview');
  if (!preview) {
    return;
  }

  try {
    preview.textContent = buildCurlPreview();
  } catch (error) {
    preview.textContent = error instanceof Error ? error.message : 'Failed to build cURL preview';
  }
}

function loadQuickTest(testName, silent = false) {
  const definition = BROWSERLESS_TEST_CASES[testName];
  if (!definition) {
    return;
  }

  const methodEl = testerEl('requestMethod');
  const endpointEl = testerEl('requestEndpoint');
  const bodyEl = testerEl('requestBody');
  const targetUrl = getTargetUrl();

  if (methodEl) {
    methodEl.value = definition.method;
  }

  if (endpointEl) {
    endpointEl.value = definition.path;
  }

  if (bodyEl) {
    bodyEl.value = JSON.stringify(definition.buildBody(targetUrl), null, 2);
  }

  document.querySelectorAll('.quick-test-btn').forEach((button) => {
    button.classList.toggle('selected', button.dataset.test === testName);
  });

  updateCurlPreview();
  if (!silent) {
    showToast(`Loaded ${definition.label} preset`, 'info');
  }
}

function syncTargetFromBody() {
  const body = parseBodyPayload('POST', false);
  if (!body || typeof body !== 'object' || !body.url) {
    showToast('Body does not contain a valid url field', 'error');
    return;
  }

  const target = testerEl('testTargetUrl');
  if (!target) {
    return;
  }

  target.value = String(body.url).trim();
  showToast('Target URL synced from body', 'success');
}

async function executeBrowserlessRequest({
  apiKey,
  baseUrl,
  method,
  endpoint,
  headers,
  params,
  body,
  timeoutMs,
  externalSignal,
}) {
  const url = buildRequestUrl(baseUrl, endpoint, apiKey, params);
  const controller = new AbortController();
  const startedAt = performance.now();

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs + 2000);

  try {
    const proxyEndpoint = API_ENDPOINTS[0].replace(/\/generate\/?$/, '/test-proxy');
    
    const payload = {
      url: url.toString(),
      method: method || 'POST',
      headers: headers || {},
      body: body || null,
      timeoutMs: timeoutMs || 30000,
    };

    const response = await fetch(proxyEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const durationMs = Math.round(performance.now() - startedAt);
    
    const responseData = await response.json();
    if (!response.ok) {
      throw new Error(responseData.error || `Proxy returned ${response.status}`);
    }

    return {
      ...responseData,
      durationMs,
      url: url.toString(),
    };
  } catch (error) {
    if (externalSignal?.aborted) {
      throw new Error('Request aborted');
    }

    if (controller.signal.aborted) {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

async function validateApiKey() {
  const key = getActiveApiKey();
  const baseUrl = getActiveBaseUrl();
  if (!key) {
    showToast('API key is required', 'error');
    return;
  }

  if (!baseUrl) {
    showToast('Base URL is required', 'error');
    return;
  }

  setApiStatus('loading', 'Validating...');
  try {
    const response = await executeBrowserlessRequest({
      apiKey: key,
      baseUrl,
      method: 'POST',
      endpoint: '/content',
      headers: {
        'Content-Type': 'application/json',
      },
      params: {},
      body: {
        url: getTargetUrl(),
      },
      timeoutMs: getTesterTimeoutMs(),
      externalSignal: null,
    });

    setCurrentApiResponse(response);
    if (response.ok) {
      setApiStatus('success', 'API key valid');
      showToast('API key validation passed', 'success');
    } else {
      setApiStatus('error', `Validation failed (${response.status})`);
      showToast(`Validation returned HTTP ${response.status}`, 'error');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validation failed';
    setApiStatus('error', message);
    showToast(message, 'error');
  }
}

async function sendApiRequest() {
  if (apiTesterState.isSending) {
    return;
  }

  let config;
  try {
    config = readRequestBuilderConfig(true);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Invalid request', 'error');
    return;
  }

  apiTesterState.isSending = true;
  setSendRequestBusy(true);
  setApiStatus('loading', 'Sending request...');

  try {
    const response = await executeBrowserlessRequest({
      ...config,
      externalSignal: null,
    });

    setCurrentApiResponse(response);
    if (response.ok) {
      setApiStatus('success', `${response.status} ${response.statusText}`);
      showToast('Request completed successfully', 'success');
    } else {
      setApiStatus('error', `${response.status} ${response.statusText}`);
      showToast(`Request returned HTTP ${response.status}`, 'error');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    setCurrentApiResponse({
      ok: false,
      status: 0,
      statusText: 'Request Error',
      headers: {},
      data: { error: message },
      rawText: message,
      responseType: 'json',
      sizeBytes: 0,
      durationMs: 0,
      url: '',
    });
    setApiStatus('error', message);
    showToast(message, 'error');
  } finally {
    apiTesterState.isSending = false;
    setSendRequestBusy(false);
  }
}

function stopSuiteRun() {
  if (!apiTesterState.suiteRunning || !apiTesterState.suiteAbortController) {
    return;
  }

  apiTesterState.suiteAbortController.abort();
  setApiStatus('error', 'Stopping suite...');
}

async function runSuite() {
  if (apiTesterState.suiteRunning) {
    return;
  }

  const key = getActiveApiKey();
  const baseUrl = getActiveBaseUrl();
  const selectedCases = getSuiteSelection();

  if (!key) {
    showToast('API key is required', 'error');
    return;
  }

  if (!baseUrl) {
    showToast('Base URL is required', 'error');
    return;
  }

  if (!selectedCases.length) {
    showToast('Select at least one suite case', 'error');
    return;
  }

  const timeoutMs = getTesterTimeoutMs();
  const targetUrl = getTargetUrl();
  const concurrency = Math.max(
    1,
    Math.min(4, Number.parseInt(String(testerEl('suiteConcurrency')?.value || '2'), 10) || 2),
  );

  apiTesterState.suiteRunning = true;
  apiTesterState.suiteAbortController = new AbortController();
  cleanupSuiteResponseBlobs();
  apiTesterState.suiteResults = selectedCases.map((name) => ({
    testName: name,
    status: 'queued',
    http: '--',
    durationMs: 0,
    sizeBytes: 0,
    error: '',
    response: null,
  }));
  apiTesterState.suiteCompleted = 0;
  apiTesterState.suiteTotal = selectedCases.length;
  setSuiteBusy(true);
  renderSuiteResults();
  updateSuiteProgress();
  setApiStatus('loading', `Running suite (${selectedCases.length} cases)...`);

  const summaryEl = testerEl('suiteSummary');
  if (summaryEl) {
    summaryEl.textContent = `Running ${selectedCases.length} cases with concurrency ${concurrency}...`;
  }

  let cursor = 0;
  const workerLoop = async () => {
    while (true) {
      if (apiTesterState.suiteAbortController?.signal.aborted) {
        return;
      }

      const index = cursor;
      cursor += 1;
      if (index >= selectedCases.length) {
        return;
      }

      const testName = selectedCases[index];
      const definition = BROWSERLESS_TEST_CASES[testName];

      apiTesterState.suiteResults[index] = {
        ...apiTesterState.suiteResults[index],
        status: 'running',
      };
      renderSuiteResults();

      try {
        const response = await executeBrowserlessRequest({
          apiKey: key,
          baseUrl,
          method: definition.method,
          endpoint: definition.path,
          headers: {
            'Content-Type': 'application/json',
          },
          params: {},
          body: definition.buildBody(targetUrl),
          timeoutMs,
          externalSignal: apiTesterState.suiteAbortController?.signal || null,
        });

        apiTesterState.suiteResults[index] = {
          testName,
          status: response.ok ? 'pass' : 'fail',
          http: String(response.status),
          durationMs: response.durationMs,
          sizeBytes: response.sizeBytes,
          error: response.ok ? '' : `${response.status} ${response.statusText}`,
          response,
        };
      } catch (error) {
        const aborted = Boolean(apiTesterState.suiteAbortController?.signal.aborted);
        apiTesterState.suiteResults[index] = {
          testName,
          status: aborted ? 'cancelled' : 'fail',
          http: aborted ? '--' : 'ERR',
          durationMs: 0,
          sizeBytes: 0,
          error: error instanceof Error ? error.message : 'unknown error',
          response: null,
        };
      } finally {
        apiTesterState.suiteCompleted += 1;
        updateSuiteProgress();
        renderSuiteResults();
      }
    }
  };

  try {
    const workers = Array.from({ length: Math.min(concurrency, selectedCases.length) }, () => workerLoop());
    await Promise.all(workers);

    if (apiTesterState.suiteAbortController?.signal.aborted) {
      apiTesterState.suiteResults = apiTesterState.suiteResults.map((result) => {
        if (result.status === 'queued' || result.status === 'running') {
          return {
            ...result,
            status: 'cancelled',
            http: '--',
            error: 'cancelled',
          };
        }

        return result;
      });
      apiTesterState.suiteCompleted = apiTesterState.suiteResults.length;
    }

    const passed = apiTesterState.suiteResults.filter((result) => result.status === 'pass').length;
    const failed = apiTesterState.suiteResults.filter((result) => result.status === 'fail').length;
    const cancelled = apiTesterState.suiteResults.filter((result) => result.status === 'cancelled').length;
    const summary = `Suite complete: ${passed} pass, ${failed} fail, ${cancelled} cancelled`;

    if (summaryEl) {
      summaryEl.textContent = summary;
    }

    setApiStatus(failed > 0 ? 'error' : 'success', summary);
    showToast(summary, failed > 0 ? 'error' : 'success');
  } finally {
    apiTesterState.suiteRunning = false;
    apiTesterState.suiteAbortController = null;
    setSuiteBusy(false);
    updateSuiteProgress();
    renderSuiteResults();
  }
}

function initApiTester() {
  console.log("API Tester simplified");
  const validateBtn = document.getElementById('validateApiKey');
  const sendBtn = document.getElementById('sendRequest');
  if (validateBtn) validateBtn.addEventListener('click', validateApiKey);
  if (sendBtn) sendBtn.addEventListener('click', sendApiRequest);
}

function DEPRECATED_initApiTester() {
  if (!testerEl('view-api-tester')) {
    return;
  }

  refreshTesterGeneratedKeys();
  toggleCustomBaseUrlRow();
  setRequestTab(apiTesterState.requestTab);
  setResponseTab(apiTesterState.responseTab);
  updateResponseMeta(null);
  resetResponseSurface();
  renderSuiteResults();
  updateSuiteProgress();

  const suiteSlider = testerEl('suiteConcurrency');
  const suiteOutput = testerEl('suiteConcurrencyOutput');
  if (suiteSlider && suiteOutput) {
    suiteSlider.addEventListener('input', () => {
      suiteOutput.textContent = suiteSlider.value;
    });
  }

  document.querySelectorAll('.quick-test-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const testName = String(button.dataset.test || '').trim();
      if (!testName) {
        return;
      }

      loadQuickTest(testName);
    });
  });

  testerEl('resetPresetSelection')?.addEventListener('click', () => {
    document.querySelectorAll('.quick-test-btn').forEach((button) => button.classList.remove('selected'));
    loadQuickTest('screenshot', true);
    showToast('Preset reset to screenshot', 'info');
  });

  testerEl('requestMethod')?.addEventListener('change', updateCurlPreview);
  testerEl('requestEndpoint')?.addEventListener('input', updateCurlPreview);
  testerEl('requestBody')?.addEventListener('input', updateCurlPreview);
  testerEl('testApiKey')?.addEventListener('input', updateCurlPreview);
  testerEl('testTargetUrl')?.addEventListener('change', updateCurlPreview);
  testerEl('testBaseUrl')?.addEventListener('change', () => {
    toggleCustomBaseUrlRow();
    updateCurlPreview();
  });
  testerEl('customBaseUrl')?.addEventListener('input', updateCurlPreview);

  testerEl('selectGeneratedKey')?.addEventListener('change', (event) => {
    const value = String(event.target.value || '').trim();
    if (value && testerEl('testApiKey')) {
      testerEl('testApiKey').value = value;
      showToast('API key filled from generated results', 'success');
    }

    updateCurlPreview();
  });

  testerEl('pasteApiKey')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        showToast('Clipboard is empty', 'error');
        return;
      }

      const field = testerEl('testApiKey');
      if (field) {
        field.value = text.trim();
      }
      showToast('API key pasted from clipboard', 'success');
      updateCurlPreview();
    } catch {
      showToast('Clipboard access denied by browser', 'error');
    }
  });

  testerEl('formatJson')?.addEventListener('click', () => {
    const body = testerEl('requestBody');
    if (!body) {
      return;
    }

    try {
      const parsed = JSON.parse(String(body.value || '{}'));
      body.value = JSON.stringify(parsed, null, 2);
      showToast('JSON formatted', 'success');
      updateCurlPreview();
    } catch {
      showToast('Body contains invalid JSON', 'error');
    }
  });

  testerEl('clearJson')?.addEventListener('click', () => {
    const body = testerEl('requestBody');
    if (!body) {
      return;
    }

    body.value = '{}';
    updateCurlPreview();
  });

  testerEl('copyCurl')?.addEventListener('click', async () => {
    const text = String(testerEl('curlPreview')?.textContent || '').trim();
    if (!text) {
      showToast('Nothing to copy', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showToast('cURL command copied', 'success');
    } catch {
      showToast('Failed to copy cURL command', 'error');
    }
  });

  testerEl('validateApiKey')?.addEventListener('click', validateApiKey);
  testerEl('syncTargetFromBody')?.addEventListener('click', syncTargetFromBody);
  testerEl('sendRequest')?.addEventListener('click', sendApiRequest);
  testerEl('runSuiteBtn')?.addEventListener('click', runSuite);
  testerEl('stopSuiteBtn')?.addEventListener('click', stopSuiteRun);

  document.querySelectorAll('.request-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = String(tab.dataset.requestTab || '').trim();
      if (!tabName) {
        return;
      }

      setRequestTab(tabName);
    });
  });

  document.querySelectorAll('.response-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = String(tab.dataset.responseTab || '').trim();
      if (!tabName) {
        return;
      }

      setResponseTab(tabName);
    });
  });

  const requestBuilder = document.querySelector('.request-builder');
  requestBuilder?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const addButton = target.closest('.add-row');
    if (addButton instanceof HTMLElement) {
      appendEditorRow(String(addButton.dataset.target || ''));
      updateCurlPreview();
      return;
    }

    const removeButton = target.closest('.remove-row');
    if (!(removeButton instanceof HTMLElement)) {
      return;
    }

    const row = removeButton.closest('.key-value-row');
    const parent = row?.parentElement;
    if (!row || !parent) {
      return;
    }

    if (parent.children.length > 1) {
      row.remove();
    } else {
      row.querySelectorAll('input').forEach((input) => {
        input.value = '';
      });
    }

    updateCurlPreview();
  });

  requestBuilder?.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest('#headersEditor') || target.closest('#paramsEditor')) {
      updateCurlPreview();
    }
  });

  loadQuickTest('screenshot', true);
  updateCurlPreview();
  setApiStatus('idle', 'Not tested');
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function openImageModal(src) {
  const modal = document.getElementById('imageModal');
  const modalImage = document.getElementById('modalImage');
  
  if (modal && modalImage) {
    modalImage.src = src;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeImageModal() {
  const modal = document.getElementById('imageModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function initImageModal() {
  const modal = document.getElementById('imageModal');
  const closeBtn = document.getElementById('modalClose');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', closeImageModal);
  }
  
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeImageModal();
      }
    });
  }
}

// Make openImageModal available globally
window.openImageModal = openImageModal;

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

function updateAnalytics() {
  const results = state.results;
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter((r) => r.status === 'failed' || r.status === 'stopped').length;
  const totalCount = results.length;
  const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;
  const totalDuration = results.reduce((sum, item) => sum + (Number(item.durationMs || 0) || 0), 0);
  const avgDuration = totalCount > 0 ? Math.round(totalDuration / totalCount) : null;
  const proxyCount = results.filter((item) => item.proxyUsed).length;
  const proxyUsage = totalCount > 0 ? Math.round((proxyCount / totalCount) * 100) : 0;
  
  // Update stat cards
  const successEl = document.getElementById('analyticsSuccess');
  const failedEl = document.getElementById('analyticsFailed');
  const avgTimeEl = document.getElementById('analyticsAvgTime');
  const proxyUsageEl = document.getElementById('analyticsProxyUsage');
  const successRateValue = document.getElementById('successRateValue');
  const successTrend = document.getElementById('successTrend');
  const failedTrend = document.getElementById('failedTrend');
  const successArc = document.getElementById('successArc');
  
  if (successEl) successEl.textContent = successCount;
  if (failedEl) failedEl.textContent = failedCount;
  if (avgTimeEl) avgTimeEl.textContent = avgDuration === null ? '--' : `${avgDuration} ms`;
  if (proxyUsageEl) proxyUsageEl.textContent = `${proxyUsage}%`;
  if (successRateValue) successRateValue.textContent = `${successRate}%`;

  if (successTrend) {
    const trendText = totalCount > 0 ? `${successRate}% rate` : '--';
    const trendNode = successTrend.querySelector('span');
    if (trendNode) {
      trendNode.textContent = trendText;
    }
  }

  if (failedTrend) {
    const failureRate = totalCount > 0 ? Math.round((failedCount / totalCount) * 100) : 0;
    const trendNode = failedTrend.querySelector('span');
    if (trendNode) {
      trendNode.textContent = totalCount > 0 ? `${failureRate}% rate` : '--';
    }
  }

  if (successArc) {
    const circumference = Math.PI * 2 * 40;
    const arc = (successRate / 100) * circumference;
    successArc.style.strokeDasharray = `${arc} ${circumference}`;
  }
  
  updateTimelineChart(results);
  updateErrorDistribution(results);
  
  // Update activity list
  updateActivityList();
}

function updateTimelineChart(results) {
  const timeline = document.getElementById('timelineChart');
  if (!timeline) {
    return;
  }

  if (!results.length) {
    timeline.innerHTML = '<div class="timeline-empty"><p>Start generating to see timeline</p></div>';
    return;
  }

  const recent = results.slice(-24);
  timeline.innerHTML = `
    <div class="timeline-mini-wrap">
      ${recent.map((item) => {
        const cssClass = item.status === 'success' ? 'success' : item.status === 'running' ? 'running' : 'failed';
        const tooltip = `#${item.index} ${item.status}${item.durationMs ? ` ${item.durationMs}ms` : ''}`;
        return `<span class="timeline-mini-bar ${cssClass}" title="${escapeHtml(tooltip)}"></span>`;
      }).join('')}
    </div>
  `;
}

function classifyError(note) {
  const text = String(note || '').toLowerCase();
  if (text.includes('timeout')) {
    return 'Timeout';
  }

  if (text.includes('proxy')) {
    return 'Proxy';
  }

  if (text.includes('403') || text.includes('verify')) {
    return 'Verification';
  }

  if (!text) {
    return 'Unknown';
  }

  return 'Other';
}

function updateErrorDistribution(results) {
  const container = document.getElementById('errorDistribution');
  if (!container) {
    return;
  }

  const failed = results.filter((item) => item.status === 'failed' || item.status === 'stopped');
  if (!failed.length) {
    container.innerHTML = '<div class="distribution-empty"><p>No errors recorded yet</p></div>';
    return;
  }

  const bucket = new Map();
  for (const item of failed) {
    const label = classifyError(item.note);
    bucket.set(label, (bucket.get(label) || 0) + 1);
  }

  const total = failed.length;
  const rows = [...bucket.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => {
      const percent = Math.round((count / total) * 100);
      return `
        <div class="distribution-row">
          <span class="distribution-label">${escapeHtml(label)}</span>
          <div class="distribution-track"><span class="distribution-fill" style="width:${percent}%"></span></div>
          <span class="distribution-value">${count}</span>
        </div>
      `;
    }).join('');

  container.innerHTML = `<div class="distribution-list">${rows}</div>`;
}

function updateActivityList() {
  const activityList = document.getElementById('activityList');
  if (!activityList) return;
  
  // Get last 10 results
  const recentResults = [...state.results].reverse().slice(0, 10);
  
  if (recentResults.length === 0) {
    activityList.innerHTML = `
      <div class="activity-item">
        <div class="activity-content">
          <p style="color: var(--text-tertiary); margin: 0;">No activity yet. Generate some keys to see activity.</p>
        </div>
      </div>
    `;
    return;
  }
  
  activityList.innerHTML = recentResults.map(result => `
    <div class="activity-item">
      <div class="activity-icon ${result.status === 'success' ? 'success' : 'failed'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          ${result.status === 'success' 
            ? '<path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>' 
            : '<path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>'}
        </svg>
      </div>
      <div class="activity-content">
        <div class="activity-title">
          ${result.status === 'success' ? 'Key Generated Successfully' : 'Generation Failed'}
        </div>
        <div class="activity-meta">
          <span>${result.email || 'Unknown email'}</span>
          ${result.durationMs ? `<span>${result.durationMs}ms</span>` : ''}
          ${result.apiKey ? `<code>${result.apiKey.substring(0, 12)}...</code>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEY SCRAPER LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

function initVideyScraper() {
  const scrapeBtn = document.getElementById('scrapeVideyBtn');
  const urlInput = document.getElementById('videyUrl');
  const selectKey = document.getElementById('videySelectKey');
  const copyBtn = document.getElementById('copyVideyLinkBtn');

  // Update key options whenever a view changes or generation finishes
  const updateKeys = () => {
    if (!selectKey) return;
    const current = selectKey.value;
    const keys = state.results.filter(r => r.status === 'success' && r.apiKey);
    selectKey.innerHTML = '<option value="">-- Select Key --</option>' + 
      keys.map(r => `<option value="${r.apiKey}">${r.email.split('@')[0]} (${r.apiKey.substring(0,8)}...)</option>`).join('');
    if (current) selectKey.value = current;
  };

  scrapeBtn?.addEventListener('click', async () => {
    const url = urlInput?.value.trim();
    const apiKey = selectKey?.value || getActiveApiKey();

    if (!url || !url.includes('videy.co')) {
      showToast('Please enter a valid Videy URL', 'error');
      return;
    }

    if (!apiKey) {
      showToast('Please select or generate an API key first', 'error');
      return;
    }

    setVideyStatus('loading', 'Scraping video link...');
    
    try {
      const videoUrl = await performVideyScrape(url, apiKey);
      displayVideyScrapeResult(videoUrl);
      setVideyStatus('success', 'Video extracted');
      showToast('Video link extracted successfully', 'success');
    } catch (error) {
      setVideyStatus('error', error.message);
      showToast(error.message, 'error');
    }
  });

  copyBtn?.addEventListener('click', () => {
    const link = document.getElementById('videyDirectLink')?.value;
    if (link && link !== '-') {
      navigator.clipboard.writeText(link);
      showToast('Link copied to clipboard', 'success');
    }
  });

  // Export to window so it can be called elsewhere if needed
  window.updateVideyKeys = updateKeys;
}

function setVideyStatus(type, text) {
  const card = document.getElementById('videyStatus');
  const textEl = document.getElementById('videyStatusText');
  if (card && textEl) {
    card.style.display = 'flex';
    textEl.textContent = text;
    card.className = `api-status-card ${type}`;
  }
}

async function performVideyScrape(targetUrl, apiKey) {
  const proxyEndpoint = '/api/test-proxy';
  
  const payload = {
    url: `https://chrome.browserless.io/scrape?token=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      url: targetUrl,
      elements: [{ selector: 'video source', attribute: 'src' }]
    },
    timeoutMs: 30000
  };

  const response = await fetch(proxyEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (!result.ok || !result.data || !result.data.data) {
    throw new Error(result.error || 'Failed to scrape video source');
  }

  const videoSrc = result.data.data[0]?.results[0]?.value;
  if (!videoSrc) throw new Error('Could not find video source on the page');

  return videoSrc;
}

function displayVideyScrapeResult(videoUrl) {
  const container = document.getElementById('videyPlayerContainer');
  const info = document.getElementById('videyVideoInfo');
  const linkInput = document.getElementById('videyDirectLink');

  if (container) {
    container.innerHTML = `<video id="videyPlayer" controls autoplay style="width:100%; border-radius:var(--radius-lg);"><source src="${videoUrl}" type="video/mp4"></video>`;
  }
  if (info) info.style.display = 'block';
  if (linkInput) linkInput.value = videoUrl;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZE ALL FEATURES
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initViewSwitching();
  initMobileSidebar();
  initApiTester();
  initImageModal();
  initVideyScraper(); // Added
  updateAnalytics();
});
