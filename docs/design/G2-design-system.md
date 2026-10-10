# G2 — Design tokens & core components

Owner: Gargi · Status: **v0 (2026-10-10)** · Code: `packages/ui`

**Done when** (master plan): typography, colors, spacing, tables, buttons, badges and dialogs are reusable.

## Direction

Restrained compute console (master plan §6): warm paper, ink-black type, electric-lime action accent, compact
tables, lightweight node visuals. No glassmorphism, gradient heroes, card-grid sprawl or decorative AI imagery.

## Tokens — `packages/ui/src/tokens.css`

| Group | Tokens | Rule |
| --- | --- | --- |
| Neutrals | `--pm-paper` `#f5f3ee`, `--pm-surface`, `--pm-surface-sunken`, `--pm-ink` `#111`, `--pm-ink-2`, `--pm-ink-3`, `--pm-line` | `ink-3` is the lightest allowed text colour |
| Accent | `--pm-lime` `#c8ff3c` (+ hover, press, tint) | **Fill only**, always with ink text. Never lime text on paper |
| Status | success / info / warning / danger / neutral, each fg + tint | Always paired with a text label + icon |
| Risk | `--pm-risk-{low,medium,high,blocked}-{fg,bg}` | Risk badge always shown with its reasons |
| Type | IBM Plex Sans / Plex Mono; 12–32px scale, base 14px | Mono for ids, digests, times |
| Space | 4px base, `--pm-space-1…8` | |
| Shape | radius 4 / 8 / 14; 1px hairline, 2px ink for the one key panel | |
| Motion | 120 / 200ms; zeroed under `prefers-reduced-motion` | |
| Focus | 2px ink ring + lime halo | Visible on every interactive element |

Contrast: `pnpm check:contrast` checks 24 text/background pairings — all pass WCAG AA (lowest 4.99:1).

## Components — `@powermesh/ui`

| Component | Use |
| --- | --- |
| `Button`, `buttonClassName` | primary (lime) · secondary · ghost · danger; `loading` keeps the label |
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
