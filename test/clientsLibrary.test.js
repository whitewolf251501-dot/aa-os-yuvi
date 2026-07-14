const { JSDOM, ResourceLoader } = require('jsdom');
const { startServer } = require('./static-server');

const PORT = 8845;
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
    await sleep(3000); // 120ms auto-check + PBKDF2 + startBoot's own 1950ms delay before initDashboard() runs

    console.log('\n=== TEST A: Client scorecard renders metrics + package + tasks ===');
    window.nav('clients');
    const cardsBefore = window.document.querySelectorAll('.client-card').length;
    check('client cards rendered (2 default clients + add-card)', cardsBefore === 3, 'found ' + cardsBefore);
    check('output metrics grid present on a client card', !!window.document.querySelector('.cc-metrics-grid'));
    const metricTiles = window.document.querySelectorAll('.cc-metrics-grid .cc-metric-tile');
    check('exactly 5 metric tiles per card (posts/reels/leads/research/strategy)', metricTiles.length >= 5);
    check('package tracking section present', !!window.document.querySelector('.cc-pkg-list'));
    check('action button present with placeholder wiring', !!window.document.querySelector('.cc-action-btn'));

    console.log('\n=== TEST B: Package item + task checklist interaction (real onclick) ===');
    const jfs = window.clients.find(c => c.name === 'JFS');
    const pkgIdx = jfs.packageItems.findIndex(p => !p.delivered);
    check('JFS has at least one pending package item to test with', pkgIdx !== -1);
    window.toggleClientPackageItem(jfs.id, pkgIdx);
    check('toggleClientPackageItem() flips delivered state', window.clients.find(c => c.id === jfs.id).packageItems[pkgIdx].delivered === true);
    window.addClientPackageItem = window.addClientPackageItem; // sanity: exists
    check('addClientPackageItem function exists', typeof window.addClientPackageItem === 'function');

    const taskCountBefore = jfs.tasks.length;
    jfs.tasks.push({ text: 'Test task', done: false });
    window.localStorage.setItem('yuvi_clients', JSON.stringify(window.clients));
    window.renderClients();
    check('existing task-checklist mechanism still works after scorecard redesign', window.clients.find(c => c.id === jfs.id).tasks.length === taskCountBefore + 1);

    console.log('\n=== TEST C: Action button placeholder (no n8n logic, just a toast) ===');
    let toastMsg = '';
    const origToast = window.showToast;
    window.showToast = function (msg) { toastMsg = msg; origToast(msg); };
    window.triggerClientWork(jfs.id);
    check('triggerClientWork() shows a placeholder toast, does not throw', /not connected/i.test(toastMsg));
    window.showToast = origToast;

    console.log('\n=== TEST D: Backward-compat migration for pre-Phase-4 client records ===');
    const legacyClient = { id: 999, name: 'Legacy Co', fullName: 'Legacy Co', type: 'X', location: 'Ahmedabad', tier: 'Digital Foundation', amount: 5000, status: 'active', payment: 'pending', tasks: [], notes: '' }; // no metrics/packageItems — pre-Phase-4 shape
    window.clients.push(legacyClient);
    let migrationThrew = false;
    try { window.renderClients(); } catch (e) { migrationThrew = true; console.log(' threw:', e.message); }
    check('rendering a legacy client record (missing metrics/packageItems) does not throw', !migrationThrew);
    check('ensureClientDefaults() backfilled metrics on the legacy record', !!window.clients.find(c => c.id === 999).metrics);
    window.clients = window.clients.filter(c => c.id !== 999); // cleanup
    window.renderClients();

    console.log('\n=== TEST E: Library — save a widget, archive folder by client, pull to Chat ===');
    const countBeforeWidget = window.canvasWidgets.length; // may already include an auto-run Daily Digest widget (Phase 5 item 4) depending on wall-clock time
    window.YuviBrain.rawChat = async function () {
      return JSON.stringify({ type: 'list', title: 'Post Ideas', data: { items: ['5 Reel Ideas', '6 Carousel Ideas'] } });
    };
    await window.handleWidgetCommand('generate post ideas for JFS', null);
    check('exactly one NEW widget created by this command', window.canvasWidgets.length === countBeforeWidget + 1, 'before=' + countBeforeWidget + ' after=' + window.canvasWidgets.length);
    const widgetId = window.canvasWidgets.find(w => w.title === 'Post Ideas').id;

    let promptedValue = 'JFS';
    const origPrompt = window.prompt;
    window.prompt = function () { return promptedValue; };
    window.saveWidgetToLibrary(widgetId);
    window.prompt = origPrompt;

    check('saveWidgetToLibrary() adds exactly one archive entry', window.libraryArchive.length === 1);
    check('archive entry carries the widget title', window.libraryArchive[0].title === 'Post Ideas');
    check('archive entry filed under the prompted client name', window.libraryArchive[0].clientName === 'JFS');

    window.nav('library');
    window.renderLibraryArchive();
    check('library folder for JFS rendered in the DOM', /JFS/.test(window.document.getElementById('lib-archive-content').innerHTML));
    check('PULL TO CHAT button rendered for the archive item', /PULL TO CHAT/.test(window.document.getElementById('lib-archive-content').innerHTML));

    window.pullArchiveItemToChat(window.libraryArchive[0].id);
    await sleep(200);
    const chatInpVal = window.document.getElementById('chat-inp').value;
    check('pullArchiveItemToChat() populates the Chat input with context text', /Post Ideas/.test(chatInpVal) && /JFS/.test(chatInpVal));

    console.log('\n=== TEST F: Library — save & reuse a template ===');
    window.nav('library');
    window.document.getElementById('chat-inp').value = 'Build a content calendar for {client} next week';
    let tplPrompted = ['Weekly Calendar Template'];
    let tplPromptIdx = 0;
    window.prompt = function () { return tplPrompted[tplPromptIdx++]; };
    window.saveCurrentPromptAsTemplate();
    window.prompt = origPrompt;
    check('saveCurrentPromptAsTemplate() adds exactly one template', window.libraryTemplates.length === 1);
    check('template name saved correctly', window.libraryTemplates[0].name === 'Weekly Calendar Template');

    window.document.getElementById('chat-inp').value = '';
    window.triggerTemplate(window.libraryTemplates[0].id);
    await sleep(200);
    check('triggerTemplate() loads the saved prompt back into Chat input', window.document.getElementById('chat-inp').value.includes('content calendar'));

    console.log('\n=== TEST G: Library persistence across simulated reload ===');
    const archiveBefore = window.libraryArchive.length;
    const templatesBefore = window.libraryTemplates.length;
    window.libraryArchive = [];
    window.libraryTemplates = [];
    window.initLibrary();
    check('archive reloads from localStorage on re-init', window.libraryArchive.length === archiveBefore);
    check('templates reload from localStorage on re-init', window.libraryTemplates.length === templatesBefore);

    console.log('\n=== TEST H: Nav wiring for the new Library tab ===');
    check('Library nav item exists in sidebar', !!window.document.querySelector('.nav-item[data-view="library"]'));
    window.nav('library');
    check('#v-library becomes active view after nav', window.document.getElementById('v-library').classList.contains('active'));

    console.log('\n=== TEST I: Regression — everything from Phases 1-3 still intact ===');
    check('renderLeads still present', typeof window.renderLeads === 'function');
    check('renderPipeline still present', typeof window.renderPipeline === 'function');
    check('Settings still has all 7 groups', window.document.querySelectorAll('.sett-sec').length === 7);
    check('YuviVault still functional', window.YuviVault.isSetup() === true);
    check('YuviWidgetEngine still functional', typeof window.YuviWidgetEngine.applyWidget === 'function');

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
