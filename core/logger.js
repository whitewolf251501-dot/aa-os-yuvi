/**
 * core/logger.js — YUVI v5.1 Logger
 * ────────────────────────────────────
 * Centralized structured logging. Replaces scattered console.log/error calls.
 * Level-based: ERROR > WARN > INFO > DEBUG (set via localStorage yuvi_log_level)
 * Emits on event bus for any automation/monitoring that wants to listen.
 */
(function () {
  'use strict';

  const LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
  const MAX_LOG_ENTRIES = 200;

  function getLevel() {
    const stored = localStorage.getItem('yuvi_log_level') || 'INFO';
    return LEVELS[stored.toUpperCase()] ?? LEVELS.INFO;
  }

  function timestamp() {
    return new Date().toISOString();
  }

  function shouldLog(level) {
    return LEVELS[level] <= getLevel();
  }

  function writeLog(level, module, message, data) {
    if (!shouldLog(level)) return;

    const entry = {
      ts: timestamp(),
      level,
      module: module || 'app',
      message: String(message),
      data: data !== undefined ? data : null
    };

    // Console output
    const prefix = `[YUVI:${module || 'app'}]`;
    switch (level) {
      case 'ERROR': console.error(prefix, message, data !== undefined ? data : ''); break;
      case 'WARN':  console.warn(prefix,  message, data !== undefined ? data : ''); break;
      case 'DEBUG': console.debug(prefix, message, data !== undefined ? data : ''); break;
      default:      console.log(prefix,   message, data !== undefined ? data : '');
    }

    // Persist recent log entries (ring buffer)
    try {
      const logs = JSON.parse(localStorage.getItem('yuvi_log_buffer') || '[]');
      logs.push(entry);
      if (logs.length > MAX_LOG_ENTRIES) logs.splice(0, logs.length - MAX_LOG_ENTRIES);
      localStorage.setItem('yuvi_log_buffer', JSON.stringify(logs));
    } catch (e) { /* log buffer write failed — ignore silently */ }

    // Emit on event bus for monitors (non-blocking)
    if (window.YuviBus && level === 'ERROR') {
      try { window.YuviBus.emit('yuvi.error', { module, message, ts: entry.ts }); } catch (e) {}
    }
  }

  function error(module, message, data)  { writeLog('ERROR', module, message, data); }
  function warn(module, message, data)   { writeLog('WARN',  module, message, data); }
  function info(module, message, data)   { writeLog('INFO',  module, message, data); }
  function debug(module, message, data)  { writeLog('DEBUG', module, message, data); }

  function getLogs(level = null) {
    try {
      const logs = JSON.parse(localStorage.getItem('yuvi_log_buffer') || '[]');
      return level ? logs.filter(l => l.level === level.toUpperCase()) : logs;
    } catch (e) { return []; }
  }

  function clearLogs() {
    localStorage.removeItem('yuvi_log_buffer');
  }

  window.YuviLogger = { error, warn, info, debug, getLogs, clearLogs, LEVELS };
})();
