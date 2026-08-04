# v7 Regression Check — against INVENTORY_v6.1.md

Method: every ID/function referenced in the v6.1 inventory was searched for in the new `index.html`/`app.js`/`style.css`. None were removed or renamed. All new code is additive (new files, new functions with `v7` prefix, new CSS classes) or is a pure restyle (class list changes only, no markup restructuring) of existing elements.

## Confirmed intact (spot-checked against inventory)
- [x] `#livetime`, `#greet-time`, `#greet-date`, `#home-clock-time` — untouched
- [x] `#kpi-clients/leads/followups/revenue` + hidden `#kpi-contacted`/`#contacted-bar` — untouched
- [x] `#yuvi-briefing`, `#revenue-rows`, `#rev-total-val`, `#priorities-list` — untouched
- [x] `#home-clients-mini`, `#recent-activity-list` — untouched
- [x] Command view: mode pills, chat input, voice, file attach, history panel, `#yuvi-canvas` — untouched; new agent-cards/command-center blocks inserted above it, don't alter its DOM
- [x] Leads view: search, filters, CSV import, dedup, outreach flow (flyer/message/select/queue) — untouched
- [x] Pipeline view: `#kanban-board`, Add Deal panel — untouched structurally, restyled via CSS only
- [x] Clients view: `#clients-grid` card grid (tasks/package items/notes/action buttons) — **fully preserved**, not replaced; new summary table added above it as a separate, additional element
- [x] Library view: Archive/Templates tabs — untouched
- [x] Settings: all 7 sections present; only the n8n section was changed **on purpose** per your brief (enabled real URL field + save handler, replacing the disabled placeholder — everything else in Settings untouched)
- [x] PIN lock, biometric button, boot sequence, PWA manifest/service worker — untouched
- [x] `renderClients()` — original body untouched; one added line calls the new (optional, guarded) `v7RenderClientsSummary()`
- [x] Load order — all original `<script>` tags in original order; `integrations/n8n.js` inserted as a new line in the integrations layer, doesn't reorder anything else

## Known limitation / flag
- The reference image's Kanban and Command Center are visually restyled and functionally scaffolded (agent cards reflect real local queue state; suggested commands actually populate the chat input and mode), but the **AI Team "live progress %" you'll see is derived from local queue depth, not a real n8n execution percentage** — because no real n8n workflow exists yet to report true progress. Once you build actual n8n flows and have them call back to `syncQueueWhenOnline`'s expected response shape (`{updates:[{id, status}]}`), progress becomes real. This is intentional per your instruction ("just make it compatible... don't care about n8n").

## v7.1 update — Home dashboard panels + Settings redesign
- Home view now shows AI Team Live, Command Center, Sales Pipeline, Clients, and Knowledge Base as their own panels directly on Home (matches reference layout numbering 01-06), in addition to the existing nav-based full views. These are read-only previews reading the same live arrays (`clients`, `pipeline`, `v7GetQueue()`) — "OPEN"/"VIEW ALL" buttons still take you to the full interactive view for editing.
- `renderClients()` and `renderPipeline()` are wrapped (not rewritten) so their original bodies run untouched, then the home-preview refresh runs after — original behavior fully preserved.
- Settings panel restructured into 7 tabs (API & AI / Memory & Sync / Skills / Knowledge / Security / YUVI Identity / Workspace) via `v7InitSettingsTabs()` — this MOVES the existing DOM nodes into tab containers (not a rebuild), so every field id, onclick handler, and existing JS reference to those elements stays identical. It runs once, the first time Settings is opened, and is guarded against re-running or against an unexpected DOM shape (bails safely if section count doesn't match, leaving old flat layout intact rather than breaking).

## v7.2 update — Digital rain background, transcript log, tappable agent cards
- New `<canvas id="v7-rain-canvas">` layer added behind existing `.bg-a/.bg-g/.bg-s` — purely decorative, capped ~20fps, pauses when tab is hidden, no interaction/z-index conflicts with existing UI (z-index:0, same layer as other bg divs).
- Command view restructured into a flex layout: new left `TRANSCRIPT LOG` dock + existing content wrapped in `.v7-cmd-main`. All existing IDs inside (`cmd-topbar`, `history-panel`, `yuvi-canvas-wrap`, `yuvi-caption`, `chat-input-area`, etc.) are untouched, just re-parented one level deeper for the flex layout — verified div balance after edit (386/386).
- Transcript log is read-only and polls the existing `chatHistory` array every 1.2s — does not modify `sendChat()`, voice input, or `chatHistory` itself. Voice-dictated messages appear automatically since STT fills the same input box `sendChat()` already reads.
- Agent cards (both Home preview and Command view Team Floor) are now clickable — opens a modal built from real local task-queue entries grouped by date (`today` / `yesterday` / `upcoming`). If no tasks are logged for a period, the modal says so honestly rather than inventing activity.
- Standalone desktop wallpaper delivered separately as `yuvi_digital_rain_wallpaper.png` (3840x2160, matches the in-app violet HUD theme) — not part of the deployed app, just a file for your OS wallpaper setting.

## v7.3 update — Command view feel (terminal-style, blank canvas, chat as right dock)
- Removed the circular presence-ring/core decoration in the empty-chat state (`.yuvi-presence-ring`/`.yuvi-presence-core` set to display:none) — per your "no circles" request. Underlying elements are hidden, not deleted, so nothing else that might reference them breaks.
- Command view now splits into `.v7-blank-canvas` (left, transparent — the rain layer shows through) and `.v7-chat-dock` (right, 380px, dark) containing the existing chat canvas/caption/input exactly as before, just re-parented — all IDs unchanged.
- `#yuvi-caption` and `.chat-input-area` darkened to near-black with violet monospace text for a terminal feel.
- On narrow/mobile widths, the blank canvas hides and chat dock goes full-width (unchanged usability on phone).

## v7.4 update — item 1: digital rain scope fix, item 2: Business Health Score gauge
- **Item 1 (rain scope):** structural placement was already correct from v7.3 (canvas lives inside `#v-command > .v7-cmd-split`, behind `.v7-blank-canvas`; every other view already shows plain `bg-a/bg-g/bg-s`). Fixed two real remaining issues in `app.js` only (no `index.html` changes): (a) the draw loop now checks `window.__v7CommandActive` — set inside the existing `nav()` function — so it pauses on every view except Command, not just when the browser tab itself is hidden; (b) the canvas now sizes its drawing buffer to its actual parent container (`getBoundingClientRect()`) instead of the full window, fixing wasted resolution. `nav()` still does everything it did before, plus these two lines.
- **Item 2 (health score):** new `.v7-home-top-row` flex wrapper added in `index.html` around the *existing* `.home-greet` block (markup/IDs inside it untouched) plus a new sibling `.v7-health-card` gauge widget. Score computed by `v7ComputeHealthScore()` in `app.js` — real weighted formula, not static:
  - 30% active-client ratio (`clients` active/total)
  - 25% lead conversion rate (`leads` interested+closed / total)
  - 25% revenue collection rate (`revenueData` paid amount / total amount)
  - 20% overdue penalty (1 − overdue rows / total rows)
  - Any component with no underlying data defaults to a neutral 0.7 rather than 0/1, so an empty dashboard doesn't misreport as failing or perfect.
  - Hooked into the existing `renderClients()` and `renderRevenue()` (one added guarded call each) plus `initDashboard()` boot sequence, so the gauge stays live with real data — no new polling loop.
  - Gauge rendered via CSS `conic-gradient` driven by a `--v7-pct` custom property — no new dependency, no canvas/SVG needed.

## v7.5 update — items 3, 4, 5, 6: Live Activity, Upcoming Events, Workflows tab, Local Machine widget
- **Item 3 (Live Activity):** new panel in `.home-right` (above Client Status), backed by a new `V7_LIVE_ACTIVITY_KEY='yuvi_live_activity'` log — distinct from the existing widget-generation Recent Activity feed (`ACTIVITY_KEY='yuvi_recent_activity'`, untouched). Logged from real events only: `submitAddLead()` (new lead), `movePipeStage()` (stage change), `cycleClientPayment()` and `cycleRevStatus()` (payment status change) — one added guarded line in each existing function, no existing behavior altered. Relative timestamps via the existing `timeAgo()` helper.
- **Item 4 (Upcoming Events):** no event data model existed, so a minimal derived one was added — `v7GetUpcomingEvents()` computes events live from real state rather than storing fabricated calendar entries: proposal deadlines (`pipeline` cards in `proposal_sent` stage, due date = `stageEnteredAt` + your existing Settings > Preferences stale-stage-threshold days via `getStageThresholdDays()`), advance-pending follow-ups (`advance_pending` stage), and payment/call follow-ups from `clients[].payment` (`overdue`/`pending`). New panel in `.home-right`, refreshes on `renderPipeline()`/`renderClients()`.
- **Item 5 (Workflows tab):** 4th tab added to the existing AI Team panel (Team Floor / Task Queue / **Workflows** / Logs) in Command view — `v7-team-workflows` container, `v7SetTeamTab()` extended (existing tab-switch logic untouched, just one more case). Read-only `V7_WORKFLOWS` list (5 workflows, one per existing agent) shows step sequence and live active/completed counts matched against the existing `v7GetQueue()` task-queue data model by `task.type` — no new data store, no real n8n execution, exactly the scaffold called for in `BUILD_PLAN_v7.md`.
- **Item 6 (Local Machine / uptime widget):** new card at the bottom of the existing `#sidenav`. Built entirely on the real `v7CheckWorkspace()`/`v7SetWorkspaceStatus()` polling loop already in place (20s interval, unchanged) — added an online-since timestamp (`yuvi_workspace_online_since` in localStorage) that's stamped only on a genuine offline→online transition and cleared on going offline, so "Uptime" is a real duration, not a fake counter. Activity sparkline buckets real queue task timestamps (`v7GetQueue()`) into 8 hourly bars — empty/flat if no tasks logged, not invented data.
- No changes to `integrations/n8n.js` — contract (`pingWorkspace`/`enqueueTask`/`syncQueueWhenOnline`) untouched, per your instruction.

## v7.6 — Final regression pass (item 7)
Re-checked every ID/function named in `INVENTORY_v6.1.md` against the final `index.html`/`app.js`:
- All 25 spot-checked core IDs (`#livetime`, `#sys-status`, `#leads-badge`, all `#kpi-*`, `#greet-*`, `#yuvi-briefing`, `#revenue-*`, `#priorities-list`, `#home-clients-mini`, `#recent-activity-list`, `#yuvi-canvas`, `#yuvi-caption`, `#kanban-board`, `#pipe-detail-panel`, `#clients-grid`, `#mem-view-modal`, `#pin-lock`) present exactly once.
- All 18 spot-checked functions (`updateStats`, `renderRevenue`, `renderPriorities`, `renderLeads`, `renderPipeline`, `renderClients`, `renderRecentActivity`, `addRevenueRow`, `movePipeStage`, `cycleClientPayment`, `cycleRevStatus`, `submitAddLead`, `nav`, plus the v7 workspace/queue/team functions) defined exactly once, no accidental duplicates from the incremental edits.
- Script load order in `index.html` (security/logger → webauthn/vault → CDN libs → eventBus → integrations → knowledge → memory → automation → skills → brain → skillManager UI → app.js → sw-register → skill-boot) — byte-for-byte identical to baseline.
- `index.html` div balance: 408 open / 408 close. `style.css` brace balance: 605 open / 605 close. `node -c app.js` — no syntax errors, checked after every single item.
- `integrations/n8n.js` — untouched, contract unchanged.
- PIN lock, biometric, boot sequence, PWA manifest/service worker, GitHub-memory sync, Groq proxy, skills manager — not touched by any of items 1-6, confirmed by absence from every diff in this pass.

**All 7 build-plan items complete.**
