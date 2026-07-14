// Runs the REAL core/vault.js file (unmodified) under a minimal Node shim
// so we're testing the exact shipped code, not a reimplementation.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const LocalStoragePolyfill = require('./localstorage-polyfill');

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' :: ' + detail : ''));
}

function freshContext() {
  const localStorage = new LocalStoragePolyfill();
  const sandbox = {
    console,
    localStorage,
    crypto: require('node:crypto').webcrypto,
    TextEncoder, TextDecoder, btoa, atob,
    window: {},
  };
  sandbox.window = sandbox; // vault.js does window.YuviVault = {...}; make window === global sandbox
  vm.createContext(sandbox);
  const vaultSrc = fs.readFileSync(path.join(__dirname, '..', 'core', 'vault.js'), 'utf8');
  vm.runInContext(vaultSrc, sandbox, { filename: 'vault.js' });
  return sandbox; // sandbox.YuviVault is now populated
}

(async function main() {
  console.log('\n=== TEST 1: Legacy plaintext -> vault migration, then reload+unlock ===');
  {
    const ctx = freshContext();
    // Simulate pre-upgrade state: plaintext secrets sitting in localStorage.
    ctx.localStorage.setItem('yuvi_groq_key', 'gsk_LEGACY_TEST_KEY_123');
    ctx.localStorage.setItem('yuvi_gh_token', 'ghp_LEGACY_TEST_TOKEN_456');

    check('vault not yet set up on fresh profile', ctx.YuviVault.isSetup() === false);

    // Mirrors index.html's initVaultGate(): first run adopts legacy PIN 242501.
    await ctx.YuviVault.setupWithPin('242501');
    check('vault reports setup after setupWithPin', ctx.YuviVault.isSetup() === true);

    // Mirrors migrateLegacySecretsIfNeeded()
    ctx.YuviVault.migrateLegacyPlaintext({ yuvi_groq_key: 'yuvi_groq_key', yuvi_gh_token: 'yuvi_gh_token' });

    check('plaintext groq key removed from localStorage after migration', ctx.localStorage.getItem('yuvi_groq_key') === null);
    check('plaintext gh token removed from localStorage after migration', ctx.localStorage.getItem('yuvi_gh_token') === null);
    check('groq key readable from vault cache immediately post-migration', ctx.YuviVault.getItem('yuvi_groq_key') === 'gsk_LEGACY_TEST_KEY_123');
    check('gh token readable from vault cache immediately post-migration', ctx.YuviVault.getItem('yuvi_gh_token') === 'ghp_LEGACY_TEST_TOKEN_456');

    // Let async encrypt-to-disk writes (fire-and-forget in setItem/migrate) flush.
    await new Promise(r => setTimeout(r, 50));

    // Simulate an actual page reload: new JS context, same localStorage backing store.
    const reloadedCtx = { ...ctx }; // not a real reload, but we re-lock + clear cache to prove disk state is what matters
    ctx.YuviVault.lock();
    check('getItem returns empty after lock (memory cleared)', ctx.YuviVault.getItem('yuvi_groq_key') === '');

    const unlockOk = await ctx.YuviVault.unlockWithPin('242501');
    check('unlock with SAME (migrated/legacy) passcode succeeds after reload', unlockOk === true);
    check('groq key correctly decrypted after reload+unlock', ctx.YuviVault.getItem('yuvi_groq_key') === 'gsk_LEGACY_TEST_KEY_123');
    check('gh token correctly decrypted after reload+unlock', ctx.YuviVault.getItem('yuvi_gh_token') === 'ghp_LEGACY_TEST_TOKEN_456');

    const wrongUnlock = await ctx.YuviVault.unlockWithPin('000000');
    check('unlock with WRONG passcode is rejected', wrongUnlock === false);
  }

  console.log('\n=== TEST 2: Vault encryption/decryption round-trip (fresh setup, no legacy data) ===');
  {
    const ctx = freshContext();
    await ctx.YuviVault.setupWithPin('551199');
    ctx.YuviVault.setItem('yuvi_groq_key', 'gsk_ROUNDTRIP_ABC');
    ctx.YuviVault.setItem('yuvi_gh_token', 'ghp_ROUNDTRIP_XYZ');
    await new Promise(r => setTimeout(r, 50));

    // confirm what's on "disk" (localStorage) is NOT plaintext
    const rawGroq = ctx.localStorage.getItem('yuvi_vault_item__yuvi_groq_key');
    check('encrypted-at-rest blob does not contain the plaintext key', !!rawGroq && !rawGroq.includes('gsk_ROUNDTRIP_ABC'));

    ctx.YuviVault.lock();
    const unlockOk = await ctx.YuviVault.unlockWithPin('551199');
    check('round-trip: unlock succeeds', unlockOk === true);
    check('round-trip: groq key matches original after decrypt', ctx.YuviVault.getItem('yuvi_groq_key') === 'gsk_ROUNDTRIP_ABC');
    check('round-trip: gh token matches original after decrypt', ctx.YuviVault.getItem('yuvi_gh_token') === 'ghp_ROUNDTRIP_XYZ');

    // passcode change (Settings > Password flow) then confirm old pin no longer works, new one does
    const changed = await ctx.YuviVault.setNewPin('774411');
    check('setNewPin succeeds while unlocked', changed === true);
    ctx.YuviVault.lock();
    const oldPinAfterChange = await ctx.YuviVault.unlockWithPin('551199');
    const newPinAfterChange = await ctx.YuviVault.unlockWithPin('774411');
    check('old passcode rejected after change', oldPinAfterChange === false);
    check('new passcode accepted after change', newPinAfterChange === true);
    check('secrets still decrypt correctly after passcode change', ctx.YuviVault.getItem('yuvi_gh_token') === 'ghp_ROUNDTRIP_XYZ');
  }

  console.log('\n=== TEST 3: Fallback when WebAuthn / PRF unsupported ===');
  {
    const ctx = freshContext();
    // No window.YuviWebAuthn defined at all (older browser) — this is the real
    // condition index.html's initVaultGate() checks: `window.YuviWebAuthn && window.YuviWebAuthn.isSupported()`
    const bioBtnShouldShow = !!(ctx.YuviWebAuthn && ctx.YuviWebAuthn.isSupported && ctx.YuviWebAuthn.isSupported() && ctx.YuviVault.isBiometricEnrolled());
    check('bio button gate evaluates false (stays hidden) when YuviWebAuthn is undefined', bioBtnShouldShow === false);

    await ctx.YuviVault.setupWithPin('242501');
    check('passcode-only unlock still works when biometric module absent', await ctx.YuviVault.unlockWithPin('242501') === true);
    check('isBiometricEnrolled() is false with no enrollment', ctx.YuviVault.isBiometricEnrolled() === false);

    // Now simulate a browser WITH webauthn.js loaded but PRF/platform unsupported (isSupported() false)
    ctx.YuviWebAuthn = { isSupported: () => false };
    const bioBtnShouldShow2 = !!(ctx.YuviWebAuthn && ctx.YuviWebAuthn.isSupported() && ctx.YuviVault.isBiometricEnrolled());
    check('bio button gate evaluates false when isSupported() returns false', bioBtnShouldShow2 === false);

    let threw = false;
    try { await ctx.YuviVault.enrollBiometric(); } catch (e) { threw = true; }
    check('enrollBiometric() throws a clean error (not a crash) when unsupported', threw === true);
  }

  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`${passed}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log(' - ' + f.name));
    process.exitCode = 1;
  }
})();
