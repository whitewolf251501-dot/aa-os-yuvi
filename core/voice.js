/* ============================================================
 * YUVI v6.2 — VOICE ENGINE (window.YuviVoice)
 * ------------------------------------------------------------
 * Voice OUTPUT for YUVI. Three layers:
 *
 *  1. Voice pack — the founder uploads audio sample(s) of the
 *     voice YUVI should speak in. Samples are stored locally
 *     (IndexedDB) and are meant to be sent to an external
 *     voice-cloning TTS service (e.g. ElevenLabs Voice Cloning).
 *  2. synthesizeYuviVoice(text) — THE INTEGRATION POINT for that
 *     external TTS API. Not wired yet by design: it returns null
 *     until a TTS endpoint + key are configured, and the caller
 *     falls back to browser TTS as a clearly-interim voice.
 *  3. speak(text) — what the rest of the app calls. Respects the
 *     global mute toggle (this runs constantly, so mute matters).
 * ============================================================ */
(function () {
  'use strict';

  var LS_MUTED = 'yuvi_voice_muted';
  var LS_PACK_META = 'yuvi_voice_pack_meta'; // JSON: {name,size,type,date}
  var LS_TTS_ENDPOINT = 'yuvi_tts_endpoint'; // e.g. your own proxy to ElevenLabs
  var IDB_NAME = 'yuvi-voice';
  var IDB_STORE = 'packs';

  var _audioEl = null;

  /* ---------- mute ---------- */
  function isMuted() { return localStorage.getItem(LS_MUTED) === '1'; }
  function setMuted(on) {
    localStorage.setItem(LS_MUTED, on ? '1' : '0');
    if (on) stop();
  }

  /* ---------- IndexedDB (voice samples are too big for localStorage) ---------- */
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbPut(key, val) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var rq = tx.objectStore(IDB_STORE).get(key);
        rq.onsuccess = function () { resolve(rq.result || null); };
        rq.onerror = function () { reject(rq.error); };
      });
    });
  }
  function idbDel(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
      });
    });
  }

  /* ---------- voice pack ---------- */
  function getVoicePackInfo() {
    try { return JSON.parse(localStorage.getItem(LS_PACK_META) || 'null'); } catch (e) { return null; }
  }
  function hasVoicePack() { return !!getVoicePackInfo(); }

  /* Store the uploaded sample locally. When the TTS service is
   * wired, this sample is what gets uploaded to create the cloned
   * voice (ElevenLabs "Add Voice" style flow). */
  async function saveVoicePack(file) {
    if (!file || !/^audio\//.test(file.type)) throw new Error('Upload an audio file (mp3/wav/m4a) \u2014 that\u2019s the voice I\u2019ll learn from.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Sample too large \u2014 keep it under 25MB.');
    await idbPut('sample', file);
    var meta = { name: file.name, size: file.size, type: file.type, date: new Date().toISOString() };
    localStorage.setItem(LS_PACK_META, JSON.stringify(meta));
    return meta;
  }
  async function getVoicePackBlob() { return idbGet('sample'); }
  async function clearVoicePack() {
    await idbDel('sample');
    localStorage.removeItem(LS_PACK_META);
  }

  /* ------------------------------------------------------------
   * synthesizeYuviVoice(text) — INTEGRATION POINT (not wired yet).
   *
   * Contract: resolves to a playable audio URL (object URL) for
   * `text` spoken in the cloned YUVI voice, or null when the
   * service isn't configured.
   *
   * To wire it up later:
   *  1. Stand up a small server proxy to a voice-cloning TTS API
   *     (e.g. ElevenLabs: POST /v1/text-to-speech/{voice_id} with
   *     the API key server-side — never put the key in this file).
   *  2. Create the cloned voice once from the uploaded sample
   *     (getVoicePackBlob() has the audio).
   *  3. Save the proxy URL under localStorage 'yuvi_tts_endpoint'
   *     (or add a field for it in Settings > Voice).
   * The fetch below already speaks that contract.
   * ------------------------------------------------------------ */
  async function synthesizeYuviVoice(text) {
    var endpoint = localStorage.getItem(LS_TTS_ENDPOINT) || '';
    if (!endpoint || !hasVoicePack()) return null; // not wired yet — caller falls back
    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.substring(0, 600) })
      });
      if (!res.ok) return null;
      var blob = await res.blob();
      if (!/^audio\//.test(blob.type)) return null;
      return URL.createObjectURL(blob);
    } catch (e) {
      return null;
    }
  }

  /* ---------- interim browser TTS (until the voice pack is wired) ---------- */
  function browserSpeak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(text.substring(0, 300));
    utter.lang = 'en-IN'; utter.rate = 1.05; utter.pitch = 0.85;
    var voices = window.speechSynthesis.getVoices();
    var preferred = voices.find(function (v) { return v.lang === 'en-IN'; });
    if (preferred) utter.voice = preferred;
    window.speechSynthesis.speak(utter);
  }

  function stop() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (_audioEl) { _audioEl.pause(); _audioEl = null; }
  }

  /* speak() — the one entry point the app uses. */
  async function speak(text) {
    if (isMuted() || !text) return;
    var url = await synthesizeYuviVoice(text);
    if (url) {
      stop();
      _audioEl = new Audio(url);
      _audioEl.onended = function () { URL.revokeObjectURL(url); _audioEl = null; };
      _audioEl.play().catch(function () { /* autoplay blocked — fine, stay silent */ });
      return;
    }
    // Interim fallback ONLY — the target end-state is the cloned
    // voice via synthesizeYuviVoice(), not browser-default TTS.
    browserSpeak(text);
  }

  window.YuviVoice = {
    isMuted: isMuted,
    setMuted: setMuted,
    hasVoicePack: hasVoicePack,
    getVoicePackInfo: getVoicePackInfo,
    getVoicePackBlob: getVoicePackBlob,
    saveVoicePack: saveVoicePack,
    clearVoicePack: clearVoicePack,
    synthesizeYuviVoice: synthesizeYuviVoice,
    speak: speak,
    stop: stop
  };
})();
