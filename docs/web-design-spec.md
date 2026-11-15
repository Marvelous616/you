# Life Logger Web App — Design Spec

> **Status:** Draft 1 (Increment 3.9.6)  
> **Applies to:** Web app only. Phone screens are left out of this spec.  
> **Palette:** Restrained neutral, dark theme. No emojis.

---

## 1. Design Principles

1. **Dark by default.** The app is used at all hours; a dark background reduces glare.
2. **Neutral accent.** Indigo is the only accent color, used sparingly for primary actions and status.
3. **No emojis.** Text and icons (system glyphs only) carry meaning.
4. **Frictionless capture.** Quick entry is the primary interaction; it loads focused and ready to type.
5. **Timeline first.** The day timeline is the central visual element; everything else orbits it.
6. **No surprises.** Empty states explain what to do. Errors explain what happened and what to try next.

---

## 2. Design Tokens

All tokens are defined in `apps/web/src/index.css` as CSS custom properties.

### 2.1 Colors

| Token | Value | Use |
|-------|-------|-----|
| `--color-bg` | `#0f172a` | Page background |
| `--color-surface` | `#1e293b` | Cards, panels, modal |
| `--color-surface-hover` | `#334155` | Hovered surfaces |
| `--color-border` | `#334155` | Card borders, dividers |
| `--color-border-hover` | `#475569` | Hovered borders |
| `--color-text-primary` | `#f8fafc` | Headlines, important text |
| `--color-text-secondary` | `#cbd5e1` | Body text, labels |
| `--color-text-muted` | `#94a3b8` | Captions, metadata, placeholders |
| `--color-text-inverse` | `#0f172a` | Text on accent backgrounds |
| `--color-accent` | `#818cf8` | Primary buttons, active states |
| `--color-accent-hover` | `#a5b4fc` | Primary button hover |
| `--color-accent-text` | `#1e1b4b` | Text on accent backgrounds |
| `--color-success` | `#34d399` | Success states, coverage fill |
| `--color-success-bg` | `#064e3b` | Success badge background |
| `--color-warning` | `#fbbf24` | Warning states |
| `--color-warning-bg` | `#713f12` | Warning badge background |
| `--color-error` | `#f87171` | Error states |
| `--color-error-bg` | `#450a0a` | Error badge background |
| `--color-wake` | `#22d3ee` | Wake time badge |
| `--color-sleep` | `#c084fc` | Sleep time badge |
| `--color-gap` | `rgba(148, 163, 184, 0.14)` | Unlogged gap blocks |

### 2.2 Spacing

| Token | Value | Use |
|-------|-------|-----|
| Card padding | `20px` | Standard card inner padding |
| Card compact padding | `16px` | Smaller cards |
| Section gap | `20px` | Between cards |
| Field gap | `6px` | Label to input |
| Field margin bottom | `16px` | Between form fields |
| Button padding | `8px 16px` | Standard buttons |
| Button small padding | `4px 10px` | Compact buttons |

### 2.3 Typography

| Token | Value | Use |
|-------|-------|-----|
| Base font size | `14px` | Body text |
| H1 | `1.5rem` | Page titles |
| H2 | `1.125rem` | Section titles |
| H3 | `1rem` | Card titles |
| Card title | `0.72rem` uppercase, letter-spaced | Section labels |
| Caption | `0.7rem` | Metadata, hints |
| Monospace numbers | `tabular-nums` | Times, durations, counts |

### 2.4 Borders & Radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | `6px` | Buttons, inputs, small chips |
| `--radius-md` | `10px` | Cards |
| `--radius-lg` | `14px` | Large cards, modal |
| `--radius-full` | `9999px` | Badges, pills |

### 2.5 Shadows

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | Subtle depth |
| `--shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.1)...` | Cards |
| `--shadow-lg` | `0 24px 64px rgba(0, 0, 0, 0.5)` | Modal backdrop |

### 2.6 Transitions

| Token | Value | Use |
|-------|-------|-----|
| `--transition-fast` | `150ms cubic-bezier(0.4, 0, 0.2, 1)` | Hover states |
| `--transition-base` | `250ms cubic-bezier(0.4, 0, 0.2, 1)` | Coverage bar, expansions |

---

## 3. Layout Shell

The app uses a fixed shell:

```
.shell (flex column, 100vh, overflow hidden)
├── .header (fixed height 64px, border bottom)
│   ├── .brand (LL + Life Logger)
│   └── .nav (date chip, server status)
├── .content (flex 1, overflow-y auto, max-width 960px centered)
│   └── cards, timeline, forms
└── .footer (border top, version info)
```

### 3.1 Header

- **Brand:** `LL` accent monogram + "Life Logger" text, font-weight 700.
- **Nav items:** Date chip (current local date), server status indicator.
- **Server status:** Pill with colored dot (green online, red offline) + label ("online", "offline", "checking…"). Retry button (icon only) when offline.

### 3.2 Content

- Max-width `960px`, centered, `24px` padding.
- Cards stacked vertically with `20px` gaps.

### 3.3 Footer

- Border top, muted text, `0.75rem`, centered.
- Shows: "Life Logger · schema · sync protocol" (version injected at runtime).

---

## 4. Components

### 4.1 Card

- Background: `--color-surface`
- Border: `1px solid --color-border`
- Border-radius: `--radius-lg`
- Padding: `20px` (or `16px` for compact)
- Margin-bottom: `20px`

### 4.2 Card Header

- Flex row, space-between
- Title: `0.72rem`, uppercase, letter-spaced `0.07em`, `--color-text-muted`, font-weight 700
- Margin-bottom: `16px`

### 4.2 Buttons

| Variant | Background | Text | Border | Use |
|---------|-----------|------|--------|-----|
| Primary | `--color-accent` | `--color-accent-text` | none | Main actions |
| Secondary | `--color-surface-hover` | `--color-text-secondary` | `1px solid --color-border` | Secondary actions |
| Ghost | transparent | `--color-text-muted` | none | Tertiary actions |
| Icon | transparent | `--color-text-muted` | none | Icon-only buttons (close, retry) |

All buttons: `border-radius: --radius-md`, font-weight 600, `0.82rem`, transitions on hover.

### 4.3 Inputs & Textareas

- Background: `#0f172a`
- Border: `1px solid --color-border`
- Border-radius: `--radius-md`
- Color: `--color-text-primary`
- Padding: `10px 12px`
- Focus: outline none, border-color `--color-accent`, box-shadow `0 0 0 3px rgba(129, 140, 248, 0.15)`

### 4.4 Badges

| Variant | Background | Text | Border | Use |
|---------|-----------|------|--------|-----|
| Neutral | `--color-surface-hover` | `--color-text-secondary` | none | Generic labels |
| Wake | `rgba(34,211,238,0.15)` | `--color-wake` | `1px solid rgba(34,211,238,0.3)` | Wake time |
| Sleep | `rgba(192,132,252,0.15)` | `--color-sleep` | `1px solid rgba(192,132,252,0.3)` | Sleep time |
| Approx | `#0f172a` | `--color-text-secondary` | `1px solid --color-border` | Approximate times |

All badges: `border-radius: --radius-full`, padding `2px 8px`, `0.65rem`, font-weight 600.

### 4.5 Timeline

- Container: `#0f172a` background, border, border-radius `--radius-lg`, overflow hidden
- Header: `--color-surface` background, border bottom, time labels at start/middle/end
- Body: relative, min-height `100px`
- Track: absolute, pointer-events none
- Gaps: `rgba(148,163,184,0.14)` background, dashed borders, positioned absolutely
- Events: `#475569` background, `1px solid #64748b` border, border-radius `6px`, height `34px`, positioned absolutely in lanes
- Event hover: background `#64748b`, border-color `#94a3b8`
- Event title: `0.72rem`, font-weight 700, `--color-text-primary`, truncated
- Event time: `0.62rem`, `--color-text-secondary`, truncated
- Event tags: `0.6rem`, `--color-text-muted`, truncated
- Empty state: italic, `--color-text-muted`, centered, `48px` padding
- Axis: start/middle/end time labels, `0.7rem`, `--color-text-muted`

### 4.6 Quick Entry

- Card with header "Quick Entry"
- Form: input flex + primary button full width
- Input: placeholder "lunch with @rahul at 1pm #food/lunch"
- Preview: shows parsed title, time, tags (#chips), people (@chips) when text is valid
- Suggestion chips: clickable tag/people pills inserted into input on click
- Error: red text below form

### 4.7 Event List

- Row: flex, gap `12px`, padding `10px 0`, border bottom `1px solid --color-border`
- Time: `64px` min-width, `--color-text-secondary`, font-weight 700, `0.82rem`
- End time: `0.7rem`, `--color-text-muted`, or "point" for marker-style events
- Title: `0.9rem`, font-weight 600, `--color-text-primary`
- Meta: source badge + tag chips

### 4.8 Markers

- Item: flex, gap `14px`, padding `12px 14px`, `--color-surface` background, border-radius `--radius-md`
- Left border: `4px solid` — accent if note present, muted otherwise
- Time: `78px` min-width, `--color-text-secondary`, font-weight 600
- Text: `--color-text-primary`, `0.95rem`; empty shows italic muted "Quick Marker"
- Meta: precision + source chips

### 4.9 Journal

- Card with header "Journal"
- Textarea: placeholder "What mattered today? What did you learn?", 4 rows
- Entries: `#0f172a` background, `3px solid #64748b` left border, border-radius `--radius-md`, padding `14px`
- Body: `--color-text-secondary`, `0.9rem`, line-height 1.6
- Meta: `--color-text-muted`, `0.7rem`

### 4.10 Suggestions

- Row: flex, gap `14px`, padding `14px 0`, border top
- Time: `62px` min-width
- Title: `0.92rem`, font-weight 600
- Meta: source badge + time range + confidence % + approx badge if applicable
- Notes: `--color-text-muted`, `0.76rem`
- Actions: Accept (primary), Edit (secondary), Reject (secondary)
- Edit mode: title input, start/end datetime-local inputs, Save/Cancel buttons
- Empty: italic muted text explaining suggestions come from automated sources
- Calendar import: file input styled as a pill button, accepts `.ics`

### 4.11 Review Modal

- Backdrop: `rgba(2, 6, 23, 0.82)`, fixed, centered, z-index 100
- Panel: `#0f172a` background, border, border-radius `--radius-lg`, padding `28px`, max-height `90vh`, overflow-y auto
- Header: title + close button (× icon)
- Completion state: rule line, "Day complete", fidelity badge, coverage/gaps meta, Done button
- Gaps section: each gap shows time range + duration + template buttons (Deep Work, Meal, Rest)
- Journal textarea + sleep time input
- Complete button (primary, full width)

### 4.12 Empty States

- Color: `--color-text-muted`, italic, `0.84rem`
- Text-align center (or left in narrow containers)
- Padding `32px 24px`

### 4.13 Coverage Bar

- Track: `6px` height, `#0f172a` background, border-radius `--radius-full`
- Fill: `--color-success` background, transition width `0.4s`

### 4.14 Error / Notice

- Error text: `--color-error`, `0.78rem`
- Notice: `--color-text-secondary`, `0.78rem`

---

## 5. Screen Layouts

### 5.1 Day View (main screen)

```
┌─────────────────────────────────────────┐
│ Header: brand ─── date ─── server status│
├─────────────────────────────────────────┤
│                                         │
│ Card: Day summary                       │
│   "Awake since 07:30" / "Wake up" btn   │
│   "75% covered · 2 gaps · 5 events"     │
│   Coverage bar                          │
│                                         │
│ Card: Timeline                          │
│   [visual timeline with lanes/gaps]     │
│                                         │
│ Card: Quick Entry                       │
│   [input] [Log]                         │
│   [preview chips]                       │
│   [tag/people suggestion chips]         │
│                                         │
│ Card: Events (N)                        │
│   [event rows]                          │
│                                         │
│ Card: Markers (N)                       │
│   [marker rows]                         │
│                                         │
│ Card: Journal                           │
│   [textarea + entries]                  │
│                                         │
│ Card: Suggestions (N)                   │
│   [suggestion rows]                     │
│                                         │
│ Footer: version info                    │
└─────────────────────────────────────────┘
```

### 5.2 Review Modal (overlay)

```
┌─────────────────────────────────────────┐
│ End-of-Day Review      [×]              │
│                                         │
│ Unlogged gaps > 15 min                  │
│ ┌─────────────────────────────────────┐ │
│ │ 14:10 – 16:30   140 min [Deep Work] │ │
│ │                                      [Meal]│ │
│ │                                      [Rest]│ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Reflections on today?                   │
│ [textarea]                              │
│                                         │
│ Sleep time                              │
│ [time input]                            │
│                                         │
│ [Complete Day Review]                   │
└─────────────────────────────────────────┘
```

### 5.3 Empty States

- No events: "No events logged yet. Try 'read #reading for 45m'."
- No markers: "No markers recorded for this day yet."
- No journal: "No reflection yet. Write a journal entry during your day or evening review."
- No suggestions: "Nothing waiting. Automated sources propose here, and only you put events on the timeline."
- No wake time / no events on timeline: "Set your wake time or log a quick entry to start today's timeline."
- No gaps: "No gaps. Beautifully logged day!"

---

## 6. Extension Slots

The following areas are reserved for future modules (Increment 4+):

| Slot | Location | Intended use |
|------|----------|--------------|
| Event detail | Click on an event block/row | Full event editing, participants, places, observations |
| Tag management | Settings screen | Create/edit tag hierarchy, colors |
| People management | Settings screen | Create/edit people, aliases |
| Type definitions | Settings screen | Dynamic types (TypeDefinition/TypeInstance) |
| Diagnostics | Settings screen | Performance samples, crash reports |
| Calendar import | Suggestions card | ICS file import (partially built) |
| Search | Global search | Full-text over events, notes, journals |
| Analytics | Separate screen | Rollups, dashboards, trends |

---

## 7. Features Not Built Yet

These are explicitly out of scope for this design spec and will be added later:

1. **Event detail view** — clicking an event currently does nothing (TODO placeholder)
2. **Suggestion edit** — the edit handler is a TODO placeholder
3. **Calendar import file picker** — wired to import but no file UI styling beyond pill button
4. **Tag/people management** — chips display but cannot be created or edited in the web app
5. **Search** — no search functionality
6. **Diagnostics** — no performance or crash reporting UI
7. **Settings screen** — no settings page exists
8. **Phone client** — explicitly out of scope; phone screens are not in this spec

---

## 8. Responsive Behavior

- Below 640px: content padding reduces to `16px`, header padding to `16px`, nav item labels hide (icons only), quick form stacks vertically, columns become single column.
- No dedicated mobile layout; the web app is desktop-first with basic mobile tolerance.

---

## 9. Implementation Files

| File | Purpose |
|------|---------|
| `apps/web/src/index.css` | Design system tokens + component styles |
| `apps/web/src/main.tsx` | React entry point |
| `apps/web/src/App.tsx` | App shell, imports CSS |
| `apps/web/src/pages/DayView.tsx` | Main day view state + layout |
| `apps/web/src/api.ts` | API client (base URL + endpoints) |
| `apps/web/src/components/Timeline.tsx` | Visual timeline component |
| `apps/web/src/components/QuickEntry.tsx` | Quick entry form |
| `apps/web/src/components/EventList.tsx` | Event list component |
| `apps/web/src/components/Markers.tsx` | Markers list component |
| `apps/web/src/components/Journal.tsx` | Journal component |
| `apps/web/src/components/SuggestionCard.tsx` | Individual suggestion |
| `apps/web/src/components/ReviewModal.tsx` | End-of-day review modal |
| `apps/web/src/components/ServerStatus.tsx` | Server health indicator |
