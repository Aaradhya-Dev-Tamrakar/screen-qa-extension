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

const DEFAULT_LAN_IP = "192.168.1.5";
let activePort = 8000;
let qrInstance = null;

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
  const portsToProbe = [8000, 8001, 8080];
  let foundPort = null;

  for (const port of portsToProbe) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(1200),
      });
      if (res.ok) {
        foundPort = port;
        break;
      }
    } catch {
      // Continue to next port
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
  ["geminiApiKey", "lensUrl", "pairingToken"],
  ({ geminiApiKey, lensUrl, pairingToken }) => {
    if (chrome.runtime.lastError) {
      setPairingMessage(`Could not load pairing settings: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (geminiApiKey) input.value = geminiApiKey;

    // Use saved URL or default to LAN IP for phone accessibility
    lensUrlInput.value = lensUrl || `http://${DEFAULT_LAN_IP}:8000/lens`;
    pairingTokenInput.value = pairingToken || createPairingToken();
    updatePairingLink();

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
