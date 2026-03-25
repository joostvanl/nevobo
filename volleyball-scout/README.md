# Volleybal Scouting App

Mobile-first webapp om volleybalwedstrijden live te scouten: acties en events vastleggen (service, pass, setup, aanval, uitkomst) in dezelfde JSON-structuur als `example.json`.

## Technieken

- HTML, CSS, PHP, JavaScript, JSON
- Geen framework; mobile-first, bijna native look & feel

## Flow

1. **Setup (index.php)**  
   Teams kiezen, spelers toevoegen, systeem kiezen (5-1, 4-2 of geen), opstelling set 1 (6 spelers + eventueel spelverdeler(s)), daarna “Start wedstrijd”.

2. **Wedstrijd (match.php)**  
   Scorebord, rotatie-overzicht, knoppen voor:
   - Service (thuis/uit)
   - Pass (Zone I / II / III)
   - Setup (5, 1, C, 10, Pipe, 30)
   - Aanval (Smash, Tip)
   - Block
   - Uitkomst (Uit, In net, Drop, Ace)
   - Punt thuis / Punt uit

3. **Regels (Nevobo/standaard)**  
   - Set 1–4: eerste tot 25, min. 2 punten verschil  
   - Set 5: eerste tot 15, min. 2 punten verschil  
   - Max. 5 sets, winnen met 3 sets  
   - Veldwisseling in set 5 bij 8 punten (in regellogica opgenomen)

## Bestanden

- `index.php` – setup (teams, spelers, systeem, opstelling)
- `match.php` – scherm tijdens de wedstrijd
- `api.php` – laden/opslaan match-JSON
- `css/style.css` – mobile-first styling
- `js/rules.js` – puntentelling en setregels
- `js/rotation.js` – rotatie 5-1/4-2 (wie waar staat)
- `js/setup.js` – setup-wizard
- `js/match.js` – events, rally’s, score, opslaan
- `data/` – hier wordt `current_match.json` weggeschreven

## Spelersnummers (rugnummers)

- In de setup vul je per speler een **naam** en een **rugnummer** (Nr) in. Het rugnummer wordt in de interface getoond (op het veld en in de rally-log) en in de JSON opgeslagen.
- In de events wordt het veld `player` gebruikt voor het shirtnummer van de speler (thuisteam); `playerName` blijft de naam.

## Nevobo / teamdata uit externe bron

- **Officiële Nevobo API**: Er is geen openbare Nevobo-API om teamlijsten of spelersgegevens (inclusief rugnummers) op te halen. Team- en spelerinformatie wordt beheerd via [DWF](https://www.dwf.nevobo.nl) (Digitaal Wedstrijdformulier) en [Mijn Volleybal](https://www.volleybal.nl); toegang is voor ingelogde gebruikers (wedstrijdsecretarissen, aanvoerders).
- **VolleyAdmin2**: De bekende [volleyadmin2-php-api](https://github.com/jeroendesloovere/volleyadmin2-php-api) praat met het **Belgische** VolleyAdmin2-systeem (`volleyadmin2.be`) en biedt alleen: wedstrijden, reeksen en rangschikking. Geen teamopstelling of spelerslijst.
- **Team automatisch inladen**: Omdat er geen openbare Nevobo-API is voor "team kiezen → spelers + rugnummers ophalen", moet je in deze app teams en spelers handmatig invoeren. Als Nevobo later een open API aanbiedt, kan hier een koppeling (bijv. "Team uit Nevobo laden") worden toegevoegd.

## AI Coach (Timeout advies)

De Timeout-knop stuurt wedstrijddata naar een N8N webhook voor AI-advies. Zorg dat N8N draait én CORS aan staat:

```bash
set N8N_CORS_ALLOW_ORIGIN=http://localhost:8080
n8n start
```

(Vervang 8080 door de poort van jouw webserver.) Zie `docs/TIMEOUT_AI_COACH.md`.

## Installatie

1. Clone de repo en zet in een map met PHP (bijv. XAMPP, WAMP of `php -S localhost:8080`).
2. Kopieer `config/app.php.example` naar `config/app.php` en pas aan (feature toggles, webhook-URLs voor AI Coach).
3. Voor login: kopieer `config/auth.php.example` naar `config/auth.php` en vul OAuth/mail in (zie `docs/AUTH_FEATURE.md`).
4. Zorg dat de map `data/` schrijfbaar is.

## Gebruik

1. Open `index.php` in de browser (PHP nodig).
2. Vul teams in, voeg spelers toe met naam en rugnummer, kies systeem en opstelling set 1.
3. Klik “Start wedstrijd” → je gaat naar `match.php`.
4. Per rally: eventueel speler kiezen in het rotatieblok, dan service/pass/setup/aanval/uitkomst, daarna “Punt thuis” of “Punt uit”.
5. Data wordt na elke rally opgeslagen in `data/current_match.json` in dezelfde structuur als `example.json` (inclusief `teamAPlayers` en `player` als shirtnummer in events).
