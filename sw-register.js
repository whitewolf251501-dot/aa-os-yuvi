
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('/sw.js').then(function(reg){
      console.log('[YUVI] PWA service worker registered:', reg.scope);
    }).catch(function(err){
      console.warn('[YUVI] SW registration failed:', err);
    });
  });
}
