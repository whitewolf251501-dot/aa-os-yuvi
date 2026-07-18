const { JSDOM, ResourceLoader } = require('jsdom');
const { startServer } = require('./static-server');

const PORT = 8846;
const BASE = `http://localhost:${PORT}/`;
const STUB_HOSTS = ['fonts.googleapis.com', 'cdnjs.cloudflare.com'];

class TestResourceLoader extends ResourceLoader {
  fetch(url, options) {
    if (STUB_HOSTS.some(h => url.includes(h))) return Promise.resolve(Buffer.from('/* stub */'));
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
        window.TextEncoder = TextEncoder;
        window.TextDecoder = TextDecoder;
        if (window.crypto && !window.crypto.subtle) window.crypto.subtle = require('node:crypto').webcrypto.subtle;
        // We WANT the digest to fire naturally in this suite (it's what we're testing) —
        // force it deterministic instead of suppressing: briefing time in the past, never run before.
        window.localStorage.setItem('yuvi_pref_briefing_time', '00:00');
        // Seed a stuck pipeline deal + overdue client task BEFORE boot so the
        // real app state (not test-injected-after-the-fact) drives attention surfacing.
        const now = Date.now();
        const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
        window.localStorage.setItem('yuvi_pipeline', JSON.stringify([
          { id: 1, name: 'Stuck Deal Co', contact: '', phone: '', service: 'Growth', stage: 'proposal_sent', notes: [], lastTouched: daysAgo(9), stageEnteredAt: daysAgo(9) },
          { id: 2, name: 'Fresh Deal Co', contact: '', phone: '', service: 'Growth', stage: 'approached', notes: [], lastTouched: daysAgo(1), stageEnteredAt: daysAgo(1) },
        ]));
        window.localStorage.setItem('yuvi_clients', JSON.stringify([
          { id: 1, name: 'OverdueTaskCo', fullName: 'OverdueTaskCo', type: 'X', location: 'Ahmedabad', tier: 'Digital Foundation', amount: 5000, status: 'active', payment: 'pending', notes: '', metrics: { posts: 0, reels: 0, leads: 0, research: 0, strategyDocs: 0 }, packageItems: [], tasks: [{ text: 'Old overdue task', done: false, addedAt: daysAgo(8) }] },
        ]));
      },
    });
    const { window } = dom;
    await new Promise(resolve => {
      if (window.document.readyState === 'complete') return resolve();
      window.addEventListener('load', resolve);
      setTimeout(resolve, 2000);
    });
    await sleep(200);
    '242501'.split('').forEach(d => window.pinPress(d));
    await sleep(3000); // past initDashboard()'s 1950ms delay

    console.log('\n=== TEST A: Daily Digest auto-runs at boot and lands as a PINNED widget ===');
    check('yuvi_last_digest_run_date got set (digest ran)', !!window.localStorage.getItem('yuvi_last_digest_run_date'));
    const digestWidget = window.canvasWidgets.find(w => w.title === 'Daily Digest');
    check('a "Daily Digest" widget exists on the canvas', !!digestWidget);
    check('the Daily Digest widget is PINNED (so it survives reload, per spec)', digestWidget && digestWidget.pinned === true);
    check('running init again the same "day" does NOT create a duplicate digest widget', (function () {
      const before = window.canvasWidgets.filter(w => w.title === 'Daily Digest').length;
      window.runDailyDigestIfDue(); // should no-op, already ran today
      const after = window.canvasWidgets.filter(w => w.title === 'Daily Digest').length;
      return before === 1 && after === 1;
    })());

    console.log('\n=== TEST B: Chat-open surfaces attention items (stuck deal + overdue task), once per session ===');
    check('attentionShownThisSession is false before first Chat open', window.attentionShownThisSession === false);
    window.nav('command');
    await sleep(50);
    check('attentionShownThisSession flips true after first Chat open', window.attentionShownThisSession === true);
    const attnWidget = window.canvasWidgets.find(w => w.title === 'Needs Your Attention');
    check('a "Needs Your Attention" widget was created', !!attnWidget);
    check('attention widget references the stuck pipeline deal', JSON.stringify(attnWidget.data).includes('Stuck Deal Co'));
    check('attention widget references the overdue client task', JSON.stringify(attnWidget.data).includes('OverdueTaskCo'));
    check('attention widget does NOT include the fresh (not-yet-stuck) deal', !JSON.stringify(attnWidget.data).includes('Fresh Deal Co'));

    const widgetCountAfterFirstOpen = window.canvasWidgets.length;
    window.nav('home');
    window.nav('command'); // open Chat a second time
    await sleep(50);
    check('opening Chat again does NOT create a second attention widget (once-per-session)', window.canvasWidgets.length === widgetCountAfterFirstOpen);

    console.log('\n=== TEST C: Next-action suggestion after completing a pipeline stage move (suggested only, not auto-executed) ===');
    window.movePipeStage(1, 'closed');
    await sleep(50);
    const suggEl = window.document.getElementById('yuvi-suggestion-toast');
    check('suggestion bar becomes visible after a pipeline stage change', suggEl.classList.contains('show'));
    check('suggestion text is contextually relevant (closed stage -> referral ask)', /referral/i.test(suggEl.getAttribute('data-suggestion') || ''));
    check('the underlying pipeline stage change itself was NOT blocked/altered by the suggestion', window.pipeline.find(p => p.id === 1).stage === 'closed');

    window.document.getElementById('chat-inp').value = '';
    window.useSuggestionInChat();
    await sleep(200);
    check('clicking "Ask YUVI" loads the suggestion into Chat input (still requires the user to send it — not auto-executed)', /referral/i.test(window.document.getElementById('chat-inp').value));
    check('suggestion bar hides after being used', !suggEl.classList.contains('show'));

    console.log('\n=== TEST D: Next-action suggestion after completing a client task ===');
    const jfsForTask = { id: 999, name: 'TaskSuggestCo', fullName: 'TaskSuggestCo', type: 'X', location: 'Ahmedabad', tier: 'Digital Foundation', amount: 0, status: 'active', payment: 'pending', notes: '', tasks: [{ text: 'Do a thing', done: false, addedAt: new Date().toISOString() }], packageItems: [], metrics: { posts: 0, reels: 0, leads: 0, research: 0, strategyDocs: 0 } };
    window.clients.push(jfsForTask);
    window.toggleClientTask(999, 0);
    await sleep(50);
    check('suggestion bar shows after completing a client task', suggEl.classList.contains('show'));
    check('suggestion references the client by name', /TaskSuggestCo/.test(suggEl.getAttribute('data-suggestion') || ''));
    window.clients = window.clients.filter(c => c.id !== 999); // cleanup

    console.log('\n=== TEST E: Configurable stage threshold actually changes attention surfacing ===');
    window.localStorage.setItem('yuvi_pref_stage_threshold_days', '15'); // higher than the 9-day-old stuck deal
    check('getStageThresholdDays() reads the configured preference', window.getStageThresholdDays() === 15);
    const itemsWithHighThreshold = window.YuviProactive.getAttentionItems(window.leads, window.pipeline, window.clients, window.getStageThresholdDays());
    check('with a 15-day threshold, the 9-day-old deal is no longer flagged as stuck', !itemsWithHighThreshold.some(i => i.title === 'Stuck Deal Co'));
    window.localStorage.setItem('yuvi_pref_stage_threshold_days', '5'); // restore

    console.log('\n=== TEST F: Regression — Phases 1-4 untouched ===');
    check('renderLeads still present', typeof window.renderLeads === 'function');
    check('renderPipeline still present', typeof window.renderPipeline === 'function');
    check('renderClients still present', typeof window.renderClients === 'function');
    check('Settings still has all 7 groups', window.document.querySelectorAll('.sett-sec').length === 7);
    check('Library nav item still present', !!window.document.querySelector('.nav-item[data-view="library"]'));
    check('YuviLibrary still functional', typeof window.YuviLibrary.addArchiveItem === 'function');
    check('YuviWidgetEngine still functional', typeof window.YuviWidgetEngine.applyWidget === 'function');
    check('YuviVault still functional', window.YuviVault.isSetup() === true);

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
