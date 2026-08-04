/**
 * knowledge/fileParser.js
 * Parses uploaded files into plain text.
 * CDN libraries (pdf.js, mammoth, xlsx) are loaded lazily at parse-time
 * so there are no race conditions with async script loading.
 */
(function () {
  const parsers = new Map();

  function register(type, handler) {
    parsers.set(type.toLowerCase(), handler);
  }

  function detectType(file) {
    const n = (file.name || '').toLowerCase();
    if (n.endsWith('.pdf'))                         return 'pdf';
    if (n.endsWith('.docx') || n.endsWith('.doc')) return 'word';
    if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'excel';
    if (n.endsWith('.csv'))                         return 'csv';
    if (n.endsWith('.pptx') || n.endsWith('.ppt')) return 'powerpoint';
    if (n.match(/\.(png|jpg|jpeg|webp|gif)$/))     return 'image';
    if (n.endsWith('.json'))                        return 'json';
    if (n.endsWith('.md'))                          return 'markdown';
    if (n.endsWith('.txt'))                         return 'text';
    return 'unknown';
  }

  async function parse(file) {
    const type    = detectType(file);
    const handler = parsers.get(type);
    if (!handler) return { type, supported: false, text: null, message: `No parser for: ${type}` };
    try {
      const text = await handler(file);
      return { type, supported: true, text };
    } catch (e) {
      return { type, supported: false, text: null, message: e.message };
    }
  }

  // ── PDF (lazy — checks pdfjsLib at call time) ──
  register('pdf', async (file) => {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js CDN not loaded yet. Try again in a moment.');
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n\n';
    }
    return text.trim();
  });

  // ── Word .docx (lazy) ──
  register('word', async (file) => {
    if (typeof mammoth === 'undefined') throw new Error('mammoth.js CDN not loaded yet. Try again in a moment.');
    const buf    = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value.trim();
  });

  // ── Excel (lazy) ──
  register('excel', async (file) => {
    if (typeof XLSX === 'undefined') throw new Error('SheetJS CDN not loaded yet. Try again in a moment.');
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });
    return wb.SheetNames.map(name =>
      `--- ${name} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`
    ).join('\n\n').trim();
  });

  // ── CSV ──
  register('csv',        async (file) => (await file.text()).trim());
  register('text',       async (file) => (await file.text()).trim());
  register('markdown',   async (file) => (await file.text()).trim());

  // ── JSON ──
  register('json', async (file) => {
    const raw = await file.text();
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch (e) { return raw; }
  });

  // ── PowerPoint — browser-side extraction is limited ──
  register('powerpoint', async (file) => {
    return `[PowerPoint: ${file.name}, ${(file.size/1024).toFixed(1)}KB — full slide text extraction requires server-side processing. File recorded.]`;
  });

  // ── Image — OCR placeholder ──
  register('image', async (file) => {
    return `[Image: ${file.name}, ${(file.size/1024).toFixed(1)}KB — OCR not installed. Add Tesseract.js to enable text extraction.]`;
  });

  function supportedTypes() { return [...parsers.keys()]; }

  window.YuviFileParser = { parse, register, detectType, supportedTypes };
})();
