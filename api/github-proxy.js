/**
 * api/github-proxy.js
 * Server-side proxy for reading/writing files to the GitHub memory repo.
 *
 * WHY THIS FILE EXISTS:
 * Before this, the browser held the GitHub Personal Access Token (in plain
 * localStorage, not even the encrypted vault) and sent it directly to
 * api.github.com on every memory read/write — visible in the Network tab
 * every time, same problem as the old Groq key.
 *
 * Now: the browser sends { action, username, repo, path, content, message }
 * to THIS endpoint (same origin, no token attached). This function runs on
 * Vercel's server, reads the real token from an environment variable that
 * only the server can see, talks to GitHub itself, and hands back the
 * result. The token never touches the browser.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(500).json({
      error: 'Server is missing GITHUB_TOKEN. Add it in Vercel → Project Settings → Environment Variables, then redeploy.'
    });
    return;
  }

  const { action, username, repo, path, content, message } = req.body || {};
  if (!username || !repo || !path) {
    res.status(400).json({ error: 'username, repo, and path are required.' });
    return;
  }
  if (action !== 'read' && action !== 'write') {
    res.status(400).json({ error: 'action must be "read" or "write".' });
    return;
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/contents/${path}`;
  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };

  try {
    if (action === 'read') {
      const ghRes = await fetch(url, { headers });
      if (ghRes.status === 404) { res.status(200).json({ content: null, sha: null }); return; }
      if (!ghRes.ok) {
        const errText = await ghRes.text();
        res.status(ghRes.status).json({ error: `GitHub read error ${ghRes.status}: ${errText}` });
        return;
      }
      const data = await ghRes.json();
      const decoded = Buffer.from(data.content, 'base64').toString('utf8');
      let parsed;
      try { parsed = JSON.parse(decoded); } catch (e) { parsed = decoded; }
      res.status(200).json({ content: parsed, sha: data.sha });
      return;
    }

    // action === 'write'
    // Always fetch the current sha right before writing — avoids relying on
    // a client-cached sha that might be stale (and avoids the client ever
    // needing to track sha values itself).
    let sha = null;
    const shaRes = await fetch(url, { headers });
    if (shaRes.ok) { const shaData = await shaRes.json(); sha = shaData.sha; }

    const encoded = Buffer.from(JSON.stringify(content, null, 2), 'utf8').toString('base64');
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message || 'YUVI sync', content: encoded, ...(sha ? { sha } : {}) })
    });
    if (!putRes.ok) {
      const errText = await putRes.text();
      res.status(putRes.status).json({ error: `GitHub write error ${putRes.status}: ${errText}` });
      return;
    }
    const putData = await putRes.json();
    res.status(200).json(putData);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Proxy request failed.' });
  }
};
