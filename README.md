# Screen Q&A — Continuous In-Page Question Answering via Fleet-Orchestrator & Gemini Flash

A lightweight Manifest V3 Chrome extension that autonomously monitors web page DOM mutations, detects question-like text prompts and assessment cards, queries the Fleet-Orchestrator 31-worker pool (or standalone Google Gemini Flash API), and renders non-intrusive ambient floating overlays inside a closed Shadow DOM.

---

## Key Highlights

- **MutationObserver Continuous Scanning**: Scanning runs in the page content script context via `MutationObserver`, reacting seamlessly to infinite scroll, multi-page forms, and dynamic single-page applications (SPAs).
- **Hybrid Fleet-Orchestrator & Gemini Flash Routing**: Primary routing through Fleet-Orchestrator (`http://127.0.0.1:8000/api/v1/qa/ask`) with automatic zero-downtime fallback to standalone Gemini Flash (`gemini-flash-latest`).
- **Closed Shadow DOM HUD**: Renders right/left-gutter floating overlays and MCQ option badges inside a closed Shadow Root with hover-fade transparency and `Alt+Q` toggle control.
- **SidePanel Study Companion**: Built-in Chrome SidePanel (`sidepanel.html`) for reviewing detected questions, re-verifying answers, staging to OmniVault, and pushing answers via LocalSend.
- **Dual Wireless Phone Relay**: Supports both the **Screen Lens PWA** (with offline QR code pairing) and **LocalSend LAN Relay** (port `53317` UDP multicast discovery + REST payload push).

---

## Directory Structure

```
screen-qa-extension/
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── tests/
│   └── fixtures/
│       ├── pairing-link.html
│       └── test_quiz_dom.html
├── background.js       # MV3 Service worker (Fleet/Gemini router + LocalSend LAN relay)
├── content.js          # In-page DOM observer & closed Shadow DOM HUD injector
├── manifest.json       # Manifest V3 extension configuration
├── options.html        # Settings UI (API key, Screen Lens QR pairing, LocalSend toggle)
├── options.js          # Settings persistence, port probing & LocalSend LAN scanner
├── overlay.css         # Floating overlay base styles
├── qrcode.js           # Zero-dependency offline QR code generator
├── sidepanel.html      # Chrome SidePanel study companion UI
├── sidepanel.js        # SidePanel question list, OmniVault staging & LocalSend trigger
├── sync.bat            # Zero-friction Windows wrapper for sync.ps1
├── sync.ps1            # Ecosystem Git sync & secret detection engine
├── AGENTS.md           # Agent guidelines & verification workflows
├── LICENSE             # MIT License
└── README.md           # Documentation
```

---

## Installation & Setup

1. Clone or download this repository.
2. Open Google Chrome (or any Chromium browser: Brave, Edge, Arc) and navigate to:
   ```
   chrome://extensions
   ```
3. Enable **Developer mode** toggle in the top right corner.
4. Click **Load unpacked** and select the `screen-qa-extension` directory.
5. Right-click the extension icon in your browser toolbar, select **Options** (or open details > Extension options).
6. Enter your Google Gemini API key (`AIza...`) if running standalone without the local Fleet-Orchestrator server, and click **Save API key**.

### Phone Pairing (Screen Lens PWA & LocalSend Wireless Relay)

The extension supports two wireless phone delivery routes configured in `options.html`:

1. **Screen Lens PWA + Offline QR Pairing**:
   - Configure the Lens service URL (e.g., `http://192.168.1.5:8000/lens`) and generate a local pairing token.
   - `qrcode.js` renders a self-contained offline QR code directly in the options page. Scan the QR code with your phone camera on the same Wi-Fi network to launch the Screen Lens HUD.
   - The local link-handling fixture at `tests/fixtures/pairing-link.html` can be opened with a `pairing_token` query parameter to verify URL parameter generation offline.

2. **LocalSend Wireless Answer Relay (Port 53317)**:
   - Open [LocalSend](https://localsend.org) on your phone or tablet connected to the same Wi-Fi/LAN.
   - In `options.html`, enable the **Send via LocalSend** checkbox under **Wireless Answer Relay (LocalSend LAN)**.
   - **Auto-Discovery or Manual Host**: Click **Scan LAN for LocalSend devices** to discover active LocalSend instances via UDP multicast (`224.0.0.167:53317`) and REST `/api/localsend/v2/info` probing, or enter your phone's LAN IP directly (default port `53317`, HTTP or HTTPS).
   - **Structured Payload Delivery**: Whenever an answer is generated (or when clicking **Send test answer** in Options or **LocalSend** in the SidePanel), `background.js` POSTs a structured payload (`question`, `answer`, `option_letter`, `confidence`, `provenance`) to `/api/localsend/v2/prepare-upload` (and `/upload` when session tokens are issued).
   - **Graceful Fallback**: If no LocalSend instance is found on the LAN or the receiver is unreachable, `background.js` falls back gracefully to the existing Screen Lens PWA route without interrupting in-page overlays.

---

## Architecture & Data Flow

```
[Web Page DOM] ──(MutationObserver)──> [content.js] ──(Container Hoisting)──> Question Found
                                              │
                                   chrome.runtime.sendMessage
                                              │
                                              ▼
[Fleet-Orchestrator :8000 / Gemini Flash] <── [background.js (Service Worker)]
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     ▼                                                 ▼
      [content.js Closed Shadow HUD]                 [LocalSend LAN :53317 / Screen Lens PWA]
```

---

## Repository Sync & Maintenance

This repository follows ecosystem standards using `sync.bat` / `sync.ps1`:

```powershell
# Routine automated sync
.\sync.bat

# Custom semantic commit
.\sync.bat -m "feat(localsend): add wireless answer relay to phone (#3)"

# Pull only with rebase
.\sync.bat -PullOnly
```
