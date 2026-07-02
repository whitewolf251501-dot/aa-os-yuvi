/**
 * brain/skillOrchestrator.js
 * Executes Skills in response to detected intents. Supports single
 * execution and chained execution (multi-step workflows). The Brain
 * calls this after IntentDetector fires — index.html never calls
 * skills directly.
 */
(function () {

  /**
   * Execute a single capability on the first registered matching skill.
   * @returns {string|any} result from the skill, or null if no skill matched.
   */
  function execute(capability, args = {}) {
    if (!window.YuviSkillRegistry) return null;
    const skills = window.YuviSkillRegistry.findByCapability(capability);
    if (!skills.length) return null;
    const skill = skills[0];
    if (!skill.enabled) return null;
    try {
      const result = skill.api.execute(capability, args);
      if (window.YuviBus) window.YuviBus.emit('skill.executed', { capability, skill_id: skill.id });
      return result;
    } catch (e) {
      console.error(`[SkillOrchestrator] Error executing ${capability} on ${skill.id}:`, e);
      return `Error: ${e.message}`;
    }
  }

  /**
   * Run a chain of steps sequentially, passing each result to the next.
   * Example: Research → Proposal → Canva → PDF → WhatsApp
   * @param {Array<{ capability: string, args?: object }>} steps
   * @returns {Array<{ capability, result?, error? }>}
   */
  async function runChain(steps) {
    const results = [];
    let previous = null;
    for (const step of steps) {
      const result = execute(step.capability, { ...(step.args || {}), previous });
      if (typeof result === 'string' && result.startsWith('Error:')) {
        results.push({ capability: step.capability, error: result });
        break;
      }
      results.push({ capability: step.capability, result });
      previous = result;
    }
    if (window.YuviBus) window.YuviBus.emit('chain.executed', { steps: steps.map(s => s.capability), count: results.length });
    return results;
  }

  window.YuviSkillOrchestrator = { execute, runChain };
})();
