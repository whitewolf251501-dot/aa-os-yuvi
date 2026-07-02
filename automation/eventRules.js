/**
 * automation/eventRules.js
 * Event-driven automation. Rules listen on YuviBus events and execute
 * step chains. Rules are registered by Skills — not hardcoded here.
 * Exposes window.YuviAutomation (alias maintained for backward compat).
 */
(function () {
  const rules = new Map();

  function registerRule(rule) {
    if (!rule.id || !rule.trigger || !Array.isArray(rule.steps)) {
      console.error('[EventRules] Invalid rule:', rule); return false;
    }
    const entry = { ...rule, enabled: rule.enabled !== false };
    rules.set(rule.id, entry);

    if (window.YuviBus) {
      window.YuviBus.on(rule.trigger, async (event) => {
        const current = rules.get(rule.id);
        if (!current?.enabled) return;
        let payload = event.payload;
        for (const step of current.steps) {
          try {
            const result = await step.run(payload);
            payload = result ?? payload;
          } catch (e) {
            console.error(`[EventRules] Rule "${rule.id}" failed at step "${step.action}":`, e);
            break;
          }
        }
      });
    }
    return true;
  }

  function setEnabled(id, enabled) {
    const r = rules.get(id);
    if (!r) return false;
    r.enabled = enabled;
    return true;
  }

  function list() {
    return [...rules.values()].map(r => ({
      id: r.id, trigger: r.trigger, steps: r.steps.length, enabled: r.enabled, description: r.description || ''
    }));
  }

  function count() { return rules.size; }

  const api = { registerRule, setEnabled, list, count };
  window.YuviAutomation  = api;
  window.YuviEventRules  = api; // canonical name
})();
