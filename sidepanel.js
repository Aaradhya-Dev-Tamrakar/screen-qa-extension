// sidepanel.js — Screen Q&A SidePanel Companion

const statusPill = document.getElementById("statusPill");
const questionsList = document.getElementById("questionsList");
const openLensBtn = document.getElementById("openLensBtn");

// Check Fleet-Orchestrator server connection
async function checkFleetHealth() {
  try {
    const res = await fetch("http://127.0.0.1:8000/api/v1/qa/status");
    if (res.ok) {
      const data = await res.json();
      const count = data.healthy_keys || data.total_keys || 31;
      statusPill.textContent = `Copilot Fleet (${count} Workers)`;
      statusPill.className = "status-pill";
      return;
    }
  } catch (_) {}
  statusPill.textContent = "Fleet Offline (127.0.0.1:8000)";
  statusPill.className = "status-pill offline";
}

// Resolve the active web page tab across Chromium, Brave, and Vivaldi Web Panels
async function getActiveWebTab() {
  try {
    // 1. Last focused normal window (standard for side panels and web panels)
    const focusedTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const validFocused = (focusedTabs || []).find(
      (t) => t.url && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://") && !t.url.startsWith("vivaldi://")
    );
    if (validFocused) return validFocused;

    // 2. Active tab in current window
    const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const validCurrent = (currentTabs || []).find(
      (t) => t.url && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://") && !t.url.startsWith("vivaldi://")
    );
    if (validCurrent) return validCurrent;

    // 3. Fallback across all active tabs
    const allActive = await chrome.tabs.query({ active: true });
    const validActive = (allActive || []).find(
      (t) => t.url && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://") && !t.url.startsWith("vivaldi://")
    );
    if (validActive) return validActive;

    // 4. Any tab with an http, https, or file URL
    const allTabs = await chrome.tabs.query({});
    return (allTabs || []).find(
      (t) => t.url && (t.url.startsWith("http://") || t.url.startsWith("https://") || t.url.startsWith("file:///"))
    );
  } catch (err) {
    console.debug("[Sidepanel] Tab query failed", err);
    return null;
  }
}

// Fetch detected questions from active tab content script
async function loadTabQuestions() {
  const tabInfoEl = document.getElementById("targetTabInfo");
  const tab = await getActiveWebTab();
  if (!tab || !tab.id) {
    if (tabInfoEl) tabInfoEl.textContent = "No web tab active";
    return;
  }

  const tabTitle = tab.title || (tab.url ? new URL(tab.url).pathname.split("/").pop() : "Active Tab");
  if (tabInfoEl) {
    tabInfoEl.textContent = `Tab: ${tabTitle}`;
    tabInfoEl.title = tab.url;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_QUESTIONS" });
    if (response?.questions && response.questions.length > 0) {
      renderQuestions(response.questions);
    }
  } catch (err) {
    // If content script is missing or connection failed, auto-inject it into the tab
    console.debug("[Sidepanel] Auto-injecting content script into tab", tab.id, tab.url);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["overlay.css"],
      }).catch(() => {});
    } catch (_) {}
  }
}

async function triggerManualScan() {
  const scanBtn = document.getElementById("scanTabBtn");
  if (scanBtn) {
    scanBtn.textContent = "Scanning...";
    scanBtn.disabled = true;
  }

  const tab = await getActiveWebTab();
  if (tab && tab.id) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      }).catch(() => {});

      await chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_SCAN" });
    } catch (_) {}
  }

  await loadTabQuestions();

  if (scanBtn) {
    setTimeout(() => {
      scanBtn.textContent = "Scan Tab";
      scanBtn.disabled = false;
    }, 800);
  }
}

function renderQuestions(items) {
  questionsList.innerHTML = "";

  items.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "qa-card";

    const qEl = document.createElement("div");
    qEl.className = "qa-question";
    qEl.textContent = `Q${idx + 1}: ${item.question}`;

    const aEl = document.createElement("div");
    aEl.className = "qa-answer";
    aEl.textContent = item.answer || "Analyzing…";

    const metaEl = document.createElement("div");
    metaEl.className = "qa-meta";
    const provName = item.provenance && item.provenance[0] ? item.provenance[0] : "Copilot Fleet";
    metaEl.innerHTML = `
      <span class="meta-badge highlight">Ambient HUD</span>
      <span class="meta-badge">${provName}</span>
    `;

    const btnGroup = document.createElement("div");
    btnGroup.className = "btn-group";

    const consensusBtn = document.createElement("button");
    consensusBtn.className = "btn-action";
    consensusBtn.textContent = "Re-verify";
    consensusBtn.onclick = () => triggerConsensus(item.question, aEl, metaEl);

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-action";
    copyBtn.textContent = "Copy";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(item.answer || item.question);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
    };

    const omniBtn = document.createElement("button");
    omniBtn.className = "btn-action";
    omniBtn.textContent = "Stage to OmniVault";
    omniBtn.onclick = () => stageToOmniVault(item.question, item.answer, omniBtn);

    const localSendBtn = document.createElement("button");
    localSendBtn.className = "btn-action";
    localSendBtn.textContent = "LocalSend";
    localSendBtn.onclick = () => pushItemViaLocalSend(item.question, item.answer, localSendBtn);

    btnGroup.appendChild(consensusBtn);
    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(omniBtn);
    btnGroup.appendChild(localSendBtn);

    card.appendChild(qEl);
    card.appendChild(aEl);
    card.appendChild(metaEl);
    card.appendChild(btnGroup);

    questionsList.appendChild(card);
  });
}

async function triggerConsensus(question, answerEl, metaEl) {
  answerEl.textContent = "Re-verifying via Copilot Fleet…";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "ANSWER_QUESTION",
      question: question,
      mode: "fast_hud",
    });
    if (res && res.answer) {
      answerEl.textContent = res.answer;
      const prov = res.provenance && res.provenance[0] ? res.provenance[0] : "Copilot Fleet";
      metaEl.innerHTML = `
        <span class="meta-badge highlight">Re-verified</span>
        <span class="meta-badge">${prov}</span>
      `;
    }
  } catch (err) {
    answerEl.textContent = "Re-verify error: " + err.message;
  }
}

async function stageToOmniVault(question, answer, btn) {
  btn.textContent = "Staged!";
  btn.disabled = true;
  chrome.storage.local.get({ omnivault_staging: [] }, (data) => {
    const list = data.omnivault_staging;
    list.push({ question, answer, timestamp: Date.now() });
    chrome.storage.local.set({ omnivault_staging: list });
  });
}

async function pushItemViaLocalSend(question, answer, btn) {
  btn.textContent = "Sending…";
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: "SEND_LOCALSEND_PAYLOAD",
      payload: {
        question,
        answer: answer || "",
        confidence: 0.95,
        provenance: ["sidepanel_manual_relay"],
      },
    });
    if (res && res.ok) {
      btn.textContent = "Sent!";
    } else {
      btn.textContent = "PWA Fallback";
    }
  } catch {
    btn.textContent = "PWA Fallback";
  }
  setTimeout(() => {
    btn.textContent = "LocalSend";
    btn.disabled = false;
  }, 2000);
}

openLensBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "http://127.0.0.1:8000/lens" });
});

// Periodic status poll & questions sync
checkFleetHealth();
setInterval(checkFleetHealth, 5000);

loadTabQuestions();
setInterval(loadTabQuestions, 2500);


document.getElementById("scanTabBtn")?.addEventListener("click", triggerManualScan);
