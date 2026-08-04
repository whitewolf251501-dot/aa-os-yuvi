# YUVI v7 — Build Plan

## 1. n8n compatibility seam (design, no real n8n workflow logic)

**Status pill** (topbar, restyled): `WORKSPACE: OFFLINE` / `ONLINE` — polls a local endpoint your n8n exposes (e.g. `http://localhost:5678/healthz` or a webhook you define). If unreachable → OFFLINE, silent retry in background. No error toasts spammed.

**Task Queue (works whether n8n is on or off):**
- Every action that *would* need n8n (send WhatsApp, update a sheet, run a scraper, etc.) gets written to a local queue: `n8nQueue` in your existing GitHub-memory JSON, status = `queued`.
- While OFFLINE: tasks just sit in queue, visible in a "Task Queue" tab (already scaffolded in your reference as part of AI Team panel — Task Queue / Logs tabs).
- **Advance work**: YUVI (Groq-side) can pre-stage tasks ahead of time — e.g. draft the WhatsApp message, compute the send list, prep the proposal — so the moment n8n comes online it's execution-ready, not planning-ready. This staging is pure Groq/frontend work, no n8n needed.
- When n8n comes ONLINE: dashboard pings it, hands over all `queued` tasks in order, n8n executes, reports back per-task status (`done` / `failed`) via a callback webhook you already control the shape of.
- **Approval gate**: any task marked `requires_approval: true` (you decide which categories — e.g. anything spending money, anything sent to a real client) pauses in an "Awaiting Approval" state with a card in the AI Team panel; only proceeds to n8n after you tap Approve. Everything else can auto-run.

**API keys — kept fully separate, never shared, never proxied through each other:**
- Frontend (YUVI dashboard) → its own Groq key, already vault-encrypted client-side per v6.1 pattern.
- n8n → its own separate keys/credentials, stored entirely inside your local n8n instance's own credential store — the dashboard never sees, sends, or logs them. The dashboard only ever talks to n8n via the queue/webhook contract above (task in, status out) — no shared secrets cross that boundary.

## 2. File-level plan (restyle-first, incremental)

| File | Change |
|---|---|
| `style.css` | New CSS variables for the HUD purple/violet gradient system, reusing existing `--ink/--blade/--edge/--mono/--disp` tokens where they already fit; add card/kanban/table/agent-card classes. No deletions of existing classes still in use. |
| `index.html` | Restyle existing Home/Pipeline/Clients/Command markup in place (class swaps, not structural rewrites); **add** new markup: Command Center panel (suggested commands + history), AI Team agent cards w/ progress bars, upgraded Clients table columns (Plan/Revenue/Next Action), Task Queue + Logs tabs, Workspace status pill. |
| `app.js` | No changes to existing functions/logic — only new render functions for the added widgets (`renderAgentCards()`, `renderTaskQueue()`, `renderSuggestedCommands()`), reading from existing data arrays (`clients`, `leads`, pipeline stages) plus new `n8nQueue` array. |
| `integrations/` | **New** `integrations/n8n.js` — thin client: `pingWorkspace()`, `enqueueTask()`, `syncQueueWhenOnline()`. No secrets inside it. |
| `automation/eventRules.js` | Extend (not replace) with rule: on task completion/queued/approval-needed → push to existing activity feed + toast system. |
| Everything in section 10 of the inventory (load order, GitHub memory, Groq proxy, security notes) | untouched. |

## 3. Regression check method
After build: diff every ID in `INVENTORY_v6.1.md` against new `index.html`/`app.js` — confirm each still exists and is still wired to the same variable/function. I'll include this as a checked-off `REGRESSION_CHECK_v7.md` in the zip.

## 4. What ships in the zip
- Full v7 `index.html`, `style.css`, `app.js`, `integrations/n8n.js`, small `eventRules.js` patch
- `INVENTORY_v6.1.md` + `REGRESSION_CHECK_v7.md`
- `README_v7.md` — what changed, how to wire your real n8n webhook URL in Settings, how the approval-gate categories are configured

Ready to build this into the zip on your confirm.
