/**
 * brain/proactiveEngine.js — YUVI v6 Proactive Behaviors (Phase 5)
 * ─────────────────────────────────────────────────────────────────
 * Pure, deterministic, frontend-only logic. No backend/n8n dependency,
 * no AI calls required for any of these decisions — matches the phase's
 * explicit constraint. Where the existing v5 data model doesn't carry a
 * needed timestamp, this module degrades gracefully rather than inventing
 * fake data (documented per-function below).
 */
(function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  // ── Leads: v5's lead objects carry no per-lead timestamp field, so
  // time-based "stale" isn't determinable. Uses STATUS as the deterministic
  // signal instead — 'follow_up' and 'interested' both mean a human action
  // is pending. This is an intentional, documented deviation from a literal
  // time-based staleness check.
  function getAttentionLeads(leads) {
    return (leads || []).filter(function (l) { return l.status === 'follow_up' || l.status === 'interested'; })
      .map(function (l) {
        return { source: 'lead', id: l.id, title: l.name, detail: l.status === 'follow_up' ? 'Needs follow-up' : 'Interested \u2014 hasn\u2019t moved to pipeline yet' };
      });
  }

  // ── Pipeline: deals DO carry stageEnteredAt (v6) or lastTouched (v5
  // fallback for records created before this field existed).
  function getStuckPipelineDeals(pipeline, thresholdDays, now) {
    now = now || Date.now();
    thresholdDays = thresholdDays || 5;
    var cutoff = thresholdDays * DAY_MS;
    return (pipeline || []).filter(function (p) { return p.stage !== 'closed'; })
      .map(function (p) {
        var ts = p.stageEnteredAt || p.lastTouched;
        if (!ts) return null;
        var age = now - new Date(ts).getTime();
        if (age < cutoff) return null;
        return { source: 'pipeline', id: p.id, title: p.name, detail: 'Stuck in ' + (p.stage || '').replace(/_/g, ' ') + ' for ' + Math.floor(age / DAY_MS) + ' day(s)', daysStuck: Math.floor(age / DAY_MS) };
      }).filter(Boolean);
  }

  // ── Clients: tasks need an addedAt timestamp to determine overdue-ness.
  // Tasks created before this field existed simply can't be flagged (no
  // fabricated dates) — they'll start being tracked once touched again.
  function getOverdueClientTasks(clients, thresholdDays, now) {
    now = now || Date.now();
    thresholdDays = thresholdDays || 5;
    var cutoff = thresholdDays * DAY_MS;
    var out = [];
    (clients || []).forEach(function (c) {
      (c.tasks || []).forEach(function (t) {
        if (t.done || !t.addedAt) return;
        var age = now - new Date(t.addedAt).getTime();
        if (age < cutoff) return;
        out.push({ source: 'client_task', clientName: c.name, title: t.text, detail: c.name + ': "' + t.text + '" pending ' + Math.floor(age / DAY_MS) + ' day(s)', daysOverdue: Math.floor(age / DAY_MS) });
      });
    });
    return out;
  }

  // Combines all three sources into a prioritized top-3 (or fewer) list for
  // the Chat "needs your attention" surface. Priority: stuck deals (revenue
  // at risk) > stale leads > overdue client tasks.
  function getAttentionItems(leads, pipeline, clients, thresholdDays, now) {
    var stuck = getStuckPipelineDeals(pipeline, thresholdDays, now);
    var staleLeads = getAttentionLeads(leads);
    var overdueTasks = getOverdueClientTasks(clients, thresholdDays, now);
    return stuck.concat(staleLeads).concat(overdueTasks).slice(0, 3);
  }

  // ── Daily Digest scheduling gate ────────────────────────────────────────
  // prefTimeHHMM: "08:00" style string. lastRunDateISO: ISO date string of
  // the last time the digest actually ran (or null/undefined if never).
  function shouldRunDailyDigestNow(prefTimeHHMM, lastRunDateISO, now) {
    now = now ? new Date(now) : new Date();
    var todayStr = now.toISOString().slice(0, 10);
    if (lastRunDateISO) {
      var lastStr = new Date(lastRunDateISO).toISOString().slice(0, 10);
      if (lastStr === todayStr) return false; // already ran today
    }
    var parts = String(prefTimeHHMM || '08:00').split(':');
    var prefH = parseInt(parts[0], 10) || 0, prefM = parseInt(parts[1], 10) || 0;
    var prefMinutes = prefH * 60 + prefM;
    var nowMinutes = now.getHours() * 60 + now.getMinutes();
    return nowMinutes >= prefMinutes;
  }

  // ── Follow-up suggestion after a completed action (item 5) — suggested
  // only, never auto-executed. Pure string generation, deterministic.
  var STAGE_SUGGESTIONS = {
    approached: function (n) { return 'Follow up with ' + n + ' \u2014 confirm they got your message.'; },
    contacted: function (n) { return 'Send ' + n + ' the proposal while it\u2019s fresh.'; },
    interested: function (n) { return 'Draft and send a proposal for ' + n + '.'; },
    proposal_sent: function (n) { return 'Check in with ' + n + ' in 2 days if there\u2019s no reply.'; },
    advance_pending: function (n) { return 'Send the payment link / advance request to ' + n + '.'; },
    closed: function (n) { return 'Ask ' + n + ' for a referral or testimonial.'; }
  };
  function suggestNextAction(actionType, ctx) {
    ctx = ctx || {};
    if (actionType === 'pipeline_stage') {
      var fn = STAGE_SUGGESTIONS[ctx.stage];
      return fn ? fn(ctx.name || 'the client') : 'Check in with ' + (ctx.name || 'the client') + ' soon.';
    }
    if (actionType === 'client_task') {
      return 'Task done for ' + (ctx.clientName || 'the client') + '. Want me to check what\u2019s next on their package?';
    }
    return null;
  }

  window.YuviProactive = {
    getAttentionLeads: getAttentionLeads,
    getStuckPipelineDeals: getStuckPipelineDeals,
    getOverdueClientTasks: getOverdueClientTasks,
    getAttentionItems: getAttentionItems,
    shouldRunDailyDigestNow: shouldRunDailyDigestNow,
    suggestNextAction: suggestNextAction
  };
})();
