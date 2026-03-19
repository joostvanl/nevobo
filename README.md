# 🏐 VolleyApp

Mobile-first web app for Dutch volleyball clubs. Built with Vanilla JS + Node.js/Express + SQLite. Integrates the Nevobo API for live match data.

## Features

- **Match schedule & results** — Live from the Nevobo API (RSS/ICS feeds)
- **Match detail + map** — Venue location on an OpenStreetMap Leaflet map
- **Carpool coordinator** — Offer rides, book seats per match
- **Photo & video gallery** — Upload media per match after it's played
- **Social feed** — Posts, photos, activity updates from clubs/teams you follow
- **Follow system** — Follow clubs, teams, or other players
- **Gamification** — XP points, levels (1–10), badges, goals with progress bars
- **PWA** — Installable, works offline (service worker caches static assets)
- **Multi-club** — Any Dutch volleyball club can register with their Nevobo code

## Technical documentation (for developers & AI agents)

Structured module docs, API overview, database notes, and known pitfalls:

**→ [docs/technical/INDEX.md](docs/technical/INDEX.md)**

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS (ES modules), HTML5, CSS3 |
| Maps | Leaflet.js (OpenStreetMap) |
| Charts | Chart.js |
| Backend | Node.js + Express 5 |
| Database | SQLite via better-sqlite3 |
| Auth | JWT + bcrypt |
| File upload | Multer |
| Nevobo feeds | rss-parser + node-ical |

## Getting Started

### Prerequisites

- Node.js 18+

### Install & Run

```bash
# Install dependencies
npm install

# Start the server (development)
npm run dev

# Start the server (production)
npm start

# Automated tests (API + feature-settings + escHtml)
npm test
```

The app runs at **http://localhost:3000**

### Environment Variables

Create a `.env` file in the project root:

```env
PORT=3000
JWT_SECRET=your_long_random_secret_here
NODE_ENV=development
```

## Nevobo Club Setup

1. Register on the app
2. Go to Profile → "Club toevoegen"
3. Enter your club's **Nevobo code** (found on volleybal.nl next to your club name)
4. Select your region
5. Go back to Profile and select your club

Your match schedule and results will then be automatically fetched from Nevobo.

## Project Structure

```
Team/
├── server/
│   ├── app.js                # Express-app (export o.a. voor tests)
│   ├── index.js              # listen + loadModels + process handlers
│   ├── routes/
│   │   ├── auth.js           # Register, login, profile
│   │   ├── nevobo.js         # Nevobo API proxy (RSS/ICS → JSON)
│   │   ├── clubs.js          # Club + team management
│   │   ├── social.js         # Posts, media, follow system, feed
│   │   ├── carpool.js        # Carpool offers + bookings
│   │   └── gamification.js   # XP, badges, goals, leaderboard
│   ├── db/
│   │   ├── schema.sql        # SQLite schema + seed data
│   │   └── db.js             # Database wrapper
│   └── middleware/
│       └── auth.js           # JWT middleware
├── public/
│   ├── index.html            # SPA shell
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service worker
│   ├── css/app.css           # Design system (CSS variables, mobile-first)
│   └── js/
│       ├── app.js            # Router, state, API helper, utilities
│       └── pages/
│           ├── home.js       # Home feed + XP bar
│           ├── matches.js    # Schedule, results, detail, map, gallery
│           ├── carpool.js    # Carpool UI
│           ├── badges.js     # Badges, goals, level map
│           ├── social.js     # Social feed, composer, follow/discover
│           └── profile.js    # Profile edit, leaderboard, add club
├── test/                     # node --test + supertest (see npm test)
├── data/                     # Auto-created, contains volleyball.db
├── .env
└── package.json
```

## API Endpoints

### Auth
- `POST /api/auth/register` — Create account
- `POST /api/auth/login` — Login, get JWT
- `GET /api/auth/me` — Current user + badges + goals
- `PATCH /api/auth/profile` — Update name/club/team

### Clubs
- `GET /api/clubs` — All clubs
- `POST /api/clubs` — Create club
- `GET /api/clubs/:id` — Club + teams
- `POST /api/clubs/:id/teams` — Add team to club

### Nevobo
- `GET /api/nevobo/club/:code/schedule` — Upcoming matches (RSS)
- `GET /api/nevobo/club/:code/results` — Past matches (RSS)
- `GET /api/nevobo/team/:code/:type/:nr/schedule` — Team schedule
- `GET /api/nevobo/team/:code/:type/:nr/calendar` — ICS calendar
- `GET /api/nevobo/poule/:regio/:poule/standings` — League standings
- `GET /api/nevobo/geocode?address=` — Geocode a venue address

### Carpool
- `GET /api/carpool/:matchId` — All offers for a match
- `POST /api/carpool/:matchId/offer` — Offer a ride
- `DELETE /api/carpool/offer/:id` — Cancel offer
- `POST /api/carpool/offer/:id/book` — Book a seat
- `DELETE /api/carpool/booking/:id` — Cancel booking

### Social
- `GET /api/social/feed` — Personalized feed
- `POST /api/social/post` — Create text post
- `POST /api/social/upload` — Upload photos/videos
- `GET /api/social/match/:id/media` — Match gallery
- `POST /api/social/follow` — Follow club/team/user
- `DELETE /api/social/follow` — Unfollow
- `GET /api/social/following` — Who you follow

### Gamification
- `GET /api/gamification/badges` — All badges
- `GET /api/gamification/goals` — All goals
- `GET /api/gamification/my` — Your XP, badges, goals
- `GET /api/gamification/leaderboard/:clubId` — Club leaderboard
- `POST /api/gamification/award-xp` — Award XP
- `POST /api/gamification/check-badges` — Check + award earned badges
