# N8N Training Schedule Optimizer — Webhook Agent

De planner stuurt via "🤖 AI Assistent" een POST naar de N8N webhook.
Het **system prompt** komt uit configuratie (per modus `new` / `complete` / `optimize`, per omgeving **development** / **production**), met **revisiegeschiedenis** en rollback via de knop **AI-prompts** op de **trainingsplanner** (alleen voor opperbeheerders). De bron staat in git als `server/config/training-planner-ai-prompts.json`; op productie wordt bij voorkeur `data/training-planner-ai-prompts.json` gebruikt (Docker-volume), zodat wijzigingen bewaard blijven. Optioneel: `TRAINING_AI_PROMPT_ENV=development|production` in `.env` om te forceren welke set prompts de server kiest (anders: `NODE_ENV`). De **user message** wordt nog steeds in code opgebouwd.

De gebruiker kiest een van drie modi in de app:

| Modus | Beschrijving |
|-------|-------------|
| `new` | Volledig nieuwe planning vanaf nul — alle teams inplannen |
| `complete` | Bestaande planning behouden, ontbrekende teams bijplannen |
| `optimize` | Bestaande planning verbeteren zonder teams toe te voegen |

Bij `new` voert de agent intern ook `complete` + `optimize` uit.
Bij `complete` volgt automatisch `optimize`.

---

## Webhook input (POST body)

De app stuurt het volgende mee:

```json
{
  "systemPrompt": "...(bevat modus-specifieke instructies)...",
  "userMessage": "MODUS: ... + instructies + optionele extra opdracht",
  "teams": { ... },
  "training": { ... }
}
```

| Veld | Beschrijving |
|------|-------------|
| `systemPrompt` | Volledig system prompt met modus-specifieke instructies voor de AI agent |
| `userMessage` | User message met modus, stappen en eventuele extra opdracht van de gebruiker |
| `teams` | Teamroosters met spelers en coaches (backup; agent haalt dit ook op via tool) |
| `training` | Huidige planning, locaties, venues, teamnamen |

### Optioneel: twee-staps pipeline (`pipeline: "multi"`)

Als de app **`"pipeline": "multi"`** meestuurt (checkbox *Mini-LLM (2 stappen)* in de UI), doet de server **twee opeenvolgende POSTs** naar **dezelfde** `N8N_TRAINING_WEBHOOK_URL`. De agent blijft “leeg”: alle teksten komen uit de app.

Extra velden op de body:

| Veld | Alleen bij multi | Inhoud |
|------|------------------|--------|
| `pipeline` | ja | `{ "multiStep": true, "phase": 1 \| 2, "totalPhases": 2 }` |
| `previousStepResult` | stap 2 | JSON-object uit stap 1 (compact dagplan) |

**Stap 1:** `systemPrompt` is een korte vaste instructie (compact dagplan); het model moet JSON teruggeven met o.a. `team_plans` en `evening_character` (geen volledige `schedule`).

**Stap 2:** `systemPrompt` = dezelfde modus-prompt als bij de enkele aanroep, plus een vaste appendix met het stap‑1‑resultaat; `userMessage` zoals bij de klassieke flow. Verwachte response: zelfde als hieronder (`name`, `advice`, `schedule`).

In N8N kun je `{{ $json.body.pipeline?.phase }}` gebruiken om te routeren (bijv. ander parse-pad voor stap 1), of één AI Agent laten die altijd `systemPrompt` / `userMessage` uit de body volgt — dat werkt ook.

## Vereiste webhook response

```json
{
  "name": "AI-optimalisatie 22-03-2026",
  "advice": "Advies als string met \\n voor newlines",
  "schedule": [
    {
      "day": "Maandag",
      "day_of_week": 0,
      "start_time": "19:00",
      "end_time": "20:30",
      "team": "VTC Woerden HS 1",
      "venue": "Veld 1",
      "location": "Thijs van der Polshal"
    }
  ]
}
```

---

## N8N Workflow Setup

```
Webhook → AI Agent → Code Node → Respond to Webhook
```

### 1. Webhook node

- Method: POST
- Ontvangt de data van de app

### 2. AI Agent node

- **System Prompt**: `{{ $json.body.systemPrompt }}`
- **User Message**: `{{ $json.body.userMessage }}

{{ JSON.stringify($json.body.training) }}`
- **Tool**: HTTP Request tool die de teams endpoint aanroept (verplicht voor de agent)

Het system prompt en user message komen nu volledig uit de app. Je hoeft ze niet meer handmatig in N8N te onderhouden.

### 3. Code Node (parse AI output → webhook response)

```javascript
const raw = $('AI Agent').item.json.output || $('AI Agent').item.json.text || '';

let cleaned = raw.trim();
if (cleaned.startsWith('```')) {
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

let result;
try {
  result = JSON.parse(cleaned);
} catch (e) {
  const match = cleaned.match(/\{[\s\S]*"schedule"\s*:\s*\[[\s\S]*\]\s*\}/);
  if (match) {
    result = JSON.parse(match[0]);
  } else {
    return { name: 'AI-optimalisatie (parse error)', advice: 'Parse error: ' + raw.slice(0, 500), schedule: [] };
  }
}

return {
  name: result.name || 'AI-optimalisatie ' + new Date().toLocaleDateString('nl-NL'),
  advice: result.advice || '',
  schedule: result.schedule || []
};
```

### 4. Respond to Webhook node

- Response mode: "Last node"
- De Code node output wordt als JSON teruggestuurd naar de app
- De app slaat het op als nieuwe snapshot, activeert deze, en herlaadt de planner

**Als de app ineens geen planning meer krijgt:** controleer in N8N de **execution** van de laatste succesvolle run wat **Respond to Webhook** / de laatste node echt terugstuurt. N8N wikkelt output soms in als `[{ "json": { "name", "schedule", "advice" } }]` — de server probeert dat automatisch uit te pakken. Een **AI Agent**-update kan het modelantwoord in een ander veld zetten (`output` vs `text` vs `message`); pas dan de Code node aan zodat daar wél geldig JSON met `schedule[]` uitkomt. In de **Node-serverlog** staan regels `[ai-optimize] Raw webhook response` en `Parsed result keys` om te zien wat er binnenkomt.

---

## Prompt beheer

Het actieve **system prompt** komt uit `server/lib/training-ai-prompts.js` (JSON-bestanden zoals hierboven); **revisies en rollback** beheer je in de UI via **trainingsplanner → AI-prompts** (opperbeheerders). De **user message** wordt in `server/routes/training.js` opgebouwd (`buildAiUserMessage`); de `mode` (`new`, `complete`, `optimize`) geeft de frontend mee. N8N ontvangt beide via `$json.body.systemPrompt` en `$json.body.userMessage`.
