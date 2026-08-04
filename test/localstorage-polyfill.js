// Minimal Storage-interface polyfill for running vault.js under plain Node (no DOM).
class LocalStoragePolyfill {
  constructor() { this._store = new Map(); }
  getItem(key) { return this._store.has(key) ? this._store.get(key) : null; }
  setItem(key, value) { this._store.set(key, String(value)); }
  removeItem(key) { this._store.delete(key); }
  key(i) { return Array.from(this._store.keys())[i] ?? null; }
  get length() { return this._store.size; }
  clear() { this._store.clear(); }
}
module.exports = LocalStoragePolyfill;
