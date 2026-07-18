
(function(){
  function yuviBoot(){
    // 1. Load prompt skills from localStorage (before code skills, so they're available immediately)
    if(window.YuviPromptSkillEngine){
      window.YuviPromptSkillEngine.loadFromStorage();
    }
    // 2. Load installed skills from skills/installed.json
    if(window.YuviSkillLoader){
      window.YuviSkillLoader.loadAll().catch(function(e){
        console.warn('[YUVI Boot] Skill loader error:', e);
      });
    }
    // 3. Wire event bus listeners for skill manager live updates
    if(window.YuviBus && window.YuviSkillManager){
      window.YuviBus.on('skill.registered',         function(){ window.YuviSkillManager.renderSkillsManager(); });
      window.YuviBus.on('skill.toggled',             function(){ window.YuviSkillManager.renderSkillsManager(); });
      window.YuviBus.on('skills.loaded',             function(){ window.YuviSkillManager.renderAll(); });
      window.YuviBus.on('prompt-skill.installed',    function(){ window.YuviSkillManager.renderSkillsManager(); });
      window.YuviBus.on('prompt-skill.removed',      function(){ window.YuviSkillManager.renderSkillsManager(); });
      window.YuviBus.on('prompt-skills.loaded',      function(){ window.YuviSkillManager.renderSkillsManager(); });
      window.YuviBus.on('knowledge.added',           function(){ window.YuviSkillManager.renderKnowledgeManager(); });
      window.YuviBus.on('knowledge.removed',         function(){ window.YuviSkillManager.renderKnowledgeManager(); });
    }
    // 4. Emit boot event for any automation rules listening
    if(window.YuviBus){
      window.YuviBus.emit('yuvi.booted', {
        timestamp: new Date().toISOString(),
        skills: window.YuviSkillRegistry ? window.YuviSkillRegistry.count() : 0
      });
    }
    console.log('[YUVI v6.1] Boot complete.');
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', yuviBoot);
  } else {
    setTimeout(yuviBoot, 0);
  }
})();
