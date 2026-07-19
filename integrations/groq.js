/**
 * integrations/groq.js
 * Clean interface around the Groq Chat Completions API.
 * Scaffolding only — your existing inline fetchBriefingFromGroq() and
 * chat call in index.html are untouched and keep working as-is. This
 * module exists so future Skills/Brain logic call ONE function instead
 * of duplicating fetch boilerplate everywhere.
 */
(function () {
  const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

  function getKey() {
    // v6: secrets live encrypted-at-rest in the vault; getItem() reads the
    // decrypted in-memory cache populated on unlock (see core/vault.js).
    if (window.YuviVault) return window.YuviVault.getItem('yuvi_groq_key') || '';
    return localStorage.getItem('yuvi_groq_key') || ''; // pre-vault fallback, should not normally hit
  }

  async function chat(messages, opts = {}) {
    // If a specific key was handed in (this only happens from the Settings
    // "Test" button, testing a key the user just typed but hasn't saved),
    // route it through the proxy as a one-off testKey instead.
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

  // Used only by the Settings "Test" button — checks a key the user just
  // typed in (not yet saved). Goes through the same server-side proxy as
  // every other call, passing the unsaved key as a one-off "testKey" that
  // the server uses for this single request only and never stores. This
  // means the browser never needs to talk to api.groq.com directly.
  async function chatDirect(messages, opts = {}) {
    const res = await fetch('/api/groq-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 1024,
        testKey: opts.apiKey
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
