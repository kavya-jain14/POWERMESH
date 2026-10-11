# G2 — Design tokens & core components

Owner: Gargi · Status: **v1 — theme "2077" (2026-10-10)** · Code: `packages/ui`

**Done when** (master plan): typography, colors, spacing, tables, buttons, badges and dialogs are reusable.

## Direction

**Theme: "2077"** from the tweakcn community (playful tag, by Evan Jacobs), dark variant: black canvas, white
type, coral-red `#d6544b` action accent, square corners, Chakra Petch + IBM Plex Mono. It replaces the v0
paper/ink/lime direction from master plan §6 (Gargi's call under §8 decision rights). Still a restrained compute
console: compact tables, lightweight node visuals, no glassmorphism, gradient heroes or decorative AI imagery.

Where we deliberately depart from the raw theme (safety > fidelity):

- **Danger is its own crimson** (`--pm-danger-fill` `#ea1330`, white text). In 2077, destructive = primary; here
  "Stop job" must never look like "Approve once".
- **LOW risk and "healthy" are green**, not the accent. A red-family "safe" signal would mislead.
- Status colours come from the theme's chart palette (orange `#e68933`, yellow `#d4ce21`, blue `#2f75e4`
  lightened to `#6ea4f5` for AA) plus a green the theme lacks.
- Panels are lifted to `#0a0a0a` and hairlines to `#262626` (theme: `#000` / `#222`) so structure survives on black.
- Only the dark variant ships. 2077's light variant has white borders on white, so it shows no structure.

## Tokens — `packages/ui/src/tokens.css`

| Group | Tokens | Rule |
| --- | --- | --- |
| Neutrals | `--pm-paper` `#000`, `--pm-surface` `#0a0a0a`, `--pm-surface-sunken` `#1c1c17`, `--pm-ink` `#fff`, `--pm-ink-2`, `--pm-ink-3`, `--pm-line` | `ink-3` is the dimmest allowed text colour; `color-scheme: dark` |
| Accent | `--pm-accent` `#d6544b` (+ hover, press, tint), `--pm-on-accent` `#000`, `--pm-accent-text` | Text on an accent fill is always `--pm-on-accent`. Accent text on dark wells uses `--pm-accent-text` |
| Danger fill | `--pm-danger-fill` `#ea1330` (+ hover), `--pm-on-danger` `#fff` | Destructive buttons, stopped milestones, kill-bar border. `--pm-danger` is the text tone |
| Status | success / info / warning / danger / neutral, each fg + tint | Always paired with a text label + icon |
| Risk | `--pm-risk-{low,medium,high,blocked}-{fg,bg}` | Risk badge always shown with its reasons |
| Type | Chakra Petch / IBM Plex Mono; 12–32px scale, base 14px | Mono for ids, digests, times |
| Space | 4px base, `--pm-space-1…8` | |
| Shape | radius 0 everywhere (status dots and timeline markers stay round); 1px hairline, 2px `--pm-line-strong` for key panels | |
| Motion | 120 / 200ms; zeroed under `prefers-reduced-motion` | |
| Focus | 2px white ring + coral halo | Visible on every interactive element |

Contrast: `pnpm check:contrast` checks 35 text/background pairings — all pass WCAG AA (lowest 4.53:1: white on
`#ea1330`, the danger button and BLOCKED badge).

## Components — `@powermesh/ui`

| Component | Use |
| --- | --- |
| `Button`, `buttonClassName` | primary (coral, black text) · secondary · ghost · danger (crimson, white text); `loading` keeps the label |
| `Badge`, `RiskBadge`, `StatusDot` | text-first status; colour reinforces, never replaces |
| `Banner`, `EmptyState`, `Skeleton`, `Spinner` | degraded / blocked / empty / loading states |
| `Panel`, `KeyValue` | sections and label/value facts; `strong` and `accent` variants |
| `Table`, `Mono` | compact tables in a keyboard-scrollable region; cells don't wrap unless marked `.wrap` |
| `Dialog` | native `<dialog>` (focus trap, Esc, inert background); `center` or `sheet`; `initialFocusRef` |
| `Field`, `TextInput`, `Select`, `Toggle`, `ChoiceGroup` | label/hint/error wiring with `aria-describedby` / `aria-invalid` |
| `Digest` | shortened hash + copy button |
| `ProgressBar`, `LimitMeter` | `role=progressbar` / `role=meter` with text values |
| `AnnouncerProvider`, `useAnnouncer` | polite/assertive live regions; de-duplicated; state transitions only |
| `Icon` | 16px stroke set, decorative unless labelled |

## Decisions

- Native `<dialog>` instead of a dialog library: correct focus trap and inert background for free, no dependency.
- Approval Sheet focuses **Decline** first; the emergency Stop dialog focuses **Stop now** first (speed matters, and
  it's already behind an explicit click or Ctrl + .).
- No `dangerouslySetInnerHTML` anywhere. Untrusted output is only ever an `<img>` of an allowlisted raster type.
