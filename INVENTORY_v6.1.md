# YUVI v6.1 — Feature Inventory & Regression Checklist
(source: github.com/whitewolf251501-dot/aa-os-yuvi @ main, commit d8dac37)

This is the baseline. Every item below must still exist, behave identically, and be wired to the same underlying data/logic in v7 — only visuals change unless marked [NEW].

## 1. Shell / chrome
- [ ] Topbar: live clock `#livetime` (HH:MM:SS IST, updates every tick)
- [ ] Topbar: system status pill `#sys-status` → "YUVI v6.1 ONLINE" + status dot
- [ ] Topbar: Daily Digest gear icon, Settings gear icon
- [ ] Sidenav: Home / Command (AI badge) / Leads (live count badge `#leads-badge`) / Pipeline / Clients / Library / Digest / Settings
- [ ] Mobile: hamburger → slide-out nav overlay; bottom mobile-nav bar (Home/Cmd/Leads/Pipe/Clients/Lib)
- [ ] Landscape-only rotate-device lock overlay (mobile)
- [ ] PIN lock screen (6-digit passcode, dot indicators, numpad, error state) + biometric/WebAuthn unlock button
- [ ] Boot sequence (logo, progress bar, status text) after unlock
- [ ] PWA service worker registration, manifest, install icons

## 2. Home view
- [ ] Time-based greeting: "GOOD `MORNING/AFTERNOON/EVENING`, SHLOK SIR" (`#greet-time`, computed from `Date().getHours()`, <12/<17/else)
- [ ] Home clock widget `#home-clock-time` + date line `#greet-date` (day · date month year · "YUGANTAR GROWTH")
- [ ] KPI row: Active Clients (`#kpi-clients`, filtered count of clients where status=active), Total Leads (`#kpi-leads`), Follow-ups Today (`#kpi-followups`), Revenue This Month (`#kpi-revenue`, ₹ formatted en-IN) — each with a colored progress bar
- [ ] Hidden legacy KPI kept alive in DOM but not shown: `#kpi-contacted` / `#contacted-bar` (still updated by `updateStats()` — do not delete the elements, just keep them display:none equivalent)
- [ ] YUVI Briefing panel: avatar, name/role, "⚡ DIGEST" button, AI-generated proactive briefing text (`#yuvi-briefing`) — Groq-backed with local rule-based fallback (`localFallbackBriefing()`) when no API key set
- [ ] Revenue Overview chart (`#revenue-overview-chart`)
- [ ] Revenue Tracker: editable rows (`#revenue-rows`, "+ ADD" button `addRevenueRow()`), Total MRR footer (`#rev-total-val`)
- [ ] Today's Priorities checklist (`#priorities-list`, "RESET" button)
- [ ] Quick Actions panel: + Add Lead, Open Pipeline, New Proposal, ⚡ Daily Digest
- [ ] Client Status mini-list (`#home-clients-mini`) — name + payment-status colored pill (paid/pending/overdue)
- [ ] Recent Activity feed (`#recent-activity-list`)

## 3. Command view (AI chat)
- [ ] Widget-card canvas (`#yuvi-canvas`) — pin/lock/save/remove actions per card, reveal-on-hover except when pinned/locked
- [ ] Chat input + Groq-backed responses, modes (chat/plan/outreach/proposal/brief)
- [ ] Previous-conversations history drawer (right-side slide panel)
- [ ] Caption/quick-set input (`#yuvi-caption`)

## 4. Leads view
- [ ] Lead list with category/status
- [ ] Add Lead slide panel (name*, phone, category, address, initial status, notes)
- [ ] Bulk outreach selection: ALL / NONE / HOT ONLY
- [ ] Outreach queue + counter, "📢 START OUTREACH", per-lead WhatsApp deep-link queue list

## 5. Pipeline view
- [ ] Kanban board (`#kanban-board`) stages: Approached → Contacted → Interested → Proposal Sent → Advance Pending → Closed
- [ ] Add Deal slide panel (business name*, contact, phone, service package, stage, first note)
- [ ] Pipeline detail side panel (`#pipe-detail-panel`) with an action button — currently a **placeholder**: "Workspace not connected yet — configure n8n in Settings" (this is the exact hook point for real n8n wiring in v7)
- [ ] Stale-stage threshold setting (days) drives some proactive nudge (Settings > Preferences)

## 6. Clients view
- [ ] Clients grid (`#clients-grid`) — status (active/onboarding/etc.), payment status, plan
- [ ] Add Client panel

## 7. Library view
- [ ] Archive tab / Templates tab toggle
- [ ] Save current chat input as template

## 8. Settings panel (7 sections — must all survive)
- [ ] 🔑 API: Groq key (vault-encrypted, SAVE/TEST), default mode selector
- [ ] 💾 GitHub Memory: username, repo, legacy token field, CONNECT/VIEW/BACKUP/CLEAR LOCAL, memory status indicator, integrations status, live memory snapshot, event log clear
- [ ] 🧩 Skills: skill manager (install/enable/disable/schedule/remove), `skills/installed.json` driven
- [ ] 📚 Knowledge: file upload (pdf/doc/docx/xls/xlsx/csv/txt/json/md) → auto-parsed into knowledge base
- [ ] 🔒 Password: change 6-digit passcode, biometric enroll/status
- [ ] 🤖 YUVI: personality textarea, business context textarea, daily briefing time, toast duration, pipeline stale-stage threshold
- [ ] 🔗 Connection to Workspace (n8n): **currently a disabled placeholder** — status "OFFLINE — not yet connected", webhook URL field (disabled). **This is the real integration point for v7.**

## 9. Modals
- [ ] Memory.json viewer modal
- [ ] Generic confirm/cancel modal (used for destructive actions)

## 10. Cross-cutting / architecture (do not break)
- [ ] Load order: security/logger → webauthn/vault → CDN libs (jsPDF, pdf.js, mammoth, xlsx) → eventBus → integrations (groq/github/canva/whatsapp) → knowledge → memory/contextBuilder → automation (eventRules/scheduler) → skills (registry/loader/promptSkillEngine) → brain (intentDetector/promptComposer/skillOrchestrator/brain/widgetEngine/libraryEngine/proactiveEngine) → skillManager UI → app.js → sw-register → skill-boot
- [ ] GitHub-memory sync is the persistence layer (`memory.json` via serverless `api/github-proxy.js`) — real GitHub PAT lives server-side on Vercel (`GITHUB_TOKEN` env var), not client-side
- [ ] Groq chat via serverless `api/groq-chat.js`
- [ ] n8n integration today = **UI placeholder only, zero real logic** — confirmed via `grep`, only reference is the disabled Settings section + one toast message. Nothing to preserve here beyond the visual slot; this is where v7's real n8n-compatibility hook goes.
- [ ] 2 known unpatched security issues carried over from earlier audit (stored XSS via CSV import unsanitized `innerHTML`, plaintext credentials in localStorage) — out of scope for this UI task, flagging so they aren't accidentally reintroduced by copy-pasting old patterns into new components.

---
## What "v7" actually is, per your brief
- Frontend visual upgrade to match the reference mockup (Sales Pipeline Kanban styling, upgraded Clients table w/ Plan/Revenue/Next Action, Command Center panel w/ suggested-commands + history, agent avatar cards w/ progress bars) — **restyle/extend existing views above, not a rewrite**.
- Dashboard must run 24×7 independent of n8n (n8n is local-hosted, laptop-only) — i.e. Groq-key-driven "AI Team" awareness/control layer stays live even when n8n is offline; n8n involvement is additive when it happens to be online.
- I'm building the frontend + the compatibility seam (a defined interface — e.g. status field + webhook/event contract) for n8n to plug into later. I'm not building or wiring your actual n8n workflows.

Next: I'll turn this into the v7 build plan (which files change, which are new, what the n8n-compat contract looks like) before writing code — confirm and I'll proceed to the zip.
