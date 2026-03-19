# 10 — Deployment, PWA en caching

## Omgeving

- **`PORT`** — default 3000 in `server/index.js`  
- **`JWT_SECRET`** — verplicht uniek in productie  
- **`DOTENV`** — `.env` niet in git; `.env.example` als sjabloon  
- **`SOCIAL_EMBEDS_ENABLED`** — `false` schakelt interleave van TikTok/IG in feeds uit (string vergelijking `!== 'false'`)

## Docker (typisch)

- `Dockerfile` + `docker-compose.yml` in repo-root  
- Volume voor `data/` en uploads buiten image  
- Nginx reverse proxy + eventueel Cloudflare tunnel (productie-setup gebruiker-afhankelijk)

## Security headers

- **Helmet** aan, maar **`contentSecurityPolicy: false`** — **reden:** CDN scripts (Leaflet, Chart.js, cookie consent) en inline handlers in oudere HTML; anders breekt de app.  
- **CORS** open (`cors()`) — acceptabel voor mobiele webapp; API is niet publiek zonder token waar nodig.

## PWA

- **`public/manifest.json`** — naam, icons, `start_url`  
- **`sw.js`** — cache versioning; **network-first** voor JS/CSS zodat code-updates snel doorstromen  
- **`index.html`** — `app.js?v=N` — **handmatig bumpen** bij release om cache-busting te garanderen naast SW

## Operationeel

- Na deploy: gebruikers **hard refresh** of SW unregister bij hardnekkige cache  
- Logs: stdout/stderr in container; `uncaughtException` wordt gelogd maar stopt proces niet

## Zie ook

- [03-frontend-app-and-routing.md](./03-frontend-app-and-routing.md)
