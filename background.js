// background.js — Screen Q&A v0.3.0 MV3 Service Worker
// Manages hybrid Fleet-Orchestrator routing with fallback, side panel dispatch,
// and Alt+Q scan toggle command handling.

const FLEET_ENDPOINT = "http://127.0.0.1:8000/api/v1/qa/ask";
const DIRECT_GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

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

// 1. Primary: Fleet-Orchestrator 31-Key Rotator & Consensus Engine
async function askFleetOrchestrator(question, context, mode) {
  const controller = new AbortController();
  const timeoutMs = mode === "deep_consensus" ? 6000 : 1800;
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
        sendResponse(result);
      } catch (err) {
        sendResponse({ error: err.message || String(err) });
      }
    })();
    return true; // Keep message channel open for async response
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
        chrome.tabs.sendMessage(tab.id, {
          type: "TOGGLE_SCAN",
          isActive: isScanningEnabled,
        }).catch(() => {});
      }
    }
  }
});
