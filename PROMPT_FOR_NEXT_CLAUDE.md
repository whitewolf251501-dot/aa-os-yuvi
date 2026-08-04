You are continuing work on YUVI, a personal AI Business OS dashboard (single-page web app, vanilla JS/HTML/CSS + serverless functions on Vercel). I'm attaching a zip containing the full current codebase (v7 in progress). Read `INVENTORY_v6.1.md`, `BUILD_PLAN_v7.md`, and `REGRESSION_CHECK_v7.md` inside it first — they document the original baseline and everything already changed. Do not re-read this as a fresh app; treat the attached zip as the current source of truth.

Work through the list below ONE ITEM AT A TIME, in order. After each item: show me what changed, update `REGRESSION_CHECK_v7.md` with what you did, and wait for my go-ahead before moving to the next item. Do not batch multiple items into one pass. Do not touch anything not listed below. Do not touch n8n backend/workflow logic (`integrations/n8n.js`'s existing contract is final — only extend it if a task below explicitly requires it). Preserve every existing feature exactly (PIN lock, biometric, PWA, personality/system prompts, knowledge base, skills manager, GitHub memory sync, all of it) — treat `INVENTORY_v6.1.md` as a regression checklist for every change.

## 1. Fix digital rain scope (do this first)
Right now `#v7-rain-canvas` is a `position:fixed` layer in `<body>`, so it renders behind every view. Change it so:
- The digital rain ONLY shows on the Command (AI Chat) view — specifically behind `.v7-blank-canvas` on the left side of the chat dock.
- Every other view (Home, Leads, Pipeline, Clients, Library, Settings) goes back to the original dark background exactly as it was before v7 (no rain, just the existing `.bg-a/.bg-g/.bg-s` layers).
- Implementation: move the canvas element into `#v-command` (or specifically inside `.v7-blank-canvas`), change its CSS from `position:fixed` to `position:absolute` scoped to that container, and make sure the animation loop pauses (or the canvas is hidden) when Command view isn't active, so it's not wasting CPU in the background on other tabs.

## 2. Business Health Score gauge
Reference image shows a circular score gauge ("Business Health Score — 87/100") next to the KPI row on Home. Add this as a real widget — compute a reasonable score from existing data (e.g. weighted mix of: active clients ratio, lead conversion rate, revenue trend, overdue payments) rather than a static number. Document the formula you use in the regression file so it's auditable later.

## 3. Live Activity panel (distinct from Recent Activity)
Reference shows a dedicated "LIVE ACTIVITY" panel on Home (real-time-feeling feed: "Follow up with 6 new leads — 2m ago", "Proposal pending: 3 — 7m ago" etc.), separate from the existing Recent Activity feed. Add this as its own panel, sourced from real events (new leads, pipeline stage changes, payment status changes) with relative timestamps, not fabricated content.

## 4. Upcoming Events panel
Reference shows a calendar-style list on Home: Client Call, Payment Follow-up, Proposal Deadline, each with a date/time. Build this sourced from real data already in the app (client next-actions, pipeline deadlines) rather than inventing events — if there's no real event data model yet, propose a minimal one (e.g. an `events` array in existing storage) before building the UI.

## 5. AI Team panel — Workflows tab
Command view / AI Team panel currently has 3 tabs: Team Floor, Task Queue, Logs. Reference shows a 4th tab: Workflows. Add it — should show whatever repeatable multi-step processes exist (this can start as a simple read-only list of workflow definitions, tied into the same task-queue data model already built).

## 6. "Local Machine" / uptime widget
Reference shows a small sidebar widget: "n8n Status: ONLINE", "Local Machine: Shlok's Laptop", an uptime counter ("Uptime: 2h 24m"), and a small activity sparkline. Build this using the real `v7CheckWorkspace()`/workspace-pill logic already in place — uptime should track from when the workspace last came online, not be fake.

## 7. Final pass
Once all of the above are done: re-run the full regression check against `INVENTORY_v6.1.md`, confirm nothing broke, and give me an updated zip with all docs current.

Confirm you've read the attached zip and the plan above, then start with item 1.
