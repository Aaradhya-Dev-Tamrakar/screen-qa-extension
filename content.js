// content.js — Screen Q&A v0.3.1 (Adaptive Question HUD & Continuous Multi-Page Perception)
// Operates passively in closed Shadow DOM with pointer-events transparency.
// Zero hotkey reliance, zero mouse interception, self-healing multi-page cleanup.

const QUESTION_RE = /[^.!?\n]{8,350}\?/g;
const seen = new Set();
let isScanActive = true;
const activeOverlays = new Map();
let lastUrl = window.location.href;

// Closed Shadow DOM CSS
const SHADOW_STYLE = `
  :host {
    all: initial;
  }
  .screen-qa-overlay {
    position: absolute;
    z-index: 2147483647;
    max-width: 420px;
    padding: 8px 12px;
    background: rgba(15, 17, 23, 0.95);
    color: #f1f5f9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.45;
    border-radius: 8px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(8px);
    pointer-events: none; /* Clicks pass straight through to radio buttons */
    transition: opacity 0.2s ease, transform 0.2s ease;
  }
  .screen-qa-overlay.loading {
    opacity: 0.75;
    color: #94a3b8;
    font-style: italic;
  }
  .screen-qa-letter {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    color: #22c55e;
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.4);
    padding: 2px 7px;
    border-radius: 6px;
    margin-right: 8px;
    font-size: 13px;
    letter-spacing: 0.5px;
  }
  .screen-qa-option-highlight {
    position: absolute;
    z-index: 2147483647;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 700;
    font-size: 12px;
    color: #22c55e;
    background: rgba(34, 197, 94, 0.16);
    border: 1.5px solid #22c55e;
    padding: 2px 8px;
    border-radius: 12px;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(34, 197, 94, 0.3);
  }
  .screen-qa-badge {
    font-size: 10px;
    background: #334155;
    color: #cbd5e1;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: 6px;
    font-weight: 500;
  }
`;

// Extract questions from standard text, Google Forms, and assessment containers
function extractQuestions(root) {
  if (!isScanActive) return [];
  const results = [];

  // 1. Google Forms & assessment card containers
  const assessmentContainers = root.querySelectorAll(
    'div[role="listitem"], .geSWh, .freebirdFormviewerViewNumberedItemContent, .que, .question-view'
  );

  for (const container of assessmentContainers) {
    const headingEl = container.querySelector('div[role="heading"], .M7eMe, .qtext, h2, h3, legend');
    if (headingEl) {
      const qText = (headingEl.innerText || headingEl.textContent || "").trim();
      if (qText.length >= 8 && !seen.has(qText)) {
        results.push({ questionText: qText, anchorNode: headingEl, containerNode: container });
      }
    }
  }

  // 2. Regex fallback for standard paragraphs / question marks
  const text = root.innerText || root.textContent || "";
  const matches = text.match(QUESTION_RE) || [];
  for (const m of matches) {
    const qTrim = m.trim();
    if (qTrim.length > 0 && !seen.has(qTrim)) {
      const anchor = findTextNodeForMatch(root, qTrim);
      if (anchor && !results.some((r) => r.questionText === qTrim)) {
        results.push({ questionText: qTrim, anchorNode: anchor, containerNode: anchor.parentElement });
      }
    }
  }

  return results;
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

// Climbs DOM to capture question stem + all choices
function hoistQuestionContext(containerEl, anchorEl, questionText) {
  let curr = containerEl || anchorEl;
  let depth = 0;
  let bestContainer = curr;

  while (curr && curr !== document.body && depth < 5) {
    const tagName = (curr.tagName || "").toLowerCase();
    const classList = (curr.className || "").toString().toLowerCase();

    if (
      tagName === "fieldset" ||
      tagName === "form" ||
      classList.includes("question") ||
      classList.includes("quiz") ||
      classList.includes("listitem") ||
      classList.includes("card")
    ) {
      bestContainer = curr;
      break;
    }
    curr = curr.parentElement;
    depth++;
  }

  const rawContext = (bestContainer?.innerText || anchorEl?.innerText || questionText).trim();
  return rawContext.slice(0, 1600);
}

// Find matching radio/choice element for MCQ question types
function findOptionElement(containerEl, optionLetter) {
  if (!containerEl || !optionLetter) return null;
  const letter = optionLetter.toUpperCase();
  const letterIndex = letter.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3

  // 1. Google Forms radio buttons & labels
  const radios = containerEl.querySelectorAll(
    'div[role="radio"], div[role="checkbox"], label, div.docssharedWizToggleLabeledContainer, .answer div, .option'
  );

  if (radios.length > letterIndex && letterIndex >= 0) {
    // Check if explicitly matching letter index or text
    for (const r of radios) {
      const text = (r.innerText || "").trim();
      if (text.startsWith(letter + ")") || text.startsWith(letter + ".") || text.startsWith(`Option ${letter}`)) {
        return r;
      }
    }
    return radios[letterIndex];
  }

  return null;
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

    const shadow = host.attachShadow({ mode: "closed" });
    const styleEl = document.createElement("style");
    styleEl.textContent = SHADOW_STYLE;
    shadow.appendChild(styleEl);

    const overlayDiv = document.createElement("div");
    overlayDiv.className = "screen-qa-overlay loading";
    overlayDiv.textContent = "Analyzing…";
    shadow.appendChild(overlayDiv);

    const optionHighlightDiv = document.createElement("div");
    optionHighlightDiv.className = "screen-qa-option-highlight";
    optionHighlightDiv.style.display = "none";
    shadow.appendChild(optionHighlightDiv);

    document.body.appendChild(host);
    anchorEl.__sqaHost = host;
    anchorEl.__sqaShadowRoot = shadow;
    anchorEl.__sqaOverlayDiv = overlayDiv;
    anchorEl.__sqaOptionDiv = optionHighlightDiv;
  }
  return {
    host,
    overlayDiv: anchorEl.__sqaOverlayDiv,
    optionDiv: anchorEl.__sqaOptionDiv,
  };
}

function updatePositions(anchorEl, host, overlayDiv, optionDiv, targetOptionEl) {
  if (!anchorEl || !anchorEl.isConnected) return;
  const rect = anchorEl.getBoundingClientRect();
  const top = window.scrollY + rect.bottom + 4;
  const left = window.scrollX + Math.max(10, rect.left);
  overlayDiv.style.top = `${top}px`;
  overlayDiv.style.left = `${left}px`;

  // Position option highlight directly on the winning radio button
  if (targetOptionEl && targetOptionEl.isConnected) {
    const optRect = targetOptionEl.getBoundingClientRect();
    optionDiv.style.top = `${window.scrollY + optRect.top + (optRect.height / 2) - 12}px`;
    optionDiv.style.left = `${window.scrollX + optRect.right + 10}px`;
    optionDiv.style.display = "inline-flex";
  } else {
    optionDiv.style.display = "none";
  }
}

// Adaptive presentation according to question type
function showAdaptiveAnswer(anchorEl, containerEl, question, answerText, isLoading, provenance) {
  if (!isScanActive) return;
  const { host, overlayDiv, optionDiv } = createClosedShadowOverlay(anchorEl);

  if (isLoading) {
    overlayDiv.textContent = "Analyzing…";
    overlayDiv.classList.add("loading");
    optionDiv.style.display = "none";
    updatePositions(anchorEl, host, overlayDiv, optionDiv, null);
    return;
  }

  overlayDiv.classList.remove("loading");
  overlayDiv.innerHTML = "";

  // 1. Detect question type: MCQ (letter candidate) vs Open-Ended
  const matchLetter = answerText.match(/\b([A-D])\b[:.)\s]?/i) || answerText.match(/OPTION:\s*([A-D])/i);
  let optionLetter = matchLetter ? matchLetter[1].toUpperCase() : null;
  let targetOptionEl = null;

  if (optionLetter) {
    targetOptionEl = findOptionElement(containerEl, optionLetter);
    if (targetOptionEl) {
      optionDiv.textContent = `✓ Option ${optionLetter}`;
      optionDiv.style.display = "inline-flex";
    }

    const letterSpan = document.createElement("span");
    letterSpan.className = "screen-qa-letter";
    letterSpan.textContent = `Option [${optionLetter}]`;
    overlayDiv.appendChild(letterSpan);
  } else {
    optionDiv.style.display = "none";
  }

  // Answer text formatting
  const textNode = document.createTextNode(answerText);
  overlayDiv.appendChild(textNode);

  if (provenance && (provenance.includes("copilot_headless_fallback") || provenance.includes("copilot_fallback"))) {
    const badge = document.createElement("span");
    badge.className = "screen-qa-badge";
    badge.textContent = "Copilot";
    overlayDiv.appendChild(badge);
  }

  updatePositions(anchorEl, host, overlayDiv, optionDiv, targetOptionEl);
  activeOverlays.set(anchorEl, { host, overlayDiv, optionDiv, targetOptionEl, question, answerText });
}

function handleQuestionItem(item) {
  const { questionText, anchorNode, containerNode } = item;
  seen.add(questionText);
  showAdaptiveAnswer(anchorNode, containerNode, questionText, "", true);

  const contextBlock = hoistQuestionContext(containerNode, anchorNode, questionText);

  chrome.runtime.sendMessage(
    {
      type: "ANSWER_QUESTION",
      question: questionText,
      context: contextBlock,
      mode: "fast_hud",
    },
    (response) => {
      if (chrome.runtime.lastError) {
        showAdaptiveAnswer(anchorNode, containerNode, questionText, `Error: ${chrome.runtime.lastError.message}`, false);
        return;
      }
      if (response?.error) {
        showAdaptiveAnswer(anchorNode, containerNode, questionText, `Error: ${response.error}`, false);
        return;
      }
      showAdaptiveAnswer(
        anchorNode,
        containerNode,
        questionText,
        response?.answer || "(no answer)",
        false,
        response?.provenance
      );
    }
  );
}

// Clean up disconnected / stale overlays (e.g. Next button clicked on multi-page forms)
function cleanupStaleOverlays() {
  for (const [anchor, data] of activeOverlays.entries()) {
    if (!anchor || !anchor.isConnected) {
      if (data.host && data.host.parentNode) {
        data.host.parentNode.removeChild(data.host);
      }
      activeOverlays.delete(anchor);
    }
  }
}

function scan() {
  if (!isScanActive) return;

  // SPA / URL Transition Detection: Clear seen cache if navigating to new step
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    seen.clear();
  }

  cleanupStaleOverlays();

  const items = extractQuestions(document.body);
  for (const item of items) {
    handleQuestionItem(item);
  }
}

function debouncedScan() {
  clearTimeout(debouncedScan._t);
  debouncedScan._t = setTimeout(scan, 350);
}

// Passive repositioning and viewport discovery on scroll
window.addEventListener("scroll", () => {
  for (const [anchor, data] of activeOverlays.entries()) {
    if (anchor && anchor.isConnected) {
      updatePositions(anchor, data.host, data.overlayDiv, data.optionDiv, data.targetOptionEl);
    }
  }
  debouncedScan();
}, { passive: true });

// Listen for window resize
window.addEventListener("resize", () => {
  for (const [anchor, data] of activeOverlays.entries()) {
    if (anchor && anchor.isConnected) {
      updatePositions(anchor, data.host, data.overlayDiv, data.optionDiv, data.targetOptionEl);
    }
  }
}, { passive: true });

// Continuous MutationObserver: catches infinite scroll & Next-button step page transitions
const observer = new MutationObserver(() => {
  debouncedScan();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});

// Initial scan
debouncedScan();
