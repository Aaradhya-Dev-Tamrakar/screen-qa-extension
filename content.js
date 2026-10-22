// content.js — Screen Q&A v0.3.0
// Runs in page context with smart container hoisting, closed Shadow DOM,
// pointer-events transparency, and Alt+Q scan toggle support.

const QUESTION_RE = /[^.!?\n]{8,350}\?/g;
const seen = new Set();
let isScanActive = true;
const activeOverlays = new Map();

// CSS injected inside closed Shadow DOM to avoid host-page style collisions & detection
const SHADOW_STYLE = `
  :host {
    all: initial;
  }
  .screen-qa-overlay {
    position: absolute;
    z-index: 2147483647;
    max-width: 380px;
    padding: 8px 12px;
    background: rgba(18, 18, 18, 0.94);
    color: #f4f4f5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.45;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(8px);
    pointer-events: none; /* Ghost HUD: clicks pass straight through to radio buttons */
    transition: opacity 0.2s ease, transform 0.2s ease;
  }
  .screen-qa-overlay.loading {
    opacity: 0.75;
    color: #a1a1aa;
    font-style: italic;
  }
  .screen-qa-letter {
    display: inline-block;
    font-weight: 700;
    color: #4ade80;
    margin-right: 6px;
    font-size: 14px;
  }
  .screen-qa-badge {
    font-size: 10px;
    background: #27272a;
    color: #a1a1aa;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: 6px;
    font-weight: 500;
  }
`;

function extractQuestions(root) {
  if (!isScanActive) return [];
  const text = root.innerText || root.textContent || "";
  const matches = text.match(QUESTION_RE);
  if (!matches) return [];
  return matches
    .map((m) => m.trim())
    .filter((m) => m.length > 0 && !seen.has(m));
}

function findTextNodeForMatch(root, matchText) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const t = node.innerText || "";
      return t.includes(matchText) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  let best = null;
  let node;
  while ((node = walker.nextNode())) {
    best = node;
  }
  return best;
}

// Smart Container Hoisting: climbs up DOM to capture question stem + choices (A-D)
function hoistQuestionContext(anchorEl, matchText) {
  let curr = anchorEl;
  let bestContainer = anchorEl;
  let depth = 0;

  while (curr && curr !== document.body && depth < 5) {
    const tagName = curr.tagName.toLowerCase();
    const classList = (curr.className || "").toString().toLowerCase();

    // Check for common assessment containers
    if (
      tagName === "fieldset" ||
      tagName === "form" ||
      tagName === "article" ||
      classList.includes("question") ||
      classList.includes("quiz") ||
      classList.includes("problem") ||
      classList.includes("card") ||
      classList.includes("item")
    ) {
      bestContainer = curr;
      break;
    }

    const textLen = (curr.innerText || "").length;
    if (textLen >= 50 && textLen <= 1600) {
      bestContainer = curr;
    }
    curr = curr.parentElement;
    depth++;
  }

  const rawContext = (bestContainer.innerText || "").trim();
  // Bound to max 1,500 characters
  return rawContext.slice(0, 1500);
}

function createClosedShadowOverlay(anchorEl) {
  let host = anchorEl.__sqaHost;
  if (!host || !host.isConnected) {
    host = document.createElement("div");
    host.style.position = "absolute";
    host.style.top = "0";
    host.style.left = "0";
    host.style.width = "0";
    host.style.height = "0";
    host.style.overflow = "visible";
    host.style.pointerEvents = "none";
    host.style.zIndex = "2147483647";

    // Closed Shadow Root: immune to document.querySelectorAll inspection
    const shadow = host.attachShadow({ mode: "closed" });
    const styleEl = document.createElement("style");
    styleEl.textContent = SHADOW_STYLE;
    shadow.appendChild(styleEl);

    const overlayDiv = document.createElement("div");
    overlayDiv.className = "screen-qa-overlay loading";
    overlayDiv.textContent = "Analyzing…";
    shadow.appendChild(overlayDiv);

    document.body.appendChild(host);
    anchorEl.__sqaHost = host;
    anchorEl.__sqaShadowRoot = shadow;
    anchorEl.__sqaOverlayDiv = overlayDiv;
  }
  return { host, overlayDiv: anchorEl.__sqaOverlayDiv };
}

function updateOverlayPosition(anchorEl, host, overlayDiv) {
  const rect = anchorEl.getBoundingClientRect();
  const top = window.scrollY + rect.bottom + 4;
  const left = window.scrollX + Math.max(10, rect.left);
  overlayDiv.style.top = `${top}px`;
  overlayDiv.style.left = `${left}px`;
}

function showOverlay(anchorEl, question, answerText, isLoading, provenance) {
  if (!isScanActive) return;
  const { host, overlayDiv } = createClosedShadowOverlay(anchorEl);
  updateOverlayPosition(anchorEl, host, overlayDiv);

  if (isLoading) {
    overlayDiv.textContent = "Analyzing…";
    overlayDiv.classList.add("loading");
  } else {
    overlayDiv.classList.remove("loading");
    overlayDiv.innerHTML = "";

    // Parse out leading option letter if present (e.g. "B: ...")
    const matchLetter = answerText.match(/^([A-D])[:.)\s]/i);
    if (matchLetter) {
      const letterSpan = document.createElement("span");
      letterSpan.className = "screen-qa-letter";
      letterSpan.textContent = `[${matchLetter[1].toUpperCase()}]`;
      overlayDiv.appendChild(letterSpan);
    }

    const textNode = document.createTextNode(answerText);
    overlayDiv.appendChild(textNode);

    if (provenance && provenance.includes("consensus_arbiter")) {
      const badge = document.createElement("span");
      badge.className = "screen-qa-badge";
      badge.textContent = "Consensus";
      overlayDiv.appendChild(badge);
    }
  }

  activeOverlays.set(anchorEl, { host, overlayDiv, question, answerText });
}

function handleQuestion(question, anchorEl) {
  seen.add(question);
  showOverlay(anchorEl, question, "", true);

  const contextBlock = hoistQuestionContext(anchorEl, question);

  chrome.runtime.sendMessage(
    {
      type: "ANSWER_QUESTION",
      question,
      context: contextBlock,
      mode: "fast_hud",
    },
    (response) => {
      if (chrome.runtime.lastError) {
        showOverlay(anchorEl, question, `Error: ${chrome.runtime.lastError.message}`, false);
        return;
      }
      if (response?.error) {
        showOverlay(anchorEl, question, `Error: ${response.error}`, false);
        return;
      }
      showOverlay(
        anchorEl,
        question,
        response?.answer || "(no answer)",
        false,
        response?.provenance
      );
    }
  );
}

function scan() {
  if (!isScanActive) return;
  const questions = extractQuestions(document.body);
  for (const q of questions) {
    const anchor = findTextNodeForMatch(document.body, q) || document.body;
    handleQuestion(q, anchor);
  }
}

function debouncedScan() {
  clearTimeout(debouncedScan._t);
  debouncedScan._t = setTimeout(scan, 500);
}

// Toggle on/off via Alt+Q broadcast from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TOGGLE_SCAN") {
    isScanActive = message.isActive;
    if (!isScanActive) {
      // Clear all active overlays
      for (const [anchor, data] of activeOverlays.entries()) {
        if (data.host && data.host.parentNode) {
          data.host.parentNode.removeChild(data.host);
        }
      }
      activeOverlays.clear();
    } else {
      debouncedScan();
    }
    sendResponse({ status: "ok", isScanActive });
    return true;
  }

  if (message?.type === "GET_PAGE_QUESTIONS") {
    // Collect detected questions for the SidePanel
    const list = [];
    for (const [anchor, data] of activeOverlays.entries()) {
      list.push({ question: data.question, answer: data.answerText });
    }
    sendResponse({ questions: list });
    return true;
  }
});

// Window resize & scroll repositioning
window.addEventListener("scroll", () => {
  for (const [anchor, data] of activeOverlays.entries()) {
    if (anchor && anchor.isConnected) {
      updateOverlayPosition(anchor, data.host, data.overlayDiv);
    }
  }
}, { passive: true });

// Initial scan
debouncedScan();

// MutationObserver for infinite scroll & SPAs
const observer = new MutationObserver(() => {
  debouncedScan();
});
observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});
