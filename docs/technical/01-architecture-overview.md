# 01 — Architectuur-overzicht

## Stack

| Laag | Keuze | Reden |
|------|--------|--------|
| Runtime | Node.js ≥18 | Ecosysteem, Sharp/native deps, eenvoudige deploy |
| Server | Express 5 | Lichtgewicht REST; geen aparte API-framework nodig |
| Database | SQLite (`better-sqlite3`) | Eén bestand, geen aparte DB-server; voldoende voor club/team schaal |
| Frontend | Vanilla JS (ES modules) | Geen build-stap voor basis-app; import maps via `type="module"` |
| Auth | JWT in `Authorization: Bearer` | Stateless; past bij SPA + mobiel |

**Waarom geen React/Vue op de hoofd-app:** snelle iteratie, klein team, PWA-vriendelijk; zware embeds (TikTok) zijn toch third-party iframes.

## Entrypoints

1. **`server/index.js`**  
   - Laadt `.env` (`dotenv`)  
   - `express.static(public)`  
   - Mount routers onder `/api/...`  
   - 404 JSON voor onbekende `/api/*`; anders `index.html` (SPA)  
   - Start `loadModels()` uit `faceBlur` (achtergrond)

2. **`public/index.html`**  
   - Laadt `/js/app.js` (met query `?v=N` voor cache-bust)  
   - Registreert service worker `sw.js`

3. **`public/js/app.js`**  
   - Registreert routes via `registerRoute(name, fn)`  
   - `navigate(route, params)` roept de juiste page-functie aan

## Directory-structuur (relevant)

```
server/
  index.js
  db/db.js, schema.sql
  middleware/auth.js
  routes/*.js
  services/faceBlur.js
  lib/tiktok-scraper.js   # optioneel — zie docs/tiktok-scraper.md
  data/scout/          # JSON-bestanden per match (scout feature)
public/
  index.html, sw.js, manifest.json
  css/app.css
  js/app.js, reel-viewer.js, file-picker.js
  js/pages/*.js
  js/scout/*.js        # scout UI modules
  uploads/             # runtime uploads (niet in git)
data/
  volleyball.db        # SQLite (niet in git)
```

## Belangrijkste externe services

- **NeVoBo** — RSS (`api.nevobo.nl/export/...`) voor programma/resultaten; soms LD+json voor aanvullende data  
- **assets.nevobo.nl** — clublogo’s  
- **TikTok / Instagram** — embed-URLs en iframes in de reel  
- **CDN** — Leaflet, Chart.js, vanilla-cookieconsent (zie `index.html`)

## Foutafhandeling server

- Globale Express error handler → 500 JSON  
- `uncaughtException` / `unhandledRejection` loggen maar proces niet stoppen (o.a. TF/WASM kan rommelen)

## Zie ook

- [02-database-and-migrations.md](./02-database-and-migrations.md)  
- [03-frontend-app-and-routing.md](./03-frontend-app-and-routing.md)
