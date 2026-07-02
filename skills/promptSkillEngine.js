/**
 * skills/promptSkillEngine.js
 * ───────────────────────────
 * Turns an uploaded skill document into a real, registered, working Skill.
 *
 * SUPPORTED FORMATS
 * ─────────────────
 * .json  — full skill definition as JSON
 * .md    — Markdown with YAML frontmatter (--- block at top)
 * .txt   — plain text treated as the prompt; manifest auto-generated
 * .html  — prompt extracted from <body>, meta tags used for manifest
 *
 * HOW IT WORKS
 * ─────────────
 * 1. User uploads a skill document in Settings → Skills.
 * 2. promptSkillEngine.install(file) parses the file.
 * 3. The parsed PromptSkill is saved to localStorage (yuvi_prompt_skills).
 * 4. It is immediately registered in YuviSkillRegistry as a working Skill.
 * 5. On every boot, loadFromStorage() reloads all saved PromptSkills.
 * 6. The Skill appears in Settings → Skills like any code-based Skill.
 * 7. When triggered (chat or Brain intent), the Skill calls Groq with its
 *    custom prompt and returns a real AI response.
 *
 * SKILL DOCUMENT FORMAT (.json)
 * ──────────────────────────────
 * {
 *   "type":         "yuvi-skill",        ← required, must be "yuvi-skill"
 *   "id":           "my-skill",          ← required, unique slug
 *   "name":         "My Skill",          ← required
 *   "version":      "1.0.0",             ← optional, defaults to "1.0.0"
 *   "description":  "What it does",      ← recommended
 *   "category":     "business",          ← optional
 *   "icon":         "🔧",               ← optional
 *   "prompt":       "You are...",        ← the system prompt for AI calls
 *   "triggers":     ["phrase one",       ← chat phrases that activate this
 *                    "phrase two"],
 *   "capabilities": ["my-skill.run"],    ← capability IDs
 *   "config":       {},                  ← any extra config key-values
 *   "templates":    {}                   ← named output templates (optional)
 * }
 *
 * SKILL DOCUMENT FORMAT (.md)
 * ────────────────────────────
 * ---
 * type: yuvi-skill
 * id: my-skill
 * name: My Skill
 * description: What it does
 * icon: 🔧
 * triggers:
 *   - phrase one
 *   - phrase two
 * ---
 *
 * Everything below the closing --- becomes the system prompt.
 *
 * GENERATING A SKILL DOCUMENT
 * ────────────────────────────
 * Ask YUVI (or Claude): "Generate a YUVI skill document for [what you want]"
 * YUVI will output a .json or .md file you can immediately upload.
 */
(function () {
  'use strict';

  const STORE_KEY = 'yuvi_prompt_skills';

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveAll(skills) {
    localStorage.setItem(STORE_KEY, JSON.stringify(skills));
  }

  // ── Parsers ────────────────────────────────────────────────────────────────

  function parseJSON(text) {
    const obj = JSON.parse(text);
    if (obj.type !== 'yuvi-skill') throw new Error('JSON must have "type": "yuvi-skill"');
    if (!obj.id)   throw new Error('Missing required field: "id"');
    if (!obj.name) throw new Error('Missing required field: "name"');
    return normalise(obj);
  }

  function parseMarkdown(text) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
      // No frontmatter — treat entire content as prompt, generate minimal manifest
      const lines = text.trim().split('\n');
      const firstLine = lines[0].replace(/^#+\s*/, '').trim();
      return normalise({
        type: 'yuvi-skill',
        id: slugify(firstLine || 'uploaded-skill'),
        name: firstLine || 'Uploaded Skill',
        prompt: text.trim()
      });
    }
    const front  = parseYAMLFrontmatter(match[1]);
    const prompt = (match[2] || '').trim();
    if (front.type !== 'yuvi-skill') throw new Error('Frontmatter must have type: yuvi-skill');
    if (!front.id)   throw new Error('Frontmatter missing: id');
    if (!front.name) throw new Error('Frontmatter missing: name');
    return normalise({ ...front, prompt: front.prompt || prompt });
  }

  function parseTXT(text) {
    const lines = text.trim().split('\n');
    const firstLine = lines[0].replace(/^#+\s*/, '').trim();
    return normalise({
      type: 'yuvi-skill',
      id: slugify(firstLine || 'text-skill-' + Date.now()),
      name: firstLine || 'Text Skill',
      description: 'Skill created from plain text upload.',
      prompt: text.trim()
    });
  }

  function parseHTML(text) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(text, 'text/html');
    const getMeta = (name) => doc.querySelector(`meta[name="${name}"]`)?.content || '';
    const id   = getMeta('skill-id') || slugify(doc.title || 'html-skill');
    const name = getMeta('skill-name') || doc.title || 'HTML Skill';
    const prompt = (doc.body?.innerText || doc.body?.textContent || '').trim();
    return normalise({
      type: 'yuvi-skill',
      id, name,
      description: getMeta('skill-description'),
      icon:        getMeta('skill-icon'),
      prompt
    });
  }

  // ── Minimal YAML frontmatter parser (no library dependency) ───────────────
  function parseYAMLFrontmatter(text) {
    const result = {};
    const lines  = text.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const keyVal = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
      if (!keyVal) { i++; continue; }
      const key = keyVal[1];
      let   val = keyVal[2].trim();

      // Inline value
      if (val && !val.startsWith('|') && !val.startsWith('>')) {
        // Quoted string
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        result[key] = val;
        i++; continue;
      }

      // Block scalar (| or >)
      if (val === '|' || val === '>') {
        const blockLines = [];
        i++;
        while (i < lines.length && (lines[i].startsWith('  ') || lines[i] === '')) {
          blockLines.push(lines[i].replace(/^  /, ''));
          i++;
        }
        result[key] = blockLines.join(val === '|' ? '\n' : ' ').trim();
        continue;
      }

      // List items on following lines
      if (!val) {
        const items = [];
        i++;
        while (i < lines.length && lines[i].match(/^\s*-\s+/)) {
          items.push(lines[i].replace(/^\s*-\s+/, '').trim());
          i++;
        }
        result[key] = items.length ? items : [];
        continue;
      }
      result[key] = val;
      i++;
    }
    return result;
  }

  // ── Normalise parsed object into a consistent PromptSkill shape ───────────
  function normalise(raw) {
    const id = slugify(raw.id || raw.name || 'skill-' + Date.now());
    return {
      id,
      name:         raw.name        || id,
      version:      raw.version     || '1.0.0',
      description:  raw.description || 'Uploaded prompt skill.',
      category:     raw.category    || 'business',
      icon:         raw.icon        || '🧩',
      prompt:       raw.prompt      || '',
      triggers:     Array.isArray(raw.triggers)     ? raw.triggers     : [],
      capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [`${id}.run`],
      config:       raw.config      || {},
      templates:    raw.templates   || {},
      source:       'upload',
      uploaded_at:  new Date().toISOString()
    };
  }

  function slugify(str) {
    return (str || 'skill').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'skill';
  }

  // ── Parse a File object into a PromptSkill definition ─────────────────────
  async function parseFile(file) {
    const text = await file.text();
    const name = file.name.toLowerCase();
    if (name.endsWith('.json'))            return parseJSON(text);
    if (name.endsWith('.md') || name.endsWith('.markdown')) return parseMarkdown(text);
    if (name.endsWith('.html') || name.endsWith('.htm'))    return parseHTML(text);
    return parseTXT(text); // .txt, .yaml, .csv, .doc (plaintext), anything else
  }

  // ── Register a PromptSkill in YuviSkillRegistry ───────────────────────────
  function registerSkill(ps) {
    if (!window.YuviSkillRegistry) {
      console.error('[PromptSkillEngine] YuviSkillRegistry not loaded.');
      return false;
    }

    const manifest = {
      id:           ps.id,
      name:         ps.name,
      version:      ps.version,
      description:  ps.description,
      category:     ps.category,
      icon:         ps.icon,
      capabilities: ps.capabilities,
      dependencies: [],
      source:       'prompt-skill'
    };

    const api = {
      execute(capability, args = {}) {
        // All capabilities route to the same AI call with this skill's prompt
        return executePromptSkill(ps, capability, args);
      },
      onEnable()  { console.log(`[PromptSkill] ${ps.id} enabled`); },
      onDisable() { console.log(`[PromptSkill] ${ps.id} disabled`); },
      onUninstall() { remove(ps.id); }
    };

    // Register intent triggers so Brain can route chat messages
    if (window.YuviIntentDetector && ps.triggers.length) {
      ps.triggers.forEach(trigger => {
        const pattern = new RegExp(
          trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'i'
        );
        window.YuviIntentDetector.addRule({
          id:      ps.capabilities[0] || `${ps.id}.run`,
          pattern: pattern,
          extract: (m) => ({ message: m.input, trigger })
        });
      });
    }

    return window.YuviSkillRegistry.register(manifest, api);
  }

  // ── Execute a PromptSkill — calls Brain → Groq ────────────────────────────
  async function executePromptSkill(ps, capability, args) {
    if (!window.YuviGroq) throw new Error('YuviGroq not loaded.');

    const userMessage = args.message
      || args.previous
      || `Run: ${capability}`;

    const templateKey = Object.keys(ps.templates)[0];
    const template    = templateKey ? `\n\nOUTPUT TEMPLATE:\n${ps.templates[templateKey]}` : '';

    const systemPrompt = [
      ps.prompt || `You are a specialised assistant called ${ps.name}.`,
      template,
      ps.config && Object.keys(ps.config).length
        ? `\n\nCONFIGURATION:\n${JSON.stringify(ps.config, null, 2)}`
        : '',
      // Always append the Brain's knowledge + memory context
      window.YuviBrain ? '\n\n' + window.YuviBrain.composeSystemPrompt() : ''
    ].filter(Boolean).join('');

    const response = await window.YuviGroq.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage }
    ], { maxTokens: 768 });

    if (window.YuviBus) window.YuviBus.emit('prompt-skill.executed', { id: ps.id, capability });
    return response;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Install a PromptSkill from a File object.
   * Parses, persists to localStorage, registers in YuviSkillRegistry.
   * Returns the installed PromptSkill object.
   */
  async function install(file) {
    const ps    = await parseFile(file);
    const all   = loadAll().filter(s => s.id !== ps.id); // replace if same id
    all.push(ps);
    saveAll(all);
    registerSkill(ps);
    if (window.YuviBus) window.YuviBus.emit('prompt-skill.installed', { id: ps.id, name: ps.name });
    return ps;
  }

  /**
   * Remove a PromptSkill by id.
   */
  function remove(id) {
    saveAll(loadAll().filter(s => s.id !== id));
    if (window.YuviSkillRegistry) window.YuviSkillRegistry.remove(id);
    if (window.YuviBus) window.YuviBus.emit('prompt-skill.removed', { id });
  }

  /**
   * Load all persisted PromptSkills from localStorage and register them.
   * Called on every boot.
   */
  function loadFromStorage() {
    const all = loadAll();
    if (!all.length) return;
    let registered = 0;
    all.forEach(ps => {
      try { if (registerSkill(ps)) registered++; }
      catch (e) { console.error(`[PromptSkillEngine] Failed to register ${ps.id}:`, e); }
    });
    console.log(`[PromptSkillEngine] ${registered}/${all.length} prompt skills loaded from storage.`);
    if (window.YuviBus) window.YuviBus.emit('prompt-skills.loaded', { count: registered });
  }

  /**
   * Return all stored PromptSkills (for UI rendering).
   */
  function list() { return loadAll(); }

  /**
   * Export a PromptSkill back to a downloadable .json file.
   */
  function exportSkill(id) {
    const ps = loadAll().find(s => s.id === id);
    if (!ps) return;
    const blob = new Blob([JSON.stringify(ps, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${ps.id}.yuvi-skill.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  window.YuviPromptSkillEngine = { install, remove, list, loadFromStorage, exportSkill, parseFile };
})();
