// options.js — Screen Q&A Settings with Dynamic Port Probing & Offline QR Generator
const input = document.getElementById("apiKey");
const status = document.getElementById("status");
const lensUrlInput = document.getElementById("lensUrl");
const pairingTokenInput = document.getElementById("pairingToken");
const pairingLinkInput = document.getElementById("pairingLink");
const pairingStatus = document.getElementById("pairingStatus");
const qrcodeContainer = document.getElementById("qrcodeContainer");
const qrHint = document.getElementById("qrHint");
const fleetServerStatus = document.getElementById("fleetServerStatus");
const fleetStatusText = document.getElementById("fleetStatusText");
const localSendEnabledInput = document.getElementById("localSendEnabled");
const localSendHostInput = document.getElementById("localSendHost");
const localSendPortInput = document.getElementById("localSendPort");
const localSendProtocolSelect = document.getElementById("localSendProtocol");
const localSendPinInput = document.getElementById("localSendPin");
const localSendDevicesContainer = document.getElementById("localSendDevices");
const localSendStatus = document.getElementById("localSendStatus");

const DEFAULT_LAN_IP = "192.168.1.5";
let activePort = 8000;
let qrInstance = null;

const fleetUrlInput = document.getElementById("fleetUrl");
const backendStatus = document.getElementById("backendStatus");

function setBackendMessage(msg) {
  if (backendStatus) backendStatus.textContent = msg;
}

// Preset button handlers for fleet ports
document.getElementById("btnFleetPort8000")?.addEventListener("click", () => {
  if (fleetUrlInput) fleetUrlInput.value = "http://127.0.0.1:8000";
  probeFleetHealth();
});
document.getElementById("btnFleetPort8001")?.addEventListener("click", () => {
  if (fleetUrlInput) fleetUrlInput.value = "http://127.0.0.1:8001";
  probeFleetHealth();
});
document.getElementById("btnFleetPort8080")?.addEventListener("click", () => {
  if (fleetUrlInput) fleetUrlInput.value = "http://127.0.0.1:8080";
  probeFleetHealth();
});

document.getElementById("btnProbeFleet")?.addEventListener("click", async () => {
  setBackendMessage("Probing available ports...");
  await probeFleetHealth();
  if (activePort && fleetUrlInput) {
    fleetUrlInput.value = `http://127.0.0.1:${activePort}`;
    chrome.storage.local.set({
    fleetUrl, fleetUrl: fleetUrlInput.value });
    setBackendMessage(`Auto-detected active backend on port ${activePort}`);
  }
});

document.getElementById("saveBackend")?.addEventListener("click", () => {
  const url = (fleetUrlInput?.value || "").trim();
  if (!url) {
    setBackendMessage("Enter a valid URL.");
    return;
  }
  try {
    const parsed = new URL(url);
    chrome.storage.local.set({ fleetUrl: parsed.origin }, () => {
      setBackendMessage("Backend URL saved.");
      probeFleetHealth();
    });
  } catch {
    setBackendMessage("Invalid URL format.");
  }
});


function buildPairingLink() {
  const lensUrl = lensUrlInput.value.trim();
  const pairingToken = pairingTokenInput.value.trim();
  if (!lensUrl || !pairingToken) return "";

  try {
    const url = new URL(lensUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.searchParams.set("pairing_token", pairingToken);
    return url.toString();
  } catch {
    return "";
  }
}

function renderQRCode(link) {
  if (!qrcodeContainer) return;

  if (!link) {
    qrcodeContainer.innerHTML = "";
    if (qrHint) qrHint.textContent = "Enter Lens URL and token to generate QR code.";
    return;
  }

  if (typeof QRCode !== "undefined") {
    try {
      if (!qrInstance) {
        qrInstance = new QRCode(qrcodeContainer, {
          width: 200,
          height: 200,
          colorDark: "#172033",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M,
        });
      }
      qrInstance.makeCode(link);
      if (qrHint) {
        qrHint.textContent = "Scan with your phone camera to launch Screen Lens directly.";
      }
    } catch (err) {
      console.error("[QR Render Error]", err);
      if (qrHint) qrHint.textContent = "Could not render QR code: " + err.message;
    }
  }
}

function updatePairingLink() {
  const link = buildPairingLink();
  pairingLinkInput.value = link;
  renderQRCode(link);
}

function setPairingMessage(message) {
  pairingStatus.textContent = message;
}

function createPairingToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Dynamic Port Probe & Health Check
async function probeFleetHealth() {
  // First test configured fleetUrl
  const configured = (fleetUrlInput?.value || "").trim();
  const portsToProbe = [8000, 8001, 8080, 8765];
  let foundPort = null;

  if (configured) {
    try {
      const parsed = new URL(configured);
      const testPort = parsed.port || (parsed.protocol === "https:" ? 443 : 80);
      const res = await fetch(`${parsed.origin}/api/v1/qa/status`, {
        method: "GET",
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        foundPort = Number(testPort);
      }
    } catch {}
  }

  if (!foundPort) {
    for (const port of portsToProbe) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/qa/status`, {
          method: "GET",
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          foundPort = port;
          break;
        }
      } catch {}
    }
  }

  if (foundPort) {
    activePort = foundPort;
    fleetServerStatus.className = "status-badge online";
    fleetStatusText.textContent = `Fleet Orchestrator Online (port ${foundPort})`;

    // If current lens URL is empty or localhost, suggest LAN IP with live port
    if (!lensUrlInput.value || lensUrlInput.value.includes("127.0.0.1")) {
      lensUrlInput.value = `http://${DEFAULT_LAN_IP}:${foundPort}/lens`;
      updatePairingLink();
    }
  } else {
    fleetServerStatus.className = "status-badge offline";
    fleetStatusText.textContent = "Fleet Orchestrator Offline (Start uvicorn on port 8000)";
  }
}

// Preset button handlers
document.getElementById("btnLanPreset")?.addEventListener("click", () => {
  lensUrlInput.value = `http://${DEFAULT_LAN_IP}:${activePort}/lens`;
  updatePairingLink();
  setPairingMessage("Applied LAN IP preset.");
});

document.getElementById("btnLocalhostPreset")?.addEventListener("click", () => {
  lensUrlInput.value = `http://127.0.0.1:${activePort}/lens`;
  updatePairingLink();
  setPairingMessage("Applied Localhost preset.");
});

// Load saved settings
chrome.storage.local.get(
  [
    "fleetUrl",
    "geminiApiKey",
    "lensUrl",
    "pairingToken",
    "localSendEnabled",
    "localSendHost",
    "localSendPort",
    "localSendProtocol",
    "localSendPin",
  ],
  ({
    geminiApiKey,
    lensUrl,
    pairingToken,
    localSendEnabled,
    localSendHost,
    localSendPort,
    localSendProtocol,
    localSendPin,
  }) => {
    if (chrome.runtime.lastError) {
      setPairingMessage(`Could not load pairing settings: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (geminiApiKey) input.value = geminiApiKey;

    // Use saved URL or default to LAN IP for phone accessibility
    lensUrlInput.value = lensUrl || `http://${DEFAULT_LAN_IP}:8000/lens`;
    pairingTokenInput.value = pairingToken || createPairingToken();
    updatePairingLink();

    if (localSendEnabledInput) localSendEnabledInput.checked = Boolean(localSendEnabled);
    if (localSendHostInput) localSendHostInput.value = localSendHost || "";
    if (localSendPortInput) localSendPortInput.value = String(localSendPort || 53317);
    if (localSendProtocolSelect) localSendProtocolSelect.value = localSendProtocol || "http";
    if (localSendPinInput) localSendPinInput.value = localSendPin || "";

    // Probe Fleet backend
    probeFleetHealth();
  }
);

for (const field of [lensUrlInput, pairingTokenInput]) {
  field.addEventListener("input", updatePairingLink);
}

document.getElementById("save").addEventListener("click", () => {
  const value = input.value.trim();
  chrome.storage.local.set({ geminiApiKey: value }, () => {
    status.textContent = "Saved.";
    setTimeout(() => (status.textContent = ""), 1500);
  });
});

document.getElementById("generateToken").addEventListener("click", () => {
  pairingTokenInput.value = createPairingToken();
  updatePairingLink();
  setPairingMessage("Token generated. Save pairing settings to keep it.");
});

document.getElementById("savePairing").addEventListener("click", () => {
  const lensUrl = lensUrlInput.value.trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(lensUrl);
  } catch {
    setPairingMessage("Enter a valid Lens service URL.");
    lensUrlInput.focus();
    return;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    setPairingMessage("Lens service URL must use HTTP or HTTPS.");
    lensUrlInput.focus();
    return;
  }

  const pairingToken = pairingTokenInput.value.trim();
  if (!pairingToken) {
    setPairingMessage("Generate or enter a pairing token before saving.");
    pairingTokenInput.focus();
    return;
  }

  chrome.storage.local.set({ lensUrl: parsedUrl.toString(), pairingToken }, () => {
    if (chrome.runtime.lastError) {
      setPairingMessage(`Could not save pairing settings: ${chrome.runtime.lastError.message}`);
      return;
    }
    updatePairingLink();
    setPairingMessage("Pairing settings saved on this device.");
  });
});

document.getElementById("copyPairingLink").addEventListener("click", async () => {
  const pairingLink = buildPairingLink();
  if (!pairingLink) {
    setPairingMessage("Enter a valid Lens URL and pairing token first.");
    return;
  }

  try {
    await navigator.clipboard.writeText(pairingLink);
    setPairingMessage("Pairing link copied.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "clipboard access was denied";
    setPairingMessage(`Could not copy the pairing link: ${message}`);
  }
});

function setLocalSendMessage(message) {
  if (localSendStatus) {
    localSendStatus.textContent = message;
  }
}

function saveLocalSendSettings(showMessage = true) {
  const localSendEnabled = Boolean(localSendEnabledInput?.checked);
  const localSendHost = (localSendHostInput?.value || "").trim();
  const parsedPort = Number(localSendPortInput?.value || 53317);
  const localSendPort = parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 53317;
  const localSendProtocol = localSendProtocolSelect?.value === "https" ? "https" : "http";
  const localSendPin = (localSendPinInput?.value || "").trim();

  chrome.storage.local.set(
    {
      localSendEnabled,
      localSendHost,
      localSendPort,
      localSendProtocol,
      localSendPin,
    },
    () => {
      if (chrome.runtime.lastError) {
        setLocalSendMessage(`Could not save LocalSend settings: ${chrome.runtime.lastError.message}`);
        return;
      }
      if (showMessage) {
        setLocalSendMessage(
          localSendEnabled
            ? `LocalSend relay enabled (${localSendHost || "auto-discover"}:${localSendPort}).`
            : "LocalSend settings saved (relay disabled)."
        );
      }
    }
  );
}

localSendEnabledInput?.addEventListener("change", () => saveLocalSendSettings(true));
document.getElementById("saveLocalSend")?.addEventListener("click", () => saveLocalSendSettings(true));

document.getElementById("discoverLocalSend")?.addEventListener("click", () => {
  setLocalSendMessage("Scanning LAN for active LocalSend receivers (port 53317)...");
  if (localSendDevicesContainer) localSendDevicesContainer.innerHTML = "";

  const host = (localSendHostInput?.value || "").trim();
  const port = Number(localSendPortInput?.value || 53317);
  const protocol = localSendProtocolSelect?.value || "http";

  chrome.runtime.sendMessage(
    {
      type: "DISCOVER_LOCALSEND",
      options: { host, port, protocol },
    },
    (response) => {
      if (chrome.runtime.lastError || !response) {
        setLocalSendMessage(
          `Discovery error: ${chrome.runtime.lastError?.message || "No response from background worker."}`
        );
        return;
      }

      const peers = response.peers || [];
      if (peers.length === 0) {
        setLocalSendMessage(
          "No LocalSend receivers detected on LAN. Ensure LocalSend is open on your phone, or enter its IP manually."
        );
        return;
      }

      setLocalSendMessage(`Found ${peers.length} LocalSend device(s). Click a device pill to select it:`);
      peers.forEach((peer) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "pill";
        const modelSuffix = peer.deviceModel ? ` (${peer.deviceModel})` : "";
        pill.textContent = `${peer.alias || peer.host}${modelSuffix} - ${peer.host}:${peer.port} [${peer.protocol}]`;
        pill.addEventListener("click", () => {
          if (localSendHostInput) localSendHostInput.value = peer.host;
          if (localSendPortInput) localSendPortInput.value = String(peer.port || 53317);
          if (localSendProtocolSelect) localSendProtocolSelect.value = peer.protocol || "http";
          if (localSendEnabledInput) localSendEnabledInput.checked = true;
          saveLocalSendSettings(false);
          setLocalSendMessage(`Selected ${peer.alias || peer.host} (${peer.host}:${peer.port}) and saved.`);
        });
        localSendDevicesContainer?.appendChild(pill);
      });
    }
  );
});

document.getElementById("testLocalSend")?.addEventListener("click", () => {
  saveLocalSendSettings(false);
  setLocalSendMessage("Sending test answer payload via LocalSend...");

  const host = (localSendHostInput?.value || "").trim();
  const port = Number(localSendPortInput?.value || 53317);
  const protocol = localSendProtocolSelect?.value || "http";
  const pin = (localSendPinInput?.value || "").trim();

  chrome.runtime.sendMessage(
    {
      type: "SEND_LOCALSEND_PAYLOAD",
      payload: {
        question: "Screen Q&A LocalSend wireless relay verification test",
        answer: "C) 8 kHz (Nyquist sampling rate is 2 * fm)",
        option_letter: "C",
        confidence: 0.99,
        provenance: ["localsend_test"],
      },
      options: { host, port, protocol, pin },
    },
    (response) => {
      if (chrome.runtime.lastError || !response) {
        setLocalSendMessage(`Relay error: ${chrome.runtime.lastError?.message || "No response"}`);
        return;
      }
      if (response.ok) {
        const targetName = response.peer?.alias || response.peer?.host || host || "LAN device";
        setLocalSendMessage(`Delivered test payload to ${targetName} (${response.transport}).`);
      } else {
        setLocalSendMessage(
          `Fallback active (${response.fallback || "pwa_route"}): ${response.reason || "Receiver unreachable."}`
        );
      }
    }
  );
});
