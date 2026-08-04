/* =========================================================
   YUVI v7 — n8n compatibility client
   -----------------------------------------------------------
   IMPORTANT: this file does NOT know your Groq key, and n8n
   never sees it. It does NOT know your n8n credentials either
   — those live entirely inside your local n8n instance's own
   credential store. This file only speaks a small task-queue
   contract across the boundary:

     dashboard --(queued tasks)--> n8n --(status updates)--> dashboard

   n8n is local-hosted and only reachable when your laptop is
   on. Every function here fails soft: if n8n is unreachable,
   the dashboard keeps working on Groq alone and tasks simply
   wait in the local queue (see app.js v7GetQueue/v7EnqueueTask).

   TO WIRE YOUR REAL N8N: set the webhook URLs in Settings >
   Connection to Workspace once you build the actual n8n flows.
   Nothing here assumes any specific n8n workflow exists yet.
   ========================================================= */
window.YuviN8N=(function(){

  function getWorkspaceUrl(){
    // Read-only lookup of what the user configured in Settings.
    // Falls back to the common local n8n default if unset.
    return (localStorage.getItem('yuvi_n8n_webhook_url')||'').trim()
      || 'http://localhost:5678';
  }

  async function pingWorkspace(){
    var base=getWorkspaceUrl();
    if(!base)return false;
    try{
      var ctrl=new AbortController();
      var t=setTimeout(function(){ctrl.abort();},2500);
      var res=await fetch(base.replace(/\/$/,'')+'/healthz',{signal:ctrl.signal});
      clearTimeout(t);
      return res.ok;
    }catch(e){
      return false; // n8n offline / laptop off — expected, not an error state
    }
  }

  async function syncQueueWhenOnline(){
    if(typeof v7GetQueue!=='function')return;
    var queue=v7GetQueue().filter(function(t){return t.status==='queued';});
    if(!queue.length)return;
    var base=getWorkspaceUrl();
    try{
      var res=await fetch(base.replace(/\/$/,'')+'/webhook/yuvi-tasks',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({tasks:queue})
        // No API keys attached here — n8n authenticates its own
        // downstream services using its own stored credentials.
      });
      if(res.ok){
        var result=await res.json().catch(function(){return {};});
        applyStatusUpdates(result.updates||[]);
      }
    }catch(e){
      // n8n went offline mid-sync — tasks stay 'queued', retried on next poll.
    }
  }

  function applyStatusUpdates(updates){
    if(typeof v7GetQueue!=='function'||typeof v7SaveQueue!=='function')return;
    var q=v7GetQueue();
    updates.forEach(function(u){
      var t=q.find(function(x){return x.id===u.id;});
      if(t)t.status=u.status; // 'done' | 'failed' | 'working'
    });
    v7SaveQueue(q);
    if(typeof v7RenderTeamTab==='function')v7RenderTeamTab();
  }

  function enqueue(task){
    if(typeof v7EnqueueTask==='function')v7EnqueueTask(task);
  }

  return {
    pingWorkspace:pingWorkspace,
    syncQueueWhenOnline:syncQueueWhenOnline,
    enqueue:enqueue
  };
})();
