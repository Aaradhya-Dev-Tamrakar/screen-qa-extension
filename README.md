# Screen Q&A — Continuous In-Page Question Answering via Gemini Flash

A lightweight Manifest V3 Chrome extension that autonomously monitors web page DOM mutations, detects question-like text prompts, queries the Google Gemini Flash API (`gemini-flash-latest`), and renders non-intrusive ambient floating overlays anchored to target questions in real time.

---

## Key Highlights

- **MutationObserver Continuous Scanning**: Unlike service workers that terminate on idle, scanning runs in the page content script context via `MutationObserver`, reacting seamlessly to infinite scroll and dynamic single-page applications (SPAs).
- **Gemini Flash Acceleration**: Direct connection to Google Gemini Flash API for rapid, high-concurrency answers.
- **Smart DOM Anchoring**: Uses `TreeWalker` to pinpoint the most specific DOM element containing question text and anchors ambient floating UI overlays.
- **Deduplication & Debouncing**: In-memory seen set with 500ms debounced scanning to prevent redundant API calls and rate-limiting.
- **Zero Heavy Build Step**: Written in clean, vanilla MV3 ES JavaScript with no complex bundling required.

---

## Directory Structure

```
screen-qa-extension/
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── background.js       # MV3 Service worker relay (Gemini API bridge)
├── content.js          # In-page DOM observer & overlay injector
├── manifest.json       # Manifest V3 extension configuration
├── options.html        # Settings page for API key configuration
├── options.js          # API key persistence in chrome.storage.local
├── overlay.css         # Dark theme floating overlay styles
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
6. Enter your Google Gemini API key (`AIza...`) and click **Save**.

### Phone pairing UI scaffold

The options page includes fields for a Lens service URL and a locally stored pairing token. Generate a token, save the settings, then copy the resulting pairing link. The QR preview is intentionally a placeholder; QR generation and a phone-side pairing service are not implemented yet. Do not treat the scaffold token as authentication until the Lens service validates it.

The local link-handling fixture at `tests/fixtures/pairing-link.html` can be opened with a `pairing_token` query parameter to verify that a generated link carries the expected parameter. It does not perform device pairing or contact a server.

---

## Architecture & Data Flow

```
[Web Page DOM] ──(MutationObserver)──> [content.js] ──(TreeWalker)──> Question Found
                                              │
                                   chrome.runtime.sendMessage
                                              │
                                              ▼
[Gemini Flash API] <──(fetch)── [background.js (Service Worker)]
        │                                     │
        └────── Return Answer Candidate ──────┘
                        │
                        ▼
                [content.js Overlay] (Anchored to DOM element)
```

---

## Repository Sync & Maintenance

This repository follows ecosystem standards using `sync.ps1`:

```powershell
# Routine automated sync
.\sync.ps1

# Custom semantic commit
.\sync.ps1 -m "feat(overlay): add markdown formatting support"

# Pull only with rebase
.\sync.ps1 -PullOnly
```
