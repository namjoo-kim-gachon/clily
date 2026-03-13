# Clily Terminal Viewer

<p align="center">
  <img src="src/app/icon.svg" alt="Clily Icon" width="120" />
</p>

[![Build Workflow](https://github.com/namjoo-kim-gachon/clily/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/namjoo-kim-gachon/clily/actions/workflows/build.yml)
[![Test Workflow](https://github.com/namjoo-kim-gachon/clily/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/namjoo-kim-gachon/clily/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Use your browser as a mobile-friendly terminal client while keeping terminal sessions alive on the server.

## What You Can Do

- Keep terminal sessions alive even if you refresh or reconnect.
- Open multiple terminal sessions and switch between them.
- Send normal commands and shortcut sequences from the same UI.
- Restore recent terminal output after reconnect.
- Use swipe navigation on mobile and button navigation on desktop.
- Install as a PWA (standalone app experience) on supported browsers.
- Receive browser notifications when terminal output stays idle for 30 seconds.

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Run the app

```bash
npm run dev
```

Open:

- `http://localhost:3000` (default Next.js dev port)

## Core Usage Flow

1. Open the app and wait for the terminal view to load.
2. Type a command in the command input and press Enter.
3. Use **+** to create a new terminal session.
4. Switch sessions:
   - Mobile: swipe left/right on the terminal area.
   - Desktop: use previous/next buttons.
5. For shortcut input (for example `Ctrl+B D`), use the shortcut field and submit.
6. If you reload or reconnect, the app restores session state and recent output.


## Troubleshooting

### Terminal does not start or shows runtime failure

This usually means `node-pty` cannot create a PTY in the current environment.

Try:

- Running from a local terminal session.
- Verifying shell availability and permissions on macOS/Linux.


## FAQ

### Does this create a new terminal every time I reconnect?

No. Sessions are managed server-side and persist across browser reconnects during server process lifetime.

### Can I use multiple terminals?

Yes. Create additional sessions with the **+** button and switch between them.

### Which shortcut inputs are supported?

You can send key-like expressions such as `Ctrl+B`, `Shift+Tab`, arrow keys, `Esc`, and more through the shortcut input flow.

### Is this production-ready with persistent storage?

Not yet. Current behavior focuses on in-memory session management during server runtime.

### Does it support PWA install?

Yes. The app includes a web manifest (`/manifest.webmanifest`) and registers a service worker (`/sw.js`) so you can install it as a standalone app on supported browsers.

### How do idle notifications work?

The app requests browser notification permission and sends a notification when the active terminal view has no visible changes for 30 seconds. Identical idle states are deduplicated to avoid repeated alerts.

## For Contributors

- Run quality checks:

```bash
npm run lint
npm run typecheck
npm test
```

- Run E2E tests:

```bash
npm run test:e2e
```

- Optional UI mode:

```bash
npm run test:e2e:ui
```
