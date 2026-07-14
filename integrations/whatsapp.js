/**
 * integrations/whatsapp.js
 * Interface for WhatsApp outreach via wa.me deep links (no paid API
 * needed). Structured so a real WhatsApp Business API integration can
 * replace the internals later without touching any calling code.
 */
(function () {
  function buildLink(phone, message) {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const withCountryCode = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    return `https://wa.me/${withCountryCode}?text=${encodeURIComponent(message || '')}`;
  }

  function send(phone, message) {
    const link = buildLink(phone, message);
    window.open(link, '_blank');
    if (window.YuviBus) window.YuviBus.emit('whatsapp.sent', { phone });
    return link;
  }

  window.YuviWhatsApp = { buildLink, send };
})();
