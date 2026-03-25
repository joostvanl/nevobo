# Timeout AI Coach – N8N integratie

De Timeout-knop stuurt wedstrijddata via de **PHP-proxy** (api.php) naar de N8N webhook.

**AI-prompt:** Zie `AI_COACH_PROMPT.md` voor de volledige systeemprompt. De browser praat met de eigen server; de server roept N8N aan. Geen CORS-problemen, ook niet vanaf een andere client.

### Webhook-URL

In `config/app.php`:

```php
'timeout_webhook_env' => 'test',  // of 'production'
'timeout_webhook_test' => 'http://localhost:5678/webhook-test/ed3961ab-04bc-4688-a796-7b3e4b3e85d5',
'timeout_webhook_production' => 'https://jouw-n8n-domein.nl/webhook/xxx',
```

## Checklist

1. **N8N draait** – `n8n start`
2. **CORS** – `N8N_CORS_ALLOW_ORIGIN` op je app-origin (bv. `http://localhost:8080`)
3. **Webhook actief** – workflow ingeschakeld, URL klopt

## Timeout in JSON

Het timeout-advies wordt opgeslagen in de wedstrijd-JSON als `timeoutAdvice` (huidige weergave) en `lastTimeoutAdvice` (persistent, voor AI-context). De geaggregeerde export bevat `previousTimeoutAdvice` zodat de AI zijn eigen vorige advies kan lezen en daarop kan voortbouwen.

## Response

Ondersteunde formaten:

- **output** (string): `{ "output": "**Time-out advies**\n\n**1. Tip één**\nTekst..." }` – Markdown met `**vet**` en regeleinden
- **tips** (array): `{ "tips": ["tip1", "tip2", "tip3"] }`
- **advice** (array): `{ "advice": ["..."] }`
