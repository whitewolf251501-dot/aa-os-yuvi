/**
 * brain/eventBus.js
 * Minimal pub/sub so Skills can react to each other without
 * direct coupling. Loaded once, attached to window.YuviBus.
 */
(function () {
  const listeners = new Map();

  function on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
    return () => listeners.get(type).delete(handler);
  }

  function emit(type, payload = {}) {
    const record = { type, payload, ts: new Date().toISOString() };
    const log = JSON.parse(localStorage.getItem('yuvi_event_log') || '[]');
    log.push(record);
    if (log.length > 500) log.shift();
    localStorage.setItem('yuvi_event_log', JSON.stringify(log));

    (listeners.get(type) || []).forEach(h => {
      try { h(record); } catch (e) { console.error('[YuviBus] handler error', type, e); }
    });
    (listeners.get('*') || []).forEach(h => {
      try { h(record); } catch (e) { console.error('[YuviBus] wildcard handler error', e); }
    });
    return record;
  }

  function getLog(type = null) {
    const log = JSON.parse(localStorage.getItem('yuvi_event_log') || '[]');
    return type ? log.filter(e => e.type === type) : log;
  }

  window.YuviBus = { on, emit, getLog };
})();
