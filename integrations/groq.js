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
    // v6: secrets live encrypted-at-rest in the vault; getItem() reads the
    // decrypted in-memory cache populated on unlock (see core/vault.js).
    if (window.YuviVault) return window.YuviVault.getItem('yuvi_groq_key') || '';
    return localStorage.getItem('yuvi_groq_key') || ''; // pre-vault fallback, should not normally hit
  }

  async function chat(messages, opts = {}) {
    // If a specific key was handed in (this only happens from the Settings
    // "Test" button, where the user is testing a key they just typed),
    // call Groq directly with that one-off key — nothing to proxy there.
    if (opts.apiKey) return chatDirect(messages, opts);

    // Normal path: every real AI call in the app now goes through the
    // server-side proxy at /api/groq-chat. The real Groq key lives only on
    // Vercel's server (as GROQ_API_KEY) and never reaches this browser.
    const res = await fetch('/api/groq-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 1024
      })
    });

    if (!res.ok) {
      let errMsg = `AI proxy error ${res.status}`;
      try {
        const errData = await res.json();
        if (errData && errData.error) errMsg = errData.error;
      } catch (e) { /* ignore parse failure, keep default message */ }
      throw new Error(errMsg);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  // Used only by the Settings "Test" button — calls Groq directly with a
  // key the user just typed in (not yet saved), so it can't go through the
  // server proxy (the server doesn't know about that key).
  async function chatDirect(messages, opts = {}) {
    const key = opts.apiKey;
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
