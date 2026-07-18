/**
 * brain/libraryEngine.js — YUVI v6 Library
 * ─────────────────────────────────────────────
 * Pure logic layer for the Library tab: archive of AI-generated outputs
 * (organized by client folder) + saved reusable templates. No DOM, no
 * network — index.html wires this to rendering and to the Chat input.
 *
 * Archive item shape:
 *   { id, clientName ('Unassigned' if none), type, title, content, createdAt }
 *   type ∈ 'reel' | 'post' | 'research' | 'strategy' | 'proposal' | 'widget'
 *
 * Template shape:
 *   { id, name, promptText, createdAt }
 */
(function () {
  'use strict';

  var LS_ARCHIVE = 'yuvi_library_archive';
  var LS_TEMPLATES = 'yuvi_library_templates';
  var UNASSIGNED = 'Unassigned';

  function _ls(ref) { return ref || (typeof localStorage !== 'undefined' ? localStorage : null); }

  function loadArchive(localStorageRef) {
    var ls = _ls(localStorageRef); if (!ls) return [];
    try { var raw = ls.getItem(LS_ARCHIVE); var arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
  }
  function persistArchive(items, localStorageRef) {
    var ls = _ls(localStorageRef); if (!ls) return;
    ls.setItem(LS_ARCHIVE, JSON.stringify(items || []));
  }
  function loadTemplates(localStorageRef) {
    var ls = _ls(localStorageRef); if (!ls) return [];
    try { var raw = ls.getItem(LS_TEMPLATES); var arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
  }
  function persistTemplates(items, localStorageRef) {
    var ls = _ls(localStorageRef); if (!ls) return;
    ls.setItem(LS_TEMPLATES, JSON.stringify(items || []));
  }

  function addArchiveItem(items, entry) {
    var created = {
      id: 'lib_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      clientName: entry.clientName ? String(entry.clientName) : UNASSIGNED,
      type: entry.type || 'text',
      title: entry.title || 'Untitled',
      content: entry.content || '',
      createdAt: new Date().toISOString()
    };
    return (items || []).concat([created]);
  }
  function removeArchiveItem(items, id) { return (items || []).filter(function (i) { return i.id !== id; }); }

  // Groups archive items into { clientName: [items...] } folders, sorted
  // with 'Unassigned' last. Pure — used directly by the render layer.
  function groupByClient(items) {
    var groups = {};
    (items || []).forEach(function (it) {
      var key = it.clientName || UNASSIGNED;
      if (!groups[key]) groups[key] = [];
      groups[key].push(it);
    });
    var orderedKeys = Object.keys(groups).filter(function (k) { return k !== UNASSIGNED; }).sort();
    if (groups[UNASSIGNED]) orderedKeys.push(UNASSIGNED);
    var ordered = {};
    orderedKeys.forEach(function (k) { ordered[k] = groups[k]; });
    return ordered;
  }

  function addTemplate(templates, entry) {
    var created = {
      id: 'tpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: entry.name || 'Untitled template',
      promptText: entry.promptText || '',
      createdAt: new Date().toISOString()
    };
    return (templates || []).concat([created]);
  }
  function removeTemplate(templates, id) { return (templates || []).filter(function (t) { return t.id !== id; }); }

  // ── Phase 3 integration: turn a canvas widget into a savable archive item ──
  function widgetToArchiveItem(widget, clientName) {
    var summary;
    switch (widget.type) {
      case 'metric': summary = (widget.data.label || '') + ': ' + widget.data.value; break;
      case 'list': summary = (widget.data.items || []).map(function (i) { return typeof i === 'string' ? i : (i.title || ''); }).join('\n'); break;
      case 'table': summary = 'Table: ' + (widget.data.columns || []).join(', '); break;
      case 'calendar': summary = (widget.data.days || []).map(function (d) { return d.day + ': ' + (d.items || []).join(', '); }).join('\n'); break;
      case 'chart': summary = (widget.data.labels || []).join(', ') + ' \u2192 ' + (widget.data.values || []).join(', '); break;
      case 'text': default: summary = widget.data.text || ''; break;
    }
    return {
      clientName: clientName || UNASSIGNED,
      type: 'widget',
      title: widget.title,
      content: summary
    };
  }

  // "Pull into Chat as context" — builds the text to drop into the chat
  // input. Pure so it's testable without touching the DOM.
  function buildChatContextText(item) {
    if (item.promptText !== undefined) return item.promptText; // template
    return 'Using this from the Library \u2014 "' + item.title + '" (' + item.clientName + '):\n' + item.content + '\n\n';
  }

  window.YuviLibrary = {
    UNASSIGNED: UNASSIGNED,
    loadArchive: loadArchive, persistArchive: persistArchive,
    loadTemplates: loadTemplates, persistTemplates: persistTemplates,
    addArchiveItem: addArchiveItem, removeArchiveItem: removeArchiveItem, groupByClient: groupByClient,
    addTemplate: addTemplate, removeTemplate: removeTemplate,
    widgetToArchiveItem: widgetToArchiveItem,
    buildChatContextText: buildChatContextText
  };
})();
