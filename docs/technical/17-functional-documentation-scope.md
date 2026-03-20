# 17 — `FUNCTIONELE_DOCUMENTATIE.md`: scope en grenzen

**Pad (repo-root):** `FUNCTIONELE_DOCUMENTATIE.md`

## Ingebouwde naslag (JSON-viewer)

- **Canoniek voor eindgebruikers in de app:** gestructureerde inhoud onder `public/help/` (`manifest.json`, `functional.nl.json`, `admin-manual.nl.json`) en de SPA-route **`help`** (`public/js/pages/help.js`). Daar staat de actuele functionele naslag en (voor beheerders) de stap-handleiding.
- **`FUNCTIONELE_DOCUMENTATIE.md`:** blijft bruikbaar als menselijk leesbaar overzicht en archief/export; bij verschil met de app geldt de **code** als technische waarheid (zie hieronder). Werk de JSON-viewer bij als de productregels in de app veranderen.

## Rol

- **Primair:** Menselijke stakeholders — functionele uitleg, UX, businessregels op **productniveau** (badges, carpool, Pi-backup, JWT-duur, enz.).
- **Secundair:** Startpunt voor agents om **wat de app belooft** te snappen vóór ze code lezen.

## Wat technische docs **niet** overnemen

- Geen 1:1 kopie van elke bullet uit de functionele doc — dubbel onderhoud voorkomen.
- Technische waarheid blijft **`server/routes/*`, `public/js/*`, `db.js`**. Als functionele doc en code divergeren (bijv. cache-TTL tabel vs `scheduleSmartTtl`), wint **code** tenzij productbewust anders beslist.

## Secties met hoge “business detail”-dichtheid

| § | Onderwerp | Opmerking voor agents |
|---|-----------|------------------------|
| 9 | Gamification (XP, badges, doelen, leaderboard) | Badge-slugs en triggers staan in tabel — verifieer tegen `server/routes/gamification.js` + eventuele client-triggers. |
| 15 | Pi backup / restore / pull | Paden (`PI_HOST`, volume-namen) zijn **omgevingsspecifiek**; pas toe op eigen infra. |
| 6 | Gezichtsblur | Drempel in tekst kan afwijken van `.env` / `faceBlur.js` constanten — zie [18](./18-face-blur-thresholds-and-error-paths.md). |
| 14 | Bekende beperkingen | Goede checklist; kruislings met [11](./11-cross-cutting-decisions.md). |

## Aanbevolen gebruik

1. Lees **INDEX + technische moduledocs** voor architectuur.  
2. Lees **FUNCTIONELE_DOCUMENTATIE.md** voor gebruikersverwachtingen en terminologie.  
3. Bij twijfel: **grep de codebase** op endpoint of tabelnaam.

**Disclaimer:** Niemand hoeft te claimen “alle businessregels” te kennen zonder de volledige functionele doc én de actuele code te hebben doorgenomen.
