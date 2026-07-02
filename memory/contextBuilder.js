/**
 * memory/contextBuilder.js
 * Aggregates all context the Brain needs into one object.
 * Individual pieces (business context, conversation memory, GitHub memory,
 * knowledge) are sourced from their own modules — this is the assembler.
 * Exposes window.YuviMemory (alias maintained for backward compat).
 */
(function () {

  function safeParse(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
  }

  // --- Business context (Settings → localStorage) ---
  function getBusinessContext() { return localStorage.getItem('yuvi_biz_ctx') || ''; }
  function getPersonality()     { return localStorage.getItem('yuvi_personality') || ''; }

  // --- Conversation memory summary (written by autoSaveSession in index.html) ---
  function getConversationSummary() { return localStorage.getItem('yuvi_memory_summary') || ''; }

  // --- Live CRM data ---
  function getLiveAppData() {
    return {
      leads:    safeParse('yuvi_leads'),
      pipeline: safeParse('yuvi_pipeline'),
      clients:  safeParse('yuvi_clients'),
      revenue:  safeParse('yuvi_revenue')
    };
  }

  // --- Conversation history for multi-turn chat ---
  function getConversationHistory(limit = 20) {
    try {
      return JSON.parse(localStorage.getItem('yuvi_chat_history') || '[]').slice(-limit);
    } catch (e) { return []; }
  }

  // --- GitHub long-term memory ---
  async function getGitHubMemory() {
    const mod = window.YuviGitHub || window.YuviGitHubMemory;
    if (!mod) return null;
    try { const { content } = await mod.readFile('memory.json'); return content; }
    catch (e) { console.warn('[ContextBuilder] GitHub memory unavailable:', e.message); return null; }
  }

  // --- Uploaded knowledge ---
  function getUploadedKnowledge(maxCharsPerDoc = 3500) {
    return window.YuviKnowledge ? window.YuviKnowledge.getContextBundle(maxCharsPerDoc) : '';
  }

  // --- Installed skills summary ---
  function getInstalledSkills() {
    return window.YuviSkillRegistry ? window.YuviSkillRegistry.list() : [];
  }

  // --- Full context bundle (used by PromptComposer / Brain.chat) ---
  async function build() {
    const githubMemory = await getGitHubMemory();
    return {
      businessContext:      getBusinessContext(),
      personality:          getPersonality(),
      conversationSummary:  getConversationSummary(),
      liveAppData:          getLiveAppData(),
      conversationHistory:  getConversationHistory(),
      uploadedKnowledge:    getUploadedKnowledge(),
      installedSkills:      getInstalledSkills(),
      githubMemory
    };
  }

  // Expose — also alias to YuviMemory for any code that already references it
  const api = { getBusinessContext, getPersonality, getConversationSummary, getLiveAppData, getConversationHistory, getGitHubMemory, getUploadedKnowledge, getInstalledSkills, build, buildFullContext: build };
  window.YuviMemory        = api;
  window.YuviContextBuilder = api;
})();
