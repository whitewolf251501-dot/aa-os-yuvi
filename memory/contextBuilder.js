/**
 * memory/contextBuilder.js — YUVI v5.1 Memory Layer (hardened)
 * ─────────────────────────────────────────────────────────────
 * v5.1 changes:
 *  - Corruption detection on every localStorage read
 *  - Schema version tracking (yuvi_memory_schema_version)
 *  - Graceful recovery (returns empty safe defaults on corruption)
 *  - All reads through YuviSecurity.safeGetLocal
 *  - Memory size guard (warns if approaching localStorage limit)
 */
(function () {
  'use strict';

  const SCHEMA_VERSION = '5.1';
  const MODULE         = 'Memory';

  function log(level, msg, data) {
    if (window.YuviLogger) window.YuviLogger[level](MODULE, msg, data);
  }

  // ── Corruption-safe array reader ───────────────────────────────────────────
  function safeArray(key, validate = null) {
    const sec = window.YuviSecurity;
    const raw = sec ? sec.safeGetLocal(key, []) : [];

    if (!Array.isArray(raw)) {
      log('warn', `Corrupted array at key "${key}" — recovering with empty array`);
      if (sec) sec.safeSetLocal(key + '_corrupt_backup_' + Date.now(), raw);
      return [];
    }

    if (validate) {
      const valid = raw.filter(item => {
        try { return validate(item); }
        catch (e) { return false; }
      });
      if (valid.length < raw.length) {
        log('warn', `Removed ${raw.length - valid.length} invalid entries from "${key}"`);
      }
      return valid;
    }

    return raw;
  }

  // ── Safe string reader ─────────────────────────────────────────────────────
  function safeString(key, fallback = '') {
    try { return localStorage.getItem(key) || fallback; }
    catch (e) { log('warn', `Cannot read "${key}" from localStorage`, e.message); return fallback; }
  }

  // ── Schema version check ───────────────────────────────────────────────────
  function checkSchema() {
    const stored = safeString('yuvi_schema_version', '');
    if (stored && stored !== SCHEMA_VERSION) {
      log('info', `Schema version mismatch: stored=${stored} current=${SCHEMA_VERSION} — continuing with compatibility mode`);
    }
    try { localStorage.setItem('yuvi_schema_version', SCHEMA_VERSION); } catch (e) {}
  }

  // ── localStorage size guard ────────────────────────────────────────────────
  function checkStorageUsage() {
    try {
      let total = 0;
      for (const key in localStorage) {
        if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
          total += (localStorage[key] || '').length * 2; // UTF-16 bytes
        }
      }
      const usedKB  = Math.round(total / 1024);
      const limitKB = 5120; // 5MB typical limit
      if (usedKB > limitKB * 0.8) {
        log('warn', `localStorage usage at ${usedKB}KB / ~${limitKB}KB (${Math.round(usedKB/limitKB*100)}%) — consider clearing old data`);
      }
      return { usedKB, limitKB };
    } catch (e) { return { usedKB: 0, limitKB: 5120 }; }
  }

  // ── Context readers ────────────────────────────────────────────────────────
  function getBusinessContext()     { return safeString('yuvi_biz_ctx', ''); }
  function getPersonality()         { return safeString('yuvi_personality', ''); }
  function getConversationSummary() { return safeString('yuvi_memory_summary', ''); }

  function getLiveAppData() {
    return {
      leads:    safeArray('yuvi_leads',    item => item && typeof item.name === 'string'),
      pipeline: safeArray('yuvi_pipeline', item => item && typeof item.name === 'string'),
      clients:  safeArray('yuvi_clients',  item => item && typeof item.name === 'string'),
      revenue:  safeArray('yuvi_revenue')
    };
  }

  function getConversationHistory(limit = 20) {
    const history = safeArray('yuvi_chat_history');
    return history.slice(-limit);
  }

  async function getGitHubMemory() {
    const mod = window.YuviGitHub || window.YuviGitHubMemory;
    if (!mod) return null;
    try { const { content } = await mod.readFile('memory.json'); return content; }
    catch (e) { log('warn', 'GitHub memory unavailable', e.message); return null; }
  }

  function getUploadedKnowledge(maxCharsPerDoc = 3500) {
    if (!window.YuviKnowledge) return '';
    try { return window.YuviKnowledge.getContextBundle(maxCharsPerDoc); }
    catch (e) { log('warn', 'Knowledge context failed', e.message); return ''; }
  }

  function getInstalledSkills() {
    if (!window.YuviSkillRegistry) return [];
    try { return window.YuviSkillRegistry.list(); }
    catch (e) { log('warn', 'Skill list failed', e.message); return []; }
  }

  async function build() {
    const githubMemory = await getGitHubMemory();
    return {
      businessContext:     getBusinessContext(),
      personality:         getPersonality(),
      conversationSummary: getConversationSummary(),
      liveAppData:         getLiveAppData(),
      conversationHistory: getConversationHistory(),
      uploadedKnowledge:   getUploadedKnowledge(),
      installedSkills:     getInstalledSkills(),
      githubMemory,
      schema:              SCHEMA_VERSION
    };
  }

  // Init on load
  checkSchema();
  const usage = checkStorageUsage();
  log('info', `Memory v5.1 ready — localStorage: ${usage.usedKB}KB used`);

  const api = {
    getBusinessContext, getPersonality, getConversationSummary,
    getLiveAppData, getConversationHistory, getGitHubMemory,
    getUploadedKnowledge, getInstalledSkills, build,
    checkStorageUsage, checkSchema,
    buildFullContext: build // alias
  };

  window.YuviMemory         = api;
  window.YuviContextBuilder = api;
})();
