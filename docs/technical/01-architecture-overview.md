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

1. **`server/app.js`**  
   - Laadt `.env` (`dotenv`)  
   - Bouwt de Express-app: `express.static(public)`, mount van alle `/api/...` routers, globale foutafhandeling, SPA-fallback  
   - `module.exports = app` — gebruikt door **`server/index.js`** (start luisterpoort + `loadModels`) en door **tests** (`supertest`)

2. **`server/index.js`**  
   - `require('./app')`, `app.listen(PORT)`  
   - `loadModels()` uit `faceBlur` wanneer face blur aan staat  
   - `uncaughtException` / `unhandledRejection` handlers

3. **`public/index.html`**  
   - Laadt `/js/app.js` (met query `?v=N` voor cache-bust)  
   - Registreert service worker `sw.js`

4. **`public/js/app.js`**  
   - Registreert routes via `registerRoute(name, fn)`  
   - `navigate(route, params)` roept de juiste page-functie aan

## Directory-structuur (relevant)

```
server/
  index.js          # listen + loadModels + process handlers
  app.js            # Express-app (export voor tests)
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
