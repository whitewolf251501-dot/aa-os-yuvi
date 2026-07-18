
// ============================================================
// STATE
// ============================================================
// ============================================================
// PIN LOCK — v6: backed by core/vault.js (encrypted secret vault).
// First run after this upgrade: vault auto-initializes using the same
// passcode you already use (242501) so nothing changes for you day-to-day —
// it just also silently migrates your Groq key / GitHub token off plaintext
// localStorage and into the encrypted vault. Change your passcode any time
// in Settings > Password.
// ============================================================
var LEGACY_PIN_DEFAULT='242501';var pinBuffer='';var pinBusy=false;
function pinPress(v){
  if(pinBusy)return;
  var err=document.getElementById('pin-error');err.textContent='';
  if(v==='del'){pinBuffer=pinBuffer.slice(0,-1);}
  else if(v==='ok'){checkPin();}
  else if(pinBuffer.length<6){pinBuffer+=v;}
  updatePinDots();
  if(pinBuffer.length===6)setTimeout(checkPin,120);
}
function updatePinDots(){
  for(var i=0;i<6;i++){
    var d=document.getElementById('pd'+i);
    if(d)d.className='pin-dot'+(i<pinBuffer.length?' filled':'');
  }
}
async function checkPin(){
  if(pinBusy)return;pinBusy=true;
  try{
    var ok=await window.YuviVault.unlockWithPin(pinBuffer);
    if(ok){
      migrateLegacySecretsIfNeeded();
      unlockAndBoot();
    }else{
      document.getElementById('pin-error').textContent='WRONG PASSCODE';
      pinBuffer='';updatePinDots();
    }
  }finally{pinBusy=false;}
}
async function tryBiometricUnlock(){
  if(pinBusy)return;pinBusy=true;
  try{
    var ok=await window.YuviVault.unlockWithBiometric();
    if(ok){migrateLegacySecretsIfNeeded();unlockAndBoot();}
    else showToastSafe('Fingerprint unlock failed — use passcode');
  }catch(e){showToastSafe('Fingerprint unlock failed — use passcode');}
  finally{pinBusy=false;}
}
function showToastSafe(msg){document.getElementById('pin-error').textContent=msg;}
function unlockAndBoot(){
  var pl=document.getElementById('pin-lock');
  pl.style.transition='opacity .4s';pl.style.opacity='0';
  setTimeout(function(){pl.style.display='none';},400);
  startBoot();
}
// One-time move of any pre-v6 plaintext secrets into the encrypted vault.
function migrateLegacySecretsIfNeeded(){
  if(localStorage.getItem('yuvi_groq_key')||localStorage.getItem('yuvi_gh_token')){
    window.YuviVault.migrateLegacyPlaintext({'yuvi_groq_key':'yuvi_groq_key','yuvi_gh_token':'yuvi_gh_token'});
  }
}
// keyboard PIN support
document.addEventListener('keydown',function(e){
  var pl=document.getElementById('pin-lock');
  if(!pl||pl.style.display==='none')return;
  if(e.key>='0'&&e.key<='9')pinPress(e.key);
  else if(e.key==='Backspace')pinPress('del');
  else if(e.key==='Enter')pinPress('ok');
});
// Boot-time vault init + biometric button visibility
(function initVaultGate(){
  if(!window.YuviVault.isSetup()){
    // First run under v6: silently adopt the existing hardcoded passcode as
    // the vault PIN so unlock behavior is unchanged for you.
    window.YuviVault.setupWithPin(LEGACY_PIN_DEFAULT).then(migrateLegacySecretsIfNeeded);
  }
  var bioBtn=document.getElementById('pin-bio-btn');
  if(bioBtn&&window.YuviWebAuthn&&window.YuviWebAuthn.isSupported()&&window.YuviVault.isBiometricEnrolled()){
    bioBtn.style.display='block';
  }
})();
function startBoot(){
  try{ if(screen.orientation && screen.orientation.lock){ screen.orientation.lock('landscape').catch(function(){}); } }catch(e){}
  var boot=document.getElementById('boot');
  boot.style.display='flex';
  var bf=document.getElementById('bfill');
  if(bf)setTimeout(function(){bf.style.width='100%';},50);
  var msgs=['LOADING YUVI INTELLIGENCE...','SYNCING LEADS...','SCORING LEADS...','CONNECTING AI...','YUVI ONLINE'];
  var i=0;var iv=setInterval(function(){var el=document.getElementById('bstatus');if(el&&i<msgs.length)el.textContent=msgs[i++];else clearInterval(iv);},380);
  setTimeout(function(){
    boot.style.transition='opacity .5s';boot.style.opacity='0';
    setTimeout(function(){boot.style.display='none';},500);
    initDashboard();
  },1950);
}

// v6.1 — TRACK B STEP 3: crash protection for localStorage JSON reads.
// A single corrupted value here used to throw during boot and take down the
// entire app before anything rendered. Now a bad value just falls back to
// the default and logs a warning, instead of a blank white screen.
function safeParseLS(key,fallback){
  try{
    var raw=localStorage.getItem(key);
    if(raw==null)return fallback;
    return JSON.parse(raw);
  }catch(e){
    console.warn('[YUVI] Corrupt localStorage value for "'+key+'" — using default.',e.message);
    return fallback;
  }
}
var leads=safeParseLS('yuvi_leads',[]);
var pipeline=safeParseLS('yuvi_pipeline',[]);
var clients=safeParseLS('yuvi_clients',null)||getDefaultClients();
var revenueData=safeParseLS('yuvi_revenue',null)||getDefaultRevenue();
var priorities=safeParseLS('yuvi_priorities',null)||[{text:'Contact 10 leads from Google Maps list',done:false},{text:'Follow up with JFS — ask for referral',done:false},{text:'Prepare 1 proposal for an interested lead',done:false}];
var chatHistory=[];
var currentMode=localStorage.getItem('yuvi_default_mode')||'chat';
var selectedLead=null;
var catFilter='all';
var contactedToday=parseInt(localStorage.getItem('yuvi_contacted_today')||'0');
var lastContactedDate=localStorage.getItem('yuvi_contacted_date')||'';
var memory=null;
var attachedFile=null;
var attachedFileContent='';
var isRecording=false;
var recognition=null;
var digestOpen=false;
var PIPE_STAGES=['approached','contacted','interested','proposal_sent','advance_pending','closed'];
var PIPE_LABELS={approached:'APPROACHED',contacted:'CONTACTED',interested:'INTERESTED',proposal_sent:'PROPOSAL SENT',advance_pending:'ADVANCE PENDING',closed:'CLOSED'};
var autoBriefingDone=false;

// ============================================================
// YUVI v4 — MASTER SYSTEM PROMPT (baked into every Groq call)
// ============================================================
var YUVI_STATIC_PROMPT=`You are YUVI — Yugantar's Unified Virtual Intelligence. You are NOT a chatbot. You are a proactive AI business agent and the operational brain of Yugantar Growth, a digital agency in Ahmedabad, India.

FOUNDER: Shlok Pandya, 21, solo founder. No formal tech background. Vibe coder. Father Amit Pandya = Brand & Design Partner. Works fast, casual, Hinglish. Known weakness: builds before securing payment — always flag this.

AGENCY: Yugantar Growth | MSME registered April 2026 | Website: yugantar-growth-drab.vercel.app | Instagram: @yugantargrowth
Services: Website Dev, SEO, Performance Marketing, AI Automation, Brand Identity & SMM
Packages: Digital Foundation \u20B97,999 one-time | Lead Machine \u20B912,999/month | Full System \u20B924,999/month
Brand: #080808 black, #e8520a orange, #f0ede8 cream | Syne + DM Sans | YG triangle logo | 3S rule: Simple Short Smooth

GOLDEN RULE: Proposal \u2192 Agreement \u2192 Advance \u2192 Work. NEVER work before advance. Flag every violation.

CLIENTS, DEALS, REVENUE, LEADS, AND CURRENT PRIORITIES:
v6.1 \u2014 this is no longer hardcoded here. It's pulled live from the dashboard CRM (leads/pipeline/clients/revenue/priorities arrays) and injected fresh below every single time, under "=== LIVE BUSINESS CONTEXT ===". That means whatever you see there is exactly what's in the dashboard right now, not a frozen snapshot from whenever this prompt was written.

LEAD-GEN TOOLING: Docker + gosom scraper at D:\\Lead-gen. WhatsApp outreach 50-70/day. Best offer: "Website in 48 Hours."

CLOSING PATTERNS:
- Works: Niche-specific WA message, 48hr offer, showing real client work, getting advance first
- Doesn't work: Generic outreach, working before payment
- Objection "too expensive": "Kitna budget hai? Main usi mein adjust karta hoon."
- Objection "no time": "Main sab karta hoon, tumhe sirf approve karna hai."
- Target: Job-holders starting business, small shop owners, finance/trading professionals needing tech

OTHER VENTURES: Black Compass (adventure travel, Shlok = CMO) | Agni (print-on-demand clothing) | Australia Solar (3-partner, Shlok = backend ops salaried, rule: jobs before resignation)

YOUR BEHAVIOR:
- On EVERY session start: auto-generate morning briefing — open deals, follow-ups due, revenue gap, today's top 3 actions. Don't wait to be asked.
- Always give recommendation + reason in one line. Never "Option A or B" without picking one.
- Speak like a sharp business partner. Direct, high-energy, no fluff. Hinglish natural. Call Shlok "bhai" casually.
- Never say "great question." Never pad responses.
- Flag immediately if Shlok is about to work without advance payment.
- Load memory from GitHub on startup. Save session summary to GitHub on close.`;

// v6.1 — TRACK B STEP 5: builds the "CLIENTS/DEALS/REVENUE/LEADS/PRIORITIES"
// section fresh from the actual dashboard arrays (clients, pipeline,
// revenueData, leads, priorities) every time it's called — instead of the
// old approach where that whole section was typed once into
// YUVI_MASTER_PROMPT and slowly went stale as the real business moved on.
function getLiveBusinessContext(){
  var lines=['=== LIVE BUSINESS CONTEXT (pulled fresh from the dashboard right now) ==='];
  if(clients&&clients.length){
    lines.push('CLIENTS:');
    clients.forEach(function(c){
      var tasks=c.tasks||[];var done=tasks.filter(function(t){return t.done;}).length;
      lines.push('- '+c.name+(c.fullName&&c.fullName!==c.name?' ('+c.fullName+')':'')+': '+(c.tier||'no tier set')+', \u20B9'+(c.amount||0)+', status '+String(c.status||'unknown').toUpperCase()+', payment '+String(c.payment||'unknown').toUpperCase()+(tasks.length?', tasks '+done+'/'+tasks.length+' done':'')+(c.notes?'. Notes: '+c.notes:''));
    });
  }else{
    lines.push('CLIENTS: none tracked in the dashboard yet.');
  }
  if(pipeline&&pipeline.length){
    lines.push('PIPELINE DEALS:');
    pipeline.forEach(function(p){
      lines.push('- '+p.name+': stage '+(PIPE_LABELS[p.stage]||p.stage||'unknown')+(p.value?', value \u20B9'+p.value:'')+(p.lastTouched?', last touched '+new Date(p.lastTouched).toLocaleDateString('en-IN'):''));
    });
  }
  if(revenueData&&revenueData.length){
    var totalRev=revenueData.reduce(function(s,r){return s+(r.amount||0);},0);
    lines.push('REVENUE: \u20B9'+totalRev.toLocaleString('en-IN')+' tracked across '+revenueData.length+' line item(s) \u2014 '+revenueData.map(function(r){return r.name+' ('+String(r.status).toUpperCase()+', \u20B9'+(r.amount||0).toLocaleString('en-IN')+')';}).join(', ')+'.');
  }
  lines.push('LEADS: '+leads.length+' total in dashboard, '+leads.filter(function(l){return l.status==='interested';}).length+' interested, '+leads.filter(function(l){return(l.score||0)>=8;}).length+' hot-scored (8+).');
  if(priorities&&priorities.length){
    lines.push('CURRENT PRIORITIES:');
    priorities.forEach(function(p,i){lines.push((i+1)+'. '+p.text+(p.done?' (done)':''));});
  }
  return lines.join('\n');
}
function getMasterPrompt(){return YUVI_STATIC_PROMPT+'\n\n'+getLiveBusinessContext();}

// ============================================================
// BOOT
// ============================================================
window.addEventListener('load',function(){
  // reset contacted count if new day
  var today=new Date().toDateString();
  if(lastContactedDate!==today){contactedToday=0;localStorage.setItem('yuvi_contacted_today','0');localStorage.setItem('yuvi_contacted_date',today);}
  // restore settings (run immediately so fields are ready)
  var ghUser=localStorage.getItem('yuvi_gh_user')||'whitewolf251501-dot';
  var ghRepo=localStorage.getItem('yuvi_gh_repo')||'aa-os-yuvi';
  document.getElementById('s-gh-user').value=ghUser;
  document.getElementById('s-gh-repo').value=ghRepo;
  ['yuvi_personality:s-personality','yuvi_biz_ctx:s-biz-ctx'].forEach(function(p){var k=p.split(':');var v=localStorage.getItem(k[0]);if(v){var el=document.getElementById(k[1]);if(el)el.value=v;}});
  var groqKey=window.YuviVault?window.YuviVault.getItem('yuvi_groq_key'):'';if(groqKey)document.getElementById('s-groq-key').value=groqKey;
  var ghTok=window.YuviVault?window.YuviVault.getItem('yuvi_gh_token'):'';if(ghTok)document.getElementById('s-gh-token').value=ghTok;
  var dm=localStorage.getItem('yuvi_default_mode');if(dm){document.getElementById('s-default-mode').value=dm;setModeByName(dm);}
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){closeSettings();closeAddLead();closePipeDetail();document.getElementById('add-pipe-panel').classList.remove('open');closeGenericModal();if(digestOpen)toggleDigest();}
  });
  // PIN lock shows first — boot runs after correct PIN
  // (startBoot() called from checkPin())
});

function initDashboard(){
  updateClock();setInterval(updateClock,1000);
  setGreeting();
  renderRevenue();renderPriorities();
  scoreAllLeads();
  renderLeads();renderPipeline();renderClients();renderHomeClientsMini();
  updateStats();checkReminders();
  setInterval(checkReminders,60000);
  runProactiveBriefing();
  initCanvas();
  initLibrary();
  runDailyDigestIfDue();
  // evening auto-save also on tab hide (mobile-safe), not just unload
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'&&chatHistory.length>=2)autoSaveSession();});
}

// ============================================================
// v4 — PROACTIVE STARTUP SEQUENCE
// auto-fetch memory.json -> auto-generate briefing -> no user input needed
// ============================================================
async function runProactiveBriefing(){
  document.getElementById('yuvi-briefing').textContent='YUVI is reading memory & pulling status\u2026';
  var cfg=getGHConfig();
  var mem=null;
  if(cfg.username&&cfg.repo&&cfg.token){
    mem=await loadMemory().catch(function(){return null;});
    if(mem){applyMemoryToUI(mem);showMemStatus(true);}
  }
  var key=getGroqKey();
  if(!key){
    // no AI key yet — fall back to local rule-based briefing, still proactive
    document.getElementById('yuvi-briefing').textContent=localFallbackBriefing();
    return;
  }
  await generateProactiveMorningBriefing(mem);
}

function localFallbackBriefing(){
  var h=new Date().getHours();var lc=leads.length,ic=leads.filter(function(l){return l.status==='interested';}).length;
  var overdueCount=revenueData.filter(function(r){return r.status==='overdue';}).length;
  if(h<12)return'Morning bhai. '+lc+' leads, '+ic+' interested'+(overdueCount?', '+overdueCount+' payment(s) overdue.':'.')+' Add your Groq key in Settings so I can give you the full proactive briefing automatically.';
  if(h<17)return'Afternoon. '+ic+' interested leads waiting on follow-up. Add Groq key in Settings for full auto-briefing.';
  return'Evening. Log today\'s contacts and prep tomorrow. Add Groq key in Settings for full auto-briefing.';
}

// This is the core v4 feature: fires automatically on load, no user message needed.
async function generateProactiveMorningBriefing(mem){
  var key=getGroqKey();if(!key)return;
  setStatusDot(true);
  try{
    var lc=leads.length,ic=leads.filter(function(l){return l.status==='interested';}).length,cc=clients.filter(function(c){return c.status==='active';}).length;
    var fc=leads.filter(function(l){return l.status==='follow_up';}).length;
    var overdueCount=revenueData.filter(function(r){return r.status==='overdue';}).length;
    var advPending=pipeline.filter(function(p){return p.stage==='advance_pending';}).length;
    var openReminders=reminders.filter(function(r){return!r.done;}).length;
    var memCtx=getMemoryContext();
    var sys=getMasterPrompt()+'\n\n=== LIVE DASHBOARD STATE ===\nDashboard CRM: '+cc+' active clients tracked, '+lc+' leads ('+ic+' interested, '+fc+' need follow-up), '+advPending+' pipeline deals at advance-pending, '+overdueCount+' overdue payments, '+openReminders+' open reminders. Time now: '+new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})+', '+new Date().toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'long'})+'.'+memCtx;
    var userMsg='Session just started. Shlok has not typed anything yet. Auto-generate the morning briefing now: open deals (Tradosphere, JFS, FinEdge — exact status), follow-ups due, revenue gap (\u20B925,000 collected, \u20B90 saved), and the top 3 actions for today. 4-6 sentences, sharp, bhai tone, no fluff. End with one direct next move.';
    var reply=await window.YuviBrain.rawChat([{role:'system',content:sys},{role:'user',content:userMsg}],{maxTokens:320,temperature:0.5,mode:'brief'}).catch(function(e){if(window.YuviLogger)window.YuviLogger.error('Briefing','Morning briefing failed',e.message);return '';});
    if(reply){
      document.getElementById('yuvi-briefing').textContent=reply;
      // also drop it into Command chat as the opening message, unprompted
      postProactiveBriefingToChat(reply);
      autoBriefingDone=true;
    }else{
      document.getElementById('yuvi-briefing').textContent=localFallbackBriefing();
    }
  }catch(e){
    document.getElementById('yuvi-briefing').textContent=localFallbackBriefing();
  }
  setStatusDot(false);
}
function postProactiveBriefingToChat(text){
  appendMsg('ai',text,'YUVI \u00B7 MORNING BRIEFING (AUTO)');
  chatHistory.push({role:'assistant',content:text});
}

// ============================================================
// CLOCK & GREET
// ============================================================
function updateClock(){document.getElementById('livetime').textContent=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+' IST';}
function setGreeting(){
  var h=new Date().getHours();
  document.getElementById('greet-time').textContent=h<12?'MORNING':h<17?'AFTERNOON':'EVENING';
  var days=['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  var months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var d=new Date();
  document.getElementById('greet-date').textContent=days[d.getDay()]+' \u00B7 '+d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear()+' \u00B7 YUGANTAR GROWTH';
}
// kept for manual re-trigger (e.g. called from settings save) — routes into proactive flow
function setYuviBriefing(){runProactiveBriefing();}
function setYuviBriefingFromMemory(mem){generateProactiveMorningBriefing(mem);}
async function fetchBriefingFromGroq(){
  var key=getGroqKey();if(!key)return;
  try{
    var lc=leads.length,ic=leads.filter(function(l){return l.status==='interested';}).length,cc=clients.filter(function(c){return c.status==='active';}).length;
    var memCtx=getMemoryContext();
    var sys=getMasterPrompt()+'\n\n=== LIVE DASHBOARD STATE ===\nDashboard CRM: '+cc+' active clients, '+lc+' leads, '+ic+' interested. Time: '+new Date().toLocaleTimeString('en-IN')+'.'+memCtx;
    var reply=await window.YuviBrain.rawChat([{role:'system',content:sys},{role:'user',content:'Give a 2-3 sentence sharp briefing. No emojis.'}],{maxTokens:130,temperature:0.4,mode:'brief'}).catch(function(){return '';});
    if(reply)document.getElementById('yuvi-briefing').textContent=reply;
  }catch(e){}
}

// ============================================================
// NAV
// ============================================================
function nav(viewId,navEl,mobileEl){
  document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active');v.style.display='none';});
  var t=document.getElementById('v-'+viewId);
  if(t){t.style.display=viewId==='command'?'flex':'block';t.classList.add('active');}
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  if(navEl)navEl.classList.add('active');
  else{var m=document.querySelector('.nav-item[data-view="'+viewId+'"]');if(m)m.classList.add('active');}
  document.querySelectorAll('.mn-item').forEach(function(m){m.classList.remove('active');});
  if(mobileEl)mobileEl.classList.add('active');
  if(viewId==='command')maybeSurfaceAttentionItems();
}
function navToProposal(){nav('command');setTimeout(function(){setModeByName('proposal');document.getElementById('chat-inp').focus();},200);}
function toggleMobSidebar(){document.getElementById('mob-overlay').style.display='block';}
function closeMobSidebar(){document.getElementById('mob-overlay').style.display='none';}

// ============================================================
// REVENUE & PRIORITIES
// ============================================================
function getDefaultRevenue(){return [{id:1,name:'JFS',amount:7999,status:'paid'},{id:2,name:'FinEdge Advisory',amount:14999,status:'pending'}];}
function renderRevenue(){
  var c=document.getElementById('revenue-rows');
  c.innerHTML=revenueData.map(function(r){
    return '<div class="rev-row"><span class="rev-name">'+escHtml(r.name)+'</span>'
      +'<span style="display:flex;align-items:center;gap:4px;flex-shrink:0;">'
      +'<span class="rev-amt">\u20B9'+r.amount.toLocaleString('en-IN')+'</span>'
      +'<span class="rev-status '+getRevSC(r.status)+'">'+r.status.toUpperCase()+'</span>'
      +'<button class="btn" style="font-size:6px;padding:2px 4px;" onclick="cycleRevStatus('+r.id+')">&#8635;</button>'
      +'<button class="btn danger" style="font-size:6px;padding:2px 4px;" onclick="removeRevRow('+r.id+')">&#10005;</button>'
      +'</span></div>';
  }).join('');
  var total=revenueData.reduce(function(s,r){return s+r.amount;},0);
  document.getElementById('rev-total-val').textContent='\u20B9'+total.toLocaleString('en-IN');
  document.getElementById('kpi-revenue').textContent='\u20B9'+total.toLocaleString('en-IN');
  localStorage.setItem('yuvi_revenue',JSON.stringify(revenueData));
}
function getRevSC(s){return{paid:'rs-paid',pending:'rs-pending',overdue:'rs-overdue'}[s]||'rs-pending';}
function cycleRevStatus(id){var r=revenueData.find(function(x){return x.id===id;});if(!r)return;r.status={paid:'pending',pending:'overdue',overdue:'paid'}[r.status]||'paid';renderRevenue();}
function removeRevRow(id){revenueData=revenueData.filter(function(r){return r.id!==id;});renderRevenue();}
function addRevenueRow(){var name=prompt('Client name:');if(!name)return;var amt=parseInt(prompt('Amount (\u20B9):')||'0');revenueData.push({id:Date.now(),name:name,amount:amt,status:'pending'});renderRevenue();showToast('Revenue row added!');}
function renderPriorities(){
  var list=document.getElementById('priorities-list');
  list.innerHTML=priorities.map(function(p,i){
    return '<div class="pri-item"><div class="pri-check'+(p.done?' done-chk':'')+'" onclick="togglePriority('+i+')">'+(p.done?'&#10003;':'')+'</div>'
      +'<input class="pri-inp'+(p.done?' done-txt':'')+'" value="'+p.text.replace(/"/g,'&quot;')+'" onchange="updatePriorityText('+i+',this.value)"/></div>';
  }).join('')+'<div style="padding:5px 0;"><button class="btn" style="font-size:7px;padding:3px 7px;width:100%;" onclick="addPriorityRow()">+ TASK</button></div>';
  localStorage.setItem('yuvi_priorities',JSON.stringify(priorities));
}
function togglePriority(i){priorities[i].done=!priorities[i].done;renderPriorities();}
function updatePriorityText(i,v){priorities[i].text=v;localStorage.setItem('yuvi_priorities',JSON.stringify(priorities));}
function addPriorityRow(){priorities.push({text:'',done:false});renderPriorities();}
function resetPriorities(){priorities=priorities.map(function(p){return{text:p.text,done:false};});renderPriorities();showToast('Priorities reset!');}

// ============================================================
// LEAD SCORING (Feature 5)
// ============================================================
function calcLeadScore(lead){
  var score=5;
  var statusScores={new:0,approached:1,contacted:2,interested:5,follow_up:3,proposal_sent:4,not_interested:-3,closed:8};
  score+=(statusScores[lead.status]||0);
  if(lead.rating>=4.5)score+=2;else if(lead.rating>=4.0)score+=1;
  if(lead.phone&&lead.phone.length>=10)score+=1;
  if(lead.notes&&lead.notes.length>10)score+=1;
  var catBonus={digital:2,smm:1,website:1,seo:1,unknown:0};
  score+=(catBonus[lead.category]||0);
  return Math.min(10,Math.max(1,Math.round(score)));
}
function getScoreClass(score){return score>=8?'ls-hot':score>=5?'ls-warm':'ls-cold';}
function getScoreTooltip(score,lead){
  if(score>=8)return'HOT \u2014 High priority. Contact today.';
  if(score>=5)return'WARM \u2014 Follow up this week.';
  return'COLD \u2014 Low priority for now.';
}
function scoreAllLeads(){leads.forEach(function(l){l.score=calcLeadScore(l);});localStorage.setItem('yuvi_leads',JSON.stringify(leads));}

// ============================================================
// FOLLOW-UP REMINDERS (Feature 3)
// ============================================================
var reminders=safeParseLS('yuvi_reminders',[]);
function addReminder(name,days,ref){
  var due=new Date();due.setDate(due.getDate()+parseInt(days));
  reminders.push({id:Date.now(),name:name,due:due.toISOString(),ref:ref||'',done:false});
  localStorage.setItem('yuvi_reminders',JSON.stringify(reminders));showToast('Reminder set: '+name+' in '+days+' day(s)');
}
function checkReminders(){
  var now=new Date();var bar=document.getElementById('reminder-bar');
  var overdue=reminders.filter(function(r){return!r.done&&new Date(r.due)<=now;});
  if(overdue.length===0){bar.classList.remove('show');return;}
  bar.classList.add('show');
  bar.innerHTML='&#9888; '+overdue.length+' FOLLOW-UP'+(overdue.length>1?'S':'')+' DUE: '
    +overdue.map(function(r){return'<span style="color:var(--text);">'+escHtml(r.name)+'</span>';}).join(', ')
    +'&nbsp;&nbsp;<button class="btn danger" style="font-size:7px;padding:2px 8px;" onclick="dismissReminders()">DISMISS ALL</button>';
}
function dismissReminders(){reminders.forEach(function(r){r.done=true;});localStorage.setItem('yuvi_reminders',JSON.stringify(reminders));checkReminders();}

// ============================================================
// DAILY DIGEST (Feature 2)
// ============================================================
var digestGenerated=false;
function toggleDigest(){
  digestOpen=!digestOpen;
  document.getElementById('digest-panel').classList.toggle('open',digestOpen);
  document.getElementById('digest-date').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).toUpperCase();
}
async function generateDailyDigest(){
  var key=getGroqKey();
  var digestDiv=document.getElementById('digest-content');
  if(!digestOpen)toggleDigest();
  if(!key){
    digestDiv.innerHTML=renderLocalDigest();return;
  }
  digestDiv.innerHTML='<div style="font-family:var(--mono);font-size:9px;color:var(--muted);text-align:center;padding:30px 0;">&#9889; YUVI is analyzing...</div>';
  try{
    var lc=leads.length;var ic=leads.filter(function(l){return l.status==='interested';}).length;
    var fc=leads.filter(function(l){return l.status==='follow_up';}).length;
    var cc=clients.filter(function(c){return c.status==='active';}).length;
    var pipe_adv=pipeline.filter(function(p){return p.stage==='advance_pending';}).length;
    var overdue=revenueData.filter(function(r){return r.status==='overdue';}).length;
    var hotLeads=leads.filter(function(l){return(l.score||0)>=8;}).slice(0,3).map(function(l){return l.name;}).join(', ');
    var memCtx=getMemoryContext();
    var sys=getMasterPrompt()+'\n\n=== LIVE DASHBOARD STATE ===\n'+cc+' active clients (in dashboard CRM), '+lc+' total leads, '+ic+' interested, '+fc+' need follow-up, '+pipe_adv+' deals in advance pending, '+overdue+' overdue payments.\nHot leads (score 8+): '+(hotLeads||'none')+'.'+memCtx;
    var prompt='Generate today\'s Daily Digest: exactly 5 prioritized action items, pulling from real client/deal status (Tradosphere, JFS, FinEdge) AND dashboard leads/pipeline data above. Format each as:\nPRIORITY [1-5]: [action title]\nWHY: [one line reason]\nACTION: [exact step to take]\n\nBe brutally specific. This is Shlok\'s battle plan for today.';
    var reply=await window.YuviBrain.rawChat([{role:'system',content:sys},{role:'user',content:prompt}],{maxTokens:750,temperature:0.6,mode:'brief'}).catch(function(e){if(window.YuviLogger)window.YuviLogger.error('Digest','Daily digest failed',e.message);return '';});
    if(reply){digestDiv.innerHTML=renderParsedDigest(reply);digestGenerated=true;}
    else{digestDiv.innerHTML=renderLocalDigest();}
  }catch(e){digestDiv.innerHTML=renderLocalDigest();}
}
function renderParsedDigest(text){
  var items=text.split(/PRIORITY \d+:/);
  var html='';
  items.forEach(function(item){
    if(!item.trim())return;
    var lines=item.trim().split('\n').filter(Boolean);
    var title=lines[0]||'';
    var why=lines.find(function(l){return l.startsWith('WHY:');});
    var action=lines.find(function(l){return l.startsWith('ACTION:');});
    html+='<div class="digest-item">'
      +'<div class="digest-priority">&#9889; '+title.trim()+'</div>'
      +(why?'<div class="digest-text">'+escHtml(why.replace('WHY:','').trim())+'</div>':'')
      +(action?'<div class="digest-action">&#10145; '+escHtml(action.replace('ACTION:','').trim())+'</div>':'')
      +'</div>';
  });
  return html||'<div style="font-family:var(--mono);font-size:9px;color:var(--text);line-height:2;padding:10px;">'+escHtml(text)+'</div>';
}
function renderLocalDigest(){
  var items=[];
  var interested=leads.filter(function(l){return l.status==='interested';});
  var hot=leads.filter(function(l){return(l.score||0)>=8;});
  var overdueRev=revenueData.filter(function(r){return r.status==='overdue';});
  var advPending=pipeline.filter(function(p){return p.stage==='advance_pending';});
  if(overdueRev.length>0)items.push({t:'COLLECT OVERDUE PAYMENTS',w:overdueRev.length+' payment(s) overdue',a:'Call '+overdueRev.map(function(r){return r.name;}).join(', ')+' today'});
  if(advPending.length>0)items.push({t:'CLOSE ADVANCE PENDING DEALS',w:advPending.length+' deal(s) waiting for advance',a:'Follow up with '+advPending.map(function(p){return p.name;}).join(', ')});
  if(interested.length>0)items.push({t:'SEND PROPOSALS TO INTERESTED LEADS',w:interested.length+' leads showed interest',a:'Build proposal for '+interested.slice(0,2).map(function(l){return l.name;}).join(', ')});
  if(hot.length>0)items.push({t:'CONTACT HOT LEADS',w:'Score 8+ leads — highest conversion chance',a:'WhatsApp '+hot.slice(0,3).map(function(l){return l.name;}).join(', ')});
  items.push({t:'ADD 10 NEW LEADS FROM GOOGLE MAPS',w:'Pipeline needs fresh input daily',a:'Search your target category in Ahmedabad, import CSV'});
  return items.map(function(item,i){
    return '<div class="digest-item"><div class="digest-priority">&#9889; '+item.t+'</div>'
      +'<div class="digest-text">'+item.w+'</div>'
      +'<div class="digest-action">&#10145; '+item.a+'</div></div>';
  }).join('');
}

// ============================================================
// COMMAND — CHAT (Feature 1: Voice, Feature 6: File Attach)
// ============================================================
function getGroqKey(){return window.YuviVault?window.YuviVault.getItem('yuvi_groq_key'):'';}
var modeTokens={chat:350,plan:900,outreach:500,proposal:1800,brief:120};
var modeTemps={chat:0.4,plan:0.6,outreach:0.6,proposal:0.7,brief:0.4};
var modeInstr={
  chat:'Reply short and sharp. Max 3-4 lines. Only go longer if asked.',
  plan:'Be structured and thorough. Use numbered steps. Think like a strategist.',
  outreach:'Generate ready-to-send messages. WhatsApp style, Indian business context, Hinglish ok. Always give 2 variants.',
  proposal:'Build a full business proposal. Ask clarifying questions one at a time. When ready, output: ===PROPOSAL_READY=== then the full proposal with sections: Executive Summary, Client Challenge, Our Solution, Deliverables, Timeline, Investment, Why Yugantar, Next Steps.',
  brief:'Two sentences maximum. No exceptions. Be brutally concise.'
};
function setMode(mode,el){currentMode=mode;document.querySelectorAll('.mode-pill').forEach(function(p){p.classList.remove('active');});if(el)el.classList.add('active');else{var f=document.querySelector('.mode-pill[data-mode="'+mode+'"]');if(f)f.classList.add('active');}}
function setModeByName(mode){setMode(mode,null);}
function handleChatKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}

// VOICE INPUT (Feature 1)
function toggleVoice(){
  var btn=document.getElementById('voice-btn');
  if(!('webkitSpeechRecognition' in window)&&!('SpeechRecognition' in window)){showToast('Voice not supported on this browser');return;}
  if(isRecording){if(recognition)recognition.stop();return;}
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition=new SR();recognition.lang='en-IN';recognition.continuous=false;recognition.interimResults=true;
  recognition.onstart=function(){isRecording=true;btn.classList.add('recording');showToast('Listening...');};
  recognition.onresult=function(e){
    var transcript='';for(var i=e.resultIndex;i<e.results.length;i++){transcript+=e.results[i][0].transcript;}
    document.getElementById('chat-inp').value=transcript;autoResize(document.getElementById('chat-inp'));
  };
  recognition.onend=function(){isRecording=false;btn.classList.remove('recording');};
  recognition.onerror=function(e){isRecording=false;btn.classList.remove('recording');showToast('Voice error: '+e.error);};
  recognition.start();
}

// FILE ATTACH (Feature 6 — part 1)
function handleFileAttach(input){
  var file=input.files[0];if(!file)return;
  attachedFile=file;
  var bar=document.getElementById('file-preview-bar');
  var btn=document.getElementById('attach-btn');
  btn.classList.add('has-file');
  if(file.type.startsWith('image/')){
    var reader=new FileReader();
    reader.onload=function(e){
      attachedFileContent='[IMAGE ATTACHED: '+file.name+']';
      bar.style.display='flex';
      bar.innerHTML='<div class="file-preview"><span>&#128247; '+file.name+'</span>'
        +'<img src="'+e.target.result+'" style="height:28px;border:1px solid var(--edge2);" />'
        +'<button class="btn danger" style="font-size:7px;padding:2px 5px;" onclick="clearAttachment()">&#10005;</button></div>';
      showToast('Image attached: '+file.name);
    };
    reader.readAsDataURL(file);
  }else{
    var reader2=new FileReader();
    reader2.onload=function(e){
      var content=e.target.result;
      var maxChars=3000;
      attachedFileContent='[FILE: '+file.name+']\n'+content.substring(0,maxChars)+(content.length>maxChars?'\n...(truncated)':'');
      bar.style.display='flex';
      bar.innerHTML='<div class="file-preview"><span>&#128206; '+file.name+' ('+Math.round(file.size/1024)+'KB)</span>'
        +'<button class="btn danger" style="font-size:7px;padding:2px 5px;" onclick="clearAttachment()">&#10005;</button></div>';
      showToast('File attached: '+file.name);
    };
    reader2.readAsText(file);
  }
  input.value='';
}
function clearAttachment(){
  attachedFile=null;attachedFileContent='';
  document.getElementById('file-preview-bar').style.display='none';
  document.getElementById('attach-btn').classList.remove('has-file');
}

// SEND CHAT
async function sendChat(){
  var inp=document.getElementById('chat-inp');
  var msg=inp.value.trim();
  if(!msg&&!attachedFileContent)return;
  var key=getGroqKey();
  if(!key){showToast('Add Groq API key in Settings \u2699');return;}
  var fullMsg=msg+(attachedFileContent?'\n\n'+attachedFileContent:'');
  inp.value='';inp.style.height='auto';
  clearAttachment();
  document.getElementById('send-btn').disabled=true;setStatusDot(true);
  appendMsg('user',msg+(attachedFile?'\n\n[Attached: '+(attachedFile?attachedFile.name:'')+ ']':''),'SHLOK');

  // widget command parser
  var cmdResult=parseCommand(fullMsg);
  if(cmdResult){appendMsg('ai',cmdResult,'YUVI \u00B7 ACTION');document.getElementById('send-btn').disabled=false;setStatusDot(false);return;}

  // memory save command
  if(/^(remember|save)\s+/i.test(msg)){
    var thing=msg.replace(/^(remember|save)\s+/i,'');
    if(memory){if(!memory.logs)memory.logs=[];memory.logs.push({date:new Date().toISOString(),type:'manual_save',note:thing});await saveMemory({logs:memory.logs});}
    appendMsg('ai','Saved to memory: "'+thing+'"','YUVI \u00B7 MEMORY');
    document.getElementById('send-btn').disabled=false;setStatusDot(false);return;
  }

  // reminder command
  var remMatch=msg.match(/remind(?:er)?\s+(?:me\s+)?(?:about\s+)?(.+?)\s+in\s+(\d+)\s+day/i);
  if(remMatch){addReminder(remMatch[1],remMatch[2]);appendMsg('ai','Reminder set! I\'ll alert you in '+remMatch[2]+' day(s) about: '+remMatch[1],'YUVI \u00B7 REMINDER');document.getElementById('send-btn').disabled=false;setStatusDot(false);return;}

  // v6 PHASE 3 — blank-canvas widget generation branch. Deterministic
  // classification (no AI call needed to decide); only the widget CONTENT
  // itself is generated by Groq.
  if(window.YuviWidgetEngine){
    var intent=window.YuviWidgetEngine.classifyIntent(fullMsg,canvasWidgets);
    if(intent.isWidgetRequest){
      showCommandChip(msg);
      nav('command'); // ensure canvas is visible
      await handleWidgetCommand(fullMsg,intent.targetWidgetId);
      document.getElementById('send-btn').disabled=false;inp.focus();
      return;
    }
  }

  chatHistory.push({role:'user',content:fullMsg});
  var typing=appendTyping();
  var now=new Date();
  var days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var personality=localStorage.getItem('yuvi_personality')||'Sharp, direct, practical. Ahmedabad business culture aware.';
  var memCtx=getMemoryContext();
  var leadsSummary='Leads: '+leads.length+' total, '+leads.filter(function(l){return l.status==='interested';}).length+' interested, '+leads.filter(function(l){return(l.score||0)>=8;}).length+' hot-scored.';
  /* YUVI v5 — Brain knowledge injection */
  var knowledgeCtx=window.YuviBrain?window.YuviBrain.composeSystemPrompt():'';
  var sysPrompt=getMasterPrompt()+'\n\n=== LIVE DASHBOARD STATE ===\n'+leadsSummary+' Date/time IST: '+days[now.getDay()]+', '+now.getDate()+' '+months[now.getMonth()]+' '+now.getFullYear()+' at '+now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})+'.\nCurrent UI mode: '+currentMode.toUpperCase()+'. Mode instruction: '+modeInstr[currentMode]+'\nAdditional personality note: '+personality+memCtx+(knowledgeCtx?'\n\n'+knowledgeCtx:'');
  try{
    var data={choices:[{message:{content:await window.YuviBrain.rawChat([{role:'system',content:sysPrompt}].concat(chatHistory.slice(-14)),{maxTokens:modeTokens[currentMode]||350,temperature:modeTemps[currentMode]||0.5,mode:currentMode,force:true}).catch(function(e){return 'Error: '+e.message;})}}]};
    if(data.error){typing.remove();appendMsg('ai','YUVI offline \u2014 check API key in Settings.','YUVI \u00B7 ERROR');document.getElementById('send-btn').disabled=false;setStatusDot(false);return;}
    var reply=(data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'Signal lost.';
    chatHistory.push({role:'assistant',content:reply});
    typing.remove();
    if(reply.includes('===PROPOSAL_READY===')){
      var parts=reply.split('===PROPOSAL_READY===');
      if(parts[0].trim())appendMsg('ai',parts[0].trim(),'YUVI \u00B7 PROPOSAL');
      var pDiv=appendMsgWithActions('ai',parts[1]?parts[1].trim():'','YUVI \u00B7 PROPOSAL READY');
      addProposalActions(pDiv,parts[1]?parts[1].trim():'');
    }else{
      var lbl={plan:'STRATEGY',outreach:'OUTREACH',brief:'BRIEF',proposal:'PROPOSAL',chat:'YUGANTAR'}[currentMode]||'YUGANTAR';
      appendMsg('ai',reply,'YUVI \u00B7 '+lbl);
      // TTS
      if(currentMode==='brief'||currentMode==='chat')speakReply(reply);
    }
  }catch(err){typing.remove();appendMsg('ai','Error: '+err.message,'YUVI \u00B7 ERROR');}
  document.getElementById('send-btn').disabled=false;setStatusDot(false);inp.focus();
}

// TTS (Feature 1 — voice output)
function speakReply(text){
  if(!('speechSynthesis' in window))return;
  var utter=new SpeechSynthesisUtterance(text.substring(0,300));
  utter.lang='en-IN';utter.rate=1.05;utter.pitch=0.85;
  var voices=window.speechSynthesis.getVoices();
  var preferred=voices.find(function(v){return v.lang==='en-IN';});
  if(preferred)utter.voice=preferred;
  window.speechSynthesis.speak(utter);
}

// WIDGET COMMAND PARSER (Feature for controlling dashboard via chat)
function parseCommand(msg){
  /* YUVI v5 — Brain handles intent first; existing logic is the fallback */
  if(window.YuviBrain){
    var brainResult=window.YuviBrain.handle(msg);
    if(brainResult!==null)return brainResult;
  }
  var m=msg.toLowerCase().trim();
  // add lead
  var addLead=m.match(/^add lead[:\s]+(.+?)(?:\s+(\d{10,}))?(?:\s+(website|seo|smm|digital))?$/i);
  if(addLead){var name=addLead[1].trim();var phone=addLead[2]||'';var cat=addLead[3]||'unknown';leads.push({id:Date.now(),name:name,phone:phone,category:cat,address:'Ahmedabad',status:'new',rating:0,notes:'',score:5});localStorage.setItem('yuvi_leads',JSON.stringify(leads));renderLeads();scoreAllLeads();return'Done. Lead added: '+name+(phone?' ('+phone+')':'')+'.';}
  // move pipeline stage
  var moveStage=m.match(/move (.+?) to (approached|contacted|interested|proposal.sent|advance.pending|closed)/i);
  if(moveStage){var pname=moveStage[1].trim();var stage=moveStage[2].replace(/\s/g,'_').replace('proposal_sent','proposal_sent');var card=pipeline.find(function(c){return c.name.toLowerCase().includes(pname.toLowerCase());});if(card){card.stage=stage;card.lastTouched=new Date().toISOString();localStorage.setItem('yuvi_pipeline',JSON.stringify(pipeline));renderPipeline();return card.name+' moved to '+PIPE_LABELS[stage]+'.';}return'Could not find "'+pname+'" in pipeline.';}
  // mark payment
  var payMatch=m.match(/mark (.+?) (?:payment\s+)?(?:as\s+)?(paid|pending|overdue)/i);
  if(payMatch){var cname=payMatch[1].trim();var pstatus=payMatch[2];var client=clients.find(function(c){return c.name.toLowerCase().includes(cname.toLowerCase());});if(client){client.payment=pstatus;localStorage.setItem('yuvi_clients',JSON.stringify(clients));renderClients();return client.name+' payment marked as '+pstatus.toUpperCase()+'.';}var rev=revenueData.find(function(r){return r.name.toLowerCase().includes(cname.toLowerCase());});if(rev){rev.status=pstatus;renderRevenue();return rev.name+' revenue status: '+pstatus.toUpperCase()+'.';}return'Could not find "'+cname+'".';}
  // show pipeline
  if(m==='pipeline'||m==='open pipeline'||m==='show pipeline'){nav('pipeline');return'Pipeline opened.';}
  // show leads
  if(m==='leads'||m==='show leads'||m==='open leads'){nav('leads');return'Leads opened.';}
  // score leads
  if(m==='score leads'||m==='rescore'||m==='score all leads'){scoreAllLeads();renderLeads();return'All leads rescored. Hot leads (8+): '+leads.filter(function(l){return(l.score||0)>=8;}).map(function(l){return l.name;}).join(', ')+'.';}
  return null;
}

function setStatusDot(t){var dot=document.getElementById('cmd-status-dot');if(t)dot.classList.add('thinking');else dot.classList.remove('thinking');}
// v6.1 — every YUVI response (and Shlok's own messages) now renders as a
// live widget card directly in the canvas — there is no separate chat-bubble
// strip anymore. makeResponseWidget() builds the widget object; the actual
// card look is handled by renderWidgetBody()'s 'response' case below.
function makeResponseWidget(role,text,label,extra){
  var now=new Date().toISOString();
  var time=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  return {
    id:'r_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
    type:'response',
    title:label,
    subtitle:time,
    data:Object.assign({role:role,text:text},extra||{}),
    pinned:false,locked:false,createdAt:now,updatedAt:now
  };
}
function renderCanvasAndScroll(){
  renderCanvas();
  var wrap=document.getElementById('yuvi-canvas-wrap');
  if(wrap)wrap.scrollTop=wrap.scrollHeight;
}
function appendMsg(type,text,label){
  var w=makeResponseWidget(type,text,label);
  canvasWidgets.push(w);
  renderCanvasAndScroll();
  logConversationMessage(type,text,label);
  return document.getElementById('yc-card-'+w.id);
}
function appendMsgWithActions(type,text,label){
  var w=makeResponseWidget(type,text,label,{actions:true});
  canvasWidgets.push(w);
  renderCanvasAndScroll();
  logConversationMessage(type,text,label);
  return document.getElementById('yc-card-'+w.id);
}
function appendTyping(){
  var w=makeResponseWidget('ai','','YUVI \u00B7 THINKING',{typing:true});
  canvasWidgets.push(w);
  renderCanvasAndScroll();
  return {remove:function(){canvasWidgets=canvasWidgets.filter(function(x){return x.id!==w.id;});renderCanvasAndScroll();}};
}

// ============================================================
// v6 PHASE 3 — CHAT CANVAS (blank-canvas dynamic widget surface)
// Pure logic lives in brain/widgetEngine.js (window.YuviWidgetEngine);
// everything below is DOM wiring + the Groq call orchestration.
// ============================================================
var canvasWidgets=[];

function initCanvas(){
  canvasWidgets=window.YuviWidgetEngine?window.YuviWidgetEngine.load():[];
  startNewConversation();
  renderCanvas();
}
function renderCanvas(){
  var grid=document.getElementById('yuvi-canvas');
  var empty=document.getElementById('yuvi-canvas-empty');
  if(!grid||!empty)return;
  grid.innerHTML='';
  canvasWidgets.forEach(function(w){grid.appendChild(buildWidgetCardEl(w));});
  empty.style.display=canvasWidgets.length===0?'flex':'none';
}
function persistCanvas(){if(window.YuviWidgetEngine)window.YuviWidgetEngine.persist(canvasWidgets);}

// ============================================================
// v6.1 — TRACK A #3: PREVIOUS CONVERSATIONS SIDE PANEL
// Every message that goes through appendMsg()/appendMsgWithActions() is
// mirrored here so past sessions can be browsed later. Capped to the last
// 30 conversations so localStorage doesn't grow unbounded.
// ============================================================
var CONV_LS_KEY='yuvi_conversations';
var CONV_MAX=30;
var activeConversation=null;

function loadConversationList(){
  try{
    var raw=localStorage.getItem(CONV_LS_KEY);
    var arr=raw?JSON.parse(raw):[];
    return Array.isArray(arr)?arr:[];
  }catch(e){return [];}
}
function saveConversationList(list){
  try{localStorage.setItem(CONV_LS_KEY,JSON.stringify(list.slice(-CONV_MAX)));}catch(e){/* storage full or blocked — non-fatal */}
}
function startNewConversation(){
  activeConversation={id:'conv_'+Date.now(),title:new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short'})+' \u00B7 '+new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),startedAt:new Date().toISOString(),messages:[]};
}
function logConversationMessage(role,text,label){
  if(!activeConversation)startNewConversation();
  if(!text)return; // skip empty/typing placeholders
  activeConversation.messages.push({role:role,label:label,text:text,time:new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})});
  var list=loadConversationList();
  var idx=list.findIndex(function(c){return c.id===activeConversation.id;});
  if(idx===-1)list.push(activeConversation);else list[idx]=activeConversation;
  saveConversationList(list);
}
function toggleHistoryPanel(){
  var panel=document.getElementById('history-panel');
  if(!panel)return;
  var opening=!panel.classList.contains('show');
  panel.classList.toggle('show');
  if(opening)populateHistorySelect();
}
function populateHistorySelect(){
  var sel=document.getElementById('history-select');
  if(!sel)return;
  var list=loadConversationList().slice().reverse(); // newest first
  sel.innerHTML='<option value="">Select a past conversation\u2026</option>'+list.map(function(c){
    return '<option value="'+c.id+'">'+escHtml(c.title)+' ('+c.messages.length+' msgs)</option>';
  }).join('');
}
function loadConversationFromHistory(id){
  var listEl=document.getElementById('history-list');
  if(!listEl)return;
  if(!id){listEl.innerHTML='';return;}
  var list=loadConversationList();
  var convo=list.find(function(c){return c.id===id;});
  if(!convo){listEl.innerHTML='<div style="font-size:10px;color:var(--muted);">Not found.</div>';return;}
  listEl.innerHTML=convo.messages.map(function(m){
    return '<div class="history-item"><div class="hi-role">'+escHtml(m.label||m.role)+' \u00B7 '+escHtml(m.time||'')+'</div><div class="hi-text">'+escHtml(m.text)+'</div></div>';
  }).join('')||'<div style="font-size:10px;color:var(--muted);">No messages in this conversation.</div>';
}

function showCommandChip(text){
  var chip=document.getElementById('yuvi-command-chip');
  if(!chip)return;
  chip.innerHTML='&#128172; '+escHtml(text.length>90?text.slice(0,90)+'\u2026':text);
  chip.classList.add('show');
}
function hideCommandChip(){var chip=document.getElementById('yuvi-command-chip');if(chip)chip.classList.remove('show');}

// Thinking-state card — real step progression (not a canned animation):
// step 0 lights up immediately, step 1 once the prompt is built, step 2 while
// the Groq call is actually in flight.
function showThinkingCard(steps){
  var grid=document.getElementById('yuvi-canvas');
  document.getElementById('yuvi-canvas-empty').style.display='none';
  var card=document.createElement('div');
  card.className='yc-thinking';card.id='yc-thinking-live';
  card.innerHTML='<div class="yc-thinking-head"><span class="hud-ring sm"></span> YUVI IS WORKING</div>'
    +'<div class="yc-thinking-steps">'+steps.map(function(s,i){return '<div class="yc-thinking-step" id="yc-step-'+i+'"><span class="yc-step-mark">&#9675;</span>'+escHtml(s)+'</div>';}).join('')+'</div>';
  grid.prepend(card);
  return card;
}
function advanceThinkingStep(i){
  var el=document.getElementById('yc-step-'+i);if(!el)return;
  var prev=document.getElementById('yc-step-'+(i-1));
  if(prev){prev.classList.remove('active');prev.classList.add('done');prev.querySelector('.yc-step-mark').innerHTML='&#10003;';}
  el.classList.add('active');
}
function removeThinkingCard(){
  var el=document.getElementById('yc-thinking-live');
  if(el){var last=el.querySelectorAll('.yc-thinking-step');if(last.length){var l=last[last.length-1];l.classList.remove('active');l.classList.add('done');l.querySelector('.yc-step-mark').innerHTML='&#10003;';}setTimeout(function(){el.remove();},250);}
}

// Main entry point — called from sendChat() when classifyIntent() says this
// command wants a widget rather than a plain chat reply.
async function handleWidgetCommand(commandText,targetWidgetId){
  var steps=['Reading context','Analyzing request','Generating widget'];
  showThinkingCard(steps);
  advanceThinkingStep(0);
  setStatusDot(true);
  try{
    var bizCtx=(localStorage.getItem('yuvi_biz_ctx')||'Yugantar Growth. Digital agency, Ahmedabad.')+'\n\n'+getLiveBusinessContext();
    var target=targetWidgetId?canvasWidgets.find(function(w){return w.id===targetWidgetId;}):null;
    await new Promise(function(r){setTimeout(r,150);}); // let step 1 be visible, not instant-skip
    advanceThinkingStep(1);
    var messages=window.YuviWidgetEngine.buildWidgetPrompt(commandText,bizCtx,target);
    advanceThinkingStep(2);
    var raw=await window.YuviBrain.rawChat(messages,{maxTokens:500,temperature:0.4,mode:'widget',force:true});
    var widgetData=window.YuviWidgetEngine.parseWidgetResponse(raw);
    canvasWidgets=window.YuviWidgetEngine.applyWidget(canvasWidgets,widgetData,targetWidgetId);
    persistCanvas();
    removeThinkingCard();
    renderCanvas();
  }catch(e){
    removeThinkingCard();
    showToast('Widget generation failed: '+e.message);
    console.warn('[YUVI:Canvas] widget generation error',e);
  }finally{
    setStatusDot(false);
  }
}

function buildWidgetCardEl(w){
  var el=document.createElement('div');
  var roleClass=w.type==='response'?(' yc-msg yc-msg-'+(w.data&&w.data.role==='user'?'user':'ai')):'';
  el.className='yc-card'+roleClass+(w.pinned?' pinned':'')+(w.locked?' locked':'');
  el.id='yc-card-'+w.id;
  var isTyping=w.type==='response'&&w.data&&w.data.typing;
  var actions=isTyping?'':'<div class="yc-card-actions">'
    +'<button class="'+(w.pinned?'on':'')+'" title="Pin" onclick="toggleWidgetPin(\''+w.id+'\')">&#128204;</button>'
    +'<button class="'+(w.locked?'on':'')+'" title="Lock" onclick="toggleWidgetLock(\''+w.id+'\')">&#128274;</button>'
    +'<button title="Save to Library" onclick="saveWidgetToLibrary(\''+w.id+'\')">&#128190;</button>'
    +'<button title="Remove" onclick="removeWidgetCard(\''+w.id+'\')">&#10005;</button>'
    +'</div>';
  el.innerHTML='<div class="yc-card-head"><div><div class="yc-card-title">'+escHtml(w.title)+'</div>'
    +(w.subtitle?'<div class="yc-card-sub">'+escHtml(w.subtitle)+'</div>':'')+'</div>'+actions+'</div>'
    +'<div class="yc-card-body">'+renderWidgetBody(w)+'</div>';
  return el;
}

function renderWidgetBody(w){
  var d=w.data||{};
  switch(w.type){
    case 'metric':
      return '<div class="yc-metric-val">'+escHtml(String(d.value!=null?d.value:'\u2014'))+'</div>'
        +(d.label?'<div class="yc-metric-label">'+escHtml(d.label)+'</div>':'')
        +(d.delta?'<div class="yc-metric-delta">'+escHtml(d.delta)+'</div>':'');
    case 'list':
      var items=Array.isArray(d.items)?d.items:[];
      return '<ul class="yc-list">'+items.map(function(it){
        if(typeof it==='string')return '<li>'+escHtml(it)+'</li>';
        return '<li><b>'+escHtml(it.title||'')+'</b>'+(it.detail?' \u2014 '+escHtml(it.detail):'')+'</li>';
      }).join('')+'</ul>';
    case 'table':
      var cols=Array.isArray(d.columns)?d.columns:[];var rows=Array.isArray(d.rows)?d.rows:[];
      return '<table class="yc-table"><thead><tr>'+cols.map(function(c){return '<th>'+escHtml(c)+'</th>';}).join('')+'</tr></thead>'
        +'<tbody>'+rows.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+escHtml(String(c))+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>';
    case 'calendar':
      var days=Array.isArray(d.days)?d.days:[];
      return '<div class="yc-cal">'+days.map(function(day){
        return '<div class="yc-cal-day"><div class="yc-cal-day-name">'+escHtml(day.day||'')+'</div>'
          +(Array.isArray(day.items)?day.items.map(function(it){return '<div style="font-size:10px;">'+escHtml(it)+'</div>';}).join(''):'')+'</div>';
      }).join('')+'</div>';
    case 'chart':
      return renderSparklineSVG(Array.isArray(d.values)?d.values:[],Array.isArray(d.labels)?d.labels:[]);
    case 'response':
      if(d.typing)return '<div class="typing"><span></span><span></span><span></span></div>';
      return '<div class="yc-msg-text">'+escHtml(d.text||'')+'</div>'+(d.actions?'<div class="msg-actions"></div>':'');
    case 'text':
    default:
      return escHtml(d.text||'');
  }
}

// Hand-rolled SVG line chart — no external chart library in this app, keeps
// Phase 3 dependency-free and consistent with the rest of the codebase.
function renderSparklineSVG(values,labels){
  if(!values.length)return '<div style="font-size:10px;color:var(--muted);">No data</div>';
  var w=240,h=80,pad=6;
  var max=Math.max.apply(null,values),min=Math.min.apply(null,values);
  var range=(max-min)||1;
  var stepX=values.length>1?(w-pad*2)/(values.length-1):0;
  var pts=values.map(function(v,i){
    var x=pad+i*stepX;
    var y=h-pad-((v-min)/range)*(h-pad*2);
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  var lastPt=pts.split(' ').slice(-1)[0].split(',');
  return '<svg class="yc-chart-svg" viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg">'
    +'<polyline points="'+pts+'" fill="none" stroke="var(--blade)" stroke-width="1.6"/>'
    +'<circle cx="'+lastPt[0]+'" cy="'+lastPt[1]+'" r="2.5" fill="var(--blade)"/>'
    +'</svg>'
    +(labels.length?'<div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:7px;color:var(--muted);margin-top:2px;">'+labels.map(function(l){return '<span>'+escHtml(l)+'</span>';}).join('')+'</div>':'');
}

function toggleWidgetPin(id){canvasWidgets=window.YuviWidgetEngine.setPinned(canvasWidgets,id,!canvasWidgets.find(function(w){return w.id===id;}).pinned);persistCanvas();renderCanvas();}
function toggleWidgetLock(id){canvasWidgets=window.YuviWidgetEngine.setLocked(canvasWidgets,id,!canvasWidgets.find(function(w){return w.id===id;}).locked);persistCanvas();renderCanvas();}
function removeWidgetCard(id){
  var result=window.YuviWidgetEngine.removeWidget(canvasWidgets,id);
  if(result.blocked){showToast('Locked \u2014 unlock before removing');return;}
  canvasWidgets=result.widgets;persistCanvas();renderCanvas();
}

// ============================================================
// v6 PHASE 4 — LIBRARY (archive by client folder + reusable templates)
// Pure logic lives in brain/libraryEngine.js (window.YuviLibrary).
// ============================================================
var libraryArchive=[];var libraryTemplates=[];var libraryActiveTab='archive';

function initLibrary(){
  if(!window.YuviLibrary)return;
  libraryArchive=window.YuviLibrary.loadArchive();
  libraryTemplates=window.YuviLibrary.loadTemplates();
  renderLibrary();
}
function setLibraryTab(tab){
  libraryActiveTab=tab;
  document.getElementById('lib-tab-archive').classList.toggle('active',tab==='archive');
  document.getElementById('lib-tab-templates').classList.toggle('active',tab==='templates');
  document.getElementById('lib-archive-panel').style.display=tab==='archive'?'block':'none';
  document.getElementById('lib-templates-panel').style.display=tab==='templates'?'block':'none';
}
function renderLibrary(){
  renderLibraryArchive();
  renderLibraryTemplates();
}
function renderLibraryArchive(){
  var el=document.getElementById('lib-archive-content');if(!el)return;
  if(!libraryArchive.length){el.innerHTML='<div class="lib-empty">No saved outputs yet. Save a widget from Chat (\u{1F4BE} icon) or generate a proposal to start building your archive.</div>';return;}
  var groups=window.YuviLibrary.groupByClient(libraryArchive);
  el.innerHTML=Object.keys(groups).map(function(clientName){
    return '<div class="lib-folder"><div class="lib-folder-name">&#128193; '+escHtml(clientName)+' ('+groups[clientName].length+')</div>'
      +'<div class="lib-grid">'+groups[clientName].map(function(it){
        return '<div class="lib-item"><div class="lib-item-title">'+escHtml(it.title)+'</div>'
          +'<div class="lib-item-meta">'+it.type.toUpperCase()+' \u00B7 '+new Date(it.createdAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})+'</div>'
          +'<div class="lib-item-actions"><button class="btn primary" onclick="pullArchiveItemToChat(\''+it.id+'\')">PULL TO CHAT</button>'
          +'<button class="btn danger" onclick="removeArchiveItemUI(\''+it.id+'\')">DELETE</button></div></div>';
      }).join('')+'</div></div>';
  }).join('');
}
function renderLibraryTemplates(){
  var el=document.getElementById('lib-templates-content');if(!el)return;
  if(!libraryTemplates.length){el.innerHTML='<div class="lib-empty">No saved templates yet. Type a prompt in Chat, then come back and save it as a reusable template.</div>';return;}
  el.innerHTML='<div class="lib-grid">'+libraryTemplates.map(function(t){
    return '<div class="lib-item"><div class="lib-item-title">'+escHtml(t.name)+'</div>'
      +'<div class="lib-item-meta">'+new Date(t.createdAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})+'</div>'
      +'<div class="lib-item-actions"><button class="btn primary" onclick="triggerTemplate(\''+t.id+'\')">USE IN CHAT</button>'
      +'<button class="btn danger" onclick="removeTemplateUI(\''+t.id+'\')">DELETE</button></div></div>';
  }).join('')+'</div>';
}
function saveWidgetToLibrary(widgetId){
  var w=canvasWidgets.find(function(x){return x.id===widgetId;});if(!w)return;
  var clientNames=clients.map(function(c){return c.name;});
  var suggestion=clientNames.length?clientNames.join(', '):'';
  var clientName=prompt('Save to which client folder? (leave blank for Unassigned)'+(suggestion?'\nExisting: '+suggestion:''),'');
  var entry=window.YuviLibrary.widgetToArchiveItem(w,clientName);
  libraryArchive=window.YuviLibrary.addArchiveItem(libraryArchive,entry);
  window.YuviLibrary.persistArchive(libraryArchive);
  showToast('Saved "'+w.title+'" to Library');
  if(document.getElementById('v-library').classList.contains('active'))renderLibraryArchive();
}
function removeArchiveItemUI(id){libraryArchive=window.YuviLibrary.removeArchiveItem(libraryArchive,id);window.YuviLibrary.persistArchive(libraryArchive);renderLibraryArchive();showToast('Removed from Library');}
function pullArchiveItemToChat(id){
  var it=libraryArchive.find(function(x){return x.id===id;});if(!it)return;
  var text=window.YuviLibrary.buildChatContextText(it);
  nav('command');
  setTimeout(function(){var inp=document.getElementById('chat-inp');inp.value=text;autoResize(inp);inp.focus();},150);
  showToast('Pulled "'+it.title+'" into Chat');
}
function saveCurrentPromptAsTemplate(){
  var inp=document.getElementById('chat-inp');
  var text=(inp&&inp.value.trim())||'';
  if(!text){var manual=prompt('No text in Chat input right now. Type the template prompt to save:');if(!manual)return;text=manual;}
  var name=prompt('Name this template:','');if(!name)return;
  libraryTemplates=window.YuviLibrary.addTemplate(libraryTemplates,{name:name,promptText:text});
  window.YuviLibrary.persistTemplates(libraryTemplates);
  renderLibraryTemplates();
  showToast('Template saved: '+name);
}
function triggerTemplate(id){
  var t=libraryTemplates.find(function(x){return x.id===id;});if(!t)return;
  var text=window.YuviLibrary.buildChatContextText(t);
  nav('command');
  setTimeout(function(){var inp=document.getElementById('chat-inp');inp.value=text;autoResize(inp);inp.focus();},150);
  showToast('Loaded template: '+t.name);
}
function removeTemplateUI(id){libraryTemplates=window.YuviLibrary.removeTemplate(libraryTemplates,id);window.YuviLibrary.persistTemplates(libraryTemplates);renderLibraryTemplates();showToast('Template removed');}

// ============================================================
// v6 PHASE 5 — PROACTIVE BEHAVIORS (frontend/state logic only)
// Pure decision logic lives in brain/proactiveEngine.js (window.YuviProactive).
// ============================================================
var attentionWidgetId=null;
var attentionShownThisSession=false;

function getStageThresholdDays(){return parseInt(localStorage.getItem('yuvi_pref_stage_threshold_days')||'5',10)||5;}

// Item 1 — surfaces on Chat open, once per session (not on every nav click).
function maybeSurfaceAttentionItems(){
  if(attentionShownThisSession)return;
  if(!window.YuviProactive)return;
  var items=window.YuviProactive.getAttentionItems(leads,pipeline,clients,getStageThresholdDays());
  if(!items.length)return;
  attentionShownThisSession=true;
  var widgetData={type:'list',title:'Needs Your Attention',subtitle:items.length+' item(s)',data:{items:items.map(function(it){return {title:it.title,detail:it.detail};})}};
  canvasWidgets=window.YuviWidgetEngine.applyWidget(canvasWidgets,widgetData,attentionWidgetId);
  attentionWidgetId=canvasWidgets[canvasWidgets.length-1].id;
  persistCanvas();renderCanvas();
  var el=document.getElementById('yc-card-'+attentionWidgetId);
  if(el)el.classList.add('attention');
}

// Item 4 — Daily Digest auto-runs at the configured briefing time and lands
// as a (pinned, so it survives reload) canvas widget instead of requiring
// the manual digest-panel button. Falls back to the same local rule-based
// digest the manual button already falls back to when no Groq key is set.
async function runDailyDigestIfDue(){
  if(!window.YuviProactive)return;
  var prefTime=localStorage.getItem('yuvi_pref_briefing_time')||'08:00';
  var lastRun=localStorage.getItem('yuvi_last_digest_run_date');
  if(!window.YuviProactive.shouldRunDailyDigestNow(prefTime,lastRun))return;
  var key=getGroqKey();
  var digestText;
  if(key){
    try{
      var lc=leads.length,ic=leads.filter(function(l){return l.status==='interested';}).length;
      var fc=leads.filter(function(l){return l.status==='follow_up';}).length;
      var cc=clients.filter(function(c){return c.status==='active';}).length;
      var overdue=revenueData.filter(function(r){return r.status==='overdue';}).length;
      var memCtx=getMemoryContext();
      var sys=getMasterPrompt()+'\n\n=== LIVE DASHBOARD STATE ===\n'+cc+' active clients, '+lc+' leads, '+ic+' interested, '+fc+' need follow-up, '+overdue+' overdue payments.'+memCtx;
      var prompt='Generate today\'s Daily Digest: exactly 3-5 prioritized action items with a one-line reason each. Be brutally specific and short — this renders in a compact widget card.';
      digestText=await window.YuviBrain.rawChat([{role:'system',content:sys},{role:'user',content:prompt}],{maxTokens:400,temperature:0.6,mode:'brief'}).catch(function(){return '';});
    }catch(e){digestText='';}
  }
  if(!digestText)digestText=localFallbackBriefing();
  var widgetData={type:'text',title:'Daily Digest',subtitle:new Date().toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'short'}),data:{text:digestText}};
  var existingDigest=canvasWidgets.find(function(w){return w.title==='Daily Digest';});
  canvasWidgets=window.YuviWidgetEngine.applyWidget(canvasWidgets,widgetData,existingDigest?existingDigest.id:null);
  var created=canvasWidgets[canvasWidgets.length-1];
  canvasWidgets=window.YuviWidgetEngine.setPinned(canvasWidgets,created.id,true); // "appears as a widget next time the app opens" => must survive reload
  persistCanvas();
  localStorage.setItem('yuvi_last_digest_run_date',new Date().toISOString());
}

// Item 5 — suggested only, never auto-executed. Shown as a dismissible bar
// with an explicit "Ask YUVI" action the user must click.
function offerNextAction(type,ctx){
  if(!window.YuviProactive)return;
  var text=window.YuviProactive.suggestNextAction(type,ctx);
  if(!text)return;
  showSuggestionBar(text);
}
function showSuggestionBar(text){
  var el=document.getElementById('yuvi-suggestion-toast');if(!el)return;
  el.innerHTML='<span style="font-family:var(--sans);font-size:11px;color:var(--text);max-width:340px;">'+escHtml(text)+'</span>'
    +'<button class="btn primary" style="font-size:8px;padding:5px 10px;flex-shrink:0;" onclick="useSuggestionInChat()">ASK YUVI</button>'
    +'<button class="btn" style="font-size:8px;padding:5px 10px;flex-shrink:0;" onclick="dismissSuggestionBar()">DISMISS</button>';
  el.setAttribute('data-suggestion',text);
  el.classList.add('show');
  clearTimeout(window.__suggTimer);
  window.__suggTimer=setTimeout(dismissSuggestionBar,10000);
}
function useSuggestionInChat(){
  var el=document.getElementById('yuvi-suggestion-toast');
  var text=el?el.getAttribute('data-suggestion')||'':'';
  dismissSuggestionBar();
  nav('command');
  setTimeout(function(){var inp=document.getElementById('chat-inp');if(inp){inp.value=text;autoResize(inp);inp.focus();}},150);
}
function dismissSuggestionBar(){var el=document.getElementById('yuvi-suggestion-toast');if(el)el.classList.remove('show');}

function addProposalActions(div,pText){var a=div.querySelector('.msg-actions');if(!a)return;var pb=document.createElement('button');pb.className='btn gold';pb.innerHTML='&#8595; PDF';pb.onclick=function(){generateProposalPDF(pText);};var cb=document.createElement('button');cb.className='btn';cb.textContent='COPY';cb.onclick=function(){navigator.clipboard.writeText(pText).then(function(){showToast('Copied!');});};var cvb=document.createElement('button');cvb.className='btn primary';cvb.textContent='DESIGN BRIEF';cvb.onclick=function(){openInCanva(pText);};a.appendChild(pb);a.appendChild(cb);a.appendChild(cvb);}
function escHtml(t){return window.YuviSecurity?window.YuviSecurity.escapeHTML(t):(t==null?'':String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'));}

// ============================================================
// PROPOSAL PDF + CANVA
// ============================================================
function autoDetectColor(text){var t=(text||'').toLowerCase();if(t.includes('finance')||t.includes('fintech')||t.includes('advisory'))return{primary:'#032B44',accent:'#f0b429'};if(t.includes('food')||t.includes('restaurant')||t.includes('cafe'))return{primary:'#7c2d12',accent:'#FF6B35'};if(t.includes('health')||t.includes('clinic')||t.includes('hospital'))return{primary:'#14532d',accent:'#22d68e'};if(t.includes('retail')||t.includes('furniture')||t.includes('textile'))return{primary:'#0a4a5a',accent:'#0ef6ff'};return{primary:'#032B44',accent:'#0ef6ff'};}
function hexToRgb(hex){hex=hex.replace('#','');if(hex.length===3)hex=hex.split('').map(function(c){return c+c;}).join('');return[parseInt(hex.substring(0,2),16),parseInt(hex.substring(2,4),16),parseInt(hex.substring(4,6),16)];}
function generateProposalPDF(proposalText){
  if(typeof window.jspdf==='undefined'){showToast('PDF library loading');return;}
  var colors=autoDetectColor(proposalText);var pr=hexToRgb(colors.primary);var ar=hexToRgb(colors.accent);
  var jsPDF=window.jspdf.jsPDF;var doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  var pw=210,ph=297,mg=18,cw=pw-mg*2;
  doc.setFillColor(5,10,15);doc.rect(0,0,pw,ph,'F');doc.setFillColor(pr[0],pr[1],pr[2]);doc.rect(0,0,pw,3,'F');doc.setFillColor(8,15,23);doc.rect(0,3,pw,32,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(22);doc.setTextColor(pr[0],pr[1],pr[2]);doc.text('YUGANTAR GROWTH',mg,18);
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,150,160);doc.text('DIGITAL GROWTH AGENCY \u00B7 AHMEDABAD',mg,25);
  doc.setFontSize(8);doc.setTextColor(ar[0],ar[1],ar[2]);doc.text('PROPOSAL \u00B7 '+new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),pw-mg,18,{align:'right'});
  doc.setDrawColor(pr[0],pr[1],pr[2]);doc.setLineWidth(0.3);doc.line(mg,36,pw-mg,36);
  var cm=proposalText.match(/(?:for|client|prepared for)[:\s]+([A-Za-z\s]+)/i);var cn=cm?cm[1].trim().split('\n')[0].substring(0,40):'Client';
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(220,230,240);doc.text('PREPARED FOR: '+cn.toUpperCase(),mg,44);
  var y=54;var lines=proposalText.split('\n');
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();if(!line){y+=3;continue;}
    if(y>ph-25){doc.addPage();doc.setFillColor(5,10,15);doc.rect(0,0,pw,ph,'F');doc.setFillColor(pr[0],pr[1],pr[2]);doc.rect(0,0,pw,2,'F');y=16;}
    if(line===line.toUpperCase()&&line.length>3&&line.length<60&&!line.includes('HTTP')){doc.setFillColor(Math.floor(pr[0]*.15),Math.floor(pr[1]*.15),Math.floor(pr[2]*.15));doc.rect(mg-2,y-4,cw+4,8,'F');doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(pr[0],pr[1],pr[2]);doc.text(line,mg,y);y+=8;}
    else if(/^[-*\u2022]/.test(line)){doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(180,200,210);doc.setFillColor(ar[0],ar[1],ar[2]);doc.circle(mg+1.5,y-1.5,1,'F');var w1=doc.splitTextToSize(line.replace(/^[-*\u2022]\s*/,''),cw-8);doc.text(w1,mg+6,y);y+=w1.length*5+2;}
    else if(line.includes('\u20B9')){doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(ar[0],ar[1],ar[2]);var w2=doc.splitTextToSize(line,cw);doc.text(w2,mg,y);y+=w2.length*5.5+2;}
    else{doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(160,185,200);var w3=doc.splitTextToSize(line,cw);doc.text(w3,mg,y);y+=w3.length*5+1.5;}
  }
  var tp=doc.internal.getNumberOfPages();for(var p=1;p<=tp;p++){doc.setPage(p);doc.setDrawColor(pr[0],pr[1],pr[2]);doc.setLineWidth(0.2);doc.line(mg,ph-14,pw-mg,ph-14);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(60,90,100);doc.text('Yugantar Growth \u00B7 Ahmedabad',mg,ph-8);doc.text('Page '+p+' of '+tp,pw-mg,ph-8,{align:'right'});doc.setFillColor(pr[0],pr[1],pr[2]);doc.rect(0,ph-2,pw,2,'F');}
  var fname='Yugantar_Proposal_'+cn.replace(/\s+/g,'_')+'_'+new Date().toISOString().slice(0,10)+'.pdf';doc.save(fname);showToast('PDF saved!');
  var lm=leads.find(function(l){return l.name.toLowerCase().includes(cn.toLowerCase().split(' ')[0]);});if(lm){lm.status='proposal_sent';localStorage.setItem('yuvi_leads',JSON.stringify(leads));renderLeads();}
}
function openInCanva(pText){
  var colors=autoDetectColor(pText);
  var cm=pText.match(/(?:for|client|prepared for)[:\s]+([A-Za-z\s]+)/i);
  var cn=cm?cm[1].trim().split('\n')[0].substring(0,30):'Client';
  var brief='=== YUVI DESIGN BRIEF ===\nProject: Yugantar Growth Proposal — '+cn+'\nPrimary Color: '+colors.primary+'\nAccent Color: '+colors.accent+'\nFonts: Syne (headings), DM Sans (body)\nStyle: Professional, dark background, minimal, premium\nLogo: YG triangle mark\nBrand Voice: Simple. Short. Smooth.\nInstruction for Canva AI: Create a professional business proposal presentation. Dark background ('+colors.primary+'), accent highlights ('+colors.accent+'). Include cover slide, problem/solution, services, pricing, and next steps slides.';
  navigator.clipboard.writeText(brief).then(function(){
    // show brief as a card in the canvas
    appendMsg('ai',brief,'YUVI \u00B7 CANVA DESIGN BRIEF');
    showToast('Brief copied! Opening Canva\u2026');
    // open Canva presentation creator — most reliable deep link
    setTimeout(function(){
      window.open('https://www.canva.com/design/DANew/?s=presentation','_blank');
    },400);
  }).catch(function(){
    // fallback if clipboard blocked
    showToast('Opening Canva\u2026');
    window.open('https://www.canva.com/design/DANew/?s=presentation','_blank');
  });
}

// ============================================================
// LEADS
// ============================================================
function setCatFilter(cat,el){catFilter=cat;document.querySelectorAll('.fpill').forEach(function(p){p.classList.remove('active');});el.classList.add('active');renderLeads();}
function renderLeads(){
  var tbody=document.getElementById('leads-tbody');var empty=document.getElementById('leads-empty');
  var search=(document.getElementById('lead-search')||{}).value||'';search=search.toLowerCase();
  var filtered=leads.filter(function(l){return(!search||l.name.toLowerCase().includes(search)||(l.phone&&l.phone.includes(search)))&&(catFilter==='all'||l.category===catFilter);});
  if(leads.length===0){tbody.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  var statOpts=['new','approached','contacted','interested','follow_up','proposal_sent','not_interested','closed'];
  var statLbls={new:'NEW',approached:'APPROACHED',contacted:'CONTACTED',interested:'INTERESTED',follow_up:'FOLLOW UP',proposal_sent:'PROPOSAL SENT',not_interested:'NOT INT.',closed:'CLOSED'};
  tbody.innerHTML=filtered.map(function(l,i){
    var score=l.score||calcLeadScore(l);var sc=getScoreClass(score);
    var sel='<select class="lead-status-sel" onchange="updateLeadStatus('+l.id+',this.value)" onclick="event.stopPropagation()">'+statOpts.map(function(s){return'<option value="'+s+'"'+(l.status===s?' selected':'')+'>'+statLbls[s]+'</option>';}).join('')+'</select>';
    return '<tr onclick="selectLead('+l.id+')" '+(selectedLead&&selectedLead.id===l.id?'class="sel-row"':'')+'>'+
      '<td style="color:var(--muted);">'+(i+1)+'</td>'+
      '<td>'+escHtml(l.name)+'</td>'+
      '<td>'+(l.phone||'-')+'</td>'+
      '<td><span class="cat-badge cat-'+l.category+'">'+getCatLabel(l.category)+'</span></td>'+
      '<td><span class="lead-score '+sc+'" title="'+getScoreTooltip(score,l)+'">'+score+'</span></td>'+
      '<td>'+sel+'</td>'+
      '<td><button class="wa-btn" onclick="event.stopPropagation();sendWA('+l.id+')">WA</button></td>'+
      '<td><button class="pipe-btn" onclick="event.stopPropagation();moveToPipeline('+l.id+')">\u2192</button></td>'+
    '</tr>';
  }).join('');
  document.getElementById('leads-badge').textContent=leads.length;
  document.getElementById('kpi-leads').textContent=leads.length;
}
function getCatLabel(cat){return{website:'WEB',seo:'SEO',smm:'SMM',digital:'DIG',unknown:'UNK'}[cat]||'UNK';}
function selectLead(id){
  selectedLead=leads.find(function(l){return l.id===id;});if(!selectedLead)return;
  var score=selectedLead.score||calcLeadScore(selectedLead);var sc=getScoreClass(score);
  var panel=document.getElementById('lead-detail-panel');
  panel.innerHTML='<div class="ldp-name">'+escHtml(selectedLead.name)+'</div>'
    +'<div class="ldp-cat">'+getCatLabel(selectedLead.category)+' \u00B7 '+selectedLead.status.toUpperCase()+'</div>'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
    +'<span class="lead-score '+sc+'" style="width:30px;height:30px;font-size:11px;">'+score+'</span>'
    +'<span style="font-family:var(--mono);font-size:8px;color:var(--muted);">'+getScoreTooltip(score,selectedLead)+'</span></div>'
    +'<div class="ldp-row"><span class="ldp-key">PHONE</span><span class="ldp-val">'+(selectedLead.phone||'N/A')+'</span></div>'
    +'<div class="ldp-row"><span class="ldp-key">ADDRESS</span><span class="ldp-val">'+(selectedLead.address||'N/A')+'</span></div>'
    +'<div class="ldp-row"><span class="ldp-key">RATING</span><span class="ldp-val">'+(selectedLead.rating||'N/A')+'</span></div>'
    +'<div class="blade-line"></div>'
    +'<div class="form-lbl" style="margin-top:6px;">NOTES</div>'
    +'<textarea class="ldp-notes" onchange="saveLeadNotes('+selectedLead.id+',this.value)">'+(selectedLead.notes||'')+'</textarea>'
    +'<div style="font-family:var(--mono);font-size:7px;color:var(--muted);margin:8px 0 4px;">SET REMINDER</div>'
    +'<div style="display:flex;gap:6px;margin-bottom:8px;">'
    +'<input type="number" id="rem-days-'+selectedLead.id+'" class="form-inp" placeholder="Days" style="width:70px;"/>'
    +'<button class="btn" style="flex:1;font-size:7px;" onclick="setLeadReminder('+selectedLead.id+')">SET REMINDER</button></div>'
    +'<div class="blade-line"></div>'
    +'<div style="display:flex;flex-direction:column;gap:5px;">'
    +'<button class="btn research" onclick="researchLead('+selectedLead.id+')">&#128269; AI RESEARCH</button>'
    +'<button class="btn success" onclick="sendWA('+selectedLead.id+')">OPEN WHATSAPP</button>'
    +'<button class="btn primary" onclick="moveToPipeline('+selectedLead.id+')">\u2192 PIPELINE</button>'
    +'<button class="btn" onclick="loadLeadToProposal('+selectedLead.id+')">BUILD PROPOSAL</button>'
    +'</div>'
    +'<div id="research-result-'+selectedLead.id+'"></div>';
  renderLeads();
}
function setLeadReminder(id){var l=leads.find(function(x){return x.id===id;});if(!l)return;var inp=document.getElementById('rem-days-'+id);var days=inp?parseInt(inp.value)||1:1;addReminder('Follow up: '+l.name,days,id);}
function saveLeadNotes(id,val){var l=leads.find(function(x){return x.id===id;});if(!l)return;l.notes=val;localStorage.setItem('yuvi_leads',JSON.stringify(leads));}
function updateLeadStatus(id,status){
  var l=leads.find(function(x){return x.id===id;});if(!l)return;
  l.status=status;
  if(status==='contacted'){contactedToday++;localStorage.setItem('yuvi_contacted_today',contactedToday);localStorage.setItem('yuvi_contacted_date',new Date().toDateString());updateStats();}
  l.score=calcLeadScore(l);
  localStorage.setItem('yuvi_leads',JSON.stringify(leads));showToast(l.name+' \u2192 '+status.toUpperCase());renderLeads();
}
function getWAMessage(lead){var msgs={website:'Hi! I am Shlok from Yugantar Growth. We build professional websites in Ahmedabad from \u20B97,999. Would love to help '+lead.name+' get online. Free consultation!',seo:'Hi! I am Shlok from Yugantar Growth. We help businesses rank higher on Google. Can I show you results for similar businesses in Ahmedabad?',smm:'Hi! I am Shlok from Yugantar Growth. We manage Instagram & Facebook for Ahmedabad businesses. '+lead.name+' has great potential online. Interested?',digital:'Hi! I am Shlok from Yugantar Growth, digital agency in Ahmedabad. We help businesses get complete online presence. Can we connect for 10 minutes?',unknown:'Hi! I am Shlok from Yugantar Growth, digital agency in Ahmedabad. We help local businesses grow online. Can I show you what is possible for '+lead.name+'?'};return msgs[lead.category]||msgs.unknown;}
function sendWA(id){var l=leads.find(function(x){return x.id===id;});if(!l||!l.phone){showToast('No phone number');return;}var phone=l.phone.replace(/\D/g,'');var fp=phone.startsWith('91')?phone:'91'+phone;window.open('https://wa.me/'+fp+'?text='+encodeURIComponent(getWAMessage(l)),'_blank');updateLeadStatus(id,'contacted');}
function moveToPipeline(id){var l=leads.find(function(x){return x.id===id;});if(!l)return;pipeline.push({id:Date.now(),name:l.name,contact:'',phone:l.phone||'',service:'Digital Foundation \u20B97,999',stage:'approached',notes:[{date:new Date().toISOString(),text:'From leads. Cat: '+getCatLabel(l.category)+'.'}],lastTouched:new Date().toISOString(),stageEnteredAt:new Date().toISOString()});localStorage.setItem('yuvi_pipeline',JSON.stringify(pipeline));renderPipeline();nav('pipeline');showToast(l.name+' \u2192 pipeline!');}
function loadLeadToProposal(id){var l=leads.find(function(x){return x.id===id;});if(!l)return;nav('command');setModeByName('proposal');setTimeout(function(){document.getElementById('chat-inp').value='Build a proposal for '+escHtml(l.name)+', '+getCatLabel(l.category)+' service, located in '+(l.address||'Ahmedabad')+'.';document.getElementById('chat-inp').focus();},200);showToast('Lead loaded to Command!');}

// ============================================================
// AI LEAD RESEARCH (Feature 3)
// ============================================================
async function researchLead(id){
  var l=leads.find(function(x){return x.id===id;});if(!l)return;
  var key=getGroqKey();
  var resDiv=document.getElementById('research-result-'+id);
  if(!resDiv)return;
  var nameEnc=encodeURIComponent(l.name);
  var cityEnc=encodeURIComponent(l.address||'Ahmedabad');
  var namePlain=l.name.toLowerCase().replace(/[^a-z0-9]/g,'');

  resDiv.innerHTML='<div class="research-loading"><span class="hud-ring sm"></span> Step 1/3 — Checking website...</div>';
  showToast('Researching '+escHtml(l.name)+'...');

  // STEP 1 — attempt real website check via fetch (CORS-safe via no-cors)
  var websiteResult={exists:false,broken:false,url:null,tried:false};
  // try common domain patterns
  var domainGuesses=[
    namePlain+'.com',namePlain+'.in',namePlain+'.co.in',
    namePlain.replace(/studio|enterprises|solutions|services|pvtltd|ltd/g,'')+'.com',
  ];
  for(var di=0;di<domainGuesses.length;di++){
    try{
      var testUrl='https://'+domainGuesses[di];
      var r=await Promise.race([
        fetch(testUrl,{method:'HEAD',mode:'no-cors'}),
        new Promise(function(_,rej){setTimeout(function(){rej(new Error('timeout'));},4000);})
      ]);
      // no-cors fetch resolves with opaque response if site exists
      websiteResult={exists:true,broken:false,url:testUrl,tried:true};
      break;
    }catch(e){
      // timeout or network error = likely doesn't exist on this domain
    }
  }

  resDiv.innerHTML='<div class="research-loading"><span class="hud-ring sm"></span> Step 2/3 — Checking Google rating & business profile...</div>';

  // STEP 2 — Google Business: if rating exists in our data, they have GBP
  var hasGBP=l.rating&&l.rating>0;

  // STEP 3 — Fire Groq to analyze everything and return structured JSON
  resDiv.innerHTML='<div class="research-loading"><span class="hud-ring sm"></span> Step 3/3 — YUVI is analyzing presence...</div>';

  if(!key){
    // no Groq key — show what we found manually
    renderResearchCard(resDiv,l,id,{
      website:websiteResult,
      google_business:{likely:hasGBP,confidence:hasGBP?'HIGH':'LOW'},
      instagram:{likely:false,confidence:'UNKNOWN',handle:null},
      facebook:{likely:false,confidence:'UNKNOWN'},
      justdial:{likely:false,confidence:'UNKNOWN'},
      pitch_potential:'UNKNOWN',
      best_service:'Unknown',
      opening_line:'Add Groq key in Settings for AI-generated opener.',
      watch_out:'Add Groq key for AI analysis.',
      verdict:'Add Groq API key in Settings to get full AI research verdict.',
      online_score:hasGBP?6:3
    },nameEnc,cityEnc);
    return;
  }

  try{
    var sys=getMasterPrompt()+'\n\nYou are in LEAD RESEARCH MODE. You must respond ONLY with a valid JSON object. No explanation, no markdown, no backticks. Just raw JSON.';
    var prompt='Analyze this business lead for Yugantar Growth. Return ONLY a JSON object with these exact fields:\n'
      +'{\n'
      +'"online_score": <number 1-10, how strong is their online presence>,\n'
      +'"pitch_potential": <"HIGH" or "MEDIUM" or "LOW">,\n'
      +'"best_service": <"Digital Foundation ₹7,999" or "Lead Machine ₹12,999/month" or "Full System ₹24,999/month">,\n'
      +'"instagram": {"likely": <true or false>, "confidence": <"HIGH" or "MEDIUM" or "LOW">, "handle": <guessed handle string or null>},\n'
      +'"facebook": {"likely": <true or false>, "confidence": <"HIGH" or "MEDIUM" or "LOW">},\n'
      +'"justdial": {"likely": <true or false>, "confidence": <"HIGH" or "MEDIUM" or "LOW">},\n'
      +'"opening_line": <one perfect WhatsApp message in Hinglish for this specific business>,\n'
      +'"watch_out": <one line — main objection or red flag to prepare for>,\n'
      +'"verdict": <one sentence — should Shlok prioritize this lead, direct opinion>\n'
      +'}\n\n'
      +'Lead data:\n'
      +'Name: '+escHtml(l.name)+'\n'
      +'Category: '+getCatLabel(l.category)+'\n'
      +'Location: '+(l.address||'Ahmedabad')+'\n'
      +'Google Rating: '+(l.rating||'Not found — likely no Google Business Profile')+'\n'
      +'Phone: '+(l.phone||'Unknown')+'\n'
      +'Website check result: '+(websiteResult.exists?'Domain '+websiteResult.url+' responded (site may exist)':'No common domain responded — likely no website')+'\n'
      +'Has Google Business Profile: '+(hasGBP?'Yes (has rating '+l.rating+')':'Likely no (no rating in our data)')+'\n\n'
      +'Use your knowledge of Ahmedabad small businesses in the '+getCatLabel(l.category)+' category to judge Instagram/Facebook/JustDial presence. Be realistic — most small Ahmedabad shops have weak or no social presence.';

    var raw=await window.YuviBrain.rawChat([{role:'system',content:sys},{role:'user',content:prompt}],{maxTokens:600,temperature:0.4,mode:'research'}).catch(function(e){if(window.YuviLogger)window.YuviLogger.error('Research','Lead research failed',e.message);return '';});
    // strip any accidental markdown backticks
    raw=raw.replace(/```json|```/g,'').trim();
    var parsed=JSON.parse(raw);
    parsed.website=websiteResult;
    parsed.google_business={likely:hasGBP,confidence:hasGBP?'HIGH':'LOW'};
    renderResearchCard(resDiv,l,id,parsed,nameEnc,cityEnc);
    // save research to lead
    l.aiResearched=true;l.lastResearch=parsed;
    localStorage.setItem('yuvi_leads',JSON.stringify(leads));
    showToast('Research done: '+l.name);
  }catch(e){
    // JSON parse failed — show raw text fallback
    resDiv.innerHTML='<div class="research-card">'
      +'<div class="research-card-title">&#128269; RESEARCH — '+escHtml(l.name).toUpperCase()+'</div>'
      +'<div class="research-verdict" style="color:var(--flash);">AI response could not be parsed. Raw output below:</div>'
      +'<div class="research-verdict" style="font-size:8px;">'+escHtml(e.message)+'</div>'
      +'<div class="research-links" style="margin-top:8px;">'
      +'<a class="research-link" href="https://www.google.com/search?q='+nameEnc+'+'+cityEnc+'" target="_blank">Google</a>'
      +'<a class="research-link" href="https://www.google.com/maps/search/'+nameEnc+'+'+cityEnc+'" target="_blank">Maps</a>'
      +'</div></div>';
  }
}

function renderResearchCard(resDiv,l,id,data,nameEnc,cityEnc){
  var pitchColor=data.pitch_potential==='HIGH'?'var(--green)':data.pitch_potential==='MEDIUM'?'var(--gold)':'var(--flash)';
  var scoreClass=(data.online_score||5)>=7?'ls-hot':(data.online_score||5)>=4?'ls-warm':'ls-cold';

  // BUILD PLATFORM ROWS — only show what was found or likely
  var platformRows='';

  // Website
  if(data.website&&data.website.exists){
    platformRows+='<div class="rp-row rp-found">'
      +'<span class="rp-icon">&#127758;</span>'
      +'<span class="rp-label">Website</span>'
      +'<span class="rp-status found">FOUND</span>'
      +'<a class="research-link" href="'+data.website.url+'" target="_blank" rel="noopener" style="margin-left:auto;">OPEN</a>'
      +'</div>';
  }else{
    platformRows+='<div class="rp-row rp-missing">'
      +'<span class="rp-icon">&#127758;</span>'
      +'<span class="rp-label">Website</span>'
      +'<span class="rp-status missing">NOT FOUND</span>'
      +'<span class="rp-opp">&#128308; Opportunity</span>'
      +'</div>';
  }

  // Google Business
  if(data.google_business&&data.google_business.likely){
    platformRows+='<div class="rp-row rp-found">'
      +'<span class="rp-icon">&#128205;</span>'
      +'<span class="rp-label">Google Business</span>'
      +'<span class="rp-status found">FOUND ('+(l.rating||'?')+' &#9733;)</span>'
      +'<a class="research-link" href="https://www.google.com/maps/search/'+nameEnc+'+'+cityEnc+'" target="_blank" rel="noopener" style="margin-left:auto;">VIEW</a>'
      +'</div>';
  }else{
    platformRows+='<div class="rp-row rp-missing">'
      +'<span class="rp-icon">&#128205;</span>'
      +'<span class="rp-label">Google Business</span>'
      +'<span class="rp-status missing">NOT FOUND</span>'
      +'<span class="rp-opp">&#128308; Opportunity</span>'
      +'</div>';
  }

  // Instagram — only show if likely
  if(data.instagram&&data.instagram.likely){
    var igHandle=data.instagram.handle?'@'+data.instagram.handle:null;
    var igUrl=igHandle
      ?'https://www.instagram.com/'+data.instagram.handle.replace('@','')+'/'
      :'https://www.instagram.com/explore/search/keyword/?q='+nameEnc;
    platformRows+='<div class="rp-row rp-found">'
      +'<span class="rp-icon">&#128247;</span>'
      +'<span class="rp-label">Instagram</span>'
      +'<span class="rp-status found">LIKELY '+(igHandle?'('+igHandle+')':'')+'</span>'
      +'<span style="font-family:var(--mono);font-size:6px;color:var(--muted);margin:0 4px;">'+data.instagram.confidence+'</span>'
      +'<a class="research-link" href="'+igUrl+'" target="_blank" rel="noopener" style="margin-left:auto;">CHECK</a>'
      +'</div>';
  }else{
    platformRows+='<div class="rp-row rp-none">'
      +'<span class="rp-icon">&#128247;</span>'
      +'<span class="rp-label">Instagram</span>'
      +'<span class="rp-status none">NOT FOUND</span>'
      +'</div>';
  }

  // Facebook — only show if likely
  if(data.facebook&&data.facebook.likely){
    platformRows+='<div class="rp-row rp-found">'
      +'<span class="rp-icon">&#128101;</span>'
      +'<span class="rp-label">Facebook</span>'
      +'<span class="rp-status found">LIKELY</span>'
      +'<span style="font-family:var(--mono);font-size:6px;color:var(--muted);margin:0 4px;">'+data.facebook.confidence+'</span>'
      +'<a class="research-link" href="https://www.facebook.com/search/top/?q='+nameEnc+'" target="_blank" rel="noopener" style="margin-left:auto;">CHECK</a>'
      +'</div>';
  }else{
    platformRows+='<div class="rp-row rp-none">'
      +'<span class="rp-icon">&#128101;</span>'
      +'<span class="rp-label">Facebook</span>'
      +'<span class="rp-status none">NOT FOUND</span>'
      +'</div>';
  }

  // JustDial — only show if likely
  if(data.justdial&&data.justdial.likely){
    platformRows+='<div class="rp-row rp-found">'
      +'<span class="rp-icon">&#128222;</span>'
      +'<span class="rp-label">JustDial</span>'
      +'<span class="rp-status found">LIKELY</span>'
      +'<a class="research-link" href="https://www.justdial.com/search?q='+nameEnc+'&where='+cityEnc+'" target="_blank" rel="noopener" style="margin-left:auto;">CHECK</a>'
      +'</div>';
  }
  // JustDial not found = skip entirely, not worth flagging

  resDiv.innerHTML='<div class="research-card">'
    +'<div class="research-card-title">&#128269; AI RESEARCH — '+escHtml(l.name).toUpperCase()+'</div>'
    // scores row
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'
    +'<span class="lead-score '+scoreClass+'" style="width:30px;height:30px;font-size:12px;">'+(data.online_score||'?')+'</span>'
    +'<span style="font-family:var(--mono);font-size:8px;color:var(--muted);">Online Presence</span>'
    +'<span style="font-family:var(--mono);font-size:8px;color:'+pitchColor+';margin-left:auto;border:1px solid '+pitchColor+';padding:2px 8px;">'+(data.pitch_potential||'?')+' POTENTIAL</span>'
    +'</div>'
    // platform rows
    +'<div style="font-family:var(--mono);font-size:7px;color:var(--muted);letter-spacing:.15em;margin-bottom:5px;">PLATFORM CHECK</div>'
    +'<div class="rp-list">'+platformRows+'</div>'
    // AI analysis
    +'<div class="blade-line" style="margin:8px 0;"></div>'
    +'<div style="font-family:var(--mono);font-size:7px;color:var(--muted);letter-spacing:.15em;margin-bottom:4px;">BEST PACKAGE</div>'
    +'<div style="font-family:var(--mono);font-size:8px;color:var(--gold);margin-bottom:8px;">'+(data.best_service||'Unknown')+'</div>'
    +'<div style="font-family:var(--mono);font-size:7px;color:var(--muted);letter-spacing:.15em;margin-bottom:4px;">OPENING LINE</div>'
    +'<div style="font-family:var(--mono);font-size:8px;color:var(--text);line-height:1.7;padding:7px;background:rgba(14,246,255,.04);border-left:2px solid var(--blade);margin-bottom:8px;">'+(data.opening_line?escHtml(data.opening_line):'—')+'</div>'
    +'<div style="font-family:var(--mono);font-size:7px;color:var(--muted);letter-spacing:.15em;margin-bottom:4px;">WATCH OUT</div>'
    +'<div style="font-family:var(--mono);font-size:8px;color:var(--flash);margin-bottom:8px;">&#9888; '+(data.watch_out?escHtml(data.watch_out):'—')+'</div>'
    +'<div style="font-family:var(--mono);font-size:7px;color:var(--muted);letter-spacing:.15em;margin-bottom:4px;">YUVI VERDICT</div>'
    +'<div class="research-verdict">'+(data.verdict?escHtml(data.verdict):'—')+'</div>'
    // action buttons
    +'<div style="display:flex;gap:5px;margin-top:8px;">'
    +'<button class="btn success" style="flex:1;font-size:7px;padding:6px;" onclick="sendWA('+id+')">WA NOW</button>'
    +'<button class="btn primary" style="flex:1;font-size:7px;padding:6px;" onclick="moveToPipeline('+id+')">&#8594; PIPELINE</button>'
    +'</div>'
    +'</div>';
}

// DUPLICATE FILTER — runs on import and on leads render
// ============================================================
// BULK OUTREACH (Feature 2)
// ============================================================
var outreachType='both';var flyerDataUrl=null;var selectedOutreachLeads=[];
function toggleOutreach(){
  var panel=document.getElementById('outreach-panel');
  var visible=panel.style.display!=='none';
  panel.style.display=visible?'none':'block';
  if(!visible){renderOutreachLeadList();updateOutreachCounter();}
}
function setOutreachType(type){
  outreachType=type;
  var labels={message:'MESSAGE ONLY',image:'IMAGE ONLY — flyer required',both:'IMAGE + MESSAGE'};
  document.getElementById('outreach-type-indicator').textContent='MODE: '+labels[type];
}
function handleFlyerUpload(input){
  var file=input.files[0];if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    flyerDataUrl=e.target.result;
    document.getElementById('flyer-name').textContent=file.name;
    document.getElementById('flyer-img').src=flyerDataUrl;
    document.getElementById('flyer-preview').style.display='block';
    document.getElementById('flyer-clear').style.display='inline-block';
    showToast('Flyer uploaded: '+file.name);
  };
  reader.readAsDataURL(file);
  input.value='';
}
function clearFlyer(){
  flyerDataUrl=null;
  document.getElementById('flyer-name').textContent='No flyer uploaded';
  document.getElementById('flyer-preview').style.display='none';
  document.getElementById('flyer-clear').style.display='none';
}
function renderOutreachLeadList(){
  var list=document.getElementById('outreach-lead-list');
  if(!leads.length){list.innerHTML='<div style="font-family:var(--mono);font-size:8px;color:var(--muted);padding:10px;">No leads yet. Add leads first.</div>';return;}
  list.innerHTML=leads.filter(function(l){return l.phone&&l.phone.length>=10;}).map(function(l){
    var checked=selectedOutreachLeads.indexOf(l.id)>-1;
    var sc=getScoreClass(l.score||calcLeadScore(l));
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 7px;border:1px solid var(--edge2);background:rgba(14,246,255,.02);">'
      +'<input type="checkbox" id="olead-'+l.id+'" '+(checked?'checked':'')+' onchange="toggleOutreachLead('+l.id+')" style="cursor:pointer;accent-color:var(--blade);"/>'
      +'<label for="olead-'+l.id+'" style="flex:1;font-family:var(--mono);font-size:8px;color:var(--text);cursor:pointer;">'+escHtml(l.name)+'</label>'
      +'<span style="font-family:var(--mono);font-size:7px;color:var(--muted);">'+escHtml(l.phone)+'</span>'
      +'<span class="lead-score '+sc+'" style="width:20px;height:20px;font-size:8px;">'+(l.score||5)+'</span>'
      +'</div>';
  }).join('');
  updateOutreachCounter();
}
function toggleOutreachLead(id){
  var idx=selectedOutreachLeads.indexOf(id);
  if(idx>-1)selectedOutreachLeads.splice(idx,1);else selectedOutreachLeads.push(id);
  updateOutreachCounter();
}
function selectAllOutreachLeads(){selectedOutreachLeads=leads.filter(function(l){return l.phone&&l.phone.length>=10;}).map(function(l){return l.id;});renderOutreachLeadList();}
function selectNoneOutreachLeads(){selectedOutreachLeads=[];renderOutreachLeadList();}
function selectHotOutreachLeads(){selectedOutreachLeads=leads.filter(function(l){return l.phone&&l.phone.length>=10&&(l.score||0)>=8;}).map(function(l){return l.id;});renderOutreachLeadList();}
function updateOutreachCounter(){var c=selectedOutreachLeads.length;document.getElementById('outreach-counter').textContent=c>0?c+' lead'+(c>1?'s':'')+' selected':'No leads selected';}

async function generateOutreachSuggestion(){
  var key=getGroqKey();
  if(!key){showToast('Add Groq key in Settings first');return;}
  var selLeads=leads.filter(function(l){return selectedOutreachLeads.indexOf(l.id)>-1;});
  var cats=selLeads.length>0?[...new Set(selLeads.map(function(l){return getCatLabel(l.category);}))].join(', '):'general';
  document.getElementById('outreach-msg').value='Generating...';
  try{
    var sys=getMasterPrompt()+'\n\nYou are writing a single WhatsApp outreach message for Yugantar Growth to send to a batch of leads.';
    var prompt='Write one WhatsApp outreach message (Hinglish, friendly but professional, under 300 characters) for '+selLeads.length+' lead(s) in these categories: '+cats+'. Introduce Yugantar Growth briefly, mention relevant service for their category, end with a soft call to action. No emojis unless natural. Return ONLY the message text, nothing else.';
    var reply=await window.YuviBrain.rawChat([{role:'system',content:sys},{role:'user',content:prompt}],{maxTokens:200,temperature:0.6,mode:'outreach'}).catch(function(e){if(window.YuviLogger)window.YuviLogger.error('Outreach','Outreach gen failed',e.message);return '';});
    if(reply)document.getElementById('outreach-msg').value=reply;
    else document.getElementById('outreach-msg').value='';
  }catch(e){document.getElementById('outreach-msg').value='';showToast('Generation failed');}
}

function startOutreach(){
  var msg=document.getElementById('outreach-msg').value.trim();
  var selLeads=leads.filter(function(l){return selectedOutreachLeads.indexOf(l.id)>-1&&l.phone&&l.phone.length>=10;});
  if(selLeads.length===0){showToast('Select at least 1 lead with a phone number');return;}
  if(outreachType==='message'&&!msg){showToast('Type a message first');return;}
  if(outreachType==='image'&&!flyerDataUrl){showToast('Upload a flyer first');return;}
  if(outreachType==='both'&&!msg){showToast('Type a message first');return;}
  // build queue
  var queueDiv=document.getElementById('outreach-queue');
  var queueList=document.getElementById('outreach-queue-list');
  queueDiv.style.display='block';
  queueList.innerHTML=selLeads.map(function(l,i){
    var phone=l.phone.replace(/\D/g,'');var fp=phone.startsWith('91')?phone:'91'+phone;
    // for image-only: open WA with no text (user pastes image manually)
    // for message/both: encode message
    var useMsg=outreachType!=='image'?msg:getWAMessage(l);
    var waUrl='https://wa.me/'+fp+(useMsg?'?text='+encodeURIComponent(useMsg):'');
    var hasImage=outreachType==='image'||outreachType==='both';
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--edge2);background:rgba(8,15,23,.7);" id="oq-'+l.id+'">'
      +'<span style="font-family:var(--mono);font-size:8px;color:var(--muted);width:18px;">'+(i+1)+'.</span>'
      +'<span style="font-family:var(--mono);font-size:8px;color:var(--text);flex:1;">'+escHtml(l.name)+'</span>'
      +(hasImage&&flyerDataUrl?'<img src="'+flyerDataUrl+'" style="height:22px;width:22px;object-fit:cover;border:1px solid var(--edge2);" title="Flyer attached"/>':'')
      +'<a href="'+waUrl+'" target="_blank" onclick="markOutreachSent('+l.id+')" '
      +'style="font-family:var(--mono);font-size:7px;padding:4px 10px;background:rgba(34,214,142,.1);border:1px solid rgba(34,214,142,.3);color:var(--green);text-decoration:none;white-space:nowrap;">SEND &#8594;</a>'
      +'<span id="oq-status-'+l.id+'" style="font-family:var(--mono);font-size:7px;color:var(--muted);"></span>'
      +'</div>';
  }).join('');
  showToast('Queue ready — click SEND for each lead!');
  // if image mode, also copy flyer instruction
  if((outreachType==='image'||outreachType==='both')&&flyerDataUrl){
    showToast('Tip: WhatsApp will open — paste/attach your flyer image manually!');
  }
  queueDiv.scrollIntoView({behavior:'smooth'});
}
function markOutreachSent(id){
  var el=document.getElementById('oq-status-'+id);if(el)el.textContent='&#10003; SENT';
  updateLeadStatus(id,'contacted');
}

function deduplicateLeads(){
  var seen={};var before=leads.length;
  leads=leads.filter(function(l){
    // dedupe by phone if available, else by normalized name
    var key=l.phone&&l.phone.length>=10?l.phone:l.name.toLowerCase().replace(/\s+/g,'');
    if(seen[key])return false;
    seen[key]=true;return true;
  });
  var removed=before-leads.length;
  if(removed>0){localStorage.setItem('yuvi_leads',JSON.stringify(leads));renderLeads();showToast('Removed '+removed+' duplicate(s)!');}
  else showToast('No duplicates found.');
}

function importCSV(input){
  var file=input.files[0];if(!file)return;
  var r=new FileReader();
  r.onload=function(e){
    try{
      var sec=window.YuviSecurity;
      var lines=e.target.result.split('\n');
      if(!lines.length){showToast('Empty CSV');return;}
      var headers=lines[0].split(',').map(function(h){return h.trim().toLowerCase().replace(/"/g,'');});
      var ti=headers.findIndex(function(h){return h.includes('title')||h.includes('name');});
      var pi=headers.findIndex(function(h){return h.includes('phone');});
      var ai=headers.findIndex(function(h){return h.includes('address')||h.includes('city');});
      var ri=headers.findIndex(function(h){return h.includes('rating');});
      var imported=0,rejected=0,warnings=0,dupes=0,nl=[];
      var existingKeys=new Set(leads.map(function(l){return(l.name||'').toLowerCase()+'|'+(l.phone||'');}));
      for(var i=1;i<lines.length;i++){
        if(!lines[i].trim())continue;
        var rawCols=lines[i].split(',').map(function(c){return c.trim().replace(/"/g,'');});
        var cols=sec?sec.sanitizeCSVRow(rawCols):rawCols;
        var name=ti>=0?cols[ti]:'';
        if(!name||name.trim().length<1){rejected++;if(window.YuviLogger)window.YuviLogger.warn('CSV','Row '+(i+1)+' rejected: no name');continue;}
        var phone=pi>=0?(sec?sec.sanitizePhone(cols[pi]):cols[pi]):'';
        var address=ai>=0?cols[ai]:'Ahmedabad';
        var rating=ri>=0?Math.min(5,Math.max(0,parseFloat(cols[ri])||0)):0;
        var lead={id:Date.now()+i,name:name,phone:phone,address:address,rating:rating,category:guessCategory(name),status:'new',notes:''};
        if(sec){var v=sec.validateLead(lead);if(!v.valid){warnings++;if(window.YuviLogger)window.YuviLogger.warn('CSV','Row '+(i+1)+' warnings: '+v.errors.join(', '));}}
        var key=(name||'').toLowerCase()+'|'+(phone||'');
        if(existingKeys.has(key)){dupes++;continue;}
        existingKeys.add(key);lead.score=calcLeadScore(lead);nl.push(lead);imported++;
      }
      leads=leads.concat(nl);localStorage.setItem('yuvi_leads',JSON.stringify(leads));
      renderLeads();scoreAllLeads();
      var msg='CSV: '+imported+' imported'+(dupes?', '+dupes+' dupes':'')+(rejected?', '+rejected+' rejected':'')+(warnings?', '+warnings+' warnings':'');
      showToast(msg);if(window.YuviLogger)window.YuviLogger.info('CSV','Import complete',{imported:imported,rejected:rejected,dupes:dupes,warnings:warnings});
    }catch(ex){showToast('Import failed: '+ex.message);if(window.YuviLogger)window.YuviLogger.error('CSV','Import error',ex.message);}
  };r.readAsText(file);input.value='';}
function guessCategory(name){var n=name.toLowerCase();if(n.includes('restaurant')||n.includes('cafe')||n.includes('food')||n.includes('hotel'))return'smm';if(n.includes('furniture')||n.includes('hardware')||n.includes('retail')||n.includes('shop'))return'website';if(n.includes('clinic')||n.includes('doctor')||n.includes('hospital'))return'digital';if(n.includes('school')||n.includes('college'))return'seo';return'unknown';}
function updateStats(){document.getElementById('kpi-contacted').textContent=contactedToday;document.getElementById('contacted-bar').style.width=Math.min(100,(contactedToday/10)*100)+'%';}
function loadSampleLeads(){leads=[{id:1,name:'Ravi Electronics',phone:'9825001234',category:'website',status:'new',address:'Ahmedabad',rating:4.2,notes:''},{id:2,name:'Mehta Restaurant',phone:'9825002345',category:'smm',status:'interested',address:'Ahmedabad',rating:4.5,notes:'Very interested in social media management'},{id:3,name:'Kumar Textiles',phone:'9825003456',category:'digital',status:'new',address:'Ahmedabad',rating:4.0,notes:''},{id:4,name:'Shah Jewellers',phone:'9825005678',category:'seo',status:'interested',address:'Ahmedabad',rating:4.7,notes:'High budget available'},{id:5,name:'Gupta Pharmacy',phone:'9825006789',category:'digital',status:'contacted',address:'Ahmedabad',rating:4.1,notes:''},{id:6,name:'Patel Clinic',phone:'9825007890',category:'website',status:'follow_up',address:'Ahmedabad',rating:3.9,notes:'Needs follow up this week'},];scoreAllLeads();localStorage.setItem('yuvi_leads',JSON.stringify(leads));renderLeads();showToast('Sample leads loaded!');}
function openAddLead(){document.getElementById('add-lead-panel').classList.add('open');}
function closeAddLead(){document.getElementById('add-lead-panel').classList.remove('open');}
function submitAddLead(){var name=document.getElementById('al-name').value.trim();if(!name){showToast('Name required');return;}var lead={id:Date.now(),name:name,phone:document.getElementById('al-phone').value.trim(),category:document.getElementById('al-cat').value,address:document.getElementById('al-addr').value||'Ahmedabad',status:document.getElementById('al-status').value,rating:0,notes:document.getElementById('al-notes').value};lead.score=calcLeadScore(lead);leads.push(lead);localStorage.setItem('yuvi_leads',JSON.stringify(leads));renderLeads();closeAddLead();showToast('Lead added: '+name);['al-name','al-phone','al-notes'].forEach(function(id){document.getElementById(id).value='';});}

// ============================================================
// PIPELINE
// ============================================================
function renderPipeline(){
  var board=document.getElementById('kanban-board');board.innerHTML='';
  PIPE_STAGES.forEach(function(stage){
    var col=document.createElement('div');col.className='kanban-col';
    var sc=pipeline.filter(function(c){return c.stage===stage;});
    col.innerHTML='<div class="col-title">'+PIPE_LABELS[stage]+' <span style="color:var(--muted);">('+sc.length+')</span></div>';
    sc.forEach(function(card){
      var el=document.createElement('div');el.className='kanban-card panel';
      var ln=card.notes&&card.notes.length>0?card.notes[card.notes.length-1].text:'No notes';
      var ld=new Date(card.lastTouched||Date.now()).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
      el.innerHTML='<div class="kc-name">'+escHtml(card.name)+'</div>'
        +'<div class="kc-contact">'+(card.contact||card.phone||'\u2014')+'</div>'
        +'<div class="kc-service">'+card.service+'</div>'
        +'<div class="kc-note">'+escHtml(ln.substring(0,55))+(ln.length>55?'...':'')+'</div>'
        +'<div class="kc-date">'+ld+'</div>'
        +'<div class="kc-actions"><button class="wa-btn" onclick="event.stopPropagation();sendWAPipe('+card.id+')">WA</button>'
        +'<button class="pipe-btn" style="font-size:7px;padding:2px 5px;" onclick="event.stopPropagation();setReminderFromPipe('+card.id+')">&#9201;</button></div>';
      el.onclick=function(){openPipeDetail(card.id);};col.appendChild(el);
    });
    var add=document.createElement('div');add.className='col-add';add.textContent='+ ADD';add.onclick=function(){document.getElementById('ap-stage').value=stage;openAddPipeline();};col.appendChild(add);board.appendChild(col);
  });
}
function setReminderFromPipe(id){var c=pipeline.find(function(x){return x.id===id;});if(!c)return;var days=prompt('Remind me about '+escHtml(c.name)+' in how many days?','3');if(days)addReminder('Follow up: '+c.name,days,id);}
function sendWAPipe(id){var c=pipeline.find(function(x){return x.id===id;});if(!c||!c.phone)return;var phone=c.phone.replace(/\D/g,'');var fp=phone.startsWith('91')?phone:'91'+phone;window.open('https://wa.me/'+fp+'?text='+encodeURIComponent('Hi! Shlok here from Yugantar Growth. Following up on '+c.service+' for '+escHtml(c.name)+'. Ready to proceed?'),'_blank');c.lastTouched=new Date().toISOString();localStorage.setItem('yuvi_pipeline',JSON.stringify(pipeline));}
function openPipeDetail(id){var card=pipeline.find(function(x){return x.id===id;});if(!card)return;renderPipeDetail(card);document.getElementById('pipe-detail-panel').classList.add('open');}
function renderPipeDetail(card){
  var content=document.getElementById('psp-content');
  var wonField=card.stage==='closed'?'<div style="margin-top:8px;"><div class="form-lbl">WON AMOUNT (\u20B9)</div><input type="number" class="form-inp" id="psp-won-amt" value="'+(card.wonAmount||'')+'" placeholder="14999" onchange="setPipeWon('+card.id+',this.value)"/></div>':'';
  var notesHtml=(card.notes||[]).map(function(n){return'<div class="note-entry"><div class="ne-date">'+new Date(n.date).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})+'</div><div class="ne-text">'+escHtml(n.text)+'</div></div>';}).join('');
  content.innerHTML='<div class="sp-title" style="font-size:17px;padding-right:36px;">'+escHtml(card.name)+'</div>'
    +'<div style="font-family:var(--mono);font-size:8px;color:var(--blade2);margin-bottom:10px;letter-spacing:.08em;">'+PIPE_LABELS[card.stage]+' \u00B7 '+card.service+'</div>'
    +'<div style="font-family:var(--mono);font-size:8px;color:var(--muted);margin-bottom:4px;">MOVE STAGE</div>'
    +'<div class="psp-stage-btns">'+PIPE_STAGES.map(function(s){return'<div class="psp-stage-btn'+(s===card.stage?' current':'')+'" onclick="movePipeStage('+card.id+',\''+s+'\')">'+PIPE_LABELS[s]+'</div>';}).join('')+'</div>'
    +wonField
    +'<div class="blade-line" style="margin:10px 0;"></div>'
    +'<div style="font-family:var(--mono);font-size:8px;color:var(--muted);margin-bottom:5px;">NOTES & HISTORY</div>'
    +notesHtml
    +'<div style="display:flex;gap:5px;margin-top:7px;"><input type="text" class="form-inp" id="psp-new-note" placeholder="Add note..." style="flex:1;"/><button class="btn primary" onclick="addPipeNote('+card.id+')">ADD</button></div>'
    +'<div class="blade-line" style="margin:10px 0;"></div>'
    +'<div style="font-family:var(--mono);font-size:8px;color:var(--muted);margin-bottom:5px;">NEXT ACTION</div>'
    +'<input type="text" class="form-inp" id="psp-next-action" value="'+(card.nextAction||'')+'" placeholder="Call back Monday..." onchange="setPipeNextAction('+card.id+',this.value)"/>'
    +'<div style="font-family:var(--mono);font-size:8px;color:var(--muted);margin:8px 0 4px;">REMINDER</div>'
    +'<div style="display:flex;gap:5px;margin-bottom:10px;"><input type="number" id="psp-rem-days" class="form-inp" placeholder="Days" style="width:70px;"/><button class="btn" style="flex:1;font-size:7px;" onclick="setReminderFromDetail('+card.id+')">SET REMINDER</button></div>'
    +'<div style="display:flex;gap:5px;flex-wrap:wrap;">'
    +'<button class="btn success" onclick="sendWAPipe('+card.id+')">WHATSAPP</button>'
    +'<button class="btn danger" onclick="deletePipeCard('+card.id+')">DELETE</button>'
    +'</div>';
}
function setReminderFromDetail(id){var c=pipeline.find(function(x){return x.id===id;});if(!c)return;var el=document.getElementById('psp-rem-days');var days=el?parseInt(el.value)||3:3;addReminder('Follow up: '+c.name,days,id);}
function movePipeStage(id,stage){var c=pipeline.find(function(x){return x.id===id;});if(!c)return;c.stage=stage;c.lastTouched=new Date().toISOString();c.stageEnteredAt=new Date().toISOString();localStorage.setItem('yuvi_pipeline',JSON.stringify(pipeline));renderPipeline();renderPipeDetail(c);showToast(c.name+' \u2192 '+PIPE_LABELS[stage]);offerNextAction('pipeline_stage',{name:c.name,stage:stage});}
function addPipeNote(id){var c=pipeline.find(function(x){return x.id===id;});if(!c)return;var el=document.getElementById('psp-new-note');var txt=el?el.value.trim():'';if(!txt)return;if(!c.notes)c.notes=[];c.notes.push({date:new Date().toISOString(),text:txt});c.lastTouched=new Date().toISOString();el.value='';localStorage.setItem('yuvi_pipeline',JSON.stringify(pipeline));renderPipeline();renderPipeDetail(c);showToast('Note added!');}
function setPipeWon(id,val){var c=pipeline.find(function(x){return x.id===id;});if(!c)return;c.wonAmount=parseInt(val)||0;localStorage.setItem('yuvi_pipeline',JSON.stringify(pipeline));}
function setPipeNextAction(id,val){var c=pipeline.find(function(x){return x.id===id;});if(!c)return;c.nextAction=val;localStorage.setItem('yuvi_pipeline',JSON.stringify(pipeline));}
function deletePipeCard(id){showConfirmModal('DELETE DEAL','Permanently delete this pipeline card?',function(){pipeline=pipeline.filter(function(x){return x.id!==id;});localStorage.setItem('yuvi_pipeline',JSON.stringify(pipeline));renderPipeline();closePipeDetail();showToast('Deleted.');});}
function closePipeDetail(){document.getElementById('pipe-detail-panel').classList.remove('open');}
function openAddPipeline(){document.getElementById('add-pipe-panel').classList.add('open');}
function submitAddPipeline(){var name=document.getElementById('ap-name').value.trim();if(!name){showToast('Name required');return;}pipeline.push({id:Date.now(),name:name,contact:document.getElementById('ap-contact').value,phone:document.getElementById('ap-phone').value,service:document.getElementById('ap-service').value,stage:document.getElementById('ap-stage').value,notes:[{date:new Date().toISOString(),text:document.getElementById('ap-note').value||'Added.'}],lastTouched:new Date().toISOString(),stageEnteredAt:new Date().toISOString()});localStorage.setItem('yuvi_pipeline',JSON.stringify(pipeline));renderPipeline();document.getElementById('add-pipe-panel').classList.remove('open');showToast('Deal added: '+name);['ap-name','ap-contact','ap-phone','ap-note'].forEach(function(id){document.getElementById(id).value='';});}

// ============================================================
// CLIENTS
// ============================================================
function getDefaultClients(){return [{id:1,name:'JFS',fullName:'Jangid Furniture Studio',type:'FURNITURE RETAILER',location:'Ahmedabad',tier:'Digital Foundation',amount:7999,status:'active',payment:'paid',tasks:[{text:'Website delivered',done:true},{text:'Instagram page created',done:true},{text:'Follow up for referral',done:false}],notes:'Great client. Ask for referral.',metrics:{posts:8,reels:2,leads:14,research:1,strategyDocs:1},packageItems:[{text:'Business website',delivered:true},{text:'Instagram setup',delivered:true},{text:'Monthly content calendar',delivered:false},{text:'Google Business optimization',delivered:false}]},{id:2,name:'FinEdge Advisory',fullName:'FinEdge Advisory',type:'FINANCIAL ADVISORY',location:'Ahmedabad',tier:'Growth \u20B914,999/month',amount:14999,status:'active',payment:'pending',tasks:[{text:'Campaign running',done:true},{text:'Monthly report due',done:false},{text:'Check ad performance',done:false}],notes:'Finance client. Report due.',metrics:{posts:16,reels:5,leads:22,research:2,strategyDocs:2},packageItems:[{text:'Content strategy',delivered:true},{text:'12 posts/month',delivered:true},{text:'4 reels/month',delivered:true},{text:'Lead-gen campaign',delivered:false},{text:'Monthly performance report',delivered:false}]}];}
// v6 PHASE 4 — backward-compat: fills in metrics/packageItems for client
// records saved before this upgrade, without touching anything else on them.
function ensureClientDefaults(c){
  if(!c.metrics)c.metrics={posts:0,reels:0,leads:0,research:0,strategyDocs:0};
  if(!c.packageItems)c.packageItems=[];
  return c;
}
function renderClients(){
  var grid=document.getElementById('clients-grid');
  var pcol={paid:'rs-paid',pending:'rs-pending',overdue:'rs-overdue'};var scol={active:'var(--green)',inactive:'var(--muted)',onboarding:'var(--blade)'};
  clients.forEach(ensureClientDefaults);
  grid.innerHTML=clients.map(function(c){
    var m=c.metrics;
    return '<div class="client-card panel">'
      +'<div class="cc-name">'+escHtml(c.name)+'</div><div class="cc-type">'+(c.fullName||c.name)+'</div>'
      +'<div class="cc-type" style="color:var(--muted);">'+(c.type||'')+(c.location?' \u00B7 '+c.location:'')+'</div>'
      +'<div class="cc-meta"><span style="font-family:var(--mono);font-size:8px;color:'+(scol[c.status]||'var(--blade)')+';">'+c.status.toUpperCase()+'</span>'
      +'<span class="rev-status '+(pcol[c.payment]||'rs-pending')+'">'+(c.payment||'PENDING').toUpperCase()+'</span>'
      +'<span style="font-family:var(--mono);font-size:8px;color:var(--gold);">\u20B9'+(c.amount||0).toLocaleString('en-IN')+'</span></div>'
      +'<div style="font-family:var(--mono);font-size:7px;color:var(--muted);margin-bottom:7px;">'+c.tier+'</div>'
      +'<div class="blade-line"></div>'
      // a. OUTPUT METRICS
      +'<div class="cc-section-lbl">OUTPUT</div>'
      +'<div class="cc-metrics-grid">'
      +'<div class="cc-metric-tile"><div class="cc-metric-val">'+m.posts+'</div><div class="cc-metric-lbl">POSTS</div></div>'
      +'<div class="cc-metric-tile"><div class="cc-metric-val">'+m.reels+'</div><div class="cc-metric-lbl">REELS</div></div>'
      +'<div class="cc-metric-tile"><div class="cc-metric-val">'+m.leads+'</div><div class="cc-metric-lbl">LEADS</div></div>'
      +'<div class="cc-metric-tile"><div class="cc-metric-val">'+m.research+'</div><div class="cc-metric-lbl">RESEARCH</div></div>'
      +'<div class="cc-metric-tile"><div class="cc-metric-val">'+m.strategyDocs+'</div><div class="cc-metric-lbl">STRATEGY</div></div>'
      +'</div>'
      // b. PACKAGE / PLAN TRACKING
      +'<div class="cc-section-lbl">PACKAGE \u2014 '+(c.packageItems.filter(function(p){return p.delivered;}).length)+'/'+c.packageItems.length+' DELIVERED</div>'
      +'<div class="cc-pkg-list">'+c.packageItems.map(function(p,pi){return'<div class="cct cc-pkg-item'+(p.delivered?' cct-done':'')+'"><div class="cct-check'+(p.delivered?' cct-done':'')+'" onclick="toggleClientPackageItem('+c.id+','+pi+')">'+(p.delivered?'&#10003;':'')+'</div><span class="cct-text'+(p.delivered?' cct-done':'')+'">'+escHtml(p.text)+'</span></div>';}).join('')
      +'<button class="btn" style="font-size:7px;padding:2px 7px;margin-top:3px;width:100%;" onclick="addClientPackageItem('+c.id+')">+ PACKAGE ITEM</button></div>'
      +'<div class="blade-line"></div>'
      // c. TASK CHECKLIST (existing, unchanged behavior/pattern)
      +'<div class="cc-section-lbl">TASKS</div>'
      +'<div class="cc-tasks-list">'+(c.tasks||[]).map(function(t,ti){return'<div class="cct"><div class="cct-check'+(t.done?' cct-done':'')+'" onclick="toggleClientTask('+c.id+','+ti+')">'+(t.done?'&#10003;':'')+'</div><span class="cct-text'+(t.done?' cct-done':'')+'">'+t.text+'</span></div>';}).join('')
      +'<button class="btn" style="font-size:7px;padding:2px 7px;margin-top:5px;width:100%;" onclick="addClientTask('+c.id+')">+ TASK</button></div>'
      +'<div class="blade-line"></div>'
      +'<textarea class="cc-note" placeholder="Notes..." onchange="saveClientNote('+c.id+',this.value)">'+escHtml(c.notes||'')+'</textarea>'
      +'<div style="display:flex;gap:4px;margin-top:7px;flex-wrap:wrap;">'
      +'<button class="btn success" style="flex:1;padding:5px;" onclick="messageClient('+c.id+')">MSG</button>'
      +'<button class="btn primary" style="flex:1;padding:5px;" onclick="buildClientReport('+c.id+')">REPORT</button>'
      +'<button class="btn gold" style="flex:1;padding:5px;" onclick="cycleClientPayment('+c.id+')">PAY &#8635;</button>'
      +'</div>'
      // d. ACTION BUTTON — placeholder, real n8n wiring is future work (Settings > Connection to Workspace)
      +'<button class="cc-action-btn" onclick="triggerClientWork('+c.id+')">&#9889; RUN WORK FOR '+escHtml(c.name.toUpperCase())+'</button>'
      +'</div>';
  }).join('')+'<div class="client-card panel" onclick="openAddClient()" style="display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;border-style:dashed;min-height:100px;"><div style="font-size:24px;color:var(--dim);margin-bottom:6px;">+</div><div style="font-family:var(--mono);font-size:8px;color:var(--muted);">ADD CLIENT</div></div>';
  document.getElementById('kpi-clients').textContent=clients.filter(function(c){return c.status==='active';}).length;
  renderHomeClientsMini();
}
function renderHomeClientsMini(){var el=document.getElementById('home-clients-mini');if(!el)return;var pcol={paid:'rs-paid',pending:'rs-pending',overdue:'rs-overdue'};el.innerHTML=clients.map(function(c){return'<div class="rev-row"><span class="rev-name">'+escHtml(c.name)+'</span><span class="rev-status '+(pcol[c.payment]||'rs-pending')+'">'+escHtml(c.status).toUpperCase()+'</span></div>';}).join('');}
function toggleClientTask(cid,ti){var c=clients.find(function(x){return x.id===cid;});if(!c||!c.tasks[ti])return;c.tasks[ti].done=!c.tasks[ti].done;localStorage.setItem('yuvi_clients',JSON.stringify(clients));renderClients();if(c.tasks[ti].done)offerNextAction('client_task',{clientName:c.name,taskText:c.tasks[ti].text});}
function toggleClientPackageItem(cid,pi){var c=clients.find(function(x){return x.id===cid;});if(!c||!c.packageItems||!c.packageItems[pi])return;c.packageItems[pi].delivered=!c.packageItems[pi].delivered;localStorage.setItem('yuvi_clients',JSON.stringify(clients));renderClients();}
function addClientPackageItem(cid){var txt=prompt('Package item (e.g. "4 reels/month"):');if(!txt)return;var c=clients.find(function(x){return x.id===cid;});if(!c)return;if(!c.packageItems)c.packageItems=[];c.packageItems.push({text:txt,delivered:false});localStorage.setItem('yuvi_clients',JSON.stringify(clients));renderClients();}
// v6 PHASE 4 — placeholder action button. Real n8n execution wiring is a
// separate future task (see Settings > Connection to Workspace, Phase 1).
function triggerClientWork(cid){
  var c=clients.find(function(x){return x.id===cid;});if(!c)return;
  showToast('Workspace not connected yet \u2014 configure n8n in Settings to run live work for '+c.name);
}
function addClientTask(cid){var txt=prompt('Task:');if(!txt)return;var c=clients.find(function(x){return x.id===cid;});if(!c)return;if(!c.tasks)c.tasks=[];c.tasks.push({text:txt,done:false,addedAt:new Date().toISOString()});localStorage.setItem('yuvi_clients',JSON.stringify(clients));renderClients();}
function saveClientNote(cid,val){var c=clients.find(function(x){return x.id===cid;});if(!c)return;c.notes=val;localStorage.setItem('yuvi_clients',JSON.stringify(clients));}
function cycleClientPayment(cid){var c=clients.find(function(x){return x.id===cid;});if(!c)return;c.payment={paid:'pending',pending:'overdue',overdue:'paid'}[c.payment]||'paid';localStorage.setItem('yuvi_clients',JSON.stringify(clients));renderClients();showToast(c.name+' \u2192 '+c.payment.toUpperCase());}
function messageClient(cid){var c=clients.find(function(x){return x.id===cid;});if(!c)return;window.open('https://wa.me/?text='+encodeURIComponent('Hi! Shlok here from Yugantar Growth. Following up on your '+c.tier+' package. Let me know if you need anything.'),'_blank');}
function buildClientReport(cid){var c=clients.find(function(x){return x.id===cid;});if(!c)return;nav('command');setModeByName('plan');setTimeout(function(){document.getElementById('chat-inp').value='Build a monthly performance report for '+escHtml(c.name)+' ('+c.fullName+'). Service: '+c.tier+'. Focus on ROI and digital improvements.';document.getElementById('chat-inp').focus();},200);showToast('Report prompt loaded!');}
function openAddClient(){var name=prompt('Client display name:');if(!name)return;var full=prompt('Full business name:')||name;var type=(prompt('Business type:')||'BUSINESS').toUpperCase();var tier=prompt('Service tier:')||'Digital Foundation';var amt=parseInt(prompt('Monthly value (\u20B9):')||'0');clients.push({id:Date.now(),name:name,fullName:full,type:type,location:'Ahmedabad',tier:tier,amount:amt,status:'active',payment:'pending',tasks:[{text:'Onboarding in progress',done:false,addedAt:new Date().toISOString()}],notes:''});localStorage.setItem('yuvi_clients',JSON.stringify(clients));renderClients();showToast('Client added: '+name);}

// ============================================================
// SETTINGS
// ============================================================
function openSettings(){document.getElementById('settings-panel').classList.add('open');document.getElementById('settings-overlay').classList.add('show');renderBiometricSettingsUI();if(window.YuviSkillManager)window.YuviSkillManager.loadPreferences();}
function closeSettings(){document.getElementById('settings-panel').classList.remove('open');document.getElementById('settings-overlay').classList.remove('show');}
function saveSettGroqKey(){var k=document.getElementById('s-groq-key').value.trim();if(!k){showToast('Enter API key');return;}window.YuviVault.setItem('yuvi_groq_key',k);showToast('Groq key saved (encrypted)!');fetchBriefingFromGroq();}
async function testGroqKey(){var k=document.getElementById('s-groq-key').value.trim();if(!k){showToast('Enter key first');return;}showToast('Testing...');try{var _testOk=await (window.YuviGroq?window.YuviGroq.testKey(k):Promise.resolve(false));if(_testOk)showToast('\u2713 Groq CONNECTED');else showToast('\u2717 Groq FAIL');}catch(e){showToast('Failed: '+e.message);}}
function saveDefaultMode(){var m=document.getElementById('s-default-mode').value;localStorage.setItem('yuvi_default_mode',m);currentMode=m;setModeByName(m);showToast('Default mode: '+m.toUpperCase());}
// ============================================================
// v6 — PASSCODE CHANGE + BIOMETRIC ENROLLMENT (Settings > Password)
// ============================================================
async function changePasscode(){
  var p1=document.getElementById('s-new-pin').value.trim();
  var p2=document.getElementById('s-new-pin-confirm').value.trim();
  if(!/^\d{6}$/.test(p1)){showToast('Passcode must be exactly 6 digits');return;}
  if(p1!==p2){showToast('Passcodes do not match');return;}
  var ok=await window.YuviVault.setNewPin(p1);
  if(ok){showToast('✓ Passcode changed');document.getElementById('s-new-pin').value='';document.getElementById('s-new-pin-confirm').value='';}
  else showToast('✗ Could not change passcode — try locking and unlocking the app first');
}
function renderBiometricSettingsUI(){
  var statusEl=document.getElementById('s-bio-status');var btnsEl=document.getElementById('s-bio-btns');
  if(!statusEl||!btnsEl)return;
  if(!window.YuviWebAuthn||!window.YuviWebAuthn.isSupported()){
    statusEl.textContent='Not supported on this device/browser — passcode unlock only.';
    btnsEl.innerHTML='';
    return;
  }
  if(window.YuviVault.isBiometricEnrolled()){
    statusEl.textContent='Fingerprint unlock is enabled on this device.';
    btnsEl.innerHTML='<button class="btn danger" onclick="removeBiometricUnlock()">REMOVE FINGERPRINT UNLOCK</button>';
  }else{
    statusEl.textContent='Use your device fingerprint/Face unlock as an alternative to your passcode.';
    btnsEl.innerHTML='<button class="btn primary" onclick="enrollBiometricUnlock()">ENABLE FINGERPRINT UNLOCK</button>';
  }
}
async function enrollBiometricUnlock(){
  try{
    showToast('Follow your device prompt...');
    await window.YuviVault.enrollBiometric();
    showToast('✓ Fingerprint unlock enabled');
    renderBiometricSettingsUI();
  }catch(e){showToast('✗ '+(e.message||'Enrollment failed'));}
}
function removeBiometricUnlock(){
  window.YuviVault.removeBiometric();
  showToast('Fingerprint unlock removed');
  renderBiometricSettingsUI();
}
function savePersonality(){localStorage.setItem('yuvi_personality',document.getElementById('s-personality').value);showToast('Personality saved!');}
function saveBizCtx(){localStorage.setItem('yuvi_biz_ctx',document.getElementById('s-biz-ctx').value);showToast('Business context saved!');}

// ============================================================
// GITHUB MEMORY
// ============================================================
function getGHConfig(){return{username:localStorage.getItem('yuvi_gh_user')||'',repo:localStorage.getItem('yuvi_gh_repo')||''};}
async function loadMemory(){
  var cfg=getGHConfig();if(!cfg.username||!cfg.repo)return null;
  try{
    var result=await (window.YuviGitHub?window.YuviGitHub.readFile('memory.json'):Promise.resolve(null));
    if(!result||!result.content)return null;
    memory=result.content;if(result.sha)localStorage.setItem('yuvi_memory_sha',result.sha);
    return memory;
  }catch(e){return null;}
}
async function saveMemory(updates){
  var cfg=getGHConfig();if(!cfg.username||!cfg.repo)return;
  try{
    var updated=Object.assign({},memory,updates);updated.lastUpdated=new Date().toISOString();
    updated.leads={total:leads.length,contacted:contactedToday,interested:leads.filter(function(l){return l.status==='interested';}).length,closed:leads.filter(function(l){return l.status==='closed';}).length};
    if(!window.YuviGitHub)return;
    await window.YuviGitHub.writeFile(updated,'memory.json','YUVI v6.1 memory update '+new Date().toISOString().slice(0,10));
    memory=updated;showToast('Memory saved \u2192 GitHub');
  }catch(e){showToast('Memory save failed: '+e.message);}
}
function getMemoryContext(){
  try{
    if(!memory)return'';
    var ctx='\n\n=== YUVI PERSISTENT MEMORY ===\n';
    if(memory.identity)ctx+='Owner: '+memory.identity.owner+', '+memory.identity.agency+', '+memory.identity.city+'.\n';
    if(memory.context&&memory.context.about_shlok)ctx+=memory.context.about_shlok+'\n';
    if(memory.context&&memory.context.first_memory)ctx+=memory.context.first_memory+'\n';
    if(memory.leads)ctx+='Lead stats: '+JSON.stringify(memory.leads)+'.\n';
    if(memory.logs&&memory.logs.length>0){var recent=memory.logs.slice(-5);ctx+='Recent logs:\n'+recent.map(function(l){return'- '+( l.note||l.summary||l.type||'');}).join('\n')+'\n';}
    if(memory.plans&&memory.plans.length>0)ctx+='Plans: '+memory.plans.slice(-3).map(function(p){return p.title||p;}).join(', ')+'.\n';
    ctx+='=== END MEMORY ===';
    return ctx;
  }catch(e){return'';}
}
async function saveAndConnectMemory(){
  var u=document.getElementById('s-gh-user').value.trim()||'whitewolf251501-dot';var r=document.getElementById('s-gh-repo').value.trim()||'aa-os-yuvi';
  if(!u||!r){showToast('Fill in GitHub username and repo');return;}
  localStorage.setItem('yuvi_gh_user',u);localStorage.setItem('yuvi_gh_repo',r);showToast('Connecting...');
  var mem=await loadMemory();
  if(mem){showToast('\u2713 Memory connected! Reading your history...');showMemStatus(true);applyMemoryToUI(mem);}
  else{showToast('\u2717 Connection failed \u2014 check repo, or GITHUB_TOKEN on the server');showMemStatus(false);}
}
function showMemStatus(ok){var el=document.getElementById('mem-status-indicator');el.style.display='block';el.className='mem-status '+(ok?'mem-ok':'mem-no');el.textContent=ok?'\u25CF MEMORY CONNECTED \u2014 Full history active':'\u25CF NOT CONNECTED';}
function applyMemoryToUI(mem){if(!mem)return;if(mem.clients&&mem.clients.length>0){clients=mem.clients;localStorage.setItem('yuvi_clients',JSON.stringify(clients));renderClients();}setYuviBriefingFromMemory(mem);}
function viewMemory(){document.getElementById('mem-view-content').textContent=memory?JSON.stringify(memory,null,2):'No memory loaded. Connect GitHub first.';document.getElementById('mem-view-modal').classList.add('show');}
function downloadMemoryBackup(){if(!memory){showToast('No memory to backup');return;}var blob=new Blob([JSON.stringify(memory,null,2)],{type:'application/json'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='yuvi_memory_'+new Date().toISOString().slice(0,10)+'.json';a.click();showToast('Backup downloaded!');}
function clearLocalMemory(){showConfirmModal('CLEAR LOCAL DATA','Clears all leads, pipeline, clients, settings from this device. GitHub memory is safe. Continue?',function(){['yuvi_leads','yuvi_pipeline','yuvi_clients','yuvi_revenue','yuvi_priorities','yuvi_contacted_today','yuvi_default_mode','yuvi_personality','yuvi_biz_ctx','yuvi_reminders'].forEach(function(k){localStorage.removeItem(k);});if(window.YuviVault)window.YuviVault.clearAllItems();leads=[];pipeline=[];clients=getDefaultClients();revenueData=getDefaultRevenue();priorities=[{text:'Add your priorities',done:false}];contactedToday=0;reminders=[];renderLeads();renderPipeline();renderClients();renderRevenue();renderPriorities();updateStats();showToast('Local data cleared!');});}

// ============================================================
// MODALS & TOAST
// ============================================================
function showToast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(function(){t.classList.remove('show');},2500);}
function showConfirmModal(title,body,onConfirm){document.getElementById('gm-title').textContent=title;document.getElementById('gm-body').textContent=body;document.getElementById('gm-confirm').onclick=function(){onConfirm();closeGenericModal();};document.getElementById('generic-modal').classList.add('show');}
function closeGenericModal(){document.getElementById('generic-modal').classList.remove('show');}

// ============================================================
// v4 — EVENING / SESSION-END AUTO-SAVE TO GITHUB MEMORY
// Fires on tab-hide (mobile-safe) AND on unload (desktop close).
// Guarded so it only actually writes once per session.
// ============================================================
window.addEventListener('beforeunload',function(){if(chatHistory.length>=2)autoSaveSession();});
var sessionSaved=false;
async function autoSaveSession(){
  var key=getGroqKey();if(!key||!memory||chatHistory.length<2||sessionSaved)return;
  sessionSaved=true;
  try{
    var convo=chatHistory.slice(-20).map(function(m){return m.role.toUpperCase()+': '+m.content.substring(0,200);}).join(' | ');
    var summary=await window.YuviBrain.rawChat([{role:'system',content:'You are YUVI\'s memory module. Summarize this Yugantar Growth business conversation in 3-5 bullet points. Focus on: decisions made, deal/client status changes (Tradosphere, JFS, FinEdge or others), leads discussed, actions agreed, advance/payment flags. Very concise.'},{role:'user',content:'Summarize: '+convo}],{maxTokens:220,temperature:0.3,mode:'brief'}).catch(function(){return '';});if(!summary)return;
    if(!memory.logs)memory.logs=[];
    memory.logs.push({date:new Date().toISOString().slice(0,10),time:new Date().toISOString(),type:'evening_summary',summary:summary,msgCount:chatHistory.length});
    if(memory.logs.length>50)memory.logs=memory.logs.slice(-50);
    await saveMemory({logs:memory.logs});
  }catch(e){sessionSaved=false;}
}
