# N8N Training Schedule Optimizer — Webhook Agent

De planner stuurt via "🤖 AI Assistent" een POST naar de N8N webhook.
Alle data inclusief het system prompt en user message worden vanuit de app meegestuurd, zodat alles centraal in de app code beheerd wordt.

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

---

## Prompt beheer

Het system prompt en user message worden gegenereerd in `server/routes/training.js` (functies `buildAiSystemPrompt(mode)` en `buildAiUserMessage(mode, extraMessage)`). De `mode` parameter (`new`, `complete`, `optimize`) wordt door de frontend meegegeven. Wijzigingen aan de prompt hoeven alleen in de app code te worden gedaan — N8N pikt ze automatisch op via `$json.body.systemPrompt` en `$json.body.userMessage`.
