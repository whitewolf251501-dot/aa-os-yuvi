const fs = require('fs');
const path = require('path');
const vm = require('vm');

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' :: ' + detail : ''));
}

function freshEngine() {
  const sandbox = { console, window: {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'brain', 'proactiveEngine.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'proactiveEngine.js' });
  return sandbox.YuviProactive;
}

const PE = freshEngine();
const NOW = new Date('2026-07-15T12:00:00Z').getTime();
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

console.log('\n=== getAttentionLeads ===');
{
  const leads = [
    { id: 1, name: 'A', status: 'new' },
    { id: 2, name: 'B', status: 'follow_up' },
    { id: 3, name: 'C', status: 'interested' },
    { id: 4, name: 'D', status: 'contacted' },
  ];
  const out = PE.getAttentionLeads(leads);
  check('only follow_up and interested leads are surfaced', out.length === 2);
  check('follow_up lead gets the right reason text', out.find(o => o.title === 'B').detail.includes('follow-up'));
  check('new/contacted leads are correctly excluded', !out.some(o => o.title === 'A' || o.title === 'D'));
}

console.log('\n=== getStuckPipelineDeals ===');
{
  const pipeline = [
    { id: 1, name: 'Fresh Deal', stage: 'approached', stageEnteredAt: daysAgo(1) },
    { id: 2, name: 'Stuck Deal', stage: 'proposal_sent', stageEnteredAt: daysAgo(7) },
    { id: 3, name: 'Closed Deal', stage: 'closed', stageEnteredAt: daysAgo(30) },
    { id: 4, name: 'Legacy Deal (no stageEnteredAt)', stage: 'contacted', lastTouched: daysAgo(10) },
  ];
  const out = PE.getStuckPipelineDeals(pipeline, 5, NOW);
  check('deal under threshold is NOT flagged', !out.some(o => o.title === 'Fresh Deal'));
  check('deal over threshold IS flagged', out.some(o => o.title === 'Stuck Deal'));
  check('closed deals are never flagged regardless of age', !out.some(o => o.title === 'Closed Deal'));
  check('legacy deal without stageEnteredAt falls back to lastTouched', out.some(o => o.title === 'Legacy Deal (no stageEnteredAt)'));
  check('configurable threshold actually changes the result (10 days -> stuck deal no longer flagged)', PE.getStuckPipelineDeals(pipeline, 10, NOW).every(o => o.title !== 'Stuck Deal'));
}

console.log('\n=== getOverdueClientTasks ===');
{
  const clients = [
    { name: 'JFS', tasks: [{ text: 'Fresh task', done: false, addedAt: daysAgo(1) }, { text: 'Old task', done: false, addedAt: daysAgo(8) }, { text: 'Done old task', done: true, addedAt: daysAgo(20) }, { text: 'No timestamp task', done: false }] }
  ];
  const out = PE.getOverdueClientTasks(clients, 5, NOW);
  check('fresh task not flagged', !out.some(o => o.title === 'Fresh task'));
  check('old pending task IS flagged', out.some(o => o.title === 'Old task'));
  check('completed tasks are never flagged even if old', !out.some(o => o.title === 'Done old task'));
  check('tasks without addedAt are NOT fabricated as overdue (graceful degradation)', !out.some(o => o.title === 'No timestamp task'));
}

console.log('\n=== getAttentionItems (combined, capped at 3, prioritized) ===');
{
  const leads = [{ id: 1, name: 'Lead A', status: 'follow_up' }, { id: 2, name: 'Lead B', status: 'interested' }];
  const pipeline = [{ id: 1, name: 'Deal A', stage: 'proposal_sent', stageEnteredAt: daysAgo(9) }];
  const clients = [{ name: 'Client A', tasks: [{ text: 'Task A', done: false, addedAt: daysAgo(10) }] }];
  const out = PE.getAttentionItems(leads, pipeline, clients, 5, NOW);
  check('caps at 3 items even though 4 candidates exist', out.length === 3);
  check('stuck pipeline deal takes priority (appears first)', out[0].source === 'pipeline');
}

console.log('\n=== shouldRunDailyDigestNow ===');
{
  const morning = new Date('2026-07-15T09:00:00'); // local time construction
  check('runs when current time is past briefing time and hasn\'t run today', PE.shouldRunDailyDigestNow('08:00', null, morning) === true);
  check('does NOT run when current time is before briefing time', PE.shouldRunDailyDigestNow('20:00', null, morning) === false);
  const alreadyRanToday = morning.toISOString();
  check('does NOT run again if already run today', PE.shouldRunDailyDigestNow('08:00', alreadyRanToday, morning) === false);
  const yesterday = new Date('2026-07-14T09:00:00').toISOString();
  check('DOES run if last run was a previous day', PE.shouldRunDailyDigestNow('08:00', yesterday, morning) === true);
}

console.log('\n=== suggestNextAction (suggested only, deterministic) ===');
{
  check('proposal_sent stage suggests a follow-up check-in', /check in/i.test(PE.suggestNextAction('pipeline_stage', { name: 'JFS', stage: 'proposal_sent' })));
  check('closed stage suggests asking for a referral', /referral/i.test(PE.suggestNextAction('pipeline_stage', { name: 'JFS', stage: 'closed' })));
  check('advance_pending stage suggests sending payment link', /payment/i.test(PE.suggestNextAction('pipeline_stage', { name: 'JFS', stage: 'advance_pending' })));
  check('unknown stage still returns a sensible generic suggestion (no crash)', typeof PE.suggestNextAction('pipeline_stage', { name: 'X', stage: 'bogus_stage' }) === 'string');
  check('client_task action returns a suggestion mentioning the client', /JFS/.test(PE.suggestNextAction('client_task', { clientName: 'JFS', taskText: 'x' })));
  check('unknown action type returns null rather than throwing', PE.suggestNextAction('bogus_type', {}) === null);
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
