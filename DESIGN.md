# Design — StudyFlow "Departure board, in glass"

A study week read like a printed transit timetable. Every task is a departure with a **planned** (scheduled) and a **studied** (actual) time. Source of truth for tokens: `frontend/src/styles.css` (`:root` and `[data-theme="dark"]`).

> **2026-11-12 update — materials.** The board now floats as liquid glass over a live sky. The structure, type, signal orange, route colours and Planned-vs-Studied mechanism below are unchanged; surfaces changed from solid ink/paper to glass. Where this note and the older sections disagree about surfaces, this note wins.
>
> - **Sky:** `frontend/src/three/Backdrop.jsx`, ShaderGradient (`@shadergradient/react` 2.4.20) on React Three Fiber 9, "Halo" plane geometry, `uSpeed` 0.12. Light: peach corner `#efbca7`, ice flank `#cbd9f4`, pale band `#f1eff9`, no grain. Dark: ember corner `#a8694f`, ink flank `#1f2c48`, harbour-teal band `#3f6f8a`, grain on. A CSS radial-gradient fallback in the same colours paints first; the canvas is lazy-loaded and fades in.
> - **Glass:** tokens `--glass`, `--glass-thick`, `--glass-sheen`, `--glass-rim`, `--glass-edge`, `--glass-shadow(-thick)`. Blur 18px (30px for the Now slab, dialog and phone tab bar). In Chromium an SVG `#liquid-glass` displacement filter refracts the live sky (the liquid-glass-js effect model, rebuilt to work over moving content); other browsers get frosted glass.
> - **Shell:** floating glass header (12px from the top, radius 22px) with its glass on `::before`, so the phone tab bar can stay `position: fixed`. On phones the nav is a floating glass capsule 12px above the bottom edge. Buttons, inputs, segmented filter and tags are pill-shaped.
> - **Focus ring:** `frontend/src/three/FocusRing.jsx`, an R3F torus arc in signal orange from 12 o'clock clockwise, a glowing bead at its head, and a glassy track. It tilts toward the pointer with damped, interruptible motion. Digits and status stay in HTML on top. CSS conic-gradient fallback.
> - **Accessibility:** reduced motion stops the sky and the ring tilt; reduced transparency skips the 3D sky and makes glass solid; high contrast raises tint opacity.
> - **2026-11-12 UX pass.** Overdue tasks live in a separate warm-tinted **Catch up** panel above the board (Focus, Today, Tomorrow, Move all to today); the board is a forward plan grouped Today / Coming up / Done (Done collapsed). No coloured rules between groups: Today is marked by a small signal dot. Any open task can be picked for focus; block length is 15, 25 or 45 minutes (default 25). Fluid colour: the Now panel carries a slow two-colour aura (`--aura-a`, `--aura-b`, registered with `@property`) that eases between late, today, on-track and in-focus moods, and the sky cools and slows while a block runs. Week tiles use a slim load meter mixing `--calm` to `--warm` in OKLCH by load. Plan changes animate with the View Transitions API (`view-transition-name: task-<id>`). Icons are lucide at 16px / 1.75 stroke; nav uses Timer, ListChecks, CalendarRange, ChartNoAxesColumn. Delete lives in the edit dialog. Film grain is off.
> - Reusable guidance lives in the personal skills `shader-gradient-backgrounds`, `liquid-glass-ui` and `react-three-fiber-web`.

## Colour

Strategy: committed shell, restrained work area. The ink-blue board owns the header and the Now panel; white paper carries the board, week and progress; signal orange is reserved for *now* and the single primary action.

| Role | Light | Dark | Used for |
|---|---|---|---|
| `--board` | `#13254a` | `#0a1428` | Header, Now panel, active segmented filter, primary "ink" button |
| `--board-2` | `#1b3160` | `#13213d` | Timer column of the Now panel |
| `--ground` / `--paper` | `#f3f5f8` / `#fff` | `#0d1626` / `#131e31` | Page / surfaces |
| `--ink` / `--ink-2` / `--muted` | `#0f1a2b` / `#3a475c` / `#5d697c` | `#e7ecf4` / `#b9c3d3` / `#95a2b6` | Text tiers |
| `--line` / `--line-strong` | `#e2e6ee` / `#c9d1dd` | `#223047` / `#33425c` | Hairlines / control borders |
| `--signal` | `#ff5b1f` | `#ff6a33` | Start focus, today marker, nav underline, timer rule, "now line" above Today |
| `--studied` | `#1f4fd8` | `#7c9bff` | Recorded focus time everywhere (never estimates) |
| `--late` / `--today` / `--done` | `#c4261b` / `#9a5400` / `#0f7049` | `#ff7a6b` / `#f2b544` / `#4cc58c` | Status only, each with a `-soft` background |
| `--route-0…3` | `#2d5bff` `#0a8f80` `#7b4dff` `#d6247a` | lighter equivalents | One colour per subject, assigned by subject order |

Rules: state colours appear only where they carry meaning. Planned time is drawn in ink; studied time is always `--studied`. A subject keeps its route colour in every view.

## Type

One family: **Archivo Variable** (self-hosted via `@fontsource-variable/archivo`, `wdth` axis), falling back to `system-ui`. Tabular figures throughout (`font-variant-numeric: tabular-nums` on `body`).

| Role | Size | Width | Weight | Tracking |
|---|---|---|---|---|
| Timer digits | clamp(60px, 7.4vw, 100px) | 112% | 600 | −0.035em |
| Now title | clamp(30px, 3.6vw, 46px) | 108% | 700 | −0.028em |
| Section heading (h2) | 26px (22px phone) | 112% | 700 | −0.02em |
| Figures | 20–30px | 110% | 650 | −0.02em |
| Body / table | 14.5–15px | 100% | 400–600 | 0 |
| Table column heads | 12px uppercase | 100% | 650 | +0.04em |

No eyebrow labels above headings; status lives in chips and tags.

## Shape and depth

Radii: 16px (Now panel, dialog), 12px (surfaces), 8px (controls), 6px (tags, bars). Surfaces are separated by 1px hairlines, not shadows; the only shadow (`--shadow-pop`) is for floating layers (profile menu, dialog). No boxes inside boxes.

## Components

- **Board header**: sticky, brand mark, nav with a 3px signal underline on the current section (scroll-spy), live status, clock with date, refresh, theme, avatar menu. On phones the nav becomes a translucent bottom tab bar.
- **Now panel**: status chip, subject route, title, Planned / Studied / This block facts, Start focus (signal) + Mark done or Reset (quiet), timer column with a linear progress rule.
- **Status line**: five figures in one hairline-divided strip; each is a filter shortcut.
- **Departures table**: groups Overdue → Today (signal rule above it) → Coming up → Done; columns Due, Task, Subject, Planned, Studied (figure + 3px track), Status, actions. Collapses to two-line rows on phones.
- **Week strip**: seven day tiles with a planned-load bar; today outlined in signal.
- **Progress**: studied-against-planned line per subject (route colour), and a 7-day focus bar chart ending today.
- Buttons: `signal` (one per view), `ink`, `quiet`, `icon-button`. Segmented filter, `select`, search input share 40px control height (32px inside the segmented control).

## Motion

Exponential ease-out `cubic-bezier(.22, 1, .36, 1)`. Press feedback on pointer-down (`scale(.97)`), menus and dialog scale in from their origin, the timer rule advances linearly each second. Theme changes fade colours only while a switch is in progress. `prefers-reduced-motion` removes transforms and transitions; `prefers-reduced-transparency` makes the phone tab bar solid; `prefers-contrast: more` darkens lines and muted text.
