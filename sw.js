/**
 * sw.js — YUVI v6 Service Worker
 * Caches the complete app shell for offline use.
 * AI features require connectivity (Groq API).
 */
const CACHE = 'yuvi-v6-shell-v1';

const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/core/security.js',
  '/core/logger.js',
  '/core/vault.js',
  '/core/webauthn.js',
  '/brain/eventBus.js',
  '/brain/intentDetector.js',
  '/brain/promptComposer.js',
  '/brain/skillOrchestrator.js',
  '/brain/brain.js',
  '/brain/widgetEngine.js',
  '/brain/libraryEngine.js',
  '/brain/proactiveEngine.js',
  '/integrations/groq.js',
  '/integrations/github.js',
  '/integrations/canva.js',
  '/integrations/whatsapp.js',
  '/knowledge/fileParser.js',
  '/knowledge/knowledgeManager.js',
  '/memory/contextBuilder.js',
  '/automation/eventRules.js',
  '/automation/scheduler.js',
  '/skills/skillRegistry.js',
  '/skills/skillLoader.js',
  '/skills/promptSkillEngine.js',
  '/skills/skillManager.js',
  '/skills/skillManager.css',
  '/skills/installed.json'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Always network for external APIs
  if (url.hostname === 'api.groq.com' || url.hostname === 'api.github.com' || url.hostname === 'cdnjs.cloudflare.com') return;
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
