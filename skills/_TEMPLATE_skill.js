/**
 * skills/your-skill-id/skill.js
 * ─────────────────────────────
 * YUVI v5 Skill Template.
 * Copy this file into skills/<your-skill-id>/skill.js and fill in:
 *   1. MANIFEST  — match your manifest.json exactly
 *   2. API       — implement execute() + any lifecycle hooks you need
 *   3. REGISTER  — the last line calls YuviSkillRegistry.register()
 *
 * That is all. YuviSkillLoader finds and runs this file automatically.
 * No changes to index.html or any core file.
 */
(function () {
  'use strict';

  // ── 1. MANIFEST ─────────────────────────────────────────────────────────────
  // Must match manifest.json exactly (same id, version, capabilities).
  const MANIFEST = {
    id:           'your-skill-id',
    name:         'Your Skill Name',
    version:      '1.0.0',
    description:  'One-line description of what this skill does.',
    category:     'business',   // business | core | ai | utility
    icon:         '🔧',
    dependencies: [],           // skill IDs that must load before this one
    capabilities: [
      'your-skill.action-one',
      'your-skill.action-two'
    ]
  };

  // ── 2. PRIVATE LOGIC ────────────────────────────────────────────────────────
  // All business logic lives here. Never in index.html.

  function actionOne(args) {
    // do something, optionally emit an event
    if (window.YuviBus) window.YuviBus.emit('your-skill.action-one.done', { args });
    return 'Action one complete.'; // return a string for Brain to show in chat
  }

  function actionTwo(args) {
    return 'Action two complete.';
  }

  // ── 3. EXECUTE (capability dispatcher) ─────────────────────────────────────
  // The Brain calls execute(capability, args) — this is the only public method
  // that handles actual work. Return a string the Brain can display, or any
  // value the next step in a chain can consume.
  function execute(capability, args = {}) {
    switch (capability) {
      case 'your-skill.action-one': return actionOne(args);
      case 'your-skill.action-two': return actionTwo(args);
      default: throw new Error(`[${MANIFEST.id}] Unknown capability: ${capability}`);
    }
  }

  // ── 4. LIFECYCLE HOOKS (all optional) ───────────────────────────────────────
  function onEnable()    { console.log(`[${MANIFEST.id}] enabled`); }
  function onDisable()   { console.log(`[${MANIFEST.id}] disabled`); }
  function onUninstall() { /* clean up localStorage keys this skill owns */ }

  // ── 5. INTENT RULES (optional — lets users trigger this skill from chat) ────
  // Uncomment and fill in to make Brain.handle() route chat messages here.
  //
  // if (window.YuviIntentDetector) {
  //   window.YuviIntentDetector.addRule({
  //     id:      'your-skill.action-one',
  //     pattern: /^(do action one|trigger action)$/i,
  //     extract: () => ({})
  //   });
  // }

  // ── 6. AUTOMATION RULES (optional) ──────────────────────────────────────────
  // Uncomment to register an event-driven automation.
  //
  // if (window.YuviAutomation) {
  //   window.YuviAutomation.registerRule({
  //     id:          'your-skill.auto-on-lead-added',
  //     trigger:     'lead.added',
  //     description: 'Runs action one whenever a lead is added',
  //     steps: [
  //       { action: 'actionOne', run: (payload) => actionOne(payload) }
  //     ]
  //   });
  // }

  // ── 7. REGISTER ─────────────────────────────────────────────────────────────
  // This MUST be the last thing in the file.
  // YuviSkillLoader injects this script and waits for it to execute —
  // registration happens here, synchronously, before onload fires.
  if (!window.YuviSkillRegistry) {
    console.error(`[${MANIFEST.id}] YuviSkillRegistry not found. Check load order.`);
    return;
  }

  window.YuviSkillRegistry.register(MANIFEST, {
    execute,
    onEnable,
    onDisable,
    onUninstall
  });

})();
