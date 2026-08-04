const { JSDOM, ResourceLoader } = require('jsdom');
const { startServer } = require('./static-server');

const PORT = 8843;
const BASE = `http://localhost:${PORT}/`;
// Domains we're not allowed to hit / don't need for this test (fonts, PDF/DOCX/XLSX libs, jsPDF).
// index.html's PIN-lock + Settings wiring doesn't depend on any of these executing.
const STUB_HOSTS = ['fonts.googleapis.com', 'cdnjs.cloudflare.com'];

class TestResourceLoader extends ResourceLoader {
  fetch(url, options) {
    if (STUB_HOSTS.some(h => url.includes(h))) {
      return Promise.resolve(Buffer.from('/* stubbed external resource for offline test */'));
    }
    return super.fetch(url, options);
  }
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' :: ' + detail : ''));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function main() {
  const server = await startServer(PORT);
  try {
    const dom = await JSDOM.fromURL(BASE + 'index.html', {
      resources: new TestResourceLoader(),
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        // jsdom doesn't expose these; vault.js/webauthn.js need them and they
        // must exist before ANY <script> in <head> runs, hence beforeParse.
        window.TextEncoder = TextEncoder;
        window.TextDecoder = TextDecoder;
        if (window.crypto && !window.crypto.subtle) {
          window.crypto.subtle = require('node:crypto').webcrypto.subtle;
        }
        // Keep this Settings/pin-lock-focused suite deterministic regardless
        // of wall-clock time (Phase 5's Daily Digest auto-widget is tested
        // elsewhere).
        window.localStorage.setItem('yuvi_last_digest_run_date', new Date().toISOString());
      },
    });
    const { window } = dom;

    // Give module scripts + DOMContentLoaded handlers time to run.
    await new Promise(resolve => {
      if (window.document.readyState === 'complete') return resolve();
      window.addEventListener('load', resolve);
      setTimeout(resolve, 2000); // safety timeout
    });
    await sleep(300);

    console.log('\n=== TEST 4a: Boot-time vault gate (fresh profile, no WebAuthn in jsdom) ===');
    check('window.YuviVault loaded', typeof window.YuviVault === 'object');
    check('window.YuviWebAuthn loaded', typeof window.YuviWebAuthn === 'object');
    check('WebAuthn reports unsupported in this environment (jsdom has no PublicKeyCredential — matches an old-browser device)', window.YuviWebAuthn.isSupported() === false);
    check('vault auto-initialized on first load (adopted legacy passcode)', window.YuviVault.isSetup() === true);

    const bioBtn = window.document.getElementById('pin-bio-btn');
    check('fingerprint button exists in DOM', !!bioBtn);
    check('fingerprint button stays hidden when WebAuthn unsupported', bioBtn && bioBtn.style.display === 'none');

    console.log('\n=== TEST 4b: PIN entry through the real UI (pinPress -> checkPin -> unlockAndBoot) ===');
    const pinLock = window.document.getElementById('pin-lock');
    check('pin-lock overlay visible before entry', pinLock.style.display !== 'none');
    '242501'.split('').forEach(d => window.pinPress(d));
    await sleep(1500); // 120ms auto-check delay + PBKDF2(210k) time + app's own 400ms fade-out
    check('pin-lock overlay hidden after correct passcode', pinLock.style.display === 'none');
    const bootEl = window.document.getElementById('boot');
    check('boot sequence started after unlock', bootEl.style.display === 'flex');

    console.log('\n=== TEST 4c: Settings — all 7 groups render, no broken onclick wiring ===');
    window.openSettings();
    const sections = Array.from(window.document.querySelectorAll('.sett-sec')).map(el => el.textContent.trim());
    console.log('Settings sections found:', sections);
    const expectedGroups = ['API', 'GITHUB MEMORY', 'SKILLS', 'KNOWLEDGE', 'PASSWORD', 'YUVI', 'CONNECTION TO WORKSPACE'];
    expectedGroups.forEach(g => {
      check(`Settings contains "${g}" group`, sections.some(s => s.toUpperCase().includes(g)));
    });
    check('exactly 7 settings groups (no stray leftover sections)', sections.length === 7, 'found ' + sections.length + ': ' + sections.join(' | '));

    // Cross-check every onclick="fnName(...)" in the settings panel resolves to a real function.
    const settingsPanel = window.document.getElementById('settings-panel');
    const onclickEls = Array.from(settingsPanel.querySelectorAll('[onclick]'));
    let allWired = true; const unresolved = [];
    onclickEls.forEach(el => {
      const attr = el.getAttribute('onclick');
      const m = attr.match(/^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/);
      if (!m) return;
      const name = m[1];
      let resolved;
      if (name.includes('.')) {
        const [obj, fn] = name.split('.');
        resolved = window[obj] && typeof window[obj][fn] === 'function';
      } else {
        resolved = typeof window[name] === 'function';
      }
      if (!resolved) { allWired = false; unresolved.push(name); }
    });
    check('every onclick handler in Settings resolves to a real function', allWired, unresolved.join(', '));

    console.log('\n=== TEST 4d: Settings > Password — changePasscode + biometric UI render without throwing ===');
    let changePinThrew = false;
    window.document.getElementById('s-new-pin').value = '112233';
    window.document.getElementById('s-new-pin-confirm').value = '112233';
    try { await window.changePasscode(); } catch (e) { changePinThrew = true; console.log('  threw:', e.message); }
    check('changePasscode() runs without throwing', !changePinThrew);
    window.YuviVault.lock();
    const reUnlock = await window.YuviVault.unlockWithPin('112233');
    check('new passcode set via Settings UI actually unlocks the vault', reUnlock === true);

    let bioUIThrew = false;
    try { window.renderBiometricSettingsUI(); } catch (e) { bioUIThrew = true; }
    check('renderBiometricSettingsUI() runs without throwing when WebAuthn unsupported', !bioUIThrew);
    const bioStatus = window.document.getElementById('s-bio-status').textContent;
    check('biometric status text reflects "not supported" (graceful fallback, no broken UI)', /not supported/i.test(bioStatus), bioStatus);

    console.log('\n=== TEST 5: Regression — Leads / Pipeline / Home markup + functions untouched ===');
    check('renderLeads function still present', typeof window.renderLeads === 'function');
    check('renderPipeline function still present', typeof window.renderPipeline === 'function');
    check('nav() function still present (view switching)', typeof window.nav === 'function');
    check('#v-leads view container still present', !!window.document.getElementById('v-leads') || !!window.document.querySelector('[data-view="leads"]'));
    check('leads nav item still present', !!window.document.querySelector('.nav-item[data-view="leads"]'));
    check('pipeline nav item still present', !!window.document.querySelector('.nav-item[data-view="pipeline"]'));
    check('home KPI stat tiles still present', !!window.document.querySelector('#v-home'));

    console.log('\n=== SUMMARY ===');
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass);
    console.log(`${passed}/${results.length} passed`);
    if (failed.length) {
      console.log('FAILED:');
      failed.forEach(f => console.log(' - ' + f.name + (f.detail ? ' :: ' + f.detail : '')));
      process.exitCode = 1;
    }
    window.close();
  } finally {
    server.close();
  }
})().catch(e => { console.error('HARNESS ERROR:', e); process.exitCode = 1; });
