/**
 * integrations/groq.js
 * Clean interface around the Groq Chat Completions API.
 * Scaffolding only — your existing inline fetchBriefingFromGroq() and
 * chat call in index.html are untouched and keep working as-is. This
 * module exists so future Skills/Brain logic call ONE function instead
 * of duplicating fetch boilerplate everywhere.
 */
(function () {
  const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

  function getKey() {
    return localStorage.getItem('yuvi_groq_key') || '';
  }

  async function chat(messages, opts = {}) {
    const key = opts.apiKey || getKey();
    if (!key) throw new Error('No Groq API key configured. Set it in Settings.');

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 1024
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async function testKey(apiKey) {
    try {
      await chat([{ role: 'user', content: 'ping' }], { apiKey, maxTokens: 5 });
      return true;
    } catch (e) {
      return false;
    }
  }

  window.YuviGroq = { chat, testKey, getKey };
})();
