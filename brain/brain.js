/**
 * brain/brain.js — YUVI v5 Brain (final)
 * Central orchestrator. All AI requests must flow through here.
 * No module other than integrations/groq.js calls Groq directly.
 *
 * Public API:
 *   YuviBrain.handle(msg)            — try skill intent, return result or null
 *   YuviBrain.chat(msg, opts)        — full AI call via Brain
 *   YuviBrain.composeSystemPrompt()  — ADDITIVE context for index.html bridge
 *   YuviBrain.runChain(steps)        — multi-skill workflow
 */
(function () {

  /* ── Intent → Skill (no AI call) ── */
  function handle(message) {
    const detector     = window.YuviIntentDetector;
    const orchestrator = window.YuviSkillOrchestrator;
    if (!detector || !orchestrator) return null;

    const intent = detector.detect(message);
    if (!intent) return null;

    const result = orchestrator.execute(intent.id, intent.args);
    if (result === null) return null; // no skill registered for this capability

    if (window.YuviBus) window.YuviBus.emit('brain.intent.handled', { intent: intent.id });
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  /* ── Full AI call: compose context → Groq ── */
  async function chat(userMessage, opts = {}) {
    if (!window.YuviGroq)           throw new Error('[Brain] YuviGroq not loaded.');
    if (!window.YuviPromptComposer) throw new Error('[Brain] YuviPromptComposer not loaded.');

    const systemPrompt = window.YuviPromptComposer.compose({
      mode:         opts.mode || 'chat',
      extraContext: opts.extraContext || ''
    });

    const history  = (opts.history || []).slice(-10); // cap history to keep tokens sane
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage }
    ];

    const response = await window.YuviGroq.chat(messages, {
      maxTokens:   opts.maxTokens   || 512,
      temperature: opts.temperature || 0.6,
      model:       opts.model       || undefined
    });

    if (window.YuviBus) window.YuviBus.emit('brain.chat.complete', {
      mode: opts.mode || 'chat', chars: response.length
    });
    return response;
  }

  /* ── Additive bridge for index.html existing sysPrompt ── */
  /* Returns ONLY knowledge + skills + memory — no duplication of existing context */
  function composeSystemPrompt() {
    if (!window.YuviPromptComposer) return '';
    return window.YuviPromptComposer.composeAdditive();
  }

  /* ── Skill chain runner ── */
  async function runChain(steps) {
    const orchestrator = window.YuviSkillOrchestrator;
    if (!orchestrator) return [{ error: 'SkillOrchestrator not loaded' }];
    return orchestrator.runChain(steps);
  }

  window.YuviBrain = { handle, chat, composeSystemPrompt, runChain };
})();
