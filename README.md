# YUVI v5 — Yugantar Growth AI Business Operating System

**Stack:** HTML · CSS · Vanilla JS · Groq · GitHub Memory · localStorage · Vercel  
**No framework. No backend. No build step. Deploys as a static site.**

---

## Architecture Lock

The core application is **complete and frozen**.  
Future capability is added exclusively by installing Skills.  
`index.html` and all core modules never need to change again.

---

## Installing a Skill — 3 steps only

```
1.  Create  skills/<id>/manifest.json
2.  Create  skills/<id>/skill.js         ← must call YuviSkillRegistry.register()
3.  Add     { "skill_id": "<id>", "enabled": true }   to  skills/installed.json
```

`YuviSkillLoader.loadAll()` runs on boot, reads `installed.json`, dynamically injects  
each skill's script, and registers it automatically.  

**No `<script>` tags in `index.html`. No core file changes. Ever.**

---

## Folder Structure

```
brain/
  eventBus.js           # Layer 0 — shared pub/sub, loads first
  intentDetector.js     # Stateless intent parsing
  promptComposer.js     # Full + additive prompt assembly
  skillOrchestrator.js  # Executes skills + chains
  brain.js              # Public API: handle · chat · runChain

integrations/
  groq.js               # ONLY module that calls Groq API
  github.js             # GitHub Contents API (memory.json)
  canva.js              # Canva deep-link
  whatsapp.js           # wa.me link builder

knowledge/
  fileParser.js         # PDF · DOCX · XLSX · CSV · TXT · JSON · MD
  knowledgeManager.js   # Store · enable/disable · context bundle

memory/
  contextBuilder.js     # Aggregates all context for Brain

automation/
  eventRules.js         # Event-driven rule chains
  scheduler.js          # Boot-time schedule checker

skills/
  skillRegistry.js      # Register · enable/disable · mode · schedule · config
  skillLoader.js        # Dynamic loader — reads installed.json, injects scripts
  skillManager.js       # Settings UI: Install · Configure · Enable · Remove
  skillManager.css
  installed.json        # ← Add skill entries here to install
  _TEMPLATE_manifest.json
  _TEMPLATE_skill.js

index.html              # Full app — all existing features intact
manifest.json           # PWA manifest
sw.js                   # Service Worker
icons/                  # PWA icons (16px–512px) from Yugantar Growth logo
vercel.json
```

---

## Script Load Order (mandatory, do not reorder)

```
CDN libs (pdf.js · mammoth · xlsx)
  → eventBus
    → integrations (groq · github · canva · whatsapp)
      → knowledge (fileParser · knowledgeManager)
        → memory (contextBuilder)
          → automation (eventRules · scheduler)
            → skills (skillRegistry · skillLoader)
              → brain (intentDetector · promptComposer · skillOrchestrator · brain)
                → UI (skillManager.css · skillManager.js)
                  → Boot sequence (loadAll · bus listeners · yuvi.booted)
```

---

## Brain Flow

```
User message
  → YuviBrain.handle(msg)
      → YuviIntentDetector.detect(msg)   [stateless pattern match]
          → match found → YuviSkillOrchestrator.execute(capability, args)
          → no match   → null → caller falls back to YuviBrain.chat()
                                  → YuviPromptComposer.composeAdditive()
                                    [knowledge + skills + memory appended to existing prompt]
                                  → YuviGroq.chat(messages)
```

---

## Adding a Skill Quickly

Copy `skills/_TEMPLATE_skill.js` and `skills/_TEMPLATE_manifest.json` into  
`skills/<your-id>/`, fill in your logic, add to `installed.json`. Done.

---

## Deploy

```
Push repo root → import to Vercel → Static Site → no build command needed
```
