const { JSDOM, ResourceLoader } = require('jsdom');
const { startServer } = require('./static-server');

const PORT = 8844;
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

async function bootAndUnlock(window) {
  await new Promise(resolve => {
    if (window.document.readyState === 'complete') return resolve();
    window.addEventListener('load', resolve);
    setTimeout(resolve, 2000);
  });
  await sleep(200);
  '242501'.split('').forEach(d => window.pinPress(d));
  await sleep(3000); // 120ms auto-check + PBKDF2 + startBoot's own 1950ms delay before initDashboard() runs
}

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
        // This suite tests pure Phase 3 canvas behavior. Phase 5's Daily
        // Digest auto-widget is correct, separately-tested behavior (see
        // proactiveEngine.test.js + clientsLibrary.test.js) — mark it as
        // already run today so it never fires here, regardless of what
        // real wall-clock time this test happens to run at.
        window.localStorage.setItem('yuvi_last_digest_run_date', new Date().toISOString());
      },
    });
    const { window } = dom;
    await bootAndUnlock(window);

    console.log('\n=== TEST A: Canvas module + empty state ===');
    check('window.YuviWidgetEngine loaded', typeof window.YuviWidgetEngine === 'object');
    check('canvasWidgets initialized as empty array on fresh profile', Array.isArray(window.canvasWidgets) && window.canvasWidgets.length === 0);
    const emptyEl = window.document.getElementById('yuvi-canvas-empty');
    check('empty-state greeting visible with no widgets', emptyEl && emptyEl.style.display !== 'none');
    check('empty-state shows the spec\'d greeting text', /what shall we build today/i.test(window.document.querySelector('.yuvi-canvas-greet').textContent));

    console.log('\n=== TEST B: classifyIntent gate — plain chat does NOT touch the canvas ===');
    // Set a Groq key so sendChat doesn't bail early on the "add key" check —
    // we won't actually let it reach the network for the plain-chat path
    // (we simply never invoke sendChat for a widget command without mocking).
    window.YuviVault.setItem('yuvi_groq_key', 'gsk_test_fake_key_not_real');
    const intent1 = window.YuviWidgetEngine.classifyIntent('hey what\'s up', window.canvasWidgets);
    check('greeting-style message is not classified as a widget request', intent1.isWidgetRequest === false);

    console.log('\n=== TEST C: Widget creation through the REAL handleWidgetCommand (Groq call mocked at YuviBrain.rawChat) ===');
    window.YuviBrain.rawChat = async function (messages, opts) {
      return JSON.stringify({ type: 'chart', title: 'Revenue Trend', subtitle: 'Last 6 months', data: { labels: ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'], values: [12000, 14000, 15500, 18000, 21000, 22998] } });
    };
    await window.handleWidgetCommand('show revenue trend for last 6 months', null);
    check('exactly one widget created', window.canvasWidgets.length === 1, 'len=' + window.canvasWidgets.length);
    const w1 = window.canvasWidgets[0];
    check('widget has correct type/title from the (mocked) AI response', w1.type === 'chart' && w1.title === 'Revenue Trend');
    check('thinking card removed after completion', !window.document.getElementById('yc-thinking-live'));
    check('a real .yc-card DOM element was rendered for the widget', !!window.document.getElementById('yc-card-' + w1.id));
    check('empty-state hidden once a widget exists', window.document.getElementById('yuvi-canvas-empty').style.display === 'none');
    const svg = window.document.querySelector('#yc-card-' + w1.id + ' svg.yc-chart-svg');
    check('chart widget rendered an inline SVG (no external chart lib)', !!svg);

    console.log('\n=== TEST D: Follow-up edit updates the SAME widget, no duplicate ===');
    window.YuviBrain.rawChat = async function () {
      return JSON.stringify({ type: 'chart', title: 'Revenue Trend', subtitle: 'Last 12 months', data: { labels: ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'], values: [8000, 9000, 9500, 10000, 11000, 11500, 12000, 14000, 15500, 18000, 21000, 22998] } });
    };
    const intent2 = window.YuviWidgetEngine.classifyIntent('show revenue trend for last 12 months instead', window.canvasWidgets);
    check('follow-up command resolves the correct target widget id', intent2.targetWidgetId === w1.id, 'got ' + intent2.targetWidgetId);
    await window.handleWidgetCommand('show revenue trend for last 12 months instead', intent2.targetWidgetId);
    check('still exactly ONE widget after the follow-up edit (no duplicate)', window.canvasWidgets.length === 1, 'len=' + window.canvasWidgets.length);
    check('widget id unchanged across the edit', window.canvasWidgets[0].id === w1.id);
    check('widget content actually updated (12 months now)', window.canvasWidgets[0].data.values.length === 12);
    check('exactly one .yc-card DOM element exists for this widget (no duplicate DOM node)', window.document.querySelectorAll('#yuvi-canvas .yc-card').length === 1);

    console.log('\n=== TEST E: A genuinely new/unrelated request creates a SECOND widget ===');
    window.YuviBrain.rawChat = async function () {
      return JSON.stringify({ type: 'list', title: 'Competitor List', data: { items: ['WoodenStreet', 'Pepperfry', 'IKEA'] } });
    };
    const intent3 = window.YuviWidgetEngine.classifyIntent('create a competitor list for furniture business', window.canvasWidgets);
    await window.handleWidgetCommand('create a competitor list for furniture business', intent3.targetWidgetId);
    check('a second, distinct widget was created', window.canvasWidgets.length === 2, 'len=' + window.canvasWidgets.length);
    check('two .yc-card DOM elements now present', window.document.querySelectorAll('#yuvi-canvas .yc-card').length === 2);

    console.log('\n=== TEST F: Pin / Lock / Remove wiring through real onclick handlers ===');
    const w2 = window.canvasWidgets[1];
    window.toggleWidgetPin(w1.id);
    check('toggleWidgetPin() flips pinned state', window.canvasWidgets.find(w => w.id === w1.id).pinned === true);
    check('pinned card gets the "pinned" CSS class', window.document.getElementById('yc-card-' + w1.id).classList.contains('pinned'));

    window.toggleWidgetLock(w2.id);
    check('toggleWidgetLock() flips locked state', window.canvasWidgets.find(w => w.id === w2.id).locked === true);
    window.removeWidgetCard(w2.id);
    check('removeWidgetCard() refuses to delete a LOCKED widget', window.canvasWidgets.length === 2);
    window.toggleWidgetLock(w2.id); // unlock
    window.removeWidgetCard(w2.id);
    check('removeWidgetCard() succeeds once unlocked', window.canvasWidgets.length === 1 && window.canvasWidgets[0].id === w1.id);

    console.log('\n=== TEST G: Persistence — pinned widget survives a simulated reload ===');
    // w1 is pinned (from Test F). Read what's actually on "disk" and re-run initCanvas()
    // as a fresh boot would, WITHOUT any prior in-memory canvasWidgets state.
    const persistedRaw = window.localStorage.getItem('yuvi_canvas_widgets');
    check('persisted blob exists in localStorage after pinning', !!persistedRaw);
    window.canvasWidgets = []; // simulate a fresh JS context's initial state
    window.initCanvas();
    check('pinned widget reappears after simulated reload', window.canvasWidgets.some(w => w.id === w1.id && w.title === 'Revenue Trend'));
    check('reloaded widget DOM actually re-rendered', !!window.document.getElementById('yc-card-' + w1.id));

    console.log('\n=== TEST H: Regression — Leads/Pipeline/Home/Settings untouched by Phase 3 ===');
    check('renderLeads function still present', typeof window.renderLeads === 'function');
    check('renderPipeline function still present', typeof window.renderPipeline === 'function');
    check('Settings still has all 7 groups', window.document.querySelectorAll('.sett-sec').length === 7);
    window.openSettings();
    check('Settings opens without throwing post-Phase-3', window.document.getElementById('settings-panel').classList.contains('open'));

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
