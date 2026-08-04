/**
 * brain/eventBus.js
 * Minimal pub/sub so Skills can react to each other without
 * direct coupling. Loaded once, attached to window.YuviBus.
 */
(function () {
  const listeners = new Map();

  // v6.1 — TRACK B STEP 3: emit() fires on almost every action in the app.
  // A corrupted yuvi_event_log used to throw here and silently break every
  // downstream listener (widgets, proactive engine, etc.) on every event.
  function safeParseLog() {
    try {
      const raw = localStorage.getItem('yuvi_event_log');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[YuviBus] Corrupt yuvi_event_log — resetting.', e.message);
      return [];
    }
  }

  function on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
    return () => listeners.get(type).delete(handler);
  }

  function emit(type, payload = {}) {
    const record = { type, payload, ts: new Date().toISOString() };
    const log = safeParseLog();
    log.push(record);
    if (log.length > 500) log.shift();
    try { localStorage.setItem('yuvi_event_log', JSON.stringify(log)); } catch (e) { /* storage full — non-fatal */ }

    (listeners.get(type) || []).forEach(h => {
      try { h(record); } catch (e) { console.error('[YuviBus] handler error', type, e); }
    });
    (listeners.get('*') || []).forEach(h => {
      try { h(record); } catch (e) { console.error('[YuviBus] wildcard handler error', e); }
    });
    return record;
  }

  function getLog(type = null) {
    const log = safeParseLog();
    return type ? log.filter(e => e.type === type) : log;
  }

  window.YuviBus = { on, emit, getLog };
})();
