// background.js — Screen Q&A v0.4.0 MV3 Service Worker
// Manages hybrid Fleet-Orchestrator routing with fallback, side panel dispatch,
// LocalSend LAN discovery + direct REST relay (port 53317), and Alt+Q scan toggle command handling.

const FLEET_ENDPOINT = "http://127.0.0.1:8000/api/v1/qa/ask";
const FLEET_LOCALSEND_DISCOVER = "http://127.0.0.1:8000/api/v1/qa/localsend/discover";
const FLEET_LOCALSEND_RELAY = "http://127.0.0.1:8000/api/v1/qa/localsend/relay";
const DIRECT_GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";
const LOCALSEND_DEFAULT_PORT = 53317;
const LOCALSEND_API_PREFIX = "/api/localsend/v2";

let isScanningEnabled = true;

// Enable opening SidePanel when clicking the extension icon
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[SidePanel Init Error]", err));
}

async function getDirectApiKey() {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  return geminiApiKey || null;
}

async function getLocalSendSettings() {
  const data = await chrome.storage.local.get({
    localSendEnabled: false,
    localSendHost: "",
    localSendPort: LOCALSEND_DEFAULT_PORT,
    localSendProtocol: "http",
    localSendPin: "",
    lensUrl: "",
  });
  return data;
}

function extractLanSubnetPrefix(ip) {
  const m = String(ip || "").trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  return m ? m[1] : "192.168.1";
}

function inferLanIpFromLensUrl(lensUrl) {
  try {
    const parsed = new URL(lensUrl);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname) && parsed.hostname !== "127.0.0.1") {
      return parsed.hostname;
    }
  } catch {}
  return "";
}

async function probeLocalSendReceiverDirect(host, port = LOCALSEND_DEFAULT_PORT, preferredProtocol = "http", timeoutMs = 900) {
  const cleanHost = String(host || "").trim();
  if (!cleanHost) return null;

  const schemes = preferredProtocol === "https" ? ["https", "http"] : ["http", "https"];
  for (const scheme of schemes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${scheme}://${cleanHost}:${port}${LOCALSEND_API_PREFIX}/info`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const info = await res.json().catch(() => ({}));
        return {
          alias: info.alias || cleanHost,
          host: cleanHost,
          port: Number(info.port || port),
          protocol: scheme,
          deviceModel: info.deviceModel || "",
          deviceType: info.deviceType || "",
          fingerprint: info.fingerprint || "",
        };
      }
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

// Discover LocalSend instances on the LAN via Fleet UDP multicast bridge + direct REST probe fallback
async function discoverLocalSendDevices(options = {}) {
  const settings = await getLocalSendSettings();
  const targetHost = (options.host ?? settings.localSendHost ?? "").trim() || inferLanIpFromLensUrl(settings.lensUrl);
  const targetPort = Number(options.port || settings.localSendPort || LOCALSEND_DEFAULT_PORT);
  const protocol = options.protocol || settings.localSendProtocol || "http";

  const discoveredMap = new Map();

  // 1. Try Fleet-Orchestrator UDP multicast discovery (224.0.0.167:53317)
  try {
    const url = new URL(FLEET_LOCALSEND_DISCOVER);
    url.searchParams.set("timeout", "1.4");
    if (targetHost) url.searchParams.set("host", targetHost);
    url.searchParams.set("port", String(targetPort));
    url.searchParams.set("protocol", protocol);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2800);
    const res = await fetch(url.toString(), { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      for (const peer of data.peers || []) {
        if (peer && peer.host) {
          discoveredMap.set(`${peer.host}:${peer.port || targetPort}`, peer);
        }
      }
    }
  } catch (err) {
    console.debug("[LocalSend Fleet Multicast Discovery Offline; using direct REST probe]", err.message);
  }

  // 2. Direct probe of configured host + localhost + nearby LAN candidate hosts
  const candidateHosts = [];
  if (targetHost) candidateHosts.push(targetHost);
  candidateHosts.push("127.0.0.1");

  const prefix = extractLanSubnetPrefix(targetHost || inferLanIpFromLensUrl(settings.lensUrl));
  for (const suffix of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 50, 100, 101, 102]) {
    const cand = `${prefix}.${suffix}`;
    if (!candidateHosts.includes(cand)) {
      candidateHosts.push(cand);
    }
  }

  const probeBatch = candidateHosts.slice(0, 14).map((h) =>
    probeLocalSendReceiverDirect(h, targetPort, protocol, h === targetHost ? 1200 : 650)
  );
  const directResults = await Promise.all(probeBatch);
  for (const peer of directResults) {
    if (peer && peer.host) {
      discoveredMap.set(`${peer.host}:${peer.port}`, peer);
    }
  }

  const peers = Array.from(discoveredMap.values());
  return {
    ok: true,
    count: peers.length,
    peers,
  };
}

// Direct REST API push to a LocalSend v2 receiver on port 53317
async function pushLocalSendDirectRest(peer, payloadObj, pin = "") {
  const host = peer.host;
  const port = Number(peer.port || LOCALSEND_DEFAULT_PORT);
  const scheme = peer.protocol || "http";

  const formattedText =
    `Q: ${payloadObj.question}\n` +
    `Answer: ${payloadObj.option_letter ? payloadObj.option_letter + " - " : ""}${payloadObj.answer}\n` +
    `Confidence: ${Math.round((payloadObj.confidence || 0.95) * 100)}%\n\n` +
    `--- JSON ---\n${JSON.stringify(payloadObj)}`;

  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(formattedText);
  const fileId = `sqa-${Date.now()}`;

  const prepareBody = {
    info: {
      alias: "Screen Q&A",
      version: "2.1",
      deviceModel: "Screen Q&A Extension",
      deviceType: "headless",
      fingerprint: "screen-qa-extension",
      port: LOCALSEND_DEFAULT_PORT,
      protocol: scheme,
      download: false,
    },
    files: {
      [fileId]: {
        id: fileId,
        fileName: "screen-qa-answer.json",
        size: payloadBytes.byteLength,
        fileType: "text/plain",
        preview: formattedText.slice(0, 500),
      },
    },
  };

  const pinQuery = pin ? `?pin=${encodeURIComponent(pin)}` : "";
  const prepareUrl = `${scheme}://${host}:${port}${LOCALSEND_API_PREFIX}/prepare-upload${pinQuery}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);

  try {
    const prepRes = await fetch(prepareUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prepareBody),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (prepRes.status === 204) {
      return {
        ok: true,
        transport: "localsend_direct_204",
        peer,
        bytesSent: payloadBytes.byteLength,
      };
    }

    if (!prepRes.ok) {
      const errText = await prepRes.text().catch(() => "");
      throw new Error(`LocalSend HTTP ${prepRes.status}: ${errText.slice(0, 120)}`);
    }

    const prepData = await prepRes.json().catch(() => ({}));
    const sessionId = prepData.sessionId || "";
    const fileToken = (prepData.files && prepData.files[fileId]) || "";

    if (sessionId && fileToken) {
      const uploadQuery =
        `?sessionId=${encodeURIComponent(sessionId)}` +
        `&fileId=${encodeURIComponent(fileId)}` +
        `&token=${encodeURIComponent(fileToken)}`;
      const uploadUrl = `${scheme}://${host}:${port}${LOCALSEND_API_PREFIX}/upload${uploadQuery}`;
      const upRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: formattedText,
      });
      if (!upRes.ok) {
        throw new Error(`LocalSend upload HTTP ${upRes.status}`);
      }
    }

    return {
      ok: true,
      transport: "localsend_direct_200",
      peer,
      sessionId,
      bytesSent: payloadBytes.byteLength,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Relay structured answer payload to LocalSend receiver, falling back gracefully to PWA route if none found
async function relayAnswerViaLocalSend(qaPayload, overrideOptions = {}) {
  const settings = await getLocalSendSettings();
  const isEnabled = overrideOptions.force || Boolean(settings.localSendEnabled);
  if (!isEnabled) {
    return { ok: false, skipped: true, fallback: "pwa_route", reason: "LocalSend toggle is disabled." };
  }

  const targetHost = (overrideOptions.host ?? settings.localSendHost ?? "").trim();
  const targetPort = Number(overrideOptions.port || settings.localSendPort || LOCALSEND_DEFAULT_PORT);
  const protocol = overrideOptions.protocol || settings.localSendProtocol || "http";
  const pin = overrideOptions.pin ?? settings.localSendPin ?? "";

  const matchLetter =
    String(qaPayload.answer || "").match(/\b([A-D])\b[:.)\s]?/i) ||
    String(qaPayload.answer || "").match(/OPTION:\s*([A-D])/i);
  const optionLetter = qaPayload.option_letter || (matchLetter ? matchLetter[1].toUpperCase() : "");

  const structuredPayload = {
    question: qaPayload.question || "",
    answer: qaPayload.answer || "",
    option_letter: optionLetter,
    confidence: qaPayload.confidence ?? 0.95,
    provenance: qaPayload.provenance || ["screen_qa"],
    timestamp: Date.now(),
  };

  // 1. Try direct REST API push if targetHost is known or discoverable directly
  try {
    let targetPeer = null;
    if (targetHost) {
      targetPeer =
        (await probeLocalSendReceiverDirect(targetHost, targetPort, protocol, 1000)) || {
          alias: targetHost,
          host: targetHost,
          port: targetPort,
          protocol,
        };
      return await pushLocalSendDirectRest(targetPeer, structuredPayload, pin);
    }
  } catch (directErr) {
    console.debug("[LocalSend Direct Host Push Failed; trying discovery/Fleet bridge]", directErr.message);
  }

  // 2. Try Fleet-Orchestrator LocalSend relay (handles UDP multicast discovery + HTTPS self-signed certs)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(FLEET_LOCALSEND_RELAY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_host: targetHost || null,
        target_port: targetPort,
        protocol,
        pin: pin || null,
        question: structuredPayload.question,
        answer: structuredPayload.answer,
        option_letter: structuredPayload.option_letter,
        confidence: structuredPayload.confidence,
        provenance: structuredPayload.provenance,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data.ok) {
        return {
          ok: true,
          transport: "localsend_fleet_bridge",
          peer: data.peer,
          bytesSent: data.bytes_sent,
        };
      }
    }
  } catch (fleetRelayErr) {
    console.debug("[LocalSend Fleet Bridge Unavailable; scanning LAN directly]", fleetRelayErr.message);
  }

  // 3. Fallback scan via direct REST discovery and push to first available receiver
  try {
    const discovery = await discoverLocalSendDevices({ host: targetHost, port: targetPort, protocol });
    if (discovery.peers && discovery.peers.length > 0) {
      return await pushLocalSendDirectRest(discovery.peers[0], structuredPayload, pin);
    }
  } catch (scanErr) {
    console.warn("[LocalSend Fallback Scan Error]", scanErr.message);
  }

  // 4. Graceful fallback to existing Screen Lens PWA route
  return {
    ok: false,
    fallback: "pwa_route",
    reason: "No active LocalSend receiver found on LAN (port 53317); using Screen Lens PWA route.",
  };
}

// 1. Primary: Fleet-Orchestrator 31-Key Rotator & Consensus Engine
async function askFleetOrchestrator(question, context, mode) {
  const controller = new AbortController();
  const timeoutMs = 30000; // Copilot Fleet allowance
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(FLEET_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, context, mode }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Fleet status ${res.status}`);
    }
    const data = await res.json();
    return {
      answer: data.answer,
      option_letter: data.option_letter || "",
      confidence: data.confidence || 0.95,
      provenance: data.provenance || ["fleet_orchestrator"],
      source: "fleet_pool",
    };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// 2. Fallback: Standalone Direct Gemini API
async function askGeminiDirect(question, context, apiKey) {
  const prompt = context
    ? `Context / Surrounding Options:\n${context}\n\nQuestion Stem:\n${question}\n\nProvide the direct correct answer or option letter with 1-sentence justification.`
    : question;

  const res = await fetch(`${DIRECT_GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Gemini direct status ${res.status}: ${errBody.slice(0, 150)}`);
  }

  const data = await res.json();
  const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!answer) throw new Error("No answer in direct Gemini response");

  return {
    answer,
    confidence: 0.9,
    provenance: ["direct_gemini_fallback"],
    source: "direct_fallback",
  };
}

// Unified hybrid router
async function routeQuestion(question, context, mode) {
  // Try Fleet-Orchestrator first
  try {
    const fleetResult = await askFleetOrchestrator(question, context, mode);
    return fleetResult;
  } catch (fleetErr) {
    console.debug("[Fleet Offline or Error; falling back to direct key]", fleetErr.message);

    const apiKey = await getDirectApiKey();
    if (!apiKey) {
      throw new Error(
        "Fleet-Orchestrator offline (127.0.0.1:8000) and no direct Gemini API key saved in extension options."
      );
    }
    return await askGeminiDirect(question, context, apiKey);
  }
}

// Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ANSWER_QUESTION") {
    (async () => {
      try {
        const result = await routeQuestion(
          message.question,
          message.context || "",
          message.mode || "fast_hud"
        );
        // Non-blocking LocalSend relay if enabled (gracefully falls back to PWA route if no LocalSend receiver is found)
        const localSendRelay = await relayAnswerViaLocalSend({
          question: message.question,
          answer: result.answer,
          option_letter: result.option_letter,
          confidence: result.confidence,
          provenance: result.provenance,
        }).catch((relayErr) => ({
          ok: false,
          fallback: "pwa_route",
          reason: relayErr.message || String(relayErr),
        }));
        sendResponse({ ...result, localSendRelay });
      } catch (err) {
        sendResponse({ error: err.message || String(err) });
      }
    })();
    return true; // Keep message channel open for async response
  }

  if (message?.type === "DISCOVER_LOCALSEND") {
    (async () => {
      try {
        const result = await discoverLocalSendDevices(message.options || {});
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, count: 0, peers: [], error: err.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "SEND_LOCALSEND_PAYLOAD") {
    (async () => {
      try {
        const result = await relayAnswerViaLocalSend(message.payload || {}, {
          force: true,
          ...(message.options || {}),
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({
          ok: false,
          fallback: "pwa_route",
          reason: err.message || String(err),
        });
      }
    })();
    return true;
  }

  if (message?.type === "GET_SCAN_STATUS") {
    sendResponse({ isScanningEnabled });
    return true;
  }
});

// Keyboard Shortcut: Alt+Q Toggle Scan
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-scan") {
    isScanningEnabled = !isScanningEnabled;

    // Update extension badge
    chrome.action.setBadgeText({ text: isScanningEnabled ? "" : "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#71717a" });

    // Broadcast to all tabs
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs
          .sendMessage(tab.id, {
            type: "TOGGLE_SCAN",
            isActive: isScanningEnabled,
          })
          .catch(() => {});
      }
    }
  }
});
