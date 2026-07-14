/**
 * integrations/github.js
 * Clean GitHub Contents API wrapper. Exposes window.YuviGitHub.
 * Also aliased as window.YuviGitHubMemory for backward compat.
 */
(function () {
  const API = 'https://api.github.com';

  function getConfig() {
    // v6: token is a secret and lives in the vault; username/repo aren't secrets so stay in localStorage.
    var token = window.YuviVault ? (window.YuviVault.getItem('yuvi_gh_token') || '') : (localStorage.getItem('yuvi_gh_token') || '');
    return {
      username: localStorage.getItem('yuvi_gh_user')  || '',
      repo:     localStorage.getItem('yuvi_gh_repo')  || '',
      token:    token
    };
  }

  function isConfigured() {
    const { username, repo, token } = getConfig();
    return !!(username && repo && token);
  }

  async function readFile(path = 'memory.json') {
    const { username, repo, token } = getConfig();
    if (!username || !repo || !token) throw new Error('GitHub not configured.');
    const res = await fetch(`${API}/repos/${username}/${repo}/contents/${path}`, {
      headers: { Authorization: `token ${token}` }
    });
    if (res.status === 404) return { content: null, sha: null };
    if (!res.ok) throw new Error(`GitHub read error ${res.status}`);
    const data = await res.json();
    return { content: JSON.parse(decodeURIComponent(escape(atob(data.content)))), sha: data.sha };
  }

  async function writeFile(content, path = 'memory.json', message = 'YUVI sync') {
    const { username, repo, token } = getConfig();
    if (!username || !repo || !token) throw new Error('GitHub not configured.');
    let sha = null;
    try { ({ sha } = await readFile(path)); } catch (e) {}
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
    const res = await fetch(`${API}/repos/${username}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: encoded, ...(sha ? { sha } : {}) })
    });
    if (!res.ok) throw new Error(`GitHub write error ${res.status}`);
    return await res.json();
  }

  const api = { getConfig, isConfigured, readFile, writeFile };
  window.YuviGitHub       = api;
  window.YuviGitHubMemory = api;
})();
