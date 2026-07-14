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
  const src = fs.readFileSync(path.join(__dirname, '..', 'brain', 'libraryEngine.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'libraryEngine.js' });
  return sandbox.YuviLibrary;
}

const LIB = freshEngine();

console.log('\n=== Archive CRUD ===');
{
  let archive = [];
  archive = LIB.addArchiveItem(archive, { clientName: 'JFS', type: 'strategy', title: 'Instagram Strategy', content: 'focus on...' });
  check('addArchiveItem creates one entry', archive.length === 1);
  check('entry has a generated id', !!archive[0].id);
  check('entry carries the right clientName/type/title', archive[0].clientName === 'JFS' && archive[0].type === 'strategy' && archive[0].title === 'Instagram Strategy');

  archive = LIB.addArchiveItem(archive, { type: 'post', title: 'Caption idea' }); // no clientName given
  check('missing clientName falls back to Unassigned', archive[1].clientName === 'Unassigned');

  const removed = LIB.removeArchiveItem(archive, archive[0].id);
  check('removeArchiveItem removes exactly the target entry', removed.length === 1 && removed[0].title === 'Caption idea');
}

console.log('\n=== groupByClient (folder organization) ===');
{
  let archive = [];
  archive = LIB.addArchiveItem(archive, { clientName: 'JFS', title: 'A' });
  archive = LIB.addArchiveItem(archive, { clientName: 'JFS', title: 'B' });
  archive = LIB.addArchiveItem(archive, { clientName: 'FinEdge', title: 'C' });
  archive = LIB.addArchiveItem(archive, { title: 'D' }); // unassigned
  const groups = LIB.groupByClient(archive);
  check('groups by client name into separate folders', Object.keys(groups).includes('JFS') && Object.keys(groups).includes('FinEdge'));
  check('JFS folder has exactly 2 items', groups['JFS'].length === 2);
  check('Unassigned folder exists and sorts LAST', Object.keys(groups)[Object.keys(groups).length - 1] === 'Unassigned');
}

console.log('\n=== Templates ===');
{
  let templates = [];
  templates = LIB.addTemplate(templates, { name: 'Weekly Content Calendar', promptText: 'Build a content calendar for {client} for next week' });
  check('addTemplate creates one entry', templates.length === 1);
  check('template carries name + promptText', templates[0].name === 'Weekly Content Calendar' && /content calendar/.test(templates[0].promptText));
  const removed = LIB.removeTemplate(templates, templates[0].id);
  check('removeTemplate removes it', removed.length === 0);
}

console.log('\n=== widgetToArchiveItem (Phase 3 integration) ===');
{
  const chartWidget = { type: 'chart', title: 'Revenue Trend', data: { labels: ['Jan', 'Feb'], values: [100, 120] } };
  const entry1 = LIB.widgetToArchiveItem(chartWidget, 'JFS');
  check('chart widget converts with type "widget" and readable content summary', entry1.type === 'widget' && /Jan, Feb/.test(entry1.content));
  check('clientName passed through', entry1.clientName === 'JFS');

  const listWidget = { type: 'list', title: 'Post Ideas', data: { items: ['Idea A', { title: 'Idea B', detail: 'x' }] } };
  const entry2 = LIB.widgetToArchiveItem(listWidget, null);
  check('list widget summary includes both string and object items', /Idea A/.test(entry2.content) && /Idea B/.test(entry2.content));
  check('no clientName defaults to Unassigned via addArchiveItem downstream', entry2.clientName === 'Unassigned');
}

console.log('\n=== buildChatContextText (pull into Chat) ===');
{
  const archiveItem = { title: 'Instagram Strategy', clientName: 'JFS', content: 'Focus on reels.' };
  const text1 = LIB.buildChatContextText(archiveItem);
  check('archive item produces a context-priming message referencing title+client', /Instagram Strategy/.test(text1) && /JFS/.test(text1));

  const template = { name: 'x', promptText: 'Draft a proposal for {client}' };
  const text2 = LIB.buildChatContextText(template);
  check('template pulls its raw promptText verbatim (re-triggerable)', text2 === 'Draft a proposal for {client}');
}

console.log('\n=== Persistence round-trip ===');
{
  const ls = new LocalStoragePolyfill();
  let archive = LIB.addArchiveItem([], { clientName: 'JFS', title: 'Persisted Item' });
  LIB.persistArchive(archive, ls);
  const reloaded = LIB.loadArchive(ls);
  check('archive survives persist/load round-trip', reloaded.length === 1 && reloaded[0].title === 'Persisted Item');

  let templates = LIB.addTemplate([], { name: 'Persisted Template', promptText: 'x' });
  LIB.persistTemplates(templates, ls);
  const reloadedT = LIB.loadTemplates(ls);
  check('templates survive persist/load round-trip', reloadedT.length === 1 && reloadedT[0].name === 'Persisted Template');

  check('loadArchive on empty storage returns empty array, not throw', LIB.loadArchive(new LocalStoragePolyfill()).length === 0);
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
