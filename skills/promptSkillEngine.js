/**
 * skills/promptSkillEngine.js — YUVI v5.1.1
 * Upload a skill document → YUVI learns it → executes it → saves output → remembers it.
 */
(function () {
  'use strict';

  const STORE_KEY = 'yuvi_prompt_skills';
  const GEN_KEY   = 'yuvi_generations';

  // ── Storage ───────────────────────────────────────────────────────────────
  function loadAll()       { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch(e){ return []; } }
  function saveAll(arr)    { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); }
  function loadGens()      { try { return JSON.parse(localStorage.getItem(GEN_KEY)   || '[]'); } catch(e){ return []; } }
  function saveGens(arr)   { localStorage.setItem(GEN_KEY, JSON.stringify(arr)); }

  // ── Parsers ───────────────────────────────────────────────────────────────
  function parseJSON(text) {
    const obj = JSON.parse(text);
    if (obj.type !== 'yuvi-skill') throw new Error('JSON must have "type": "yuvi-skill"');
    if (!obj.id)   throw new Error('Missing: id');
    if (!obj.name) throw new Error('Missing: name');
    return normalise(obj);
  }

  function parseMarkdown(text) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
      const firstLine = text.trim().split('\n')[0].replace(/^#+\s*/,'').trim();
      return normalise({ type:'yuvi-skill', id: slugify(firstLine||'skill'), name: firstLine||'Uploaded Skill', prompt: text.trim() });
    }
    const front  = parseYAML(match[1]);
    const prompt = (match[2]||'').trim();
    if (front.type !== 'yuvi-skill') throw new Error('Frontmatter must have type: yuvi-skill');
    if (!front.id)   throw new Error('Frontmatter missing: id');
    if (!front.name) throw new Error('Frontmatter missing: name');
    return normalise({ ...front, prompt: front.prompt || prompt });
  }

  function parseTXT(text) {
    const firstLine = text.trim().split('\n')[0].replace(/^#+\s*/,'').trim();
    return normalise({ type:'yuvi-skill', id: slugify(firstLine||'skill-'+Date.now()), name: firstLine||'Text Skill', prompt: text.trim() });
  }

  function parseHTML(text) {
    const doc      = new DOMParser().parseFromString(text, 'text/html');
    const getMeta  = n => doc.querySelector(`meta[name="${n}"]`)?.content || '';
    const id       = getMeta('skill-id') || slugify(doc.title || 'html-skill');
    return normalise({ type:'yuvi-skill', id, name: getMeta('skill-name')||doc.title||'HTML Skill',
      description: getMeta('skill-description'), icon: getMeta('skill-icon'),
      prompt: (doc.body?.textContent||'').trim() });
  }

  function parseYAML(text) {
    const result = {}; const lines = text.split('\n'); let i = 0;
    while (i < lines.length) {
      const kv = lines[i].match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
      if (!kv) { i++; continue; }
      const key = kv[1]; let val = kv[2].trim();
      if (val && val !== '|' && val !== '>') {
        if ((val.startsWith('"')&&val.endsWith('"'))||(val.startsWith("'")&&val.endsWith("'"))) val = val.slice(1,-1);
        result[key] = val; i++; continue;
      }
      if (!val) {
        const items = []; i++;
        while (i<lines.length && lines[i].match(/^\s*-\s+/)) { items.push(lines[i].replace(/^\s*-\s+/,'').trim()); i++; }
        result[key] = items.length ? items : []; continue;
      }
      result[key] = val; i++;
    }
    return result;
  }

  function normalise(raw) {
    const id = slugify(raw.id || raw.name || 'skill-' + Date.now());
    return {
      id, name: raw.name||id, version: raw.version||'1.0.0',
      description: raw.description||'Uploaded prompt skill.',
      category: raw.category||'business', icon: raw.icon||'🧩',
      prompt: raw.prompt||'', triggers: Array.isArray(raw.triggers)?raw.triggers:[],
      capabilities: Array.isArray(raw.capabilities)?raw.capabilities:[`${id}.run`],
      config: raw.config||{}, templates: raw.templates||{},
      source: 'upload', uploaded_at: new Date().toISOString()
    };
  }

  function slugify(str) {
    return (str||'skill').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)||'skill';
  }

  async function parseFile(file) {
    const text = await file.text();
    const n    = file.name.toLowerCase();
    if (n.endsWith('.json'))                           return parseJSON(text);
    if (n.endsWith('.md')||n.endsWith('.markdown'))    return parseMarkdown(text);
    if (n.endsWith('.html')||n.endsWith('.htm'))       return parseHTML(text);
    return parseTXT(text);
  }

  // ── Smart intent matching (fuzzy — not exact phrase only) ─────────────────
  function buildSmartPattern(trigger) {
    // Tokenise trigger into key words, match if most are present in input
    const words = trigger.toLowerCase().replace(/[^a-z0-9\s]/g,' ').trim().split(/\s+/).filter(w=>w.length>2);
    if (!words.length) return null;
    // Pattern: all keywords must appear (in any order) in the input
    return new RegExp(words.map(w => `(?=.*\\b${w})`).join(''), 'i');
  }

  // ── Register skill in YuviSkillRegistry ───────────────────────────────────
  function registerSkill(ps) {
    if (!window.YuviSkillRegistry) { console.error('[PromptSkillEngine] YuviSkillRegistry not loaded'); return false; }

    const manifest = {
      id: ps.id, name: ps.name, version: ps.version, description: ps.description,
      category: ps.category, icon: ps.icon, capabilities: ps.capabilities,
      dependencies: [], source: 'prompt-skill'
    };

    const api = {
      execute(capability, args={}) { return executePromptSkill(ps, capability, args); },
      onEnable()    { console.log(`[PromptSkill] ${ps.id} enabled`); },
      onDisable()   { console.log(`[PromptSkill] ${ps.id} disabled`); },
      onUninstall() { remove(ps.id); }
    };

    // Register smart intent triggers
    if (window.YuviIntentDetector && ps.triggers.length) {
      ps.triggers.forEach(trigger => {
        const pattern = buildSmartPattern(trigger);
        if (!pattern) return;
        window.YuviIntentDetector.addRule({
          id:      ps.capabilities[0] || `${ps.id}.run`,
          pattern: pattern,
          extract: (m) => ({ message: m.input, trigger, client: extractClient(m.input) })
        });
      });
    }

    return window.YuviSkillRegistry.register(manifest, api);
  }

  // ── Extract client name from user message ─────────────────────────────────
  function extractClient(message) {
    const clients = JSON.parse(localStorage.getItem('yuvi_clients') || '[]');
    const msg     = (message||'').toLowerCase();
    for (const c of clients) {
      if (c.name && msg.includes(c.name.toLowerCase())) return c.name;
    }
    return null;
  }

  // ── Execute a PromptSkill — calls Brain → Groq → saves output ────────────
  async function executePromptSkill(ps, capability, args={}) {
    if (!window.YuviGroq) throw new Error('YuviGroq not loaded.');

    const userMessage = args.message || args.previous || `Run: ${capability}`;
    const client      = args.client  || extractClient(userMessage) || null;

    const templateKey = Object.keys(ps.templates||{})[0];
    const template    = templateKey ? `\n\nOUTPUT TEMPLATE:\n${ps.templates[templateKey]}` : '';
    const configStr   = Object.keys(ps.config||{}).length ? `\n\nCONFIG:\n${JSON.stringify(ps.config,null,2)}` : '';
    const brainCtx    = window.YuviBrain ? '\n\n' + window.YuviBrain.composeSystemPrompt() : '';

    const systemPrompt = [
      ps.prompt || `You are a specialist AI assistant called ${ps.name} for Yugantar Growth.`,
      template, configStr, brainCtx
    ].filter(Boolean).join('');

    const response = await window.YuviGroq.chat(
      [{ role:'system', content:systemPrompt }, { role:'user', content:userMessage }],
      { maxTokens: 768 }
    );

    // ── SAVE OUTPUT to Generation Hub ────────────────────────────────────────
    const gen = {
      id:         'gen_' + Date.now(),
      skill_id:   ps.id,
      skill_name: ps.name,
      capability,
      client:     client,
      title:      `${ps.name}${client ? ' · ' + client : ''}`,
      content:    response,
      type:       ps.category,
      created_at: new Date().toISOString()
    };
    const gens = loadGens();
    gens.unshift(gen); // newest first
    if (gens.length > 500) gens.splice(500); // cap at 500
    saveGens(gens);

    // ── RECORD in Memory ─────────────────────────────────────────────────────
    const memKey   = 'yuvi_skill_memory';
    const skillMem = JSON.parse(localStorage.getItem(memKey)||'[]');
    skillMem.unshift({
      skill_id: ps.id, skill_name: ps.name, capability,
      client, summary: response.slice(0, 200),
      ran_at: new Date().toISOString()
    });
    if (skillMem.length > 200) skillMem.splice(200);
    localStorage.setItem(memKey, JSON.stringify(skillMem));

    // ── Emit event ───────────────────────────────────────────────────────────
    if (window.YuviBus) window.YuviBus.emit('skill.output.saved', { gen_id: gen.id, skill_id: ps.id, client });

    return response;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  async function install(file) {
    const ps   = await parseFile(file);
    const all  = loadAll().filter(s => s.id !== ps.id);
    all.push(ps);
    saveAll(all);
    registerSkill(ps);
    if (window.YuviBus) window.YuviBus.emit('prompt-skill.installed', { id: ps.id, name: ps.name });
    return ps;
  }

  function remove(id) {
    saveAll(loadAll().filter(s => s.id !== id));
    if (window.YuviSkillRegistry) window.YuviSkillRegistry.remove(id);
    if (window.YuviBus) window.YuviBus.emit('prompt-skill.removed', { id });
  }

  function list()    { return loadAll(); }

  // Return all generations, optionally filtered
  function getGenerations({ skill_id, client, type, limit } = {}) {
    let gens = loadGens();
    if (skill_id) gens = gens.filter(g => g.skill_id === skill_id);
    if (client)   gens = gens.filter(g => g.client   === client);
    if (type)     gens = gens.filter(g => g.type      === type);
    if (limit)    gens = gens.slice(0, limit);
    return gens;
  }

  function deleteGeneration(id) {
    saveGens(loadGens().filter(g => g.id !== id));
  }

  function getSkillMemory(skill_id) {
    const all = JSON.parse(localStorage.getItem('yuvi_skill_memory')||'[]');
    return skill_id ? all.filter(m => m.skill_id === skill_id) : all;
  }

  function exportSkill(id) {
    const ps = loadAll().find(s => s.id === id);
    if (!ps) return;
    const blob = new Blob([JSON.stringify(ps,null,2)],{type:'application/json'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=`${ps.id}.yuvi-skill.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function loadFromStorage() {
    const all = loadAll();
    if (!all.length) return;
    let n = 0;
    all.forEach(ps => { try { if(registerSkill(ps)) n++; } catch(e) { console.error('[PromptSkillEngine]',ps.id,e); } });
    console.log(`[PromptSkillEngine] ${n}/${all.length} prompt skills loaded`);
    if (window.YuviBus) window.YuviBus.emit('prompt-skills.loaded', { count: n });
  }

  window.YuviPromptSkillEngine = { install, remove, list, loadFromStorage, exportSkill, getGenerations, deleteGeneration, getSkillMemory, parseFile };
})();
