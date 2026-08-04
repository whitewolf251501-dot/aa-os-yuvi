/**
 * automation/scheduler.js
 * Checks registered skill schedules on app load and fires their
 * automations if they're due. No cron daemon — checks at boot time.
 * Skills with 'daily' schedule and a configured time fire if last run
 * was not today. Results are shown as notifications if showToast exists.
 */
(function () {
  const RUN_LOG_KEY = 'yuvi_schedule_run_log';

  function getRunLog() {
    try { return JSON.parse(localStorage.getItem(RUN_LOG_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function setLastRun(skillId) {
    const log = getRunLog();
    log[skillId] = new Date().toISOString();
    localStorage.setItem(RUN_LOG_KEY, JSON.stringify(log));
  }
  function getLastRun(skillId) {
    return getRunLog()[skillId] || null;
  }

  function isDue(schedule) {
    if (!schedule || schedule.frequency === 'none') return false;
    const now      = new Date();
    const lastRun  = getLastRun('_sched_check');
    if (!lastRun) return true;
    const last     = new Date(lastRun);
    const diffHrs  = (now - last) / 3600000;

    switch (schedule.frequency) {
      case 'daily':   return diffHrs >= 20;   // allow some drift
      case 'weekly':  return diffHrs >= 160;
      case 'monthly': return diffHrs >= 700;
      default:        return false;
    }
  }

  function checkAndRun() {
    if (!window.YuviSkillRegistry || !window.YuviBus) return;
    const skills = window.YuviSkillRegistry.list()
      .filter(s => s.enabled && s.mode === 'automatic' && s.schedule);

    if (!skills.length) return;

    skills.forEach(s => {
      if (!isDue(s.schedule)) return;
      console.log(`[Scheduler] Firing scheduled run: ${s.id}`);
      window.YuviBus.emit('skill.scheduled.run', { skill_id: s.id, schedule: s.schedule });
      setLastRun(s.id);
    });
  }

  // Run on boot, after a short delay to let skills register
  document.addEventListener('DOMContentLoaded', () => setTimeout(checkAndRun, 1500));

  window.YuviScheduler = { checkAndRun, isDue, getLastRun, setLastRun };
})();
