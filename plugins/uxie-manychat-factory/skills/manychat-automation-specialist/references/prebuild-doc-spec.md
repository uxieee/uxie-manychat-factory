# The pre-build approval document

One self-contained HTML file the operator reads **before anything is built in ManyChat**.

Its purpose is specific: they approve the diagrams, and building becomes *transcription*
rather than fresh decision-making. Every trigger, node, condition and exit is decided on this
page. If the builder has to think about what a node should be, the page failed.

**The file mechanics are identical to the operator's GHL pre-build document.** They read that
idiom every day and there is no reason ManyChat should look different. If the
`ghl-system-conventions` skill is on the machine, its `assets/example-prebuild-doc.html` is the
reference implementation — lift the shell, the theming and the mermaid bundle from it rather
than reinventing them. What changes below is the *sections*, because ManyChat has no pipeline
and different failure modes.

## File

- **One HTML file, fully self-contained.** Opens from `file://` with no CDN, no remote fonts,
  no fetch. Diagrams are mermaid and the library is **inlined** (~3.3MB) — lift the bundle,
  don't link it.
- **Fixed sidebar nav**: overview, audit, entry map, flow map, one entry per flow, then
  reference sections (data, copy appendix, open questions).
- **Full-width layout, no dead space.** Prose caps around 70ch; frames, tables and diagrams use
  the width.
- **Light and dark both work, with a visible toggle.** Palette as CSS custom properties in
  three places: `:root` (light), `@media (prefers-color-scheme:dark)` guarded with
  `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`. A sidebar button cycles
  auto → light → dark, writes `data-theme` on `<html>` (removing it for auto), and remembers
  the choice in `localStorage` inside a try/catch.
- **Diagrams re-render on theme change.** Mermaid reads `themeVariables` once at
  `initialize()` and replaces each source block with an SVG. A theme change must restore the
  stashed source text into every `.mermaid` element, drop `data-processed`, re-`initialize()`
  with freshly read computed properties, and re-`run()`. Stash the sources on first render or
  the second pass finds empty divs. Listen to `matchMedia('(prefers-color-scheme:dark)')` for
  the auto case. Hand-built SVG uses `var(--token)` for every fill and stroke.
- **Every diagram is click-to-enlarge**: hover shows the affordance, click opens a lightbox
  fitted to the window, pinch / ⌘-scroll zooms toward the cursor, drag pans, double-click
  refits, esc closes.

---

## 1. Account audit — first screen, before any design

ManyChat-specific, and it goes first because it can invalidate the design behind it.

- **What is live right now.** Every comment widget with `status: active` and every DM keyword
  rule with `status: live`, with the flow each points at. Stock "Quick Automation" templates
  count and are usually the surprise.
- **Collisions.** Any existing trigger whose keywords overlap what this build proposes, and
  which one wins. On Instagram the oldest all-posts trigger wins and a specific-post trigger
  beats any all-posts one — state the winner explicitly, don't make the reader derive it.
- **Half-live pairs.** A flow whose comment widget is draft while its DM keyword rule is live,
  or the reverse. Almost never intentional.
- **Existing objects** the build will reuse rather than create.
- **`notificationReason/list`** result if any post-24h behaviour was requested — an empty
  `reasons` array means the account has no DM Lists and no outside-window capability at all.

## 2. What the platform refuses

A short, blunt section listing every requested behaviour ManyChat will not do, what happens if
you build it anyway, and where it moves to instead. Sourced from `delivery-rules.md`.

This exists because these failures are silent — a 200 at publish, then nothing sends — so the
operator has no way to discover them later except by a campaign quietly underperforming. If
nothing was refused, say so in one line.

## 3. Entry map

What starts each flow, on which surface, with what keyword.

A table, not a diagram: keyword, surface (comment / DM keyword / story reply / ad), scope
(all posts, specific post, next post), the public reply copy where relevant, and the flow it
enters. Plus the go-live status every row will have on delivery — which is `draft`, for all
of them.

## 4. Flow map — interactive wiring

One screen answering: what triggers each flow, and which flows are wired to each other.

- Flow cards in columns by class (Entry → Core → Utility), each showing trigger type, name,
  and node count.
- **Solid arrows = `goto` / `start_flow`**, labelled with the causing signal, on background
  plates so lines never run through text. Orthogonal routing.
- **Dashed = exits and removals**, on their own horizontal channels below the graph, since
  this is the layer ManyChat's builder makes invisible.
- **Click to isolate**: clicking a node dims everything except that node, its edges and their
  endpoints; clicking empty space resets. A status line says what's selected in words.
- Cross-cutting flows (default reply, opt-out) get a dashed border.

## 5. Per-flow cards

One card per flow, stacked full-width, Entry flows then Core then Utility.

- **Header**: flow name, folder, then the trigger line in mono across the full width
  (`Trigger: comment · all posts and reels · keywords: wizard, send me wizard`).
- **Settings pills**: channel, root shape (`private_reply` where a comment trigger is
  attached), whether it is published, trigger status, and the exit contract both directions.
- **A mermaid `flowchart TD`, centered.** Shape vocabulary:
  - `([...])` stadium — the trigger at top, and terminal outcomes
  - `[...]` — message and action nodes, in ManyChat vocabulary, with the config that matters
    in the label (`add_tag interest:marriage`)
  - `[/"Wait: ..."/]` — delays, **with the elapsed total from the contact's last interaction
    on the label**, so a reader can see at a glance whether it crosses the 24-hour wall
  - `{"..."}` — conditions, with `-->|label|` branch edges
  - `-.->` dotted — exits
  - **Ladders collapse into one narrative node.** One box per decision, not per micro-step.
- **A decision paragraph under the diagram**, load-bearing choice bolded up front
  (`**The root is a single private_reply block with one button**, because...`). The diagram
  shows what; the paragraph defends it.

Note the root-shape constraint in place on every comment-triggered flow's card. Operators
reading a design where the first message does nothing but offer a button will otherwise assume
it's a mistake.

## 6. Data

- **Tags** — namespaced name, applier, remover (or "permanent"), and reader. A tag with no
  reader listed is a defect the page should expose, not hide.
- **Custom fields** — name, type, why that type, and where the value is read.
- **Bot fields** — name, purpose, and current value. **Placeholders visually chipped**, plus
  one roster of every outstanding placeholder as a go-live blocker list.
- **Reuse vs create vs retire** — three columns, so the operator can see the build isn't
  inventing objects the account already has.

## 7. Copy

- Message copy is **not** inline in diagrams — nodes reference message IDs (`DM-03`).
- The **copy appendix** holds every message in journey order, grouped by flow, each with its
  ID, so the whole script reads end to end in one pass.
- **Character counts shown per message**, against Instagram's 1000-character limit.
- Public comment replies are copy too — they appear publicly under a commenter's comment.
  Include all three per trigger.
- Identical copy reused across flows appears once, with the flows it serves listed.

## 8. The rest

- **Overview** — what the system optimises for, and the boundary: whether this is a
  ManyChat-only build or a handoff build, and what it deliberately does not own.
- **The handoff** — if there is one: the endpoint, the payload shape, and what the receiving
  system is expected to do with it.
- **Open questions** — blocking design questions, each stating what changes depending on the
  answer. An honest "we haven't decided this" box is worth more than a diagram that looks
  finished and isn't.

## What this document is not

It isn't a client deliverable and it isn't a report of work done. It's the thing that gets
argued with before the work starts.
