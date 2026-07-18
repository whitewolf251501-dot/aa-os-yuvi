/**
 * core/webauthn.js — YUVI v6 Biometric Helper
 * ─────────────────────────────────────────────
 * Thin wrapper around the platform WebAuthn API used only to obtain a
 * PRF ("pseudo-random function") output tied to a fingerprint/biometric
 * credential. That output is used by core/vault.js as key material — it
 * never touches the network, there is no server to verify against
 * (single-user local tool).
 *
 * Falls back gracefully: if WebAuthn or the PRF extension isn't supported,
 * isSupported()/isPRFReady() report false and vault.js skips straight to
 * password-only, no broken UI.
 */
(function () {
  'use strict';

  var FIXED_SALT = new TextEncoder().encode('yuvi-vault-prf-v1');

  function isSupported() {
    return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  }

  function b64url(buf) {
    var bytes = new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var bin = atob(str);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // Registers a new platform credential (Face/Touch ID, Android biometric, Windows Hello),
  // then immediately performs an assertion against it with the PRF extension to fetch
  // the actual key material (most platforms only return PRF results on `get()`, not `create()`).
  async function registerAndGetPRF() {
    var userId = crypto.getRandomValues(new Uint8Array(16));
    var challenge = crypto.getRandomValues(new Uint8Array(32));

    var cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'YUVI', id: location.hostname },
        user: { id: userId, name: 'yuvi-local-user', displayName: 'YUVI' },
        challenge: challenge,
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000,
        extensions: { prf: {} }
      }
    });
    if (!cred) throw new Error('Biometric registration cancelled.');

    var credentialId = b64url(cred.rawId);
    var prfOutput = await getPRF(credentialId);
    if (!prfOutput) throw new Error('This device/browser does not support the PRF extension needed for biometric unlock.');
    return { credentialId: credentialId, prfOutput: prfOutput };
  }

  async function getPRF(credentialIdB64url) {
    var challenge = crypto.getRandomValues(new Uint8Array(32));
    var assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge,
        allowCredentials: [{ id: unb64url(credentialIdB64url), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: FIXED_SALT } } }
      }
    });
    if (!assertion) return null;
    var ext = assertion.getClientExtensionResults();
    if (!ext || !ext.prf || !ext.prf.results || !ext.prf.results.first) return null;
    return ext.prf.results.first; // ArrayBuffer
  }

  window.YuviWebAuthn = { isSupported: isSupported, registerAndGetPRF: registerAndGetPRF, getPRF: getPRF };
})();
