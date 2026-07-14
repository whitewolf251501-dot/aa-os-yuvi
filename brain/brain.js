/**
 * brain/brain.js — YUVI v5.1.1
 * Single AI execution path. Every AI call in YUVI goes through here.
 * No module may call YuviGroq.chat() or fetch() for AI directly.
 */
(function(){
'use strict';
const MODULE='Brain',MAX_RETRY=3,TIMEOUT=30000;
let _pending=false;

function log(l,m,d){if(window.YuviLogger)window.YuviLogger[l](MODULE,m,d);else console[l==='error'?'error':'log']('['+MODULE+']',m,d||'');}

async function withRetry(fn,n){
  let err;
  for(let i=0;i<n;i++){
    try{return await fn();}
    catch(e){err=e;if(i<n-1){const ms=Math.min(1000*Math.pow(2,i),8000);log('warn','Retry '+(i+1)+'/'+n+' in '+ms+'ms: '+e.message);await new Promise(r=>setTimeout(r,ms));}}
  }
  throw err;
}

function withTimeout(p,ms){
  return Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error('AI timed out after '+ms/1000+'s')),ms))]);
}

async function _execute(messages,opts){
  if(!window.YuviGroq)throw new Error('YuviGroq not loaded. Check Settings → Groq API Key.');
  if(_pending&&!opts.force)throw new Error('Please wait for the current response to finish.');
  _pending=true;
  const t0=Date.now();
  if(window.YuviBus)window.YuviBus.emit('brain.chat.start',{mode:opts.mode||'raw'});
  try{
    const response=await withTimeout(withRetry(()=>window.YuviGroq.chat(messages,{
      maxTokens:opts.maxTokens||512,temperature:opts.temperature||0.6,model:opts.model||undefined
    }),opts.retries||MAX_RETRY),opts.timeout||TIMEOUT);
    if(!response||typeof response!=='string')throw new Error('AI returned empty response.');
    const ms=Date.now()-t0;
    log('info','AI complete',{mode:opts.mode||'raw',ms,chars:response.length});
    if(window.YuviBus)window.YuviBus.emit('brain.chat.complete',{mode:opts.mode||'raw',ms,chars:response.length});
    return response;
  }catch(e){
    log('error','AI failed',e.message);
    if(window.YuviBus)window.YuviBus.emit('brain.chat.error',{error:e.message});
    throw e;
  }finally{_pending=false;}
}

/* Intent → Skill (no AI) */
function handle(message){
  if(!window.YuviIntentDetector||!window.YuviSkillOrchestrator)return null;
  const intent=window.YuviIntentDetector.detect(message);
  if(!intent)return null;
  log('debug','Intent: '+intent.id,intent.args);
  const result=window.YuviSkillOrchestrator.execute(intent.id,intent.args);
  if(result===null)return null;
  if(window.YuviBus)window.YuviBus.emit('brain.intent.handled',{intent:intent.id});
  return typeof result==='string'?result:JSON.stringify(result,null,2);
}

/* Composed path: UI → Brain → PromptComposer → Groq */
async function chat(userMessage,opts={}){
  if(!userMessage||!String(userMessage).trim())throw new Error('Cannot send empty message.');
  if(!window.YuviPromptComposer)throw new Error('PromptComposer not loaded.');
  const sys=window.YuviPromptComposer.compose({mode:opts.mode||'chat',extraContext:opts.extraContext||''});
  const history=Array.isArray(opts.history)?opts.history.slice(-10):[];
  const messages=[{role:'system',content:sys},...history,{role:'user',content:String(userMessage).trim()}];
  return _execute(messages,{...opts,mode:opts.mode||'chat'});
}

/* Raw path: UI → Brain → Groq (caller builds messages) */
async function rawChat(messages,opts={}){
  if(!Array.isArray(messages)||!messages.length)throw new Error('rawChat requires a non-empty messages array.');
  return _execute(messages,opts);
}

/* Additive context bridge for existing index.html sysPrompt */
function composeSystemPrompt(){
  if(!window.YuviPromptComposer)return '';
  try{return window.YuviPromptComposer.composeAdditive();}catch(e){log('warn','composeSystemPrompt failed',e.message);return '';}
}

async function runChain(steps){
  if(!Array.isArray(steps)||!steps.length)return[];
  if(!window.YuviSkillOrchestrator)return[{error:'SkillOrchestrator not loaded'}];
  return window.YuviSkillOrchestrator.runChain(steps);
}

function isReady(){return!!(window.YuviGroq&&window.YuviPromptComposer&&window.YuviSkillRegistry);}
function isPending(){return _pending;}

window.YuviBrain={handle,chat,rawChat,composeSystemPrompt,runChain,isReady,isPending};
log('info','Brain v5.1.1 ready — single AI path enforced');
})();
