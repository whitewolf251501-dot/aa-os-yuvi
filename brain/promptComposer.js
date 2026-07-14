/**
 * brain/promptComposer.js
 * Assembles the system prompt for every AI call.
 *
 * Two modes:
 *
 * compose(opts)         — full prompt (used by Brain.chat() for clean AI calls)
 * composeAdditive(opts) — ONLY the additive context that index.html's existing
 *                         sysPrompt doesn't already include (knowledge, skills
 *                         summary, memory summary). This is the bridge called
 *                         from the existing Groq fetch in index.html to avoid
 *                         duplicating personality/bizCtx/liveState.
 */
(function () {

  const MODE_INSTRUCTIONS = {
    chat:     'Answer directly and concisely. You know this business inside out.',
    plan:     'Create a structured action plan with clear steps and timelines.',
    outreach: 'Write WhatsApp/email outreach. Punchy, Hinglish acceptable, under 3 lines unless asked. End with the 48-hour website hook when relevant.',
    proposal: 'Draft a professional proposal for an Ahmedabad SME. Include problem, solution, pricing, and next step.',
    brief:    'Write a sharp CEO briefing. Bullet points. No fluff. What happened, what matters, what to do next.',
    research: 'Research thoroughly. Structure the output clearly with headings and key takeaways.'
  };

  function safeParse(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
  }

  function getLiveState() {
    const leads    = safeParse('yuvi_leads');
    const clients  = safeParse('yuvi_clients');
    const pipeline = safeParse('yuvi_pipeline');
    const parts    = [];
    if (leads.length)    parts.push(`Leads: ${leads.length} total, ${leads.filter(l => l.status === 'interested').length} interested, ${leads.filter(l => (l.score||0) >= 8).length} hot.`);
    if (clients.length)  parts.push(`Clients: ${clients.map(c => c.name).join(', ')}.`);
    if (pipeline.length) parts.push(`Pipeline: ${pipeline.length} deals, ${pipeline.filter(d => d.stage !== 'closed').length} open.`);
    return parts.join(' ');
  }

  function getKnowledgeContext(maxChars = 3500) {
    if (!window.YuviKnowledge) return '';
    return window.YuviKnowledge.getContextBundle(maxChars);
  }

  function getSkillsSummary() {
    if (!window.YuviSkillRegistry) return '';
    const skills = window.YuviSkillRegistry.list().filter(s => s.enabled);
    if (!skills.length) return '';
    return skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
  }

  function getMemorySummary() {
    return localStorage.getItem('yuvi_memory_summary') || '';
  }

  /**
   * Full prompt — used when Brain.chat() makes a clean AI call.
   */
  function compose(opts = {}) {
    const mode         = opts.mode || 'chat';
    const personality  = opts.personality  || localStorage.getItem('yuvi_personality')  || 'Sharp, direct, practical. Ahmedabad business culture aware.';
    const bizCtx       = opts.businessContext || localStorage.getItem('yuvi_biz_ctx') || 'Yugantar Growth. Digital agency, Ahmedabad. Owner: Shlok Pandya, 21.';
    const liveState    = getLiveState();
    const knowledge    = getKnowledgeContext();
    const skills       = getSkillsSummary();
    const memory       = getMemorySummary();
    const modeInstr    = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.chat;
    const now          = new Date();
    const dateStr      = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr      = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    return [
      personality,
      `\n--- BUSINESS CONTEXT ---\n${bizCtx}`,
      liveState  ? `\n--- LIVE STATE ---\n${liveState}`        : '',
      `\n--- DATE/TIME ---\n${dateStr} at ${timeStr} IST`,
      memory     ? `\n--- MEMORY ---\n${memory}`               : '',
      knowledge  ? `\n--- KNOWLEDGE BASE ---\n${knowledge}`    : '',
      skills     ? `\n--- INSTALLED SKILLS ---\n${skills}`     : '',
      opts.extraContext ? `\n--- CONTEXT ---\n${opts.extraContext}` : '',
      `\n--- MODE: ${mode.toUpperCase()} ---\n${modeInstr}`
    ].filter(Boolean).join('\n');
  }

  /**
   * Additive-only context — appended to the EXISTING sysPrompt in index.html.
   * Does NOT include personality, bizCtx, liveState, or date (already there).
   * Only adds: uploaded knowledge + skills summary + memory summary.
   * This prevents prompt duplication in the backward-compat bridge.
   */
  function composeAdditive() {
    const parts   = [];
    const knowledge = getKnowledgeContext();
    const skills    = getSkillsSummary();
    const memory    = getMemorySummary();

    if (memory)    parts.push(`=== YUVI MEMORY ===\n${memory}`);
    if (knowledge) parts.push(`=== KNOWLEDGE BASE ===\n${knowledge}`);
    if (skills)    parts.push(`=== INSTALLED SKILLS ===\n${skills}`);

    return parts.join('\n\n');
  }

  window.YuviPromptComposer = { compose, composeAdditive, getLiveState, getKnowledgeContext, getSkillsSummary, MODE_INSTRUCTIONS };
})();
