# 03 — Frontend: app-shell en routing

## `public/js/app.js`

### State

```js
export const state = { user: null, token: null, currentRoute: 'home' };
```

Sessie: `localStorage` keys `vb_token`, `vb_user` — bij login gezet, bij logout gewist.

### API-helper `api(path, options)`

- Zet `Content-Type: application/json` behalve bij `FormData`  
- Voegt `Authorization: Bearer <token>` toe als `state.token` gezet is  
- `resp.json()` altijd; bij `!resp.ok` throw met `status` en `data`

### Routing

- **`registerRoute(name, async (container, params) => { ... })`** — elke page-module registreert zichzelf (import side-effect onderaan elk `pages/*.js`)  
- **`navigate(route, params)`**  
  - Zet `state.currentRoute`  
  - Slaat `{ route, params }` op in `sessionStorage` (`vb_route`) — **reden:** camera/upload kan pagina herladen; daarna route herstellen  
  - Bottom-nav `.active` op basis van `data-route` (incl. `team-own` ↔ `team`)  
  - Vult `#page-container` met spinner en roept `routes[route](container, params)` aan

### Overige exports (veel gebruikt)

- `showToast`, `showBadgeUnlock`, `showQualityWarningModal`, `showQualityDebugPanel`  
- `renderAvatar`, `renderClubLogo`, `formatDate`, `formatTime`, `relativeTime`  
- `showTeamPicker` — multi-team users → navigatie naar team met `teamId`/`clubId`

## Pagina-modules (`public/js/pages/`)

| Bestand | Route(s) | Notities |
|---------|-----------|----------|
| `home.js` | `home` | Samenvatting, reel, wedstrijden; `media-feed` + `openReelViewer` |
| `matches.js` | `matches`, match-detail | NeVoBo feeds, upload, carpool, `encodeMatchId` |
| `team.js` | `team` | Team-media API, reel, social links (player/coach only) |
| `profile.js` | `profile` | Eigen profiel, media |
| `social.js` | `social` | Feed-achtig overzicht |
| `badges.js` | `badges` | Gamification UI |
| `carpool.js` | `carpool` | Carpool-landing (eigen teams), coach-planner, detail; zie [20-carpool-behavior-and-authorization.md](./20-carpool-behavior-and-authorization.md) |
| `admin.js` | `admin` | Rollen, leden, social links |
| `privacy.js` | privacy-achtige flows | |
| `scout-setup.js`, `scout-match.js` | scout | Feature branch |
| `training-planner.js` | `training-planner` | Clubbeheerders; zet `tp-fullwidth` op `#app`; zie [21-training-module-planner-and-exercises.md](./21-training-module-planner-and-exercises.md) |
| `training-module.js` | `training-module` | Zelfde rechten als planner; full-screen beheer UI + `tp-fullwidth`; CSS: `training-module.css` |
| `training-session.js` | `training-session` | Trainingssessie (params: `teamId`, `date`, `startTime`, …); bereikbaar vanaf `team.js` schema |

**Trainings-UI:** `training-planner.css` en `training-module.css` in `index.html` na `app.css`.

## `public/js/reel-viewer.js`

- **`openReelViewer(items, startIdx, options)`**  
- Opties: `sourceVideo`, `fetchMore(offset)`, `onDelete`, `canDelete`, `canRevertBlur`, `onClose`, `fallbackNevoboCode`  
- **Belangrijk:** `fetchMore` moet **media-offset** krijgen, niet `list.length` — gebruik intern `mediaCount()` (items zonder tiktok/instagram) omdat de API eerste pagina **interleaved** social embeds teruggeeft ([11-cross-cutting-decisions.md](./11-cross-cutting-decisions.md)).

## Service worker `public/sw.js`

- Cache-naam `volleyapp-vN` — bij wijziging oude caches verwijderen  
- **Geen cache** voor `/api/*`  
- JS/CSS: **network-first**, daarna cache updaten

## `index.html`

- Query op `app.js` (`?v=N`) forceert nieuwe module-fetch na deploy.

## Zie ook

- [06-api-social-media-and-reel.md](./06-api-social-media-and-reel.md)  
- [10-deployment-pwa-and-caching.md](./10-deployment-pwa-and-caching.md)  
- [21-training-module-planner-and-exercises.md](./21-training-module-planner-and-exercises.md)
