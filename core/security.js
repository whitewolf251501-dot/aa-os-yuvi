/**
 * core/security.js — YUVI v5.1 Security Layer
 * ─────────────────────────────────────────────
 * Centralizes ALL sanitization, escaping, and validation.
 * Every module that touches user data or renders HTML must use this.
 * Load order: immediately after eventBus.js, before everything else.
 */
(function () {
  'use strict';

  // ── HTML Escaping ──────────────────────────────────────────────────────────
  // Escapes the 5 HTML-dangerous chars. Use for ALL user data in innerHTML.
  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  // ── Attribute escaping (for href/src/onclick values) ──────────────────────
  function escapeAttr(str) {
    return escapeHTML(str).replace(/`/g, '&#96;');
  }

  // ── Sanitize a plain string for storage (strip HTML tags, trim) ───────────
  function sanitizeText(str, maxLength = 500) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/<[^>]*>/g, '')           // strip HTML tags
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
      .trim()
      .slice(0, maxLength);
  }

  // ── Sanitize a phone number ───────────────────────────────────────────────
  function sanitizePhone(str) {
    if (!str) return '';
    return String(str).replace(/[^0-9+\-() ]/g, '').trim().slice(0, 20);
  }

  // ── Sanitize a URL (allow only http/https) ────────────────────────────────
  function sanitizeURL(str) {
    if (!str) return '';
    const clean = String(str).trim();
    if (!/^https?:\/\//i.test(clean)) return '';
    return clean.slice(0, 500);
  }

  // ── Sanitize a CSV row (array of strings from import) ────────────────────
  function sanitizeCSVRow(row) {
    if (!Array.isArray(row)) return [];
    return row.map(cell => sanitizeText(String(cell || ''), 300));
  }

  // ── Validate a lead object before storage ────────────────────────────────
  function validateLead(lead) {
    const errors = [];
    if (!lead.name || String(lead.name).trim().length < 1) errors.push('name required');
    if (lead.phone && !/^[0-9+\-() ]{7,20}$/.test(lead.phone)) errors.push('invalid phone');
    return { valid: errors.length === 0, errors };
  }

  // ── Validate a Skill manifest ────────────────────────────────────────────
  function validateSkillManifest(manifest) {
    const errors = [];
    if (!manifest || typeof manifest !== 'object') { return { valid: false, errors: ['manifest must be an object'] }; }
    if (!manifest.id)      errors.push('missing: id');
    if (!manifest.name)    errors.push('missing: name');
    if (!manifest.version) errors.push('missing: version');
    if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) errors.push('id must be lowercase letters, numbers, hyphens only');
    if (manifest.id && manifest.id.length > 64) errors.push('id too long (max 64 chars)');
    if (!Array.isArray(manifest.capabilities)) errors.push('capabilities must be an array');
    return { valid: errors.length === 0, errors };
  }

  // ── Validate a PromptSkill document ──────────────────────────────────────
  function validatePromptSkill(ps) {
    const errors = [];
    if (!ps || typeof ps !== 'object') return { valid: false, errors: ['invalid skill document'] };
    if (ps.type !== 'yuvi-skill')      errors.push('type must be "yuvi-skill"');
    if (!ps.id)                        errors.push('missing: id');
    if (!ps.name)                      errors.push('missing: name');
    if (ps.id && ps.id.length > 64)    errors.push('id too long');
    if (ps.prompt && ps.prompt.length > 8000) errors.push('prompt too long (max 8000 chars)');
    return { valid: errors.length === 0, errors };
  }

  // ── Sanitize an object's string fields for safe storage ──────────────────
  function sanitizeObject(obj, fields) {
    if (!obj || typeof obj !== 'object') return obj;
    const result = { ...obj };
    (fields || Object.keys(result)).forEach(key => {
      if (typeof result[key] === 'string') {
        result[key] = sanitizeText(result[key]);
      }
    });
    return result;
  }

  // ── Safe JSON parse (returns null on failure, never throws) ──────────────
  function safeParseJSON(str, fallback = null) {
    if (!str) return fallback;
    try { return JSON.parse(str); }
    catch (e) { return fallback; }
  }

  // ── Safe localStorage read ────────────────────────────────────────────────
  function safeGetLocal(key, fallback = null) {
    try { return safeParseJSON(localStorage.getItem(key), fallback); }
    catch (e) { return fallback; }
  }

  // ── Safe localStorage write ────────────────────────────────────────────────
  function safeSetLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`[YuviSecurity] localStorage write failed for key "${key}":`, e.message);
      return false;
    }
  }

  // ── Content Security: detect potential injection in a string ──────────────
  function isLikelySafe(str) {
    if (!str) return true;
    const s = String(str);
    // Flag if it looks like HTML/JS injection
    return !/<script|javascript:|on\w+\s*=|<iframe|<svg.*on/i.test(s);
  }

  window.YuviSecurity = {
    escapeHTML, escapeAttr,
    sanitizeText, sanitizePhone, sanitizeURL, sanitizeCSVRow,
    validateLead, validateSkillManifest, validatePromptSkill, sanitizeObject,
    safeParseJSON, safeGetLocal, safeSetLocal,
    isLikelySafe,
    // Alias for backward compat with existing escHtml usages
    escHtml: escapeHTML
  };

  // Global alias — existing index.html calls escHtml() globally
  window.escHtml = escapeHTML;

})();
