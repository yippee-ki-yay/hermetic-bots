# Hermes Bots

A private macOS desktop control room for persistent Hermes Agent personas on a
secured remote VPS. Electron + React + TypeScript, connected exclusively
through an app-managed SSH tunnel — the Hermes dashboard is never exposed to
the public internet.

Built from [`HERMES-BOTS-BUILD-SPEC.md`](./HERMES-BOTS-BUILD-SPEC.md). Security
model: [`docs/SECURITY.md`](./docs/SECURITY.md).

## Layout

- Constellation Rail — persona orbs, add-bot, connection status, settings
- Thread Deck — sessions for the selected bot: search, filters, context menu
- Workspace — chronological work log: streamed messages, tool events,
  approval/clarify/sudo/secret panels, activity strip, command composer

## Development

```bash
npm install
npm run dev          # electron-vite dev (opens the app)
npm run typecheck    # main+preload and renderer TS projects
npm test             # vitest unit suite
npm run mock-server  # local Hermes REST + /api/ws mock on 127.0.0.1:9119
npm run package      # electron-builder --mac (packaging: electron-builder)
```

To run the app against the mock server without a VPS, start the mock server
and add an SSH alias to `~/.ssh/config` that forwards to localhost (or simply
run the renderer in a browser — without the preload bridge it boots into a
self-contained demo mode with fabricated data).

### Demo mode

`npm run build`, then serve `out/renderer` statically and open it in a
browser: the UI runs on an in-memory bridge with four sample personas,
streaming, tool events, and approval panels — useful for design review and
visual regression.

## Status

Phases 0–5 of the spec are implemented (hardened shell, tunnel + health,
roster/sessions, live chat, bot builder/details, Telegram + gateway ops).
Phase 6 packaging/signing/E2E automation is scaffolded but not exercised
against the real VPS yet — see §18.5 of the spec for the manual acceptance
checklist.
