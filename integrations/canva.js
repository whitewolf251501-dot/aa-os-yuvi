/**
 * integrations/canva.js
 * Interface for handing a generated design brief off to Canva.
 * Today this is a deep-link opener (matches existing openInCanva
 * behavior); structured so a real Canva API integration can replace
 * the internals later without touching any calling code.
 */
(function () {
  function openDesignBrief(briefText) {
    const encoded = encodeURIComponent(briefText.slice(0, 1500));
    const url = `https://www.canva.com/design/create?brief=${encoded}`;
    window.open('https://www.canva.com/create/', '_blank');
    return url;
  }

  window.YuviCanva = { openDesignBrief };
})();
