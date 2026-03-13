# Functionele Documentatie — Volleyball Team App

**Versie:** März 2026  
**URL productie:** https://volleyapp.joostvanleeuwaarden.com  
**Technologie:** Node.js / Express 5, SQLite, Vanilla JS PWA

---

## Inhoudsopgave

1. [Algemene werking](#1-algemene-werking)
2. [Authenticatie & Gebruikersbeheer](#2-authenticatie--gebruikersbeheer)
3. [Teamlidmaatschap & Rollen](#3-teamlidmaatschap--rollen)
4. [Wedstrijden & Nevobo-integratie](#4-wedstrijden--nevobo-integratie)
5. [Media — Foto's en Video's](#5-media--fotos-en-videos)
6. [Automatische Gezichtsblurring](#6-automatische-gezichtsblurring)
7. [Carpool](#7-carpool)
8. [Sociale Feed](#8-sociale-feed)
9. [Gamification — XP, Badges & Doelen](#9-gamification--xp-badges--doelen)
10. [Beheer (Admin)](#10-beheer-admin)
11. [Profiel](#11-profiel)
12. [Privacybeleid & GDPR](#12-privacybeleid--gdpr)
13. [PWA & Caching](#13-pwa--caching)
14. [Bekende beperkingen & ontwerpkeuzes](#14-bekende-beperkingen--ontwerpkeuzes)

---

## 1. Algemene werking

De app is een **Progressive Web App (PWA)** voor volleybalteams, primair gericht op VTC Woerden. De app werkt in de browser en is installeerbaar op mobiel en desktop.

### Navigatie
- De app heeft een **bottom navigation bar** met: Home, Wedstrijden, Teams, Sociaal, Profiel.
- Routing is volledig client-side (geen page reloads). De URL verandert mee (`/home`, `/matches`, `/team/:id`, etc.).
- Niet-ingelogde gebruikers kunnen wedstrijden en teampagina's bekijken maar kunnen niet interacteren (uploaden, reageren, carpoolaanbod plaatsen, etc.).

### Inlogstatus
- Sessie wordt bijgehouden via een **JWT token** opgeslagen in `localStorage`.
- Het token verloopt na **7 dagen**. Na verlopen wordt de gebruiker uitgelogd.
- De app probeert bij elke start het token te valideren via `GET /api/auth/me`.

---

## 2. Authenticatie & Gebruikersbeheer

### Registratie
- Vereiste velden: **naam**, **e-mailadres**, **wachtwoord** (minimaal 6 tekens).
- Optioneel bij registratie: een club en/of team kiezen.
- E-mailadres moet uniek zijn — bij duplicaat krijgt de gebruiker een foutmelding.
- Bij registratie met een team wordt automatisch de badge **"Team Speler"** uitgereikt.
- Na registratie is de gebruiker direct ingelogd (token wordt teruggegeven).

### Inloggen
- Via e-mailadres + wachtwoord.
- Bij onjuiste combinatie: algemene foutmelding "Ongeldige inloggegevens" (geen onderscheid tussen onbekend e-mail en fout wachtwoord — bewust, voor veiligheid).

### Wachtwoord wijzigen
- Momenteel **niet beschikbaar** via de UI. Kan alleen via de database of door een admin.

### Profielbewerkingen (eigen account)
Via de bewerkoverlay op de profielpagina:
- **Naam** wijzigen
- **Primaire club/team** instellen (bepaalt o.a. welke wedstrijden prominent worden getoond)
- **Anonieme modus** aan/uitzetten (zie §6)
- **Profielfoto** uploaden (max 10 MB, alleen afbeeldingen)

---

## 3. Teamlidmaatschap & Rollen

### Lidmaatschapstypen (team_memberships)
Een gebruiker kan lid zijn van meerdere teams. Per team heeft een gebruiker één van de volgende rollen:

| Type | Beschrijving |
|------|-------------|
| `player` | Speler |
| `coach` | Coach |
| `trainer` | Trainer |
| `parent` | Ouder/verzorger |

- Gebruikers kunnen **zichzelf** toevoegen aan een team via de teampagina ("Volg / Word lid").
- Een teamlidmaatschap bepaalt of iemand carpool-informatie ziet voor uitwedstrijden van dat team.
- Het **eerste team** dat iemand toevoegt wordt automatisch hun primaire team.
- Bij verwijdering van het primaire team wordt automatisch het volgende team als primair ingesteld.

### Beheersrollen (user_roles)
Los van teamlidmaatschappen bestaat er een aparte rechtenstructuur voor beheer. Dit zijn drie niveaus:

| Rol | Bevoegdheden |
|-----|-------------|
| `super_admin` | Alles: gebruikers zoeken, rollen toewijzen/intrekken, alle clubs/teams beheren |
| `club_admin` | Teambeheerders aanstellen binnen de eigen club, leden inzien |
| `team_admin` | Leden van één specifiek team beheren (toevoegen, verwijderen, rol wijzigen, PII bewerken) |

**Hiërarchie-regels:**
- Alleen een `super_admin` kan `super_admin` en `club_admin` rollen toewijzen of intrekken.
- Alleen een `super_admin` of `club_admin` van de betreffende club kan een `team_admin` aanstellen.
- Een `team_admin` kan geen rollen toewijzen.

---

## 4. Wedstrijden & Nevobo-integratie

### Databron
Wedstrijddata wordt **live opgehaald** van de Nevobo API (`https://api.nevobo.nl/export`). De app fungeert als proxy en cachet de resultaten.

### Cachingstrategie
| Datatype | Cache-duur |
|----------|-----------|
| Aankomende wedstrijden (schema) | ~1 dag |
| Uitslagen | Tot er nieuwe resultaten zijn |
| Poule-stand | ~1 uur |
| Poule-indelingen | ~6 uur |

De cache is persistent (opgeslagen in SQLite) en overleeft server-herstarts.

### Wedstrijdoverzicht
- Wedstrijden worden gesorteerd op datum, **meest recent eerst** (voor uitslagen) of **eerstvolgende eerst** (voor aankomende wedstrijden).
- Elke wedstrijd toont: datum/tijd, thuisploeg vs. uitploeg, locatie, uitslag (indien gespeeld).
- Wedstrijden zijn klikbaar en openen een **detailpagina**.

### Wedstrijd detailpagina
De detailpagina toont, afhankelijk van beschikbaarheid:

**Altijd:**
- Teamnamen (home vs. away)
- Datum en tijd
- Speellocatie naam en adres

**Voor uitwedstrijden (als de gebruiker lid is van het spelende team):**
- **Verzameltijd**: 45 minuten vóór aanvang voor thuiswedstrijden; voor uitwedstrijden wordt de reistijd berekend en opgeteld bij 45 minuten, afgerond naar boven op 5 minuten.
- **Reisroute**: routekaart met afstand en reistijd (berekend via OSRM routing engine, geocoding via Nominatim).

**Na afloop:**
- Uitslag en setstanden

**Altijd (indien beschikbaar):**
- Poule-stand
- Foto's en video's van de wedstrijd (zie §5)
- Carpool-informatie (alleen voor uitwedstrijden, alleen voor teamleden — zie §7)

### Teamspagina via Nevobo
- Via de zoekfunctie kunnen **alle** Nevobo-teams gevonden worden, niet alleen VTC Woerden.
- Lazy club-code discovery: als een teamcode niet bekend is, wordt die op de achtergrond opgezocht.

### Poule-stand
- De stand van de **actieve competitie** wordt getoond ("tweede helft" heeft prioriteit over "eerste helft").
- Staat weergegeven als een inklapbare sectie per competitie.

---

## 5. Media — Foto's en Video's

### Uploaden
- Foto's en video's kunnen worden geüpload **vanuit de wedstrijddetailpagina**.
- Directe **camera-capture** is mogelijk op mobiel (foto én video).
- Maximale bestandsgrootte: **50 MB** per bestand.
- Toegestane formaten: JPEG, PNG, GIF, WebP (afbeelding) | MP4, WebM, OGG (video).
- Meerdere bestanden tegelijk uploaden is mogelijk.
- Upload is alleen beschikbaar voor **ingelogde teamleden** van het betreffende team.

### Reel Viewer (fullscreen mediaspeler)
De media worden getoond in een TikTok/Instagram-achtige fullscreen viewer:

- **Navigatie**: swipe links/rechts (mobiel) of pijltjestoetsen (desktop).
- **Video's**: worden automatisch afgespeeld en herhaald (loop).
- **Geluid**: standaard **aan** (unmuted). Via de 🔊 knop kan geluid worden gedempt (🔇).
- **Pause/play**: klikken of tikken op de video pauzeert/hervat het afspelen.
- **Likes**: hart-knop. Ingelogde gebruikers kunnen liken. Eigen likes kunnen worden teruggetrokken door opnieuw te klikken.
- **Reacties**: commentaar toevoegen via het praat-icoontje. Reacties worden per media-item getoond.
- **Views**: worden automatisch geregistreerd bij het bekijken.
- **Verwijderen**: de uploader en admins zien een 🗑 knop. Na bevestiging wordt het bestand permanent verwijderd.
- **Blur-toggle**: zie §6.

### Thumbnails
- Na sluiten van de viewer worden de thumbnails op de onderliggende pagina **automatisch bijgewerkt** zodat blur/unblur-wijzigingen direct zichtbaar zijn.

### Profielmedia
- Alle eigen media is ook te bekijken via de profielpagina, in een rooster-weergave.

---

## 6. Automatische Gezichtsblurring

> Deze functionaliteit is instelbaar via `FACE_BLUR_ENABLED` in de serveromgeving.

### Doel
Beschermt de privacy van gebruikers die **anoniem willen blijven** op foto's. Bij het uploaden van een wedstrijdfoto wordt automatisch gecontroleerd of gezichten van anonieme teamleden zichtbaar zijn, en worden die gezichten vervaagd.

### Anonieme modus instellen
1. Gebruiker gaat naar profiel → bewerken.
2. Vinkje "Ik wil anoniem blijven" aanzetten.
3. **Referentiefoto's uploaden**: tot **5 referentiefoto's** zijn mogelijk (verschillende hoeken, belichting). Deze worden gebruikt voor gezichtsherkenning.

**Kwaliteitseisen referentiefoto (blokkerend — upload wordt geweigerd bij falen):**
- Gezicht moet groot genoeg zijn (minimaal 5% van het beeld)
- Voldoende helderheid (niet te donker, niet overbelicht)
- Voldoende scherpte
- Hoge detectie-betrouwbaarheid (≥65%)

### Hoe blurring werkt
Bij een foto-upload van een wedstrijd:

1. Controleer of het team anonieme leden heeft. Zo niet → blurring overgeslagen.
2. Kwaliteitscheck van de geüploade foto (niet-blokkerend):
   - Minimale scherpte: 2.0 (Laplacian bij 640px)
   - Maximale grain ratio: 3.2 (verhouding scherpte 640px / scherpte 80px)
   - Minimale resolutie: 200px op de kortste zijde
   - Als de foto te korrelig of te laag-resolutie is → blurring overgeslagen, **waarschuwingsmodal** getoond
3. Gezichtsdetectie op de foto (SSD MobileNetV1).
4. Voor elk gedetecteerd gezicht: vergelijk met referentiefoto's van anonieme teamleden.
5. Bij match (drempelwaarde: 0.55 Euclidean distance): gezicht wordt **elliptisch vervaagd** (combinatie Gaussian blur + pixelatie).
6. Originele foto wordt bewaard als `.orig` backup.
7. Bounding boxes van vervaagde gezichten worden opgeslagen in de database (`blur_regions`).

### Blur-toggle (🙈 knop)
Zichtbaar in de reel viewer wanneer:
- De media-uploader bekijkt de foto én
- Het bijbehorende team heeft minstens één anoniem lid, óf de foto is eerder vervaagd

**Gedrag:**
- 🙈 (vol, niet uitgevaagd) = foto is momenteel **vervaagd** → klik om origineel te tonen
- 🙈 (grijs, uitgevaagd) = foto toont momenteel het **origineel** → klik om blur opnieuw toe te passen

Na elke actie wordt de staat opnieuw van de server opgehaald (server-authoritative).

**Re-blur via opgeslagen regio's:** Als `blur_regions` beschikbaar zijn in de database, worden de exacte eerder-vervaagde gebieden opnieuw gebruikt (snel, zonder herdetectie). Bij ontbreken (oude uploads) wordt gezichtsdetectie opnieuw uitgevoerd.

### Debug-modus
Via `FACE_BLUR_DEBUG=true` in de omgevingsvariabelen wordt na elke foto-upload een **debug-panel** getoond met gemeten waarden voor helderheid, scherpte, grain ratio en resolutie.

---

## 7. Carpool

### Wanneer zichtbaar
Carpool-informatie en -functionaliteit is **alleen zichtbaar voor uitwedstrijden**. Bij thuiswedstrijden wordt de carpool-sectie volledig verborgen.

Carpool is ook **alleen zichtbaar voor teamleden** van het spelende team. Niet-leden zien de carpool-informatie niet.

### Lift aanbieden
- Ingelogde teamleden kunnen een lift aanbieden via de wedstrijddetailpagina.
- Vereist: aantal beschikbare plaatsen (minimaal 1).
- Optioneel: vertrekpunt, vertrektijd, notitie.
- **Limiet: 1 aanbod per gebruiker per wedstrijd.** Een tweede aanbod voor dezelfde wedstrijd wordt geweigerd.
- De aanbieder verschijnt in de lijst met naam.
- Het eigen aanbod kan worden ingetrokken via de verwijderknop.

### Lift boeken
- Een beschikbaar aanbod kan worden geboekt door een teamlid.
- Niet mogelijk: eigen aanbod boeken.
- Niet mogelijk: een al volgeboekt aanbod boeken.
- Niet mogelijk: twee keer hetzelfde aanbod boeken.
- De boeking kan worden geannuleerd.

### Samenvatting
Op de wedstrijddetailpagina wordt een samenvatting getoond: aantal aanbiedingen, vrije plaatsen, namen van bestuurders.

---

## 8. Sociale Feed

### Persoonlijke feed (homepage)
De feed toont berichten van:
- De eigen club
- Teams/clubs die de gebruiker volgt
- De gebruiker zelf

Gesorteerd op datum, nieuwste eerst. Paginering: 20 items per keer.

### Berichten typen
| Type | Beschrijving |
|------|-------------|
| `media` | Foto's en/of video's met optionele caption |
| `text` | Tekstberichten (alleen tekst) |

### Volgen
- Gebruikers kunnen teams en clubs **volgen** via de teampagina (knop "Volg").
- Gevolgde teams/clubs verschijnen in de persoonlijke feed.
- Volgen is omkeerbaar (ontvolgen).

### Club-feed
Per club is er een publieke feed met alle media van die club, ook voor niet-ingelogde bezoekers.

---

## 9. Gamification — XP, Badges & Doelen

### XP (ervaringspunten)
- Gebruikers verdienen XP door activiteiten in de app.
- XP bepaalt het **level** van de gebruiker.
- Level-up gebeurt automatisch op basis van geconfigureerde drempelwaarden.

### Badges
Badges worden automatisch uitgereikt bij het bereiken van bepaalde mijlpalen:

| Badge slug | Trigger |
|-----------|---------|
| `team_player` | Registratie met een team |
| `first_match` | Eerste wedstrijd via carpool bijgewoond |
| `five_matches` | 5 wedstrijden via carpool bijgewoond |
| `ten_matches` | 10 wedstrijden via carpool bijgewoond |
| `photo_uploader` | Eerste foto geüpload |
| `five_photos` | 5 foto's geüpload |
| `social_butterfly` | 5 of meer teams/clubs gevolgd |
| `carpool_hero` | Eerste lift aangeboden |

Badges worden bijgehouden via `POST /api/gamification/check-badges` — dit wordt aangeroepen na relevante acties.

### Doelen
Doelen zijn voortgangstaken met een streefwaarde. Bij voltooiing ontvangt de gebruiker XP en eventueel een badge.

Voortgang wordt bijgehouden via de `user_goals` tabel.

### Leaderboard
Per club is er een leaderboard van de top-20 gebruikers op XP, inclusief level en aantal badges.

---

## 10. Beheer (Admin)

Toegankelijk via **Profiel → Gebruikersbeheer** (alleen zichtbaar voor gebruikers met een beheersrol).

### Super Admin
Kan:
- Gebruikers zoeken op naam of e-mail
- Beheersrollen toewijzen en intrekken (super_admin, club_admin, team_admin)
- Alle clubs en teams beheren

### Club Admin
Kan (binnen de eigen club):
- Teambeheerders aanstellen
- Teamleden inzien

### Team Admin
Kan (binnen het eigen team):
- Teamleden toevoegen op e-mailadres
- Lidmaatschapstype wijzigen (`player`, `coach`, `staff`, `parent`)
- Teamleden verwijderen uit het team
- Spelergegevens bewerken: naam, e-mail, rugnummer, positie, geboortedatum

**Opmerking:** De team admin **kan geen** gebruikersaccounts aanmaken. Gebruikers moeten zich zelf registreren; daarna kan de admin hen toevoegen via e-mailadres.

---

## 11. Profiel

### Eigen profielpagina toont:
- Profielfoto (of initialen als placeholder)
- Naam en level
- XP-voortgangsbalk naar volgend level
- Badges
- Doelen-voortgang
- Alle geüploade media (rooster)
- Knop naar Gebruikersbeheer (indien admin)

### Bewerken (via bewerkoverlay):
- Naam
- Profielfoto uploaden/wijzigen
- Anonieme modus aan/uitzetten
- Referentiefoto's beheren (toevoegen/verwijderen, max 5)
- Primaire club zoeken en instellen

### Profielfoto
- Max 10 MB, alleen afbeeldingen
- EXIF-rotatie wordt automatisch gecorrigeerd
- Oude profielfoto wordt automatisch verwijderd van de server

---

## 12. Privacybeleid & GDPR

Toegankelijk via **Profiel → Privacybeleid**.

De privacypagina beschrijft:
- Welke gegevens worden verzameld
- Hoe gezichtsherkenning werkt en hoe opt-out werkt
- Rechten van de gebruiker (inzage, verwijdering, bezwaar)
- Contactgegevens

---

## 13. PWA & Caching

### Installatie
De app is installeerbaar als PWA op Android, iOS en desktop. Na installatie werkt de app als een native app (eigen icoon, geen browser-chrome).

### Service Worker
- Cachet statische assets (CSS, JS, afbeeldingen) voor offline gebruik.
- Cache wordt bij elke deploy geïnvalideerd via een incrementele `CACHE_NAME` versie in `sw.js`.
- **Bij een update:** de browser laadt automatisch de nieuwe versie bij de volgende paginabezoek. Voor directe activatie: Ctrl+Shift+R (harde refresh) of de Service Worker unregistreren via DevTools.

### API-caching
API-responses worden **niet** gecacht door de service worker — die gaan altijd naar de server.

---

## 14. Bekende beperkingen & ontwerpkeuzes

### Geen wachtwoord-reset flow
Er is momenteel geen "wachtwoord vergeten" functionaliteit. Wachtwoordreset kan alleen via de database of via een admin.

### Gezichtsherkenning is niet 100% betrouwbaar
- De drempelwaarde (`FACE_BLUR_THRESHOLD=0.55`) is een balans tussen vals-positieven en vals-negatieven.
- Slechte lichtomstandigheden, sterke profielhoeken of vermomming kunnen leiden tot gemiste detecties.
- Verkeerde personen kunnen worden vervaagd als hun gezicht sterk lijkt op een referentiefoto.
- De blur-toggle (🙈) is beschikbaar zodat uploaders handmatig kunnen corrigeren.

### Foto's zonder teamcontext worden niet geblurd
Als de `team_id` niet correct meegegeven wordt bij upload (legacy uploads), valt de server terug op de teams van de uploader. Nieuw-geüploade foto's slaan de `team_id` altijd correct op.

### Carpool is niet gekoppeld aan Nevobo-wedstrijden
Carpool-aanbiedingen worden opgeslagen op `match_id` (de Nevobo wedstrijd-ID), maar er is geen directe validatie dat deze wedstrijd daadwerkelijk bestaat of dat het een uitwedstrijd is. De frontend beheert de weergavelogica (verbergen bij thuiswedstrijden).

### Nevobo API is niet officieel gedocumenteerd
De API-integratie is gebaseerd op reverse-engineering van de RSS/ICS/LD+JSON feeds. Nevobo kan de API zonder aankondiging wijzigen.

### Uploads zijn lokaal opgeslagen
Media-bestanden worden opgeslagen op de bestandsserver van de Raspberry Pi (Docker volume). Er is geen externe opslag (S3, Cloudflare R2, etc.). Bij schijfproblemen of verlies van het volume gaan uploads verloren.

### Sessieduur
JWT tokens verlopen na 7 dagen. Er is geen automatische verlenging ("refresh token"). Na verlopen moet de gebruiker opnieuw inloggen.
