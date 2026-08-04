/**
 * brain/widgetEngine.js — YUVI v6 Chat Canvas Widget Engine
 * ─────────────────────────────────────────────────────────
 * Pure logic layer for the Chat blank-canvas widget system. Deliberately
 * has NO DOM access and NO network calls — index.html wires this to
 * window.YuviBrain.rawChat() for the actual Groq call and to the DOM for
 * rendering. Keeping this layer pure is what makes it unit-testable without
 * hitting the live Groq API.
 *
 * Widget shape:
 *   { id, type, title, subtitle, data, pinned, locked, createdAt, updatedAt }
 *   type ∈ 'metric' | 'chart' | 'list' | 'table' | 'calendar' | 'text'
 */
(function () {
  'use strict';

  var LS_KEY = 'yuvi_canvas_widgets';
  var VALID_TYPES = ['metric', 'chart', 'list', 'table', 'calendar', 'text'];

  // ── intent classification (deterministic, no AI call needed to decide) ──
  var WIDGET_VERBS = /\b(show|build|create|generate|make|plan|draft|compare|chart|graph|calendar|schedule|breakdown|track|analy[sz]e|summar(?:y|ise|ize)|list|ideas?|strategy|calendar for|content plan)\b/i;

  function _titleTokens(title) {
    return String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(function (t) { return t.length > 2; });
  }

  // Returns { isWidgetRequest, targetWidgetId } — targetWidgetId is non-null
  // when the command looks like an edit to an existing widget rather than a
  // brand-new request.
  function classifyIntent(commandText, existingWidgets) {
    existingWidgets = existingWidgets || [];
    var text = String(commandText || '').trim();
    if (!text) return { isWidgetRequest: false, targetWidgetId: null };

    var looksLikeWidgetAsk = WIDGET_VERBS.test(text);
    if (!looksLikeWidgetAsk) return { isWidgetRequest: false, targetWidgetId: null };

    // Try to resolve an explicit/implicit edit target by keyword overlap
    // against existing widget titles — e.g. "show last 6 months" against a
    // widget titled "Revenue Trend" (overlap on "revenue"/"trend" tokens
    // carried from the ORIGINAL creating command is handled by the caller
    // passing recent context; here we match on the widget's own title/subtitle).
    var lower = text.toLowerCase();
    var best = null, bestScore = 0;
    existingWidgets.forEach(function (w) {
      var tokens = _titleTokens(w.title).concat(_titleTokens(w.subtitle));
      var score = 0;
      tokens.forEach(function (t) { if (lower.indexOf(t) !== -1) score++; });
      // Edit-ish phrasing bumps confidence even with weak token overlap.
      if (/\b(update|change|edit|instead|now show|last \d|this month|extend|add to|remove from)\b/i.test(text)) score += 0.5;
      if (score > bestScore) { bestScore = score; best = w; }
    });
    var targetWidgetId = (best && bestScore >= 1) ? best.id : null;
    return { isWidgetRequest: true, targetWidgetId: targetWidgetId };
  }

  // ── AI prompt construction (pure — returns a messages[] array) ─────────
  var SCHEMA_INSTRUCTIONS =
    'You are YUVI\'s widget engine. Respond with ONLY a single valid JSON object — no markdown fences, no prose before or after.\n' +
    'Schema: {"type":"metric|chart|list|table|calendar|text","title":"string","subtitle":"string (optional)","data": <type-specific, see below>}\n' +
    '- metric: {"value":"string or number","label":"string","delta":"string optional, e.g. \'+18% vs last month\'"}\n' +
    '- chart: {"labels":["Jan","Feb",...],"values":[number,...]}\n' +
    '- list: {"items":["string",...]}  OR  {"items":[{"title":"string","detail":"string"}]}\n' +
    '- table: {"columns":["string",...],"rows":[["cell",...],...]}\n' +
    '- calendar: {"days":[{"day":"Mon","items":["string",...]}]}\n' +
    '- text: {"text":"string"}\n' +
    'Pick the type that best fits the request. Keep content grounded in the given business context. Return ONLY the JSON object, nothing else.';

  function buildWidgetPrompt(commandText, businessContext, targetWidget) {
    var sys = SCHEMA_INSTRUCTIONS + (businessContext ? ('\n\nBusiness context:\n' + businessContext) : '');
    var messages = [{ role: 'system', content: sys }];
    if (targetWidget) {
      var editable = { type: targetWidget.type, title: targetWidget.title, subtitle: targetWidget.subtitle, data: targetWidget.data };
      messages.push({ role: 'user', content: 'Here is the existing widget to edit:\n' + JSON.stringify(editable) + '\n\nRequested change: ' + commandText + '\n\nReturn the FULL updated widget as JSON in the same schema (you may change type if the edit needs it).' });
    } else {
      messages.push({ role: 'user', content: commandText });
    }
    return messages;
  }

  // ── AI response parsing/validation (pure — string in, widget-data out) ──
  function parseWidgetResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') throw new Error('Empty widget response.');
    // Strip markdown fences some models add despite instructions.
    var cleaned = rawText.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var firstBrace = cleaned.indexOf('{');
    var lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) throw new Error('No JSON object found in widget response.');
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    var parsed;
    try { parsed = JSON.parse(cleaned); } catch (e) { throw new Error('Malformed JSON from widget engine: ' + e.message); }
    if (!parsed.type || VALID_TYPES.indexOf(parsed.type) === -1) throw new Error('Widget response missing/invalid "type".');
    if (!parsed.title) parsed.title = 'Untitled';
    if (!parsed.data || typeof parsed.data !== 'object') parsed.data = {};
    return { type: parsed.type, title: String(parsed.title), subtitle: parsed.subtitle ? String(parsed.subtitle) : '', data: parsed.data };
  }

  // ── create-vs-update merge (THE anti-duplication logic) ────────────────
  // Given the current widgets array, incoming widget-data, and an optional
  // targetWidgetId: if targetWidgetId matches an existing widget, that widget
  // is updated IN PLACE (same id/pinned/locked/createdAt, new content).
  // Otherwise a new widget is appended. Returns a NEW array (no mutation of
  // the input) so callers can diff/persist cleanly.
  function applyWidget(existingWidgets, widgetData, targetWidgetId) {
    existingWidgets = existingWidgets || [];
    var now = new Date().toISOString();
    if (targetWidgetId) {
      var idx = -1;
      for (var i = 0; i < existingWidgets.length; i++) { if (existingWidgets[i].id === targetWidgetId) { idx = i; break; } }
      if (idx !== -1) {
        var out = existingWidgets.slice();
        var prev = out[idx];
        out[idx] = {
          id: prev.id, pinned: prev.pinned, locked: prev.locked, createdAt: prev.createdAt,
          type: widgetData.type, title: widgetData.title, subtitle: widgetData.subtitle, data: widgetData.data,
          updatedAt: now
        };
        return out;
      }
      // targetWidgetId given but not found (e.g. was removed meanwhile) — fall through to create.
    }
    var created = {
      id: 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      type: widgetData.type, title: widgetData.title, subtitle: widgetData.subtitle, data: widgetData.data,
      pinned: false, locked: false, createdAt: now, updatedAt: now
    };
    return existingWidgets.concat([created]);
  }

  function setPinned(widgets, id, pinned) {
    return widgets.map(function (w) { return w.id === id ? Object.assign({}, w, { pinned: pinned }) : w; });
  }
  function setLocked(widgets, id, locked) {
    return widgets.map(function (w) { return w.id === id ? Object.assign({}, w, { locked: locked }) : w; });
  }
  // Locked widgets require an explicit unlock first — removeWidget refuses otherwise.
  function removeWidget(widgets, id) {
    var w = widgets.find(function (x) { return x.id === id; });
    if (w && w.locked) return { widgets: widgets, blocked: true };
    return { widgets: widgets.filter(function (x) { return x.id !== id; }), blocked: false };
  }

  // ── persistence — ONLY pinned or locked widgets survive a reload ────────
  function persist(widgets, localStorageRef) {
    var ls = localStorageRef || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!ls) return;
    var durable = (widgets || []).filter(function (w) { return w.pinned || w.locked; });
    ls.setItem(LS_KEY, JSON.stringify(durable));
  }
  function load(localStorageRef) {
    var ls = localStorageRef || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!ls) return [];
    try {
      var raw = ls.getItem(LS_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  window.YuviWidgetEngine = {
    VALID_TYPES: VALID_TYPES,
    classifyIntent: classifyIntent,
    buildWidgetPrompt: buildWidgetPrompt,
    parseWidgetResponse: parseWidgetResponse,
    applyWidget: applyWidget,
    setPinned: setPinned,
    setLocked: setLocked,
    removeWidget: removeWidget,
    persist: persist,
    load: load
  };
})();
