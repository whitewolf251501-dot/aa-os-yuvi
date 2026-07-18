const fs = require('fs');
const path = require('path');
const vm = require('vm');
const LocalStoragePolyfill = require('./localstorage-polyfill');

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' :: ' + detail : ''));
}

function freshEngine() {
  const sandbox = { console, window: {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'brain', 'widgetEngine.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'widgetEngine.js' });
  return sandbox.YuviWidgetEngine;
}

const WE = freshEngine();

console.log('\n=== classifyIntent ===');
{
  const noAsk = WE.classifyIntent('hey how are you', []);
  check('plain greeting is not classified as a widget request', noAsk.isWidgetRequest === false);

  const freshAsk = WE.classifyIntent('build me an instagram strategy for JFS', []);
  check('"build me a strategy" IS classified as a widget request', freshAsk.isWidgetRequest === true);
  check('fresh request with no existing widgets has no target (creates new)', freshAsk.targetWidgetId === null);

  const existing = [
    { id: 'w1', title: 'Revenue Trend', subtitle: 'Last 6 months' },
    { id: 'w2', title: 'Competitor List', subtitle: 'Ahmedabad furniture' }
  ];
  const editAsk = WE.classifyIntent('show revenue trend for last 12 months instead', existing);
  check('edit-ish phrasing matches the right existing widget by title overlap', editAsk.targetWidgetId === 'w1', 'got ' + editAsk.targetWidgetId);

  const unrelatedAsk = WE.classifyIntent('create a content calendar for next week', existing);
  check('unrelated new request does not falsely match an existing widget', unrelatedAsk.targetWidgetId === null, 'got ' + unrelatedAsk.targetWidgetId);
}

console.log('\n=== buildWidgetPrompt ===');
{
  const msgsNew = WE.buildWidgetPrompt('show revenue trend', 'Yugantar Growth agency', null);
  check('new-widget prompt has system + user messages', msgsNew.length === 2 && msgsNew[0].role === 'system' && msgsNew[1].role === 'user');
  check('system prompt demands JSON-only output', /ONLY a single valid JSON object/i.test(msgsNew[0].content));

  const target = { type: 'chart', title: 'Revenue Trend', subtitle: '6mo', data: { labels: ['Jan'], values: [1] } };
  const msgsEdit = WE.buildWidgetPrompt('extend to 12 months', 'ctx', target);
  check('edit prompt embeds the existing widget JSON for the model to modify', msgsEdit[1].content.indexOf('"Revenue Trend"') !== -1);
}

console.log('\n=== parseWidgetResponse ===');
{
  const good = WE.parseWidgetResponse('{"type":"metric","title":"Revenue","data":{"value":22998,"label":"This month"}}');
  check('parses clean JSON correctly', good.type === 'metric' && good.title === 'Revenue');

  const fenced = WE.parseWidgetResponse('```json\n{"type":"list","title":"Ideas","data":{"items":["a","b"]}}\n```');
  check('strips markdown code fences before parsing', fenced.type === 'list' && fenced.data.items.length === 2);

  const withPreamble = WE.parseWidgetResponse('Sure! Here you go:\n{"type":"text","title":"Note","data":{"text":"hi"}}\nHope that helps.');
  check('extracts JSON even with prose wrapped around it', withPreamble.type === 'text');

  let threwOnGarbage = false;
  try { WE.parseWidgetResponse('not json at all'); } catch (e) { threwOnGarbage = true; }
  check('throws a clean error on non-JSON garbage (no crash)', threwOnGarbage);

  let threwOnBadType = false;
  try { WE.parseWidgetResponse('{"type":"bogus","title":"x","data":{}}'); } catch (e) { threwOnBadType = true; }
  check('throws on an invalid/unknown widget type', threwOnBadType);

  const noTitle = WE.parseWidgetResponse('{"type":"text","data":{"text":"hi"}}');
  check('missing title falls back to "Untitled" rather than throwing', noTitle.title === 'Untitled');
}

console.log('\n=== applyWidget — the anti-duplication core logic ===');
{
  let widgets = [];
  widgets = WE.applyWidget(widgets, { type: 'chart', title: 'Revenue Trend', subtitle: '6mo', data: { labels: ['Jan'], values: [100] } }, null);
  check('first call creates exactly one widget', widgets.length === 1);
  const originalId = widgets[0].id;
  const originalCreatedAt = widgets[0].createdAt;

  // Simulate a follow-up edit targeting the SAME widget by id (as classifyIntent would resolve).
  widgets = WE.applyWidget(widgets, { type: 'chart', title: 'Revenue Trend', subtitle: '12mo', data: { labels: ['Jan', 'Feb'], values: [100, 120] } }, originalId);
  check('follow-up edit does NOT create a duplicate widget', widgets.length === 1, 'length=' + widgets.length);
  check('follow-up edit keeps the SAME widget id', widgets[0].id === originalId);
  check('follow-up edit keeps the original createdAt', widgets[0].createdAt === originalCreatedAt);
  check('follow-up edit actually updates the content', widgets[0].subtitle === '12mo' && widgets[0].data.values.length === 2);

  // A genuinely new, unrelated request (no targetWidgetId) creates a second widget.
  widgets = WE.applyWidget(widgets, { type: 'list', title: 'Competitor List', data: { items: ['A', 'B'] } }, null);
  check('a fresh unrelated request creates a second, separate widget', widgets.length === 2);

  // Editing a target id that no longer exists (e.g. was deleted) falls back to create, not a crash.
  widgets = WE.applyWidget(widgets, { type: 'text', title: 'Ghost Edit', data: { text: 'x' } }, 'does_not_exist');
  check('editing a stale/missing target id falls back to creating a new widget instead of throwing', widgets.length === 3);

  // pin/lock preserved across an in-place update
  widgets = WE.setPinned(widgets, originalId, true);
  const beforePinEdit = widgets.find(w => w.id === originalId).pinned;
  widgets = WE.applyWidget(widgets, { type: 'chart', title: 'Revenue Trend', subtitle: '24mo', data: { labels: [], values: [] } }, originalId);
  const afterPinEdit = widgets.find(w => w.id === originalId).pinned;
  check('pinned flag survives an in-place widget content update', beforePinEdit === true && afterPinEdit === true);
}

console.log('\n=== pin / lock / remove ===');
{
  let widgets = WE.applyWidget([], { type: 'text', title: 'A', data: { text: 'a' } }, null);
  const id = widgets[0].id;
  widgets = WE.setLocked(widgets, id, true);
  check('setLocked marks widget locked', widgets[0].locked === true);

  const blockedRemoval = WE.removeWidget(widgets, id);
  check('removeWidget refuses to delete a locked widget', blockedRemoval.blocked === true && blockedRemoval.widgets.length === 1);

  widgets = WE.setLocked(widgets, id, false);
  const okRemoval = WE.removeWidget(widgets, id);
  check('removeWidget succeeds once unlocked', okRemoval.blocked === false && okRemoval.widgets.length === 0);
}

console.log('\n=== persistence — only pinned/locked widgets survive "reload" ===');
{
  const ls = new LocalStoragePolyfill();
  let widgets = [];
  widgets = WE.applyWidget(widgets, { type: 'text', title: 'Ephemeral', data: { text: 'x' } }, null);
  widgets = WE.applyWidget(widgets, { type: 'text', title: 'Pinned One', data: { text: 'y' } }, null);
  widgets = WE.applyWidget(widgets, { type: 'text', title: 'Locked One', data: { text: 'z' } }, null);
  const pinnedId = widgets[1].id, lockedId = widgets[2].id;
  widgets = WE.setPinned(widgets, pinnedId, true);
  widgets = WE.setLocked(widgets, lockedId, true);

  WE.persist(widgets, ls);
  // "reload": fresh load() call reading only from the storage backing store
  const reloaded = WE.load(ls);

  check('unpinned/unlocked widget does NOT survive reload', !reloaded.some(w => w.title === 'Ephemeral'));
  check('pinned widget DOES survive reload', reloaded.some(w => w.title === 'Pinned One'));
  check('locked widget DOES survive reload', reloaded.some(w => w.title === 'Locked One'));
  check('exactly 2 widgets persisted (not 3)', reloaded.length === 2, 'got ' + reloaded.length);
}

console.log('\n=== SUMMARY ===');
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass);
console.log(`${passed}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach(f => console.log(' - ' + f.name + (f.detail ? ' :: ' + f.detail : '')));
  process.exitCode = 1;
}
