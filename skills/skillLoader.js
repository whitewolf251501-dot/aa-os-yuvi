/**
 * skills/skillLoader.js — YUVI v5.1 (hardened)
 * ──────────────────────────────────────────────
 * v5.1 changes:
 *  - YuviSecurity.validateSkillManifest used for all manifest checks
 *  - Version compatibility enforcement
 *  - Circular dependency detection
 *  - Load timeout per skill (10s)
 *  - YuviLogger integration throughout
 */
(function () {
  'use strict';

  const INSTALLED_PATH       = 'skills/installed.json';
  const MIN_PLATFORM_VERSION = '5.0.0';
  const SKILL_LOAD_TIMEOUT   = 10000;
  const loadedScripts        = new Set();
  const loadReport           = [];
  const MODULE               = 'SkillLoader';

  function log(level, msg, data) {
    if (window.YuviLogger) window.YuviLogger[level](MODULE, msg, data);
    else console[level === 'error' ? 'error' : 'log'](`[${MODULE}]`, msg);
  }

  async function fetchJSON(path) {
    try {
      const res = await fetch(path + '?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { return null; }
  }

  function injectScript(src) {
    return new Promise((resolve, reject) => {
      if (loadedScripts.has(src)) { resolve(src); return; }
      const el    = document.createElement('script');
      el.src      = src + '?_=' + Date.now();
      el.async    = false;
      const timer = setTimeout(() => reject(new Error(`Skill load timeout (${SKILL_LOAD_TIMEOUT/1000}s): ${src}`)), SKILL_LOAD_TIMEOUT);
      el.onload   = () => { clearTimeout(timer); loadedScripts.add(src); resolve(src); };
      el.onerror  = () => { clearTimeout(timer); reject(new Error(`Script not found: ${src}`)); };
      document.head.appendChild(el);
    });
  }

  // ── Version compatibility ─────────────────────────────────────────────────
  function semverOK(required, current) {
    if (!required) return true;
    try {
      const [rMaj, rMin] = required.split('.').map(Number);
      const [cMaj, cMin] = current.split('.').map(Number);
      return cMaj > rMaj || (cMaj === rMaj && cMin >= rMin);
    } catch (e) { return true; }
  }

  // ── Circular dependency detection ─────────────────────────────────────────
  function hasCycle(skillId, deps, visited = new Set()) {
    if (visited.has(skillId)) return true;
    visited.add(skillId);
    for (const dep of (deps[skillId] || [])) {
      if (hasCycle(dep, deps, new Set(visited))) return true;
    }
    return false;
  }

  async function loadOne(skillId, allDeps = {}) {
    // 1. Fetch manifest
    const manifest = await fetchJSON(`skills/${skillId}/manifest.json`);

    // 2. Validate via Security module
    const sec = window.YuviSecurity || { validateSkillManifest: (m) => ({ valid: !!m?.id, errors: [] }) };
    const validation = sec.validateSkillManifest(manifest);
    if (!validation.valid) {
      const err = `Invalid manifest: ${validation.errors.join(', ')}`;
      log('error', `✗ ${skillId}: ${err}`);
      loadReport.push({ skill_id: skillId, status: 'error', error: err });
      if (window.YuviBus) window.YuviBus.emit('skill.load.failed', { skill_id: skillId, reason: err });
      return false;
    }

    // 3. ID must match folder name
    if (manifest.id !== skillId) {
      const err = `Manifest id "${manifest.id}" does not match folder "${skillId}"`;
      log('error', `✗ ${skillId}: ${err}`);
      loadReport.push({ skill_id: skillId, status: 'error', error: err });
      return false;
    }

    // 4. Version compatibility
    if (manifest.min_platform_version && !semverOK(manifest.min_platform_version, MIN_PLATFORM_VERSION)) {
      const err = `Requires platform v${manifest.min_platform_version}, current is v${MIN_PLATFORM_VERSION}`;
      log('warn', `✗ ${skillId}: ${err}`);
      loadReport.push({ skill_id: skillId, status: 'error', error: err });
      return false;
    }

    // 5. Dependency check
    const deps = manifest.dependencies || [];
    if (deps.length && window.YuviSkillRegistry) {
      const missing = deps.filter(dep => !window.YuviSkillRegistry.isEnabled(dep));
      if (missing.length) {
        const err = `Missing dependencies: ${missing.join(', ')}`;
        log('warn', `✗ ${skillId}: ${err}`);
        loadReport.push({ skill_id: skillId, status: 'error', error: err });
        return false;
      }
      // Circular dependency check
      allDeps[skillId] = deps;
      if (hasCycle(skillId, allDeps)) {
        const err = 'Circular dependency detected';
        log('error', `✗ ${skillId}: ${err}`);
        loadReport.push({ skill_id: skillId, status: 'error', error: err });
        return false;
      }
    }

    // 6. Inject and execute skill.js
    try {
      await injectScript(`skills/${skillId}/skill.js`);
      log('info', `✓ ${skillId} v${manifest.version}`);
      loadReport.push({ skill_id: skillId, status: 'loaded', version: manifest.version });
      return true;
    } catch (e) {
      log('error', `✗ ${skillId}: ${e.message}`);
      loadReport.push({ skill_id: skillId, status: 'error', error: e.message });
      if (window.YuviBus) window.YuviBus.emit('skill.load.failed', { skill_id: skillId, reason: e.message });
      return false;
    }
  }

  async function loadAll() {
    loadReport.length = 0;

    const installed = await fetchJSON(INSTALLED_PATH);
    if (!Array.isArray(installed)) {
      log('warn', 'skills/installed.json missing or invalid — no skills loaded');
      if (window.YuviBus) window.YuviBus.emit('skills.loaded', { loaded: 0, total: 0, errors: 0 });
      return;
    }

    const enabled  = installed.filter(s => s?.skill_id && s.enabled !== false);
    const disabled = installed.filter(s => s?.enabled === false);

    if (disabled.length) log('info', `${disabled.length} skill(s) disabled`, disabled.map(s => s.skill_id));
    if (!enabled.length) {
      log('info', 'No skills enabled in installed.json');
      if (window.YuviBus) window.YuviBus.emit('skills.loaded', { loaded: 0, total: 0, errors: 0 });
      return;
    }

    // Build dependency map for cycle detection
    const allDeps = {};
    let loaded = 0, errors = 0;

    for (const entry of enabled) {
      const ok = await loadOne(entry.skill_id, allDeps);
      if (ok) loaded++; else errors++;
    }

    log('info', `Done — ${loaded} loaded, ${errors} failed, ${disabled.length} disabled`);
    if (window.YuviBus) window.YuviBus.emit('skills.loaded', { loaded, total: enabled.length, errors, report: loadReport });
    if (window.YuviSkillManager) window.YuviSkillManager.renderSkillsManager();
  }

  async function reload(skillId) {
    loadedScripts.delete(`skills/${skillId}/skill.js?_=${Date.now()}`);
    loadedScripts.forEach(s => { if (s.includes(`skills/${skillId}/`)) loadedScripts.delete(s); });
    if (window.YuviSkillRegistry) window.YuviSkillRegistry.remove(skillId);
    return loadOne(skillId);
  }

  function getReport() { return [...loadReport]; }

  window.YuviSkillLoader = { loadAll, loadOne, reload, getReport };
  log('info', 'SkillLoader v5.1 ready');
})();
