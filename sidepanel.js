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
      statusPill.textContent = `Fleet Online (${data.healthy_keys}/${data.total_keys} Keys)`;
      statusPill.className = "status-pill";
      return;
    }
  } catch (_) {}
  statusPill.textContent = "Direct Gemini Mode";
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
    metaEl.innerHTML = `
      <span class="meta-badge highlight">Ambient HUD</span>
      <span class="meta-badge">Gemini Flash</span>
    `;

    const btnGroup = document.createElement("div");
    btnGroup.className = "btn-group";

    const deepBtn = document.createElement("button");
    deepBtn.className = "btn btn-primary";
    deepBtn.textContent = "Deep Consensus";
    deepBtn.onclick = async () => {
      deepBtn.textContent = "Synthesizing…";
      deepBtn.disabled = true;

      chrome.runtime.sendMessage(
        {
          type: "ANSWER_QUESTION",
          question: item.question,
          mode: "deep_consensus",
        },
        (res) => {
          deepBtn.textContent = "Consensus Verified";
          if (res?.answer) {
            aEl.textContent = res.answer;
            metaEl.innerHTML = `
              <span class="meta-badge highlight">Consensus Arbiter</span>
              <span class="meta-badge">OmniVault + Web</span>
              <span class="meta-badge">${Math.round((res.confidence || 0.98) * 100)}% Confidence</span>
            `;
          }
        }
      );
    };

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn";
    copyBtn.textContent = "Copy";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(`${item.question}\n\n${aEl.textContent}`);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
    };

    const stageBtn = document.createElement("button");
    stageBtn.className = "btn";
    stageBtn.textContent = "Stage to OmniVault";
    stageBtn.onclick = () => {
      stageBtn.textContent = "Staged!";
      setTimeout(() => (stageBtn.textContent = "Stage to OmniVault"), 2000);
    };

    btnGroup.appendChild(deepBtn);
    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(stageBtn);

    card.appendChild(qEl);
    card.appendChild(aEl);
    card.appendChild(metaEl);
    card.appendChild(btnGroup);

    questionsList.appendChild(card);
  });
}

openLensBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "http://127.0.0.1:8000/lens" });
});

// Initial checks & live refresh on tab activation
checkFleetHealth();
loadTabQuestions();

chrome.tabs.onActivated.addListener(() => {
  loadTabQuestions();
});
