/**
 * skills/skillRegistry.js
 * The single source of truth for what Skills are installed, their state,
 * config, mode, and schedule. Replaces the old brain/skillEngine.js.
 * Exposes window.YuviSkillRegistry.
 */
(function () {
  const registry = new Map();
  const STATE_KEY = 'yuvi_skill_states';

  function loadStates() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveStates() {
    const obj = {};
    registry.forEach((entry, id) => {
      obj[id] = { enabled: entry.enabled, mode: entry.mode, schedule: entry.schedule, config: entry.config };
    });
    localStorage.setItem(STATE_KEY, JSON.stringify(obj));
  }

  function register(manifest, api) {
    if (!manifest?.id) { console.error('[SkillRegistry] manifest.id required'); return false; }
    const states = loadStates();
    const saved  = states[manifest.id] || {};
    const entry  = {
      manifest,
      api,
      enabled:  saved.enabled  !== false,          // default: true
      mode:     saved.mode     || 'automatic',     // manual | suggested | automatic
      schedule: saved.schedule || null,            // null | { frequency, time, days }
      config:   saved.config   || {}
    };
    registry.set(manifest.id, entry);

    if (entry.enabled && typeof api.onEnable === 'function') {
      try { api.onEnable(); } catch (e) { console.error(`[SkillRegistry] onEnable error: ${manifest.id}`, e); }
    }

    if (window.YuviBus) window.YuviBus.emit('skill.registered', { skill_id: manifest.id, version: manifest.version });
    console.log(`[SkillRegistry] ${manifest.id} v${manifest.version} registered (${entry.enabled ? 'enabled' : 'disabled'}, mode: ${entry.mode})`);
    return true;
  }

  function get(id)         { return registry.get(id) || null; }
  function getApi(id)      { const e = registry.get(id); return (e && e.enabled) ? e.api : null; }
  function getManifest(id) { return registry.get(id)?.manifest || null; }

  function list() {
    return [...registry.values()].map(e => ({
      id:          e.manifest.id,
      name:        e.manifest.name,
      version:     e.manifest.version,
      description: e.manifest.description,
      category:    e.manifest.category,
      icon:        e.manifest.icon,
      capabilities:e.manifest.capabilities || [],
      dependencies:e.manifest.dependencies || [],
      enabled:     e.enabled,
      mode:        e.mode,
      schedule:    e.schedule,
      config:      e.config
    }));
  }

  function setEnabled(id, enabled) {
    const e = registry.get(id);
    if (!e) return false;
    e.enabled = enabled;
    if (enabled  && typeof e.api.onEnable  === 'function') e.api.onEnable();
    if (!enabled && typeof e.api.onDisable === 'function') e.api.onDisable();
    saveStates();
    if (window.YuviBus) window.YuviBus.emit('skill.toggled', { skill_id: id, enabled });
    return true;
  }

  function setMode(id, mode) {
    const e = registry.get(id);
    if (!e) return false;
    e.mode = mode; // manual | suggested | automatic
    saveStates();
    return true;
  }

  function setSchedule(id, schedule) {
    const e = registry.get(id);
    if (!e) return false;
    e.schedule = schedule; // { frequency: 'daily'|'weekly'|'monthly'|'custom', time: '08:00', days: [] }
    saveStates();
    return true;
  }

  function setConfig(id, config) {
    const e = registry.get(id);
    if (!e) return false;
    e.config = { ...e.config, ...config };
    saveStates();
    return true;
  }

  function remove(id) {
    const e = registry.get(id);
    if (!e) return false;
    if (typeof e.api.onUninstall === 'function') e.api.onUninstall();
    registry.delete(id);
    const states = loadStates();
    delete states[id];
    localStorage.setItem(STATE_KEY, JSON.stringify(states));
    if (window.YuviBus) window.YuviBus.emit('skill.removed', { skill_id: id });
    return true;
  }

  function findByCapability(capability) {
    return [...registry.values()]
      .filter(e => e.enabled && (e.manifest.capabilities || []).includes(capability))
      .map(e => ({ id: e.manifest.id, api: e.api, manifest: e.manifest, enabled: e.enabled }));
  }

  function isEnabled(id) { return registry.get(id)?.enabled ?? false; }
  function count()       { return registry.size; }

  // Alias: old code called window.YuviSkillEngine
  window.YuviSkillRegistry = { register, get, getApi, getManifest, list, setEnabled, setMode, setSchedule, setConfig, remove, findByCapability, isEnabled, count };
  window.YuviSkillEngine   = window.YuviSkillRegistry; // backward compat alias
})();
