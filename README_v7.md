# YUVI v7 — README

## What changed vs v6.1
Visual/layout upgrade toward the purple-violet HUD reference, plus a compatibility seam for your local n8n. See `INVENTORY_v6.1.md` (baseline) and `REGRESSION_CHECK_v7.md` (what was verified).

Files touched:
- `style.css` — appended, new `--v7-*` tokens + new component classes. Nothing removed.
- `index.html` — added: workspace status pill (topbar), AI Team agent cards + Task Queue/Logs tabs + Command Center suggested-commands (Command view), clients summary table (Clients view), n8n URL field now active (Settings). Everything else unchanged.
- `app.js` — appended, all new code under a clearly marked `v7` section, one added line inside existing `renderClients()`.
- `integrations/n8n.js` — new file, the only thing that talks to your local n8n.

## How to wire your real n8n later
1. In Settings → Connection to Workspace, set **N8N BASE URL** to your local instance (default assumed `http://localhost:5678`).
2. Expose two things on your n8n side:
   - `GET /healthz` → 200 OK when up (used for the status pill + auto-resume).
   - `POST /webhook/yuvi-tasks` → accepts `{tasks:[...]}`, returns `{updates:[{id,status}]}` where status is `working`/`done`/`failed`.
3. Nothing else needed on the dashboard side — it already polls every 20s and syncs the queue automatically when it detects n8n is back online.

## Approval-gated tasks
Any task enqueued with `requiresApproval:true` (you decide this per task type when you build the real n8n triggers/whatever calls `YuviN8N.enqueue(...)`) sits in "Awaiting Approval" in the Task Queue tab until you tap Approve — then it flows to n8n normally.

## API keys
- Groq key: unchanged, still vault-encrypted client-side, still only used by the dashboard.
- n8n: keeps 100% of its own credentials inside itself. The dashboard/n8n boundary only ever exchanges the task-queue JSON above — nothing else crosses it.

## Deploy
Same as before — this is still a static site + the existing `api/` serverless functions. Push to your repo, Vercel auto-deploys as usual. PWA install, landscape lock, and PIN/biometric all work identically on your phone.

## v7.4–v7.6 additions (items 1–7, this pass)
- **Digital rain** now only animates on the Command view and pauses everywhere else (was already mostly scoped correctly; tightened the pause/resize logic).
- **Business Health Score** gauge on Home — real weighted formula from clients/leads/revenue, documented in `REGRESSION_CHECK_v7.md`.
- **Live Activity** panel on Home — logs real new-lead/stage-change/payment-change events, separate from the existing Recent Activity feed.
- **Upcoming Events** panel on Home — derived from real pipeline deadlines and client payment status, no fabricated calendar.
- **Workflows tab** in the AI Team panel — read-only list of 5 repeatable processes, tied to the existing task-queue data.
- **Local Machine / uptime widget** in the sidebar — real uptime tracked from your n8n workspace's actual online-since timestamp, plus an activity sparkline from real queued tasks.
- Full regression pass completed — see `REGRESSION_CHECK_v7.md` v7.6 section for the method and results. All inventory items from `INVENTORY_v6.1.md` confirmed intact.
