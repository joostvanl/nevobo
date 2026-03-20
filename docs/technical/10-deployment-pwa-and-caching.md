# 10 — Deployment, PWA en caching

## Omgeving

- **`PORT`** — default 3000 in `server/index.js`  
- **`JWT_SECRET`** — verplicht uniek in productie  
- **`DOTENV`** — `.env` niet in git; `.env.example` als sjabloon  
- **`SOCIAL_EMBEDS_ENABLED`** — `false` schakelt interleave van TikTok/IG in feeds uit (string vergelijking `!== 'false'`)

### Server vs. frontend (lokaal)

- **`server/`** aangepast → **Node herstarten** (`npm start` opnieuw, of `npm run dev` met nodemon). Zonder herstart blijft oude API-gedrag actief. Zie [01-architecture-overview.md](./01-architecture-overview.md) § “Node-proces”, [11 §9](./11-cross-cutting-decisions.md).  
  **Agent-verplichting:** een AI-agent die `server/`-bestanden wijzigt **moet** het Node-proces zelf herstarten via de shell — niet aan de gebruiker overlaten.
- **`public/`** (JS/CSS) aangepast → **cache-bump** (`sw.js` + `index.html` `app.js?v=`) en browser refresh; zie hieronder.

## Docker (typisch)

- `Dockerfile` + `docker-compose.yml` in repo-root  
- Volume voor `data/` en uploads buiten image  
- Nginx reverse proxy + eventueel Cloudflare tunnel (productie-setup gebruiker-afhankelijk)

## Security headers

- **Helmet** aan, maar **`contentSecurityPolicy: false`** — **reden:** CDN scripts (Leaflet, Chart.js, cookie consent) en inline handlers in oudere HTML; anders breekt de app.  
- **CORS** open (`cors()`) — acceptabel voor mobiele webapp; API is niet publiek zonder token waar nodig.

## PWA

- **`public/manifest.json`** — naam, icons, `start_url`  
- **`sw.js`** — `CACHE_NAME` (bijv. `volleyapp-v141`); **network-first** voor JS/CSS zodat updates meestal snel doorstromen  
- **`index.html`** — `app.js?v=N` — query-parameter voor cache-busting van het entrypoint

### Cache bump bij wijzigingen in JavaScript (of CSS)

Na **elke** betekenisvolle wijziging aan `public/js/**` of `public/css/**` (inclusief nieuwe/gewijzigde ES-module chunks zoals `reel-strip.js`):

1. **Verhoog `CACHE_NAME`** in `public/sw.js` (bijv. `volleyapp-v141` → `volleyapp-v142`) zodat geactiveerde service workers oude cache-buckets opruimen en geen verouderde assets uit een oud cache-profiel blijven serveren.
2. **Verhoog `app.js?v=`** in `public/index.html` zodat browsers het hoofdscript niet uit een oude cache-regel halen zonder SW-update.

Zie ook [11-cross-cutting-decisions.md §8](./11-cross-cutting-decisions.md) — bij releases liever **beide** bumps dan alleen één van de twee.

## Operationeel

- Na deploy: gebruikers **hard refresh** of SW unregister bij hardnekkige cache  
- Logs: stdout/stderr in container; `uncaughtException` wordt gelogd maar stopt proces niet

## Zie ook

- [03-frontend-app-and-routing.md](./03-frontend-app-and-routing.md)
