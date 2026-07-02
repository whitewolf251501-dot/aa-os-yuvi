/**
 * skills/skillLoader.js
 * Dynamically loads and registers Skills from skills/installed.json.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. Reads skills/installed.json at boot (called by index.html boot sequence).
 * 2. For each enabled entry, fetches skills/<id>/manifest.json to validate.
 * 3. Injects skills/<id>/skill.js as a dynamic <script> tag.
 * 4. skill.js calls YuviSkillRegistry.register(manifest, api) on load.
 * 5. Emits 'skills.loaded' on the event bus when complete.
 *
 * INSTALLING A SKILL (the ONLY steps needed)
 * ─────────────────────────────────────────────
 * 1. Create skills/<id>/manifest.json
 * 2. Create skills/<id>/skill.js  (must call YuviSkillRegistry.register)
 * 3. Add { "skill_id": "<id>", "enabled": true } to skills/installed.json
 *
 * No changes to index.html or any core file. Ever.
 *
 * ARCHITECTURE LOCK: this file is the ONLY place dynamic skill loading happens.
 */
(function () {
  const INSTALLED_PATH = 'skills/installed.json';
  const loadedScripts  = new Set();
  const loadReport     = [];   // { skill_id, status, error? }

  // ── Fetch JSON from a path, return null on any failure ──────────────────────
  async function fetchJSON(path) {
    try {
      const res = await fetch(path + '?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  // ── Dynamically inject a <script> tag, resolve when executed ───────────────
  function injectScript(src) {
    return new Promise((resolve, reject) => {
      if (loadedScripts.has(src)) { resolve(src); return; }
      const el    = document.createElement('script');
      el.src      = src + '?_=' + Date.now();
      el.async    = false; // preserve execution order if multiple are queued
      el.onload   = () => { loadedScripts.add(src); resolve(src); };
      el.onerror  = () => reject(new Error(`Script not found: ${src}`));
      document.head.appendChild(el);
    });
  }

  // ── Validate a manifest has the minimum required fields ─────────────────────
  function validateManifest(manifest, skillId) {
    if (!manifest)          return `manifest.json missing or invalid JSON`;
    if (!manifest.id)       return `manifest.json missing "id" field`;
    if (manifest.id !== skillId)
                            return `manifest "id" (${manifest.id}) does not match folder name (${skillId})`;
    if (!manifest.version)  return `manifest.json missing "version" field`;
    return null; // valid
  }

  // ── Check that all declared skill dependencies are already registered ───────
  function checkDependencies(manifest) {
    const deps = manifest.dependencies || [];
    if (!deps.length) return null;
    if (!window.YuviSkillRegistry) return `YuviSkillRegistry not available`;
    const missing = deps.filter(dep => !window.YuviSkillRegistry.isEnabled(dep));
    return missing.length ? `Missing dependencies: ${missing.join(', ')}` : null;
  }

  // ── Load and register a single skill ────────────────────────────────────────
  async function loadOne(skillId) {
    if (!skillId || typeof skillId !== 'string') {
      loadReport.push({ skill_id: skillId, status: 'error', error: 'Invalid skill_id' });
      return false;
    }

    // 1. Fetch and validate manifest
    const manifest = await fetchJSON(`skills/${skillId}/manifest.json`);
    const manifestError = validateManifest(manifest, skillId);
    if (manifestError) {
      console.warn(`[SkillLoader] ✗ ${skillId}: ${manifestError}`);
      loadReport.push({ skill_id: skillId, status: 'error', error: manifestError });
      if (window.YuviBus) window.YuviBus.emit('skill.load.failed', { skill_id: skillId, reason: manifestError });
      return false;
    }

    // 2. Check dependencies
    const depError = checkDependencies(manifest);
    if (depError) {
      console.warn(`[SkillLoader] ✗ ${skillId}: ${depError}`);
      loadReport.push({ skill_id: skillId, status: 'error', error: depError });
      if (window.YuviBus) window.YuviBus.emit('skill.load.failed', { skill_id: skillId, reason: depError });
      return false;
    }

    // 3. Inject skill.js — this executes the script which calls register()
    try {
      await injectScript(`skills/${skillId}/skill.js`);
      console.log(`[SkillLoader] ✓ ${skillId} v${manifest.version}`);
      loadReport.push({ skill_id: skillId, status: 'loaded', version: manifest.version });
      return true;
    } catch (e) {
      console.error(`[SkillLoader] ✗ ${skillId}: ${e.message}`);
      loadReport.push({ skill_id: skillId, status: 'error', error: e.message });
      if (window.YuviBus) window.YuviBus.emit('skill.load.failed', { skill_id: skillId, reason: e.message });
      return false;
    }
  }

  // ── Load all enabled skills from installed.json ──────────────────────────────
  async function loadAll() {
    loadReport.length = 0; // reset

    const installed = await fetchJSON(INSTALLED_PATH);
    if (!Array.isArray(installed)) {
      console.warn('[SkillLoader] skills/installed.json missing or not an array. No skills loaded.');
      if (window.YuviBus) window.YuviBus.emit('skills.loaded', { loaded: 0, total: 0, errors: 0 });
      return;
    }

    const enabled  = installed.filter(s => s && s.skill_id && s.enabled !== false);
    const disabled = installed.filter(s => s && s.enabled === false);

    if (disabled.length) {
      console.log(`[SkillLoader] ${disabled.length} skill(s) disabled:`, disabled.map(s => s.skill_id).join(', '));
    }

    if (!enabled.length) {
      console.log('[SkillLoader] No skills enabled. Add skills to skills/installed.json.');
      if (window.YuviBus) window.YuviBus.emit('skills.loaded', { loaded: 0, total: 0, errors: 0 });
      return;
    }

    // Load sequentially to respect dependency order declared in installed.json
    let loaded = 0, errors = 0;
    for (const entry of enabled) {
      const ok = await loadOne(entry.skill_id);
      if (ok) loaded++; else errors++;
    }

    console.log(`[SkillLoader] Done. ${loaded} loaded, ${errors} failed, ${disabled.length} disabled.`);

    if (window.YuviBus) window.YuviBus.emit('skills.loaded', {
      loaded, total: enabled.length, errors, report: loadReport
    });

    // Re-render Skills Manager if it's open
    if (window.YuviSkillManager) window.YuviSkillManager.renderSkillsManager();
  }

  // ── Hot-reload a single skill (useful for development) ──────────────────────
  async function reload(skillId) {
    loadedScripts.delete(`skills/${skillId}/skill.js`);
    if (window.YuviSkillRegistry) window.YuviSkillRegistry.remove(skillId);
    return loadOne(skillId);
  }

  // ── Return current load report ──────────────────────────────────────────────
  function getReport() { return [...loadReport]; }

  window.YuviSkillLoader = { loadAll, loadOne, reload, getReport };
})();
