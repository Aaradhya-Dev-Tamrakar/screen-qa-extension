const input = document.getElementById("apiKey");
const status = document.getElementById("status");
const lensUrlInput = document.getElementById("lensUrl");
const pairingTokenInput = document.getElementById("pairingToken");
const pairingLinkInput = document.getElementById("pairingLink");
const pairingStatus = document.getElementById("pairingStatus");

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

function updatePairingLink() {
  pairingLinkInput.value = buildPairingLink();
}

function setPairingMessage(message) {
  pairingStatus.textContent = message;
}

function createPairingToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

chrome.storage.local.get(
  ["geminiApiKey", "lensUrl", "pairingToken"],
  ({ geminiApiKey, lensUrl, pairingToken }) => {
    if (chrome.runtime.lastError) {
      setPairingMessage(`Could not load pairing settings: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (geminiApiKey) input.value = geminiApiKey;
    lensUrlInput.value = lensUrl || "http://127.0.0.1:8000/lens";
    pairingTokenInput.value = pairingToken || "";
    updatePairingLink();
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
