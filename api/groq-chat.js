/**
 * api/groq-chat.js
 * Server-side proxy for Groq chat completions.
 *
 * WHY THIS FILE EXISTS:
 * Before this, the browser held the Groq API key (even if encrypted-at-rest
 * in the vault) and sent it directly to api.groq.com on every AI call —
 * meaning the real key was visible in the browser's Network tab every time.
 *
 * Now: the browser sends the chat messages to THIS endpoint (same origin,
 * no key attached). This function runs on Vercel's server, reads the real
 * key from an environment variable that only the server can see, calls Groq
 * itself, and hands back the answer. The key never touches the browser.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const { messages, model, temperature, max_tokens, testKey } = req.body || {};

  // testKey: only used by Settings' "Test Key" button, to check a key the
  // user just typed in but hasn't saved yet. If present, use it instead of
  // the saved server key for THIS request only — it is never stored, and
  // never leaves the server (the browser still never talks to Groq itself).
  const apiKey = testKey || process.env.GROQ_API_KEY;
  if (!apiKey) {
    // This fires only if the Vercel env variable hasn't been added yet.
    res.status(500).json({
      error: 'Server is missing GROQ_API_KEY. Add it in Vercel → Project Settings → Environment Variables, then redeploy.'
    });
    return;
  }

  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: 'messages array is required.' });
    return;
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 1024
      })
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      res.status(groqRes.status).json({ error: data?.error?.message || 'Groq API error.' });
      return;
    }

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Proxy request failed.' });
  }
};
