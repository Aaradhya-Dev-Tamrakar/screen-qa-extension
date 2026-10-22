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

// Fetch detected questions from active tab content script
async function loadTabQuestions() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_QUESTIONS" });
    if (response?.questions && response.questions.length > 0) {
      renderQuestions(response.questions);
    }
  } catch (err) {
    // Content script might not be injected or page is chrome://
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

    btnGroup.appendChild(consensusBtn);
    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(omniBtn);

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

openLensBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "http://127.0.0.1:8000/lens" });
});

// Periodic status poll & questions sync
checkFleetHealth();
setInterval(checkFleetHealth, 5000);

loadTabQuestions();
setInterval(loadTabQuestions, 2500);
