// content.js — Screen Q&A v0.4.0 (Adaptive Question HUD & Continuous Multi-Page Perception)
// Operates passively in closed Shadow DOM with pointer-events transparency.
// Zero hotkey reliance, zero mouse interception, self-healing multi-page cleanup.

const QUESTION_RE = /[^.!?\n]{8,350}\?/g;
const seen = new Set();
let isScanActive = true;
const activeOverlays = new Map();
let lastUrl = window.location.href;
let _pendingRequests = 0;
const MAX_CONCURRENT_REQUESTS = 3; // Throttle to avoid 429 bursts
const REQUEST_STAGGER_MS = 600;    // Minimum gap between API calls

// Closed Shadow DOM CSS
const SHADOW_STYLE = `
  :host {
    all: initial;
  }
  .screen-qa-overlay {
    position: absolute;
    z-index: 2147483647;
    max-width: 320px;
    padding: 8px 12px;
    background: rgba(15, 17, 23, 0.95);
    color: #f1f5f9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    line-height: 1.4;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.16);
    backdrop-filter: blur(8px);
    pointer-events: auto; /* Allows hover and interaction without blocking quiz clicks */
    transition: opacity 0.2s ease, transform 0.2s ease;
  }
  .screen-qa-overlay:hover {
    opacity: 0.2; /* Subtly fades away completely on hover so you can read beneath if needed */
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

  // Skip Google Forms viewscore/review pages (already submitted — no point answering)
  const url = window.location.href.toLowerCase();
  const isViewScore = url.includes("viewscore") || 
                      url.includes("viewanalytics") || 
                      url.includes("formResponse") ||
                      document.querySelector('.freebirdFormviewerViewResponseConfirmationMessage') !== null ||
                      document.querySelector('.freebirdFormviewerViewHeaderGrade') !== null ||
                      document.querySelector('[data-item-id]')?.querySelector('span[aria-label*="points"]') !== null;

  if (isViewScore) {
    cleanupAllOverlays();
    return [];
  }

  const results = [];

  // 1. Google Forms & assessment card containers
  const assessmentContainers = root.querySelectorAll(
    'div[role="listitem"], .geSWh, .freebirdFormviewerViewNumberedItemContent, .que, .question-view, .question-card, .question, [class*="question-card"], [class*="question_card"], [class*="QuestionCard"], [data-question-id], fieldset'
  );

  for (const container of assessmentContainers) {
    let headingEl = container.querySelector(
      'div[role="heading"], .M7eMe, .qtext, .q-text, [class*="q-text"], [class*="question-text"], [class*="question_text"], [class*="QuestionText"], .prompt, h2, h3, h4, legend'
    );
    if (!headingEl) {
      headingEl = container.querySelector('p, strong, b');
    }
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

  // Google Forms radio buttons, custom quiz options, and labels
  const radios = containerEl.querySelectorAll(
    'div[role="radio"], div[role="checkbox"], label, div.docssharedWizToggleLabeledContainer, .answer div, .option, .option-item, [class*="option-item"], [class*="optionItem"], [class*="choice"], li'
  );

  if (radios.length > 0) {
    // Check if explicitly matching letter prefix or span with letter
    for (const r of radios) {
      const text = (r.innerText || r.textContent || "").trim();
      if (
        text.startsWith(letter + ")") ||
        text.startsWith(letter + ".") ||
        text.startsWith(letter + ":") ||
        text.startsWith(`Option ${letter}`) ||
        text.startsWith(`(${letter})`) ||
        new RegExp(`^\\s*${letter}\\b`, "i").test(text)
      ) {
        return r;
      }
    }
    if (letterIndex >= 0 && letterIndex < radios.length) {
      return radios[letterIndex];
    }
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

  // Position overlay safely to the RIGHT side or left gutter, NEVER covering question or choices
  const viewportWidth = window.innerWidth;
  const preferredRight = window.scrollX + rect.right + 18;
  const fitsRight = (rect.right + 340) < viewportWidth;

  if (fitsRight) {
    overlayDiv.style.left = `${preferredRight}px`;
    overlayDiv.style.top = `${window.scrollY + rect.top}px`;
  } else {
    // Left-gutter placement or top-banner above question
    const leftGutter = window.scrollX + Math.max(12, rect.left - 335);
    if (rect.left > 340) {
      overlayDiv.style.left = `${leftGutter}px`;
      overlayDiv.style.top = `${window.scrollY + rect.top}px`;
    } else {
      // Float neatly directly above question text
      overlayDiv.style.left = `${window.scrollX + rect.left}px`;
      overlayDiv.style.top = `${window.scrollY + Math.max(10, rect.top - 46)}px`;
    }
  }

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
    activeOverlays.set(anchorEl, {
      host,
      overlayDiv,
      optionDiv,
      targetOptionEl: null,
      question,
      answerText: "Analyzing…",
      provenance: ["fleet_pool"],
    });
    return;
  }

  overlayDiv.classList.remove("loading");
  overlayDiv.innerHTML = "";

  // 1. Detect question type: MCQ (letter candidate) vs Open-Ended
  const matchLetter =
    answerText.match(/(?:^|\b)(?:Option\s*[:\-\[]?\s*)?([A-D])(?:\b|[)\]:.\-\s])/i) ||
    answerText.match(/OPTION:\s*([A-D])/i);
  let optionLetter = matchLetter ? matchLetter[1].toUpperCase() : null;
  let targetOptionEl = null;

  if (optionLetter) {
    targetOptionEl = findOptionElement(containerEl, optionLetter);
    if (targetOptionEl) {
      optionDiv.textContent = `✓ Option ${optionLetter}`;
      optionDiv.style.display = "inline-flex";
      try {
        targetOptionEl.style.outline = "2px solid #22c55e";
        targetOptionEl.style.outlineOffset = "2px";
        targetOptionEl.style.backgroundColor = "rgba(34, 197, 94, 0.14)";
        targetOptionEl.style.borderRadius = "6px";
      } catch (_) {}
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

  if (provenance && (provenance.includes("copilot_headless_fallback") || provenance.includes("copilot_fallback") || provenance.includes("fleet_pool"))) {
    const badge = document.createElement("span");
    badge.className = "screen-qa-badge";
    badge.textContent = "Copilot Fleet";
    overlayDiv.appendChild(badge);
  }

  updatePositions(anchorEl, host, overlayDiv, optionDiv, targetOptionEl);
  activeOverlays.set(anchorEl, {
    host,
    overlayDiv,
    optionDiv,
    targetOptionEl,
    question,
    answerText,
    provenance: provenance || ["fleet_pool"],
  });
}

function removeOverlay(anchorNode) {
  const data = activeOverlays.get(anchorNode);
  if (data && data.host && data.host.parentNode) {
    data.host.parentNode.removeChild(data.host);
  }
  activeOverlays.delete(anchorNode);
}

// Resilient queue to prevent dropping questions and avoid 429 rate limit bursts
const requestQueue = [];
let isProcessingQueue = false;

function enqueueQuestion(item) {
  requestQueue.push(item);
  processQueue();
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    if (!isScanActive) {
      requestQueue.length = 0;
      break;
    }

    const item = requestQueue.shift();
    await processQuestionItem(item);
    if (requestQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_STAGGER_MS));
    }
  }

  isProcessingQueue = false;
}

function processQuestionItem(item) {
  return new Promise((resolve) => {
    const { questionText, anchorNode, containerNode } = item;
    const contextBlock = hoistQuestionContext(containerNode, anchorNode, questionText);

    chrome.runtime.sendMessage(
      {
        type: "ANSWER_QUESTION",
        question: questionText,
        context: contextBlock,
        mode: "fast_hud",
      },
      (response) => {
        if (chrome.runtime.lastError || response?.error) {
          console.warn("[Screen Q&A Backend Error]", chrome.runtime.lastError?.message || response?.error);
          removeOverlay(anchorNode);
        } else {
          showAdaptiveAnswer(
            anchorNode,
            containerNode,
            questionText,
            response?.answer || "(no answer)",
            false,
            response?.provenance
          );
        }
        resolve();
      }
    );
  });
}

function handleQuestionItem(item) {
  const { questionText, anchorNode, containerNode } = item;
  seen.add(questionText);
  showAdaptiveAnswer(anchorNode, containerNode, questionText, "", true);
  enqueueQuestion(item);
}

// Clean up all overlays
function cleanupAllOverlays() {
  for (const [anchor, data] of activeOverlays.entries()) {
    if (data.host && data.host.parentNode) {
      data.host.parentNode.removeChild(data.host);
    }
  }
  activeOverlays.clear();
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
  console.log(`[Screen Q&A] Scanned page; detected ${items.length} question(s)`);
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

// Listen for toggle scan commands from background / Alt+Q
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TOGGLE_SCAN") {
    isScanActive = Boolean(message.isActive);
    if (!isScanActive) {
      cleanupAllOverlays();
    } else {
      debouncedScan();
    }
    sendResponse({ ok: true, isScanActive });
    return true;
  }
  if (message?.type === "TRIGGER_SCAN") {
    console.log("[Screen Q&A] Manual scan triggered via SidePanel/HotKey");
    isScanActive = true;
    seen.clear();
    scan();
    sendResponse({ ok: true, count: activeOverlays.size });
    return true;
  }
  if (message?.type === "GET_PAGE_QUESTIONS") {
    const list = Array.from(activeOverlays.values()).map((d) => ({
      question: d.question,
      answer: d.answerText,
    }));
    sendResponse({ questions: list });
    return true;
  }
});

console.log("[Screen Q&A v0.4.0] Continuous HUD active on:", window.location.href);
debouncedScan();
window.addEventListener("load", debouncedScan);
