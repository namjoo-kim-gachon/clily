# Clily Terminal Viewer

Use your browser as a mobile-friendly terminal client while keeping terminal sessions alive on the server.

## What You Can Do

- Keep terminal sessions alive even if you refresh or reconnect.
- Open multiple terminal sessions and switch between them.
- Send normal commands and shortcut sequences from the same UI.
- Restore recent terminal output after reconnect.
- Use swipe navigation on mobile and button navigation on desktop.

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Create environment file

```bash
cp .env.example .env
```

Default:

```env
PORT=3001
```

### 3) Run the app

```bash
npm run dev
```

Open:

- `http://localhost:3001` (or the port you set in `.env`)

## Core Usage Flow

1. Open the app and wait for the terminal view to load.
2. Type a command in the command input and press Enter.
3. Use **+** to create a new terminal session.
4. Switch sessions:
   - Mobile: swipe left/right on the terminal area.
   - Desktop: use previous/next buttons.
5. For shortcut input (for example `Ctrl+B D`), use the shortcut field and submit.
6. If you reload or reconnect, the app restores session state and recent output.

## Configuration

Set values in `.env`.

- `PORT`
  Next.js development server port.

- `TERMINAL_E2E_MODE=mock` (optional)
  Runs with a mock terminal runtime for deterministic E2E tests.

- `TERMINAL_BACKLOG_MAX_CHARS` (optional)
  Maximum number of terminal output characters kept for replay.

- `TERMINAL_DEBUG=1` (optional)
  Enables server-side terminal runtime debug logs.

- `NEXT_PUBLIC_TERMINAL_DEBUG=1` (optional)
  Enables client-side debug logs in the browser console.

## Troubleshooting

### Terminal does not start or shows runtime failure

This usually means `node-pty` cannot create a PTY in the current environment.

Try:

- Running from a local terminal session.
- Verifying shell availability and permissions on macOS/Linux.

### Reconnect did not show expected output

- Check whether backlog retention is large enough (`TERMINAL_BACKLOG_MAX_CHARS`).
- Enable debug logs (`TERMINAL_DEBUG=1`, `NEXT_PUBLIC_TERMINAL_DEBUG=1`) and inspect server/browser logs.

### E2E tests behave differently from local runtime

- Confirm whether you are running mock mode (`TERMINAL_E2E_MODE=mock`).
- Remember that E2E is designed for deterministic behavior and may not mirror full local shell behavior.

## FAQ

### Does this create a new terminal every time I reconnect?

No. Sessions are managed server-side and persist across browser reconnects during server process lifetime.

### Can I use multiple terminals?

Yes. Create additional sessions with the **+** button and switch between them.

### Which shortcut inputs are supported?

You can send key-like expressions such as `Ctrl+B`, `Shift+Tab`, arrow keys, `Esc`, and more through the shortcut input flow.

### Is this production-ready with persistent storage?

Not yet. Current behavior focuses on in-memory session management during server runtime.

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
