/* ============================================================
 * YUVI v6.2 — n8n WORKSPACE BRIDGE (window.YuviN8N)
 * ------------------------------------------------------------
 * The real intelligence lives in the self-hosted n8n workflow
 * "YUVI — Yugantar Growth AI Orchestrator". This module is the
 * single frontend contract with that backend:
 *
 *   POST <webhookUrl>  body: { input_text, session_id, department? }
 *   -> n8n "Respond to Dashboard Webhook" node returns the result
 *      once processing finishes. Treat as a normal async fetch.
 *
 * Behind the webhook sit 5 agents (Scout, Sherlock, Spark, Ledger,
 * Echo) orchestrated by YUVI, plus a Google Sheet with tabs:
 * Task Log / Leads / Clients / Settings (agent kill switches).
 *
 * Everything here degrades gracefully when the webhook is not
 * configured or offline — the dashboard keeps working on its
 * local Groq brain.
 * ============================================================ */
(function () {
  'use strict';

  // The 5 departments behind YUVI. `id` is the value sent as
  // `department` for direct agent calls; also the row key used in
  // the Settings tab kill-switch pattern.
  var AGENTS = [
    { id: 'scout',    name: 'SCOUT',    role: 'Sales & Lead Hunting',   desc: 'Sharp and terse. Hunts leads, scores them, drafts first-touch outreach. No small talk.' },
    { id: 'sherlock', name: 'SHERLOCK', role: 'Business Analysis',      desc: 'Methodical. Digs into a prospect\u2019s business, competitors and gaps before you pitch.' },
    { id: 'spark',    name: 'SPARK',    role: 'Marketing & Content',    desc: 'Fast and trendy. Writes hooks, captions, campaign angles and content calendars.' },
    { id: 'ledger',   name: 'LEDGER',   role: 'Finance & Ops',          desc: 'Precise and calm. Tracks payments, drafts proposals, flags overdue money before you ask.' },
    { id: 'echo',     name: 'ECHO',     role: 'Client Support',         desc: 'Warm. Handles client check-ins, status updates and keeps relationships alive.' }
  ];

  var LS_URL = 'yuvi_n8n_webhook_url';
  var LS_STATUS_URL = 'yuvi_n8n_status_url';
  var LS_SHEET = 'yuvi_n8n_sheet_id';
  var LS_AGENTS = 'yuvi_n8n_agent_states';
  var LS_SESSION = 'yuvi_n8n_session_id';

  var _online = null;          // null = never checked, true/false after ping
  var _pollTimer = null;
  var _pollListeners = [];
  var _lastTasks = [];
  var POLL_MS = 8000;          // 5-10s while a task is active (spec)
  var IDLE_STOPS_AFTER = 2;    // consecutive idle polls before we stop hammering
  var _idlePolls = 0;

  function getSessionId() {
    var s = localStorage.getItem(LS_SESSION);
    if (!s) {
      s = 'yuvi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(LS_SESSION, s);
    }
    return s;
  }

  function getConfig() {
    return {
      webhookUrl: localStorage.getItem(LS_URL) || '',
      statusUrl: localStorage.getItem(LS_STATUS_URL) || '',
      sheetId: localStorage.getItem(LS_SHEET) || ''
    };
  }
  function saveConfig(cfg) {
    if (cfg.webhookUrl !== undefined) localStorage.setItem(LS_URL, cfg.webhookUrl.trim());
    if (cfg.statusUrl !== undefined) localStorage.setItem(LS_STATUS_URL, cfg.statusUrl.trim());
    if (cfg.sheetId !== undefined) localStorage.setItem(LS_SHEET, cfg.sheetId.trim());
    _online = null; // force re-ping after config change
  }
  function isConfigured() { return !!getConfig().webhookUrl; }
  function isOnline() { return _online === true; }

  /* ------------------------------------------------------------
   * send() — THE webhook contract. Every dashboard action that
   * needs the n8n brain goes through here: chat messages,
   * "Generate via Yuvi", bulk outreach triggers, agent toggles.
   * ------------------------------------------------------------ */
  async function send(payload, opts) {
    var cfg = getConfig();
    if (!cfg.webhookUrl) throw new Error('Workspace not connected \u2014 set the n8n webhook URL in Settings > Connections.');
    var body = {
      input_text: payload.input_text || '',
      session_id: payload.session_id || getSessionId()
    };
    if (payload.department) body.department = payload.department; // direct agent call
    if (payload.action) body.action = payload.action;             // structured actions (status_check, agent_toggle...)
    if (payload.data) body.data = payload.data;

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (controller) controller.abort(); }, (opts && opts.timeoutMs) || 120000);
    try {
      var res = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
      _online = res.ok;
      if (!res.ok) throw new Error('Workspace returned ' + res.status);
      var text = await res.text();
      try { return JSON.parse(text); } catch (e) { return { output: text }; }
    } catch (err) {
      if (err.name === 'AbortError') { _online = false; throw new Error('Workspace timed out \u2014 n8n took too long to respond.'); }
      if (err instanceof TypeError) _online = false; // network-level failure
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /* Lightweight connection test — used by Settings "TEST" button
   * and once at boot when a URL is configured. */
  async function ping() {
    if (!isConfigured()) { _online = false; return false; }
    try {
      await send({ input_text: '__ping__', action: 'ping' }, { timeoutMs: 12000 });
      _online = true;
    } catch (e) {
      _online = false;
    }
    if (window.YuviEventBus) window.YuviEventBus.emit('n8n:status', { online: _online });
    return _online;
  }

  /* ------------------------------------------------------------
   * TASK LOG — the Google Sheet tracking every agent task.
   * Reads via the status-check webhook (falls back to the main
   * webhook with action:'status_check' when no separate status
   * URL is set). Expected response shape:
   *   { tasks: [{ agent, task, status, started_at, finished_at, result_summary }] }
   * status: "In Progress" | "Completed" | "Failed"
   * ------------------------------------------------------------ */
  async function fetchTaskLog() {
    var cfg = getConfig();
    if (!cfg.webhookUrl && !cfg.statusUrl) return [];
    try {
      var data;
      if (cfg.statusUrl) {
        var res = await fetch(cfg.statusUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status_check', session_id: getSessionId() })
        });
        if (!res.ok) return [];
        data = await res.json();
        _online = true;
      } else {
        data = await send({ input_text: '', action: 'status_check' }, { timeoutMs: 15000 });
      }
      var tasks = (data && (data.tasks || data.task_log || data.rows)) || [];
      _lastTasks = Array.isArray(tasks) ? tasks : [];
      return _lastTasks;
    } catch (e) {
      return [];
    }
  }
  function getLastTasks() { return _lastTasks; }
  function getActiveTasks() {
    return _lastTasks.filter(function (t) { return /progress/i.test(String(t.status || '')); });
  }

  /* ------------------------------------------------------------
   * fetchYuviBrief() — INTEGRATION POINT for the proactive
   * on-load briefing (Goal 1). Asks n8n to compose a short brief
   * from Task Log + Leads + Clients tab state.
   * Expected response: { brief: "3 leads need review, Ledger has
   * 2 proposals pending..." } (or plain { output } text).
   * Returns null when the workspace isn't reachable — caller
   * falls back to the local Groq/rule-based briefing.
   * ------------------------------------------------------------ */
  async function fetchYuviBrief() {
    if (!isConfigured()) return null;
    try {
      var data = await send({ input_text: 'Compose the on-load dashboard briefing from Task Log, Leads and Clients state. 2-4 sentences, decisive, no fluff.', action: 'yuvi_brief' }, { timeoutMs: 25000 });
      var text = data && (data.brief || data.output || data.text || data.message);
      return (typeof text === 'string' && text.trim()) ? text.trim() : null;
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------
   * AGENT KILL SWITCHES — mirrors the `Settings` tab of the
   * shared Google Sheet. Local state is the optimistic cache;
   * each toggle is also pushed to n8n (action:'agent_toggle')
   * so the sheet stays the source of truth.
   * ------------------------------------------------------------ */
  function getAgentStates() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(LS_AGENTS) || '{}'); } catch (e) { raw = {}; }
    var out = {};
    AGENTS.forEach(function (a) { out[a.id] = raw[a.id] !== false; }); // default ON
    return out;
  }
  async function setAgentEnabled(agentId, enabled) {
    var states = getAgentStates();
    states[agentId] = !!enabled;
    localStorage.setItem(LS_AGENTS, JSON.stringify(states));
    if (isConfigured()) {
      // Push to the Settings sheet tab via n8n; failure keeps local
      // state so the toggle isn't lost — next successful call syncs.
      try {
        await send({ input_text: '', action: 'agent_toggle', data: { agent: agentId, enabled: !!enabled } }, { timeoutMs: 15000 });
      } catch (e) { /* offline — local cache holds the intent */ }
    }
    return states[agentId];
  }

  /* ------------------------------------------------------------
   * TASK LOG POLLING — lightweight ambient status. Polls every
   * 8s while at least one task is In Progress; after 2 idle
   * polls in a row it stops entirely until kick() is called
   * (we kick after every send() from the dashboard).
   * ------------------------------------------------------------ */
  function onTasks(fn) { if (_pollListeners.indexOf(fn) === -1) _pollListeners.push(fn); }
  function notifyTasks(tasks) {
    _pollListeners.forEach(function (fn) { try { fn(tasks); } catch (e) {} });
  }
  async function pollOnce() {
    var tasks = await fetchTaskLog();
    notifyTasks(tasks);
    var active = getActiveTasks().length > 0;
    if (active) { _idlePolls = 0; }
    else {
      _idlePolls++;
      if (_idlePolls >= IDLE_STOPS_AFTER) stopTaskPolling();
    }
  }
  function startTaskPolling() {
    if (_pollTimer || !isConfigured()) return;
    _idlePolls = 0;
    _pollTimer = setInterval(pollOnce, POLL_MS);
    pollOnce();
  }
  function stopTaskPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }
  /* Call after any dashboard action that starts backend work. */
  function kick() { startTaskPolling(); }

  window.YuviN8N = {
    AGENTS: AGENTS,
    getSessionId: getSessionId,
    getConfig: getConfig,
    saveConfig: saveConfig,
    isConfigured: isConfigured,
    isOnline: isOnline,
    send: send,
    ping: ping,
    fetchTaskLog: fetchTaskLog,
    fetchYuviBrief: fetchYuviBrief,
    getLastTasks: getLastTasks,
    getActiveTasks: getActiveTasks,
    getAgentStates: getAgentStates,
    setAgentEnabled: setAgentEnabled,
    onTasks: onTasks,
    startTaskPolling: startTaskPolling,
    stopTaskPolling: stopTaskPolling,
    kick: kick
  };
})();
