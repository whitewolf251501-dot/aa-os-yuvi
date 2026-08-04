/**
 * knowledge/knowledgeManager.js
 * Manages uploaded knowledge files. Stores extracted text in localStorage.
 * Exposes window.YuviKnowledge (aliased for backward compat with existing
 * Settings panel code that calls YuviKnowledge.addFromFile etc.)
 */
(function () {
  const STORE_KEY = 'yuvi_knowledge_index';

  function load()       { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; } }
  function persist(arr) { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); }

  async function addFromFile(file) {
    if (!window.YuviFileParser) throw new Error('YuviFileParser not loaded.');
    const result = await window.YuviFileParser.parse(file);
    if (!result.supported) throw new Error(result.message || `Unsupported file type: ${result.type}`);

    const entry = {
      id:         'know_' + Date.now(),
      name:       file.name,
      type:       result.type,
      text:       result.text,
      size_bytes: file.size,
      enabled:    true,
      added_at:   new Date().toISOString()
    };
    const items = load();
    items.push(entry);
    persist(items);

    if (window.YuviBus) window.YuviBus.emit('knowledge.added', { id: entry.id, name: entry.name, type: entry.type });
    return entry;
  }

  function remove(id) {
    persist(load().filter(i => i.id !== id));
    if (window.YuviBus) window.YuviBus.emit('knowledge.removed', { id });
    return true;
  }

  function setEnabled(id, enabled) {
    const items = load();
    const item  = items.find(i => i.id === id);
    if (!item) return false;
    item.enabled = enabled;
    persist(items);
    return true;
  }

  function getAll()        { return load(); }
  function getEnabled()    { return load().filter(i => i.enabled); }

  /**
   * Returns combined knowledge text ready for prompt injection.
   * Truncated per-document to avoid blowing context window.
   */
  function getContextBundle(maxCharsPerDoc = 3500) {
    return getEnabled()
      .map(i => `--- KNOWLEDGE: ${i.name} (${i.type.toUpperCase()}) ---\n${(i.text || '').slice(0, maxCharsPerDoc)}`)
      .join('\n\n');
  }

  function getStats() {
    const all = load();
    return { total: all.length, enabled: all.filter(i => i.enabled).length, size_kb: Math.round(all.reduce((s, i) => s + i.size_bytes, 0) / 1024) };
  }

  window.YuviKnowledge = { addFromFile, remove, setEnabled, getAll, getEnabled, getContextBundle, getStats };
})();
