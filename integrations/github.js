/**
 * integrations/github.js
 * Clean GitHub Contents API wrapper. Exposes window.YuviGitHub.
 * Also aliased as window.YuviGitHubMemory for backward compat.
 *
 * v6.1 — SECURITY FIX (Track B Step 2): this used to hold the GitHub token
 * and call api.github.com directly from the browser. Now it calls the
 * server-side proxy at /api/github-proxy, which holds the real token
 * (GITHUB_TOKEN env var on Vercel). The token never reaches this file
 * or the browser at all anymore — only username/repo (not secrets) do.
 */
(function () {
  function getConfig() {
    return {
      username: localStorage.getItem('yuvi_gh_user') || '',
      repo:     localStorage.getItem('yuvi_gh_repo') || ''
    };
  }

  function isConfigured() {
    const { username, repo } = getConfig();
    return !!(username && repo);
  }

  async function proxyCall(body) {
    const res = await fetch('/api/github-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `GitHub proxy error ${res.status}`);
    return data;
  }

  async function readFile(path = 'memory.json') {
    const { username, repo } = getConfig();
    if (!username || !repo) throw new Error('GitHub not configured.');
    return await proxyCall({ action: 'read', username, repo, path });
  }

  async function writeFile(content, path = 'memory.json', message = 'YUVI sync') {
    const { username, repo } = getConfig();
    if (!username || !repo) throw new Error('GitHub not configured.');
    return await proxyCall({ action: 'write', username, repo, path, content, message });
  }

  const api = { getConfig, isConfigured, readFile, writeFile };
  window.YuviGitHub       = api;
  window.YuviGitHubMemory = api;
})();
