/**
 * core/vault.js — YUVI v6 Secret Vault
 * ─────────────────────────────────────────────
 * Replaces plaintext localStorage for secrets (Groq key, GitHub PAT).
 *
 * Design:
 *  - One random 256-bit AES-GCM "master key" is generated once, on this device.
 *  - The master key itself is never stored in plaintext. It's "wrapped"
 *    (encrypted) once by a PIN-derived key (PBKDF2) and, optionally, a second
 *    time by a WebAuthn PRF-derived key (biometric). Either unwrap path
 *    recovers the same master key — unlocking with PIN or fingerprint are
 *    equivalent, neither is "primary".
 *  - Individual secrets (yuvi_groq_key, yuvi_gh_token, ...) are encrypted
 *    at rest with the master key and decrypted into an in-memory cache
 *    the moment the vault unlocks. Reads/writes to that cache are
 *    synchronous so existing call sites (getKey(), getConfig(), etc.)
 *    don't need to become async.
 *  - Nothing here is a substitute for real server-side secret management —
 *    it's the right trade-off for a single-user client-only tool: secrets
 *    are no longer sitting in localStorage in plaintext for any XSS/log
 *    leak/CSV-import bug to scoop up, and they're gone from disk the
 *    moment the tab is closed or the vault is locked.
 */
(function () {
  'use strict';

  var LS_SALT     = 'yuvi_vault_salt_pin';
  var LS_WRAP_PIN = 'yuvi_vault_wrap_pin';
  var LS_WRAP_BIO = 'yuvi_vault_wrap_bio';
  var LS_BIO_CRED = 'yuvi_vault_bio_cred';
  var LS_ITEM_PFX = 'yuvi_vault_item__';

  var PBKDF2_ITER = 210000;

  var _masterKey = null;   // CryptoKey, memory-only
  var _cache = {};         // decrypted secret cache, memory-only
  var _locked = true;

  // ── buffer helpers ─────────────────────────────────────────────────────
  function b64(buf) {
    var bytes = new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function unb64(str) {
    var bin = atob(str);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function randBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  // ── key derivation ─────────────────────────────────────────────────────
  async function deriveKeyFromPin(pin, saltB64) {
    var salt = saltB64 ? new Uint8Array(unb64(saltB64)) : randBytes(16);
    var baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    return { key: key, saltB64: b64(salt) };
  }

  async function deriveKeyFromPRF(prfBytesArrayBuffer) {
    // PRF output may not be exactly 32 bytes depending on authenticator; hash to fixed 256-bit key material.
    var digest = await crypto.subtle.digest('SHA-256', prfBytesArrayBuffer);
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  // ── generic wrap/unwrap of the master key ──────────────────────────────
  async function wrapMasterKeyWith(wrapKey) {
    var raw = await crypto.subtle.exportKey('raw', _masterKey);
    var iv = randBytes(12);
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, wrapKey, raw);
    return b64(iv) + '.' + b64(ct);
  }
  async function unwrapMasterKeyWith(wrapKey, blob) {
    var parts = blob.split('.');
    var iv = new Uint8Array(unb64(parts[0]));
    var ct = unb64(parts[1]);
    var raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, wrapKey, ct);
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }

  // ── setup / status ──────────────────────────────────────────────────────
  function isSetup() { return !!localStorage.getItem(LS_WRAP_PIN); }
  function isBiometricEnrolled() { return !!localStorage.getItem(LS_WRAP_BIO); }
  function getBiometricCredentialId() { return localStorage.getItem(LS_BIO_CRED) || ''; }
  function isLocked() { return _locked; }

  async function setupWithPin(pin) {
    _masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    var d = await deriveKeyFromPin(pin, null);
    var wrapped = await wrapMasterKeyWith(d.key);
    localStorage.setItem(LS_SALT, d.saltB64);
    localStorage.setItem(LS_WRAP_PIN, wrapped);
    _locked = false;
    _cache = {};
    return true;
  }

  async function unlockWithPin(pin) {
    try {
      var saltB64 = localStorage.getItem(LS_SALT);
      var wrapped = localStorage.getItem(LS_WRAP_PIN);
      if (!wrapped) return false;
      var d = await deriveKeyFromPin(pin, saltB64);
      _masterKey = await unwrapMasterKeyWith(d.key, wrapped);
      _locked = false;
      await _decryptAllIntoCache();
      return true;
    } catch (e) {
      return false;
    }
  }

  // Rewrap with a new PIN. Requires vault already unlocked (masterKey in memory).
  async function setNewPin(newPin) {
    if (!_masterKey) return false;
    var d = await deriveKeyFromPin(newPin, null);
    var wrapped = await wrapMasterKeyWith(d.key);
    localStorage.setItem(LS_SALT, d.saltB64);
    localStorage.setItem(LS_WRAP_PIN, wrapped);
    return true;
  }

  // ── biometric (WebAuthn PRF) ────────────────────────────────────────────
  async function enrollBiometric() {
    if (!_masterKey) throw new Error('Vault must be unlocked before enrolling biometric.');
    if (!window.YuviWebAuthn || !window.YuviWebAuthn.isSupported()) throw new Error('WebAuthn not supported on this device/browser.');
    var reg = await window.YuviWebAuthn.registerAndGetPRF();
    var wrapKey = await deriveKeyFromPRF(reg.prfOutput);
    var wrapped = await wrapMasterKeyWith(wrapKey);
    localStorage.setItem(LS_WRAP_BIO, wrapped);
    localStorage.setItem(LS_BIO_CRED, reg.credentialId);
    return true;
  }

  async function unlockWithBiometric() {
    try {
      var credId = getBiometricCredentialId();
      if (!credId) return false;
      var prfOutput = await window.YuviWebAuthn.getPRF(credId);
      if (!prfOutput) return false;
      var wrapKey = await deriveKeyFromPRF(prfOutput);
      var wrapped = localStorage.getItem(LS_WRAP_BIO);
      _masterKey = await unwrapMasterKeyWith(wrapKey, wrapped);
      _locked = false;
      await _decryptAllIntoCache();
      return true;
    } catch (e) {
      return false;
    }
  }

  function removeBiometric() {
    localStorage.removeItem(LS_WRAP_BIO);
    localStorage.removeItem(LS_BIO_CRED);
  }

  function lock() {
    _masterKey = null;
    _cache = {};
    _locked = true;
  }

  // ── item-level encrypt/decrypt ──────────────────────────────────────────
  function _listItemKeys() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(LS_ITEM_PFX) === 0) out.push(k.slice(LS_ITEM_PFX.length));
    }
    return out;
  }

  async function _decryptAllIntoCache() {
    var names = _listItemKeys();
    for (var i = 0; i < names.length; i++) {
      try {
        _cache[names[i]] = await _decryptItem(names[i]);
      } catch (e) { /* corrupt/foreign entry — skip */ }
    }
  }

  async function _encryptItem(name, plaintext) {
    var iv = randBytes(12);
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, _masterKey, new TextEncoder().encode(String(plaintext)));
    localStorage.setItem(LS_ITEM_PFX + name, b64(iv) + '.' + b64(ct));
  }
  async function _decryptItem(name) {
    var blob = localStorage.getItem(LS_ITEM_PFX + name);
    if (!blob) return '';
    var parts = blob.split('.');
    var iv = new Uint8Array(unb64(parts[0]));
    var ct = unb64(parts[1]);
    var raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, _masterKey, ct);
    return new TextDecoder().decode(raw);
  }

  // Synchronous public API — cache is updated immediately, disk write happens
  // right after (fire-and-forget, but same-tick reads always see the new value).
  function setItem(name, plaintext) {
    _cache[name] = plaintext;
    if (_masterKey) { _encryptItem(name, plaintext).catch(function (e) { console.warn('[YuviVault] encrypt failed for', name, e); }); }
  }
  function getItem(name) { return _cache[name] || ''; }
  function removeItem(name) {
    delete _cache[name];
    localStorage.removeItem(LS_ITEM_PFX + name);
  }
  function clearAllItems() {
    _listItemKeys().forEach(function (n) { localStorage.removeItem(LS_ITEM_PFX + n); });
    _cache = {};
  }

  // ── one-time migration from legacy plaintext keys ──────────────────────
  // Call after first successful unlock post-upgrade. Moves any old plaintext
  // secrets into the vault, then deletes the plaintext copies.
  function migrateLegacyPlaintext(map) {
    // map: { 'yuvi_groq_key': 'yuvi_groq_key', 'yuvi_gh_token': 'yuvi_gh_token' } (localStorageKey -> vaultItemName)
    Object.keys(map).forEach(function (lsKey) {
      var v = localStorage.getItem(lsKey);
      if (v) {
        setItem(map[lsKey], v);
        localStorage.removeItem(lsKey);
      }
    });
  }

  window.YuviVault = {
    isSetup: isSetup,
    isLocked: isLocked,
    isBiometricEnrolled: isBiometricEnrolled,
    setupWithPin: setupWithPin,
    unlockWithPin: unlockWithPin,
    setNewPin: setNewPin,
    enrollBiometric: enrollBiometric,
    unlockWithBiometric: unlockWithBiometric,
    removeBiometric: removeBiometric,
    lock: lock,
    setItem: setItem,
    getItem: getItem,
    removeItem: removeItem,
    clearAllItems: clearAllItems,
    migrateLegacyPlaintext: migrateLegacyPlaintext
  };
})();
