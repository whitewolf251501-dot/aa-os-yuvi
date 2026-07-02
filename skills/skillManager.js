/**
 * skills/skillManager.js
 * Renders the full Skills Manager inside the Settings panel.
 * No business logic here — only UI that calls YuviSkillRegistry.
 *
 * Panels rendered:
 *   #yuvi-skills-manager       — installed skills list
 *   #yuvi-knowledge-manager    — uploaded knowledge files
 *   #yuvi-automation-manager   — registered automation rules
 *   #yuvi-integrations-status  — integration health
 *   #yuvi-memory-status        — live memory stats
 *   #yuvi-preferences          — app preferences
 */
(function () {

  function esc(s = '') {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function badge(label, color) {
    return `<span style="font-size:9px;padding:2px 6px;border-radius:3px;background:${color}22;color:${color};border:1px solid ${color}44;">${label}</span>`;
  }

  // ===== SKILLS MANAGER =====
  function renderSkillsManager() {
    const el = document.getElementById('yuvi-skills-manager');
    if (!el || !window.YuviSkillRegistry) return;
    const skills = window.YuviSkillRegistry.list();

    // ── Upload section (always shown at top) ──────────────────────────────
    const uploadSection = `
      <div class="ym-upload-box" id="ym-upload-box"
        ondragover="event.preventDefault();this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="event.preventDefault();this.classList.remove('drag-over');YuviSkillManager.handleSkillDrop(event)">
        <div class="ym-upload-icon">⬆</div>
        <div class="ym-upload-label">Drop a skill document here, or</div>
        <label class="btn primary sm" style="cursor:pointer;margin-top:4px;">
          Browse File
          <input type="file" hidden id="ym-skill-file-input"
            accept=".json,.md,.txt,.html,.htm,.yaml,.yml"
            onchange="YuviSkillManager.handleSkillFileSelect(this)">
        </label>
        <div class="ym-upload-hint">Supports .json .md .txt .html — <a href="#" onclick="YuviSkillManager.showSkillDocFormat();return false;" style="color:var(--blade,#0ef6ff);">see format</a></div>
        <div id="ym-upload-status" style="margin-top:8px;font-size:10px;min-height:14px;"></div>
      </div>`;

    // ── Load error cards ──────────────────────────────────────────────────
    const report  = window.YuviSkillLoader ? window.YuviSkillLoader.getReport() : [];
    const errors  = report.filter(r => r.status === 'error');
    const errHtml = errors.length ? errors.map(e => `
      <div class="ym-card" style="border-color:rgba(255,60,95,0.3);background:rgba(255,60,95,0.05);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="color:#ff3c5f;font-size:14px;">✗</span>
          <div><div style="font-size:11px;color:#ff3c5f;">${esc(e.skill_id)}</div>
          <div class="ym-desc">${esc(e.error)}</div></div>
        </div>
      </div>`).join('') : '';

    if (!skills.length) {
      el.innerHTML = uploadSection + errHtml + `
        <div class="ym-empty" style="margin-top:12px;">
          No skills installed yet. Upload a skill document above, or create
          one manually in <code>skills/&lt;id&gt;/</code> and add it to
          <code>skills/installed.json</code>.
        </div>`;
      return;
    }

    const skillsHtml = skills.map(s => `
      <div class="ym-card" id="ym-skill-${s.id}">
        <div class="ym-card-header">
          <span class="ym-icon">${esc(s.icon || '🧩')}</span>
          <div class="ym-card-title">
            <div class="ym-name">${esc(s.name)} <span style="opacity:0.4;font-size:9px;">v${esc(s.version)}</span></div>
            <div class="ym-desc">${esc(s.description)}</div>
          </div>
          <div class="ym-card-badges">
            ${badge(s.category, '#0ef6ff')}
            ${s.enabled ? badge('ON', '#22d68e') : badge('OFF', '#ff3c5f')}
            ${badge(s.mode, '#f0b429')}
          </div>
        </div>

        <div class="ym-card-body">
          <div class="ym-row">
            <span class="ym-lbl">STATUS</span>
            <button class="btn ${s.enabled ? 'danger' : 'primary'} sm"
              onclick="YuviSkillManager.toggleSkill('${s.id}',${!s.enabled})">
              ${s.enabled ? 'DISABLE' : 'ENABLE'}
            </button>
          </div>

          <div class="ym-row">
            <span class="ym-lbl">MODE</span>
            <select class="ym-sel" onchange="YuviSkillManager.setMode('${s.id}',this.value)">
              ${['manual','suggested','automatic'].map(m =>
                `<option value="${m}" ${s.mode === m ? 'selected' : ''}>${m.toUpperCase()}</option>`
              ).join('')}
            </select>
          </div>

          <div class="ym-row">
            <span class="ym-lbl">SCHEDULE</span>
            <select class="ym-sel" id="ym-sched-${s.id}"
              onchange="YuviSkillManager.onScheduleChange('${s.id}',this.value)">
              ${['none','daily','weekly','monthly','custom'].map(f =>
                `<option value="${f}" ${(s.schedule?.frequency||'none')===f?'selected':''}>${f.toUpperCase()}</option>`
              ).join('')}
            </select>
            ${s.schedule ? `<input type="time" class="ym-inp" value="${s.schedule.time||'08:00'}"
              onchange="YuviSkillManager.setScheduleTime('${s.id}',this.value)" style="width:80px;">` : ''}
          </div>

          ${s.capabilities?.length ? `
          <div class="ym-row" style="flex-wrap:wrap;gap:4px;">
            <span class="ym-lbl">CAPS</span>
            ${s.capabilities.map(c => `<span class="ym-cap">${esc(c)}</span>`).join('')}
          </div>` : ''}

          <div class="ym-row" style="margin-top:6px;justify-content:flex-end;gap:6px;">
            <button class="btn sm" onclick="YuviSkillManager.showConfig('${s.id}')">⚙ CONFIG</button>
            ${s.source === 'prompt-skill' || s.capabilities?.length
              ? `<button class="btn sm" onclick="YuviSkillManager.exportSkill('${s.id}')">⬇ EXPORT</button>`
              : ''}
            <button class="btn danger sm" onclick="YuviSkillManager.removeSkill('${s.id}')">✕ REMOVE</button>
          </div>
        </div>
      </div>
    `).join('') + errHtml;

    el.innerHTML = uploadSection + skillsHtml;
  }

  function toggleSkill(id, enabled) {
    if (!window.YuviSkillRegistry) return;
    window.YuviSkillRegistry.setEnabled(id, enabled);
    renderSkillsManager();
    if (window.showToast) window.showToast(`Skill ${enabled ? 'enabled' : 'disabled'}.`);
  }

  // ── Skill file upload handlers ─────────────────────────────────────────────
  async function handleSkillFileSelect(input) {
    const file = input.files[0];
    if (!file) return;
    await installSkillFromFile(file);
    input.value = '';
  }

  async function handleSkillDrop(event) {
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    await installSkillFromFile(file);
  }

  async function installSkillFromFile(file) {
    const statusEl = document.getElementById('ym-upload-status');
    if (statusEl) { statusEl.textContent = `⏳ Reading ${file.name}…`; statusEl.style.color = 'var(--blade,#0ef6ff)'; }

    if (!window.YuviPromptSkillEngine) {
      if (statusEl) { statusEl.textContent = '✗ PromptSkillEngine not loaded.'; statusEl.style.color = '#ff3c5f'; }
      return;
    }

    try {
      const skill = await window.YuviPromptSkillEngine.install(file);
      if (statusEl) { statusEl.textContent = `✓ "${skill.name}" installed and ready.`; statusEl.style.color = '#22d68e'; }
      if (window.showToast) window.showToast(`Skill installed: ${skill.name}`);
      renderSkillsManager();
    } catch (e) {
      if (statusEl) { statusEl.textContent = `✗ ${e.message}`; statusEl.style.color = '#ff3c5f'; }
      console.error('[SkillManager] Install failed:', e);
    }
  }

  function showSkillDocFormat() {
    const example = JSON.stringify({
      type: 'yuvi-skill',
      id: 'my-skill',
      name: 'My Skill',
      version: '1.0.0',
      description: 'What this skill does.',
      category: 'business',
      icon: '🔧',
      prompt: 'You are a specialist AI for Yugantar Growth. When asked to...',
      triggers: ['phrase that activates me', 'another trigger phrase'],
      capabilities: ['my-skill.run'],
      config: { key: 'value' },
      templates: {}
    }, null, 2);

    const md = `---\ntype: yuvi-skill\nid: my-skill\nname: My Skill\ndescription: What it does\nicon: 🔧\ntriggers:\n  - phrase that activates me\n---\n\nYour system prompt goes here.\nEverything below the --- block is the prompt.`;

    if (window.showToast) window.showToast('Skill format shown in console (F12)');
    console.group('[YUVI] Skill Document Format');
    console.log('=== JSON FORMAT (skill.json) ===\n', example);
    console.log('=== MARKDOWN FORMAT (skill.md) ===\n', md);
    console.log('=== TXT FORMAT (.txt) ===\nFirst line = skill name. Everything = prompt.');
    console.groupEnd();

    // Show inline if there's a status element
    const statusEl = document.getElementById('ym-upload-status');
    if (statusEl) {
      statusEl.innerHTML = 'Format shown. <a href="#" onclick="YuviSkillManager.downloadSkillTemplate();return false;" style="color:var(--blade,#0ef6ff);">Download template</a>';
    }
  }

  function downloadSkillTemplate() {
    const template = {
      type: 'yuvi-skill',
      id: 'my-skill-id',
      name: 'My Skill Name',
      version: '1.0.0',
      description: 'What this skill does for Yugantar Growth.',
      category: 'business',
      icon: '🔧',
      prompt: 'You are a specialist AI assistant for Yugantar Growth, a digital agency in Ahmedabad run by Shlok Pandya.\n\nYour job is to [describe what this skill should do].\n\nAlways respond in a sharp, direct, action-oriented style. No fluff.',
      triggers: [
        'exact phrase that activates this skill in chat',
        'another trigger phrase'
      ],
      capabilities: ['my-skill-id.run'],
      config: {
        example_config_key: 'example_value'
      },
      templates: {
        output: 'Optional: define an output structure or template here'
      }
    };
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'my-skill-template.json';
    a.click();
    URL.revokeObjectURL(url);
    if (window.showToast) window.showToast('Template downloaded!');
  }

  function setMode(id, mode) {
    if (!window.YuviSkillRegistry) return;
    window.YuviSkillRegistry.setMode(id, mode);
    if (window.showToast) window.showToast(`Mode set to ${mode}.`);
  }

  function onScheduleChange(id, frequency) {
    if (!window.YuviSkillRegistry) return;
    if (frequency === 'none') { window.YuviSkillRegistry.setSchedule(id, null); renderSkillsManager(); return; }
    window.YuviSkillRegistry.setSchedule(id, { frequency, time: '08:00', days: [] });
    renderSkillsManager();
  }

  function setScheduleTime(id, time) {
    if (!window.YuviSkillRegistry) return;
    const e = window.YuviSkillRegistry.get(id);
    if (!e) return;
    window.YuviSkillRegistry.setSchedule(id, { ...(e.schedule || {}), time });
  }

  function showConfig(id) {
    const entry = window.YuviSkillRegistry?.get(id);
    if (!entry) return;
    const schema = entry.manifest?.config_schema;
    if (!schema) { if (window.showToast) window.showToast('This skill has no configurable settings.'); return; }
    // Future: render a modal with schema-driven form fields
    if (window.showToast) window.showToast(`Config UI for ${entry.manifest.name} coming in next release.`);
  }

  function removeSkill(id) {
    const name = window.YuviSkillRegistry?.getManifest(id)?.name || id;
    if (!confirm(`Remove skill "${name}"? This disables it and clears its config.`)) return;
    window.YuviSkillRegistry?.remove(id);
    renderSkillsManager();
    if (window.showToast) window.showToast(`Skill "${name}" removed.`);
  }

  // ===== KNOWLEDGE MANAGER =====
  async function handleKnowledgeUpload(input) {
    const file = input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('yuvi-knowledge-status');
    if (statusEl) { statusEl.textContent = `⏳ Reading ${file.name}…`; statusEl.style.color = 'var(--blade,#0ef6ff)'; }
    try {
      const entry = await window.YuviKnowledge.addFromFile(file);
      if (statusEl) { statusEl.textContent = `✓ ${entry.name} added (${entry.type.toUpperCase()}, ${(file.size/1024).toFixed(1)}KB)`; statusEl.style.color = '#22d68e'; }
      if (window.showToast) window.showToast(`Knowledge added: ${entry.name}`);
      renderKnowledgeManager();
    } catch (e) {
      if (statusEl) { statusEl.textContent = `✗ ${e.message}`; statusEl.style.color = '#ff3c5f'; }
    }
    input.value = '';
  }

  function renderKnowledgeManager() {
    const el = document.getElementById('yuvi-knowledge-manager');
    if (!el || !window.YuviKnowledge) return;
    const items = window.YuviKnowledge.getAll();
    const stats = window.YuviKnowledge.getStats();

    if (!items.length) {
      el.innerHTML = `<div class="ym-empty">No knowledge files uploaded. Upload a PDF, DOCX, XLSX, CSV, TXT, or JSON file — YUVI will read it and use it automatically in every chat.</div>`;
      return;
    }

    el.innerHTML = `
      <div style="font-size:10px;opacity:0.5;margin-bottom:8px;">${stats.total} files · ${stats.enabled} active · ~${stats.size_kb}KB stored</div>
      ${items.map(i => `
        <div class="ym-card" style="flex-direction:row;align-items:center;gap:10px;">
          <div style="flex:1;min-width:0;">
            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${esc(i.name)}</div>
            <div class="ym-desc">${i.type.toUpperCase()} · ${(i.size_bytes/1024).toFixed(1)}KB · ${new Date(i.added_at).toLocaleDateString('en-IN')}</div>
          </div>
          <div style="display:flex;gap:5px;flex-shrink:0;">
            ${i.enabled ? badge('ACTIVE','#22d68e') : badge('OFF','#ff3c5f')}
            <button class="btn sm" onclick="YuviSkillManager.toggleKnowledge('${i.id}',${!i.enabled})">${i.enabled?'Disable':'Enable'}</button>
            <button class="btn danger sm" onclick="YuviSkillManager.removeKnowledge('${i.id}')">✕</button>
          </div>
        </div>`).join('')}`;
  }

  function toggleKnowledge(id, enabled) {
    window.YuviKnowledge?.setEnabled(id, enabled);
    renderKnowledgeManager();
  }

  function removeKnowledge(id) {
    if (!confirm('Remove this file from YUVI\'s knowledge?')) return;
    window.YuviKnowledge?.remove(id);
    renderKnowledgeManager();
  }

  // ===== AUTOMATION =====
  function renderAutomationManager() {
    const el = document.getElementById('yuvi-automation-manager');
    if (!el) return;
    const rules = window.YuviAutomation?.list() || [];
    if (!rules.length) {
      el.innerHTML = `<div class="ym-empty">No automation rules registered. Rules are added by Skills via YuviAutomation.registerRule().</div>`;
      return;
    }
    el.innerHTML = rules.map(r => `
      <div class="ym-card" style="flex-direction:row;align-items:center;gap:10px;">
        <div style="flex:1;">
          <div style="font-size:12px;">${esc(r.id)}</div>
          <div class="ym-desc">Trigger: <code>${esc(r.trigger)}</code> · ${r.steps} step(s)</div>
          ${r.description ? `<div class="ym-desc">${esc(r.description)}</div>` : ''}
        </div>
        <div style="display:flex;gap:5px;">
          ${r.enabled ? badge('ACTIVE','#22d68e') : badge('PAUSED','#ff3c5f')}
          <button class="btn sm" onclick="YuviSkillManager.toggleRule('${r.id}',${!r.enabled})">${r.enabled?'Pause':'Resume'}</button>
        </div>
      </div>`).join('');
  }

  function toggleRule(id, enabled) {
    window.YuviAutomation?.setEnabled(id, enabled);
    renderAutomationManager();
  }

  // ===== INTEGRATIONS =====
  function renderIntegrations() {
    const el = document.getElementById('yuvi-integrations-status');
    if (!el) return;
    const ghConf = window.YuviGitHub?.getConfig() || {};
    const rows = [
      { name: 'Groq AI', ok: !!localStorage.getItem('yuvi_groq_key'), status: localStorage.getItem('yuvi_groq_key') ? '✓ API key set' : '✗ Set in Settings → AI Configuration' },
      { name: 'GitHub Memory', ok: !!(ghConf.username && ghConf.token), status: ghConf.username ? `✓ ${ghConf.username}/${ghConf.repo}` : '✗ Configure in Settings → Memory' },
      { name: 'Canva', ok: true, status: '◎ Deep-link mode (no API key needed)' },
      { name: 'WhatsApp', ok: true, status: '◎ wa.me links (no API key needed)' }
    ];
    el.innerHTML = rows.map(r => `
      <div class="ym-card" style="flex-direction:row;align-items:center;gap:10px;">
        <div style="flex:1;font-size:12px;">${esc(r.name)}</div>
        <div style="font-size:10px;color:${r.ok?'#22d68e':'#ff3c5f'}">${esc(r.status)}</div>
      </div>`).join('');
  }

  // ===== MEMORY STATUS =====
  function renderMemoryStatus() {
    const el = document.getElementById('yuvi-memory-status');
    if (!el) return;
    function count(key) { try { return JSON.parse(localStorage.getItem(key)||'[]').length; } catch(e){ return 0; } }
    const kStats = window.YuviKnowledge?.getStats() || { total: 0, enabled: 0 };
    const rows = [
      { label: 'Leads',                    val: count('yuvi_leads') },
      { label: 'Pipeline deals',           val: count('yuvi_pipeline') },
      { label: 'Clients',                  val: count('yuvi_clients') },
      { label: 'Knowledge files (active)', val: `${kStats.enabled} / ${kStats.total}` },
      { label: 'Installed Skills',         val: window.YuviSkillRegistry?.count() || 0 },
      { label: 'Event log entries',        val: count('yuvi_event_log') },
      { label: 'GitHub Memory',            val: window.YuviGitHub?.isConfigured() ? '✓ connected' : '✗ not set' }
    ];
    el.innerHTML = rows.map(r => `
      <div class="ym-card" style="flex-direction:row;align-items:center;gap:10px;">
        <div style="flex:1;font-size:11px;opacity:0.8;">${esc(r.label)}</div>
        <div style="font-family:monospace;color:var(--blade,#0ef6ff);font-size:11px;">${esc(String(r.val))}</div>
      </div>`).join('');
  }

  function clearEventLog() {
    if (!confirm('Clear the event log? Does not delete any business data.')) return;
    localStorage.removeItem('yuvi_event_log');
    renderMemoryStatus();
    if (window.showToast) window.showToast('Event log cleared.');
  }

  // ===== PREFERENCES =====
  function loadPreferences() {
    const td = document.getElementById('pref-toast-duration');
    const bt = document.getElementById('pref-briefing-time');
    if (td) td.value = localStorage.getItem('yuvi_pref_toast_duration') || '3';
    if (bt) bt.value = localStorage.getItem('yuvi_pref_briefing_time')  || '08:00';
  }

  function savePreferences() {
    const td = document.getElementById('pref-toast-duration')?.value;
    const bt = document.getElementById('pref-briefing-time')?.value;
    if (td) localStorage.setItem('yuvi_pref_toast_duration', td);
    if (bt) localStorage.setItem('yuvi_pref_briefing_time', bt);
    if (window.showToast) window.showToast('Preferences saved.');
  }

  // ===== REFRESH ALL =====
  function renderAll() {
    renderSkillsManager();
    renderKnowledgeManager();
    renderAutomationManager();
    renderIntegrations();
    renderMemoryStatus();
    loadPreferences();
  }

  // Boot — render once skills are registered (~400ms after page load)
  document.addEventListener('DOMContentLoaded', () => setTimeout(renderAll, 500));

  // Re-render when skills register/toggle
  if (window.YuviBus) {
    window.YuviBus.on('skill.registered', () => setTimeout(renderSkillsManager, 50));
    window.YuviBus.on('skill.toggled',    () => setTimeout(renderSkillsManager, 50));
    window.YuviBus.on('skill.removed',    () => setTimeout(renderSkillsManager, 50));
    window.YuviBus.on('knowledge.added',  () => setTimeout(renderKnowledgeManager, 50));
    window.YuviBus.on('knowledge.removed',() => setTimeout(renderKnowledgeManager, 50));
    window.YuviBus.on('skills.loaded',    () => setTimeout(renderAll, 100));
  }

  // Global exposure — HTML onclicks call these
  window.YuviSkillManager = {
    renderSkillsManager, toggleSkill, setMode, onScheduleChange, setScheduleTime, showConfig, removeSkill,
    handleSkillFileSelect, handleSkillDrop, installSkillFromFile, showSkillDocFormat, downloadSkillTemplate,
    exportSkill: (id) => window.YuviPromptSkillEngine?.exportSkill(id),
    handleKnowledgeUpload, renderKnowledgeManager, toggleKnowledge, removeKnowledge,
    renderAutomationManager, toggleRule,
    renderIntegrations, renderMemoryStatus, clearEventLog,
    savePreferences, loadPreferences, renderAll
  };

  // Backward compat aliases (old settings panel code)
  window.handleKnowledgeUpload = (input) => window.YuviSkillManager.handleKnowledgeUpload(input);
  window.toggleKnowledge       = (id, en) => window.YuviSkillManager.toggleKnowledge(id, en);
  window.removeKnowledge       = (id)     => window.YuviSkillManager.removeKnowledge(id);
  window.renderKnowledgeList   = ()       => window.YuviSkillManager.renderKnowledgeManager();
  window.renderSkillsManager   = ()       => window.YuviSkillManager.renderSkillsManager();
  window.toggleSkill           = (id, en) => window.YuviSkillManager.toggleSkill(id, en);
  window.renderAutomationList  = ()       => window.YuviSkillManager.renderAutomationManager();
  window.renderIntegrationStatus=()       => window.YuviSkillManager.renderIntegrations();
  window.renderMemoryStatus    = ()       => window.YuviSkillManager.renderMemoryStatus();
  window.clearEventLog         = ()       => window.YuviSkillManager.clearEventLog();
  window.savePreferences       = ()       => window.YuviSkillManager.savePreferences();
})();
