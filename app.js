import { faker } from "https://esm.sh/@faker-js/faker@9.8.0";

const ui = {
  apiKeyCount: document.getElementById("apiKeyCount"),
  otpWaitSeconds: document.getElementById("otpWaitSeconds"),
  plan: document.getElementById("plan"),
  useCase: document.getElementById("useCase"),
  proxyEnabled: document.getElementById("proxyEnabled"),
  proxyUrl: document.getElementById("proxyUrl"),
  proxyPool: document.getElementById("proxyPool"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  statusText: document.getElementById("statusText"),
  summaryText: document.getElementById("summaryText"),
  resultsBody: document.getElementById("resultsBody"),
  lastLog: document.getElementById("lastLog"),
};

const projectTypes = ["newProject", "existingProject", "migration"];

const state = {
  running: false,
  stopRequested: false,
  results: [],
};

const API_ENDPOINTS = ["/api/generate", "/api/generate/"];

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

function parseProxyPool(rawText) {
  return String(rawText || "")
    .split(/[\r\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function setStatus(text) {
  ui.statusText.textContent = `Status: ${text}`;
}

function updateSummary() {
  const success = state.results.filter((item) => item.status === "success").length;
  const failed = state.results.filter((item) => item.status === "failed").length;
  ui.summaryText.textContent = `Success: ${success} | Failed: ${failed} | Total: ${state.results.length}`;
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

function renderResults() {
  ui.resultsBody.innerHTML = "";

  for (const result of state.results) {
    const tr = document.createElement("tr");

    const statusClass = result.status === "success" ? "tag-ok" : "tag-fail";
    const statusLabel = result.status === "success" ? "SUCCESS" : "FAILED";

    const apiCell = document.createElement("td");
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
      wrapper.style.display = "grid";
      wrapper.style.gap = "6px";
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
      <td class="${statusClass}">${statusLabel}</td>
      <td>${note}</td>
    `;

    tr.children[3].replaceWith(apiCell);
    ui.resultsBody.appendChild(tr);
  }

  updateSummary();
}

async function callGenerateApi(payload) {
  const failures = [];

  for (const endpoint of API_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
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
        (rawText ? rawText.slice(0, 180) : "") ||
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

async function runBatchGeneration() {
  if (state.running) {
    return;
  }

  const count = Math.max(1, Math.min(30, Number.parseInt(ui.apiKeyCount.value, 10) || 1));
  const maxOtpWaitSeconds = Math.max(
    15,
    Math.min(180, Number.parseInt(ui.otpWaitSeconds.value, 10) || 60),
  );

  const proxyEnabled = ui.proxyEnabled.checked;
  const proxyUrl = ui.proxyUrl.value.trim();
  const proxyUrls = parseProxyPool(ui.proxyPool.value);

  if (proxyEnabled && !proxyUrl && proxyUrls.length === 0) {
    setStatus("proxy aktif tapi Proxy URL/Proxy Pool kosong");
    return;
  }

  state.running = true;
  state.stopRequested = false;
  state.results = [];
  ui.lastLog.textContent = "Menunggu proses...";
  renderResults();

  for (let i = 0; i < count; i += 1) {
    if (state.stopRequested) {
      setStatus(`dihentikan user di item ${i + 1}`);
      break;
    }

    const currentIndex = i + 1;
    setStatus(`proses ${currentIndex}/${count}`);

    const payload = {
      maxOtpWaitSeconds,
      proxyEnabled,
      proxyUrl,
      proxyUrls,
      preferredToken: makePreferredToken(),
      profile: buildFakeProfile(),
    };

    try {
      const result = await callGenerateApi(payload);
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
      state.results.push({
        index: currentIndex,
        status: "failed",
        email: "",
        otpCode: "",
        apiKey: "",
        proxyUsed: proxyEnabled,
        proxyUrlUsed: "",
        note: error instanceof Error ? error.message : "unknown error",
        log: [],
      });

      ui.lastLog.textContent = `Error item ${currentIndex}: ${error instanceof Error ? error.message : "unknown"}`;
    }

    renderResults();
  }

  state.running = false;

  if (!state.stopRequested) {
    setStatus("selesai");
  }
}

function stopBatchGeneration() {
  if (!state.running) {
    return;
  }

  state.stopRequested = true;
  setStatus("menghentikan proses...");
}

function exportTxt() {
  if (!state.results.length) {
    setStatus("belum ada hasil untuk di-download");
    return;
  }

  const lines = [
    "BROWSERLESS AUTO GENERATOR REPORT",
    "================================",
    "",
    `Generated At: ${new Date().toISOString()}`,
    `Total Items: ${state.results.length}`,
    "",
  ];

  for (const result of state.results) {
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

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `browserless-auto-report-${stamp}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

ui.proxyEnabled.addEventListener("change", () => {
  ui.proxyUrl.disabled = !ui.proxyEnabled.checked;
  ui.proxyPool.disabled = !ui.proxyEnabled.checked;
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

setStatus("idle");
updateSummary();
