# Hermes Bots — Desktop Design System

## Product context

Hermes Bots is a private macOS-first Electron client for one remote Hermes Agent installation. It presents every Hermes profile as a persistent bot persona with its own avatar, role, canonical conversation, model, tools, skills, memory, and Telegram gateway. The app connects to the VPS through SSH; no Hermes HTTP port is exposed publicly.

Primary jobs:

- See every persona and recent conversation in one compact bot roster.
- Resume persistent Hermes sessions instantly.
- Create and configure a new persona without editing YAML or `.env` files.
- Connect a unique Telegram bot token and inspect gateway health.
- Review tool calls and approve sensitive actions without leaving chat.

Primary screens:

1. Bot chat — two-pane desktop shell with searchable bot/session roster and conversation.
2. New bot wizard — identity, role/SOUL, capabilities, Telegram, review.
3. Bot details — profile configuration, model, tools, skills, Telegram, service status.
4. Connection settings — SSH host/key/status and reconnect controls.

## Reference boundary

The supplied screenshot communicates the product pattern only: multiple persistent personas, fast switching, and a focused conversation workspace. Hermes Bots must not reproduce its trade dress, proportions, avatar language, bubble system, or sidebar composition.

Hermes Bots uses an original three-zone shell:

- An 84px vertical **Constellation Rail** for persona orbs and global navigation.
- A 300px **Thread Deck** for the selected persona's sessions, search, filters, and new-thread action.
- A flexible **Workspace** with a command header, transcript timeline, contextual activity strip, and docked command composer.

This architecture must be visually and structurally distinct from the two-pane reference while preserving the underlying speed of switching between bots.

## Visual language

Adopt only the high-contrast prompt's restrained monochrome principle and functional typography. Do not use its landing-page composition, oversized headlines, echo effects, editorial serif accents, masonry, or marketing treatments.

### Color tokens

- Window background: `#0c1012`
- Constellation rail: `#111719`
- Thread deck: `#151c1f`
- Workspace: `#0f1416`
- Elevated surface: `#1b2428`
- Selected surface: `#223138`
- Hover surface: `#1d292d`
- Composer surface: `#182125`
- Border strong: `#35454b`
- Border subtle: `rgba(193,225,231,0.11)`
- Primary text: `#edf5f6`
- Secondary text: `#a2b2b6`
- Muted text: `#687a7f`
- Hermes cyan: `#68d5df`
- Hermes amber: `#e4ad63`
- Success: `#55c98c`
- Warning: `#e5b96c`
- Danger: `#e87878`

No gradients or neon glow. Cyan is a precise navigational accent; amber marks autonomy, scheduled work, and approval boundaries.

### Typography

- Use the native macOS system stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`.
- App/title: 18–20px, weight 600.
- Conversation title: 16–17px, weight 600.
- Body/messages: 16px, weight 400, line-height 1.5.
- Secondary preview/time: 14px, weight 400.
- Controls and labels: 13px, weight 500.
- Avoid oversized display typography and decorative fonts.

### Geometry and spacing

- Use the native macOS title bar and traffic-light placement rather than drawing a branded copy inside the UI.
- Constellation rail width: 84px; Thread Deck width: 300px; command header height: 64px.
- Search radius: 9px; session-row radius: 10px.
- Assistant messages render as open transcript blocks with a slim cyan identity rule, not chat bubbles.
- User messages use compact tinted cards with 12px corners.
- Composer minimum height: 72px; 16px rounded rectangle; 1px border; integrated command/action footer.
- Standard spacing scale: 4, 8, 12, 16, 20, 24, 32px.
- Persona identity uses **constellation orbs**: layered rings, a small core, and unique orbital ticks. No faces, droplets, blobs, or character silhouettes.

### Shadows and materials

- Nearly flat surfaces. Use borders and value changes instead of floating card shadows.
- Window shadow may use `0 24px 80px rgba(0,0,0,0.55)`.
- Composer uses a restrained `0 10px 34px rgba(0,0,0,0.28)`.
- Backdrop blur only for the fixed composer/header when content scrolls beneath them.

### Icons

- Use consistent 1.75px outline icons, visually equivalent to Lucide.
- Icons are 18–20px; muted by default and white on hover.
- Avoid emoji for actions. Persona avatars may be geometric faces.

## Interaction patterns

- 120–160ms ease-out hover and selection transitions.
- Selected roster row changes surface color without translating or scaling.
- Streaming assistant text appears progressively with a quiet caret indicator.
- Tool activity collapses into slim inline status rows between messages.
- Approval requests appear as compact dark panels with Deny and Approve once actions.
- Composer grows vertically to a maximum of six lines.
- Cmd+K opens command search; Cmd+N starts a session; Cmd+Shift+N creates a bot.
- Connection loss shows a non-blocking amber strip and automatically retries.

## Bot chat composition

- Constellation Rail top: Hermes monogram, then persona orbs for Chief, Researcher, Ops, and PnL Analyst. The active orb has a cyan outer arc and a label tooltip. Bottom: connection status, settings, and account.
- Thread Deck top: selected persona name and role, compact new-thread button, then search and filter chips. Session rows show title, state glyph, preview, and relative time; selection uses a thin left accent plus a subtle surface shift.
- Workspace command header: breadcrumb (`Researcher / Memory systems`), live run state, context meter, and `Hermes VPS` connection capsule.
- Transcript is a chronological work log. Assistant turns are open text blocks with a narrow identity rule; user turns are compact right-aligned cards; tools and approvals are timeline events.
- A slim Activity Strip above the composer shows active tools, queued prompts, or pending approvals without interrupting the transcript.
- The composer is a docked rounded rectangle with textarea above and a command footer below: attach, slash commands, model/effort, and send/stop.

## New bot wizard

- Reuse the same application shell and surfaces.
- Step rail: Identity, Persona, Capabilities, Telegram, Review.
- Identity: avatar generator/picker, name, title, description.
- Persona: large SOUL editor plus concise behavioral presets.
- Capabilities: model selector, tools, skills, working directory, approvals mode.
- Telegram: BotFather token input, mention-only toggle, allowed users, connection test.
- Review: readable summary and Create bot action.
- Secret values are password inputs and never re-rendered in plain text.

## Responsive constraints

- Primary target: 1440×900 and larger macOS desktop windows.
- Minimum window: 1040×680.
- Below 1120px, sidebar reduces to 300px and conversation margins shrink.
- This is a desktop application, not a mobile web page. Do not collapse into mobile navigation in the primary design.

## Security UX

- Clearly distinguish local UI state from remote VPS state.
- Display the active VPS/profile near sensitive configuration controls.
- Never reveal stored SSH keys, API keys, or Telegram tokens.
- Destructive actions require confirmation and name matching.
- Terminal and mutation tools remain approval-gated by default.
