/**
 * brain/intentDetector.js
 * Stateless intent detection. Takes a raw user message, returns a
 * structured intent object or null. No Groq calls, no side effects.
 * The Brain uses this as step 1 of every request.
 */
(function () {

  const RULES = [
    {
      id: 'leads.add',
      pattern: /^add lead[:\s]+(.+?)(?:\s+(\d{10,}))?(?:\s+(website|seo|smm|digital))?$/i,
      extract: m => ({ name: m[1].trim(), phone: m[2] || '', category: m[3] || 'unknown' })
    },
    {
      id: 'leads.score',
      pattern: /^(score leads?|rescore|score all)$/i,
      extract: () => ({})
    },
    {
      id: 'leads.show',
      pattern: /^(leads?|show leads?|open leads?)$/i,
      extract: () => ({})
    },
    {
      id: 'pipeline.move',
      pattern: /move (.+?) to (approached|contacted|interested|proposal.?sent|advance.?pending|closed)/i,
      extract: m => ({ name: m[1].trim(), stage: m[2].toLowerCase().replace(/[\s-]/g, '_') })
    },
    {
      id: 'pipeline.show',
      pattern: /^(pipeline|show pipeline|open pipeline)$/i,
      extract: () => ({})
    },
    {
      id: 'clients.markPayment',
      pattern: /mark (.+?) (?:payment\s+)?(?:as\s+)?(paid|pending|overdue)/i,
      extract: m => ({ name: m[1].trim(), status: m[2] })
    },
    {
      id: 'knowledge.list',
      pattern: /^(show knowledge|list knowledge|what do you know\??)$/i,
      extract: () => ({})
    },
    {
      id: 'skills.list',
      pattern: /^(show skills?|list skills?|installed skills?)$/i,
      extract: () => ({})
    }
  ];

  /**
   * Detect intent from a message string.
   * @returns {{ id: string, args: object, rule: object } | null}
   */
  function detect(message) {
    const msg = (message || '').trim();
    for (const rule of RULES) {
      const match = msg.match(rule.pattern);
      if (match) {
        return { id: rule.id, args: rule.extract(match), rule };
      }
    }
    return null;
  }

  /**
   * Add a custom intent rule at runtime (called by Skills on registration).
   */
  function addRule(rule) {
    if (!rule.id || !rule.pattern || typeof rule.extract !== 'function') {
      console.warn('[IntentDetector] Invalid rule skipped:', rule);
      return false;
    }
    RULES.unshift(rule); // skill rules take priority over defaults
    return true;
  }

  function getRules() { return [...RULES]; }

  window.YuviIntentDetector = { detect, addRule, getRules };
})();
