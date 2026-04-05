# Automatische planningsmaker — regels, use cases en vereisten

**Status:** levend document — aan te vullen na review.  
**Doel:** beschrijven **hoe een geldig trainingsrooster tot stand moet komen** en **welke regels** daarbij gelden, als specificatie voor een **automatische planningsfunctie** (feature binnen de trainingsplanner).  
**Niet het doel van dit document:** het functioneren van de hele planner-module (UI-navigatie, publiceren, snapshots, teampagina, export, andere routes). Daarvoor: [22-teamplanner-architecture-and-data-flows.md](./technical/22-teamplanner-architecture-and-data-flows.md) en [21-training-module-planner-and-exercises.md](./technical/21-training-module-planner-and-exercises.md).

---

## 1. Scope

### 1.1 Wel binnen dit document

- De **planningspuzzel**: team → dag, tijd, veld, locatie, met **beschikbaarheid uit de database** als uitgangspunt.
- **Harde** vs **zachte** regels, **fairness** bij capaciteitstekort, **geen onmogelijke planning**.
- **Modi:** uitsluitend **Nieuw** en **Aanvullen** (geen optimalisatiemodus).
- Invoer/uitvoer van de maker, inclusief **rapportage** bij onvolledige planning.

### 1.2 Buiten dit document

- Module-UI, publicatieflow, NeVoBo, oefeningenmodule.
- Concrete API/SQL — behalve: beschikbaarheidsdata **komt uit bestaande data/database** (zoals nu gemodelleerd voor zaal/veld).

---

## 2. Woordenlijst

| Term | Betekenis |
|------|-----------|
| **Trainingsslot** | Eén afspraak: team, dag van de week, start- en eindtijd, veld, locatie. |
| **Weekpatroon** | Terugkerend rooster (zelfde structuur elke week). |
| **Beschikbaarheid (DB)** | Tijdsvensters waarin een veld **wel** gepland mag worden; de **positieve** bron van waarheid. Alles daarbuiten is verboden voor placement. *(In de app: sluit aan bij veld-/zaaldata in de database; o.a. inhuur als “niet beschikbaar”.)* |
| **Mini’s** | Teams in categorie **N5** (o.a. herkenbaar aan teamnaam of expliciet veld op team — vast te leggen in implementatie). |
| **Bevroren slot** | In modus **Aanvullen:** bestaand slot ongewijzigd laten. |
| **Coach-sequentie** | Voor een persoon die **coacht** en **zelf traint**: eerst coachen, daarna eigen training, **opeenvolgende** blokken op **dezelfde locatie**. |

---

## 3. Planningsprobleem

**Gegeven (minimaal):**

- **Teams** met `trainings_per_week`, `min_training_minutes`, `max_training_minutes`, en categorie (voor leeftijdsvolgorde / mini-detectie).
- **Velden** (veld + locatie) binnen de gekozen context (blauwdruk).
- **Beschikbaarheid per veld** uit de database: waar en wanneer mag er **wel** getraind worden (inclusief **vrijdag, zaterdag, zondag** als de data dat toestaat).
- **Coach-koppelingen** (zie §4.1): wie coacht welk team en waar traint die persoon zelf.
- Optioneel **bestaand rooster** (modus Aanvullen: bevroren slots).

**Gezocht:**

- Een set slots die **nooit onmogelijk** is: alle harde regels gehaald; **geen** overlap op hetzelfde veld (behalve expliciete uitzondering mini’s); **alleen binnen beschikbaarheid**.

**Doelwaarde:**

1. **Liefst volledig:** elk team met `trainings_per_week > 0` krijgt exact dat aantal trainingen.
2. **Als capaciteit ontbreekt:** een **eerlijke gedeeltelijke** planning (zie **H-04** en **FR-M6**); **nooit** situatie waarbij het ene team **0** van **2** heeft en een ander **2** van **2**.
3. **Leeftijdsvolgorde** zo goed mogelijk: mini’s het **vroegst** op de avond, daarna jeugd, daarna senioren/recreanten (binnen wat beschikbaarheid en capaciteit toelaten — als zachte optimalisatie met hoge prioriteit, zie §6).

**Modi (enige twee):**

| Modus | Intentie |
|-------|-----------|
| **Nieuw** | Volledige planning vanaf leeg rooster (geen bestaande slots). |
| **Aanvullen** | Bestaande slots **bevroren**; alleen ontbrekende trainingen toevoegen. |

**Optimaliseren** (bestaand rooster herschikken) valt **buiten scope** van deze setup.

---

## 4. Minimale invoer en uitvoer

### 4.1 Invoer (logisch model)

- Teams: unieke naam, `trainings_per_week`, min/max duur, **categorie** (mini / jeugd / senioren / recreanten — exacte enum in implementatie af te stemmen op club).
- Velden: veldnaam + locatie.
- **Beschikbaarheid:** uit database — per veld (en locatie) welke **dag + tijdintervallen** bruikbaar zijn. *Dit vervangt een los “globaal 17:00–23:00”-plafond: het plafond volgt uit de data (kan dus ook late vrijdagavond, weekend, enz.).*
- **Coaches:** per natuurlijk persoon (of user-id) minimaal:
  - verzameling **teams die gecoacht worden**;
  - **eigen team** (waar als speler getraind wordt), indien van toepassing.  
  *Zonder deze data kan regel **H-08** niet afgedwongen worden.*

### 4.2 Uitvoer

- **Schedule:** voorgestelde slots.
- **Status:** volledig / gedeeltelijk.
- Bij **gedeeltelijk** of **volledig met knelpunten:**
  - **Welke teams** niet op volledig `trainings_per_week` zitten;
  - **Hoeveel trainingstijd** ontbreekt (bijv. “team X: 1 van 2 geplaatst, tekort 1× 90 min” of geaggregeerd per team — formaat in implementatie vastleggen);
  - **Geen** oplossing die harde regels schendt of “onmogelijke” toewijzingen bevat.

---

## 5. Harde regels

| ID | Regel |
|----|--------|
| **H-01 — Beschikbaarheid (hoofdregel)** | Elke training ligt **volledig binnen** een beschikbaarheidsinterval van **dat veld** volgens de **database**. Geen placement buiten die data. **Vrijdag, zaterdag en zondag** zijn toegestaan **als en voor zover** de beschikbaarheid dat toelaat. |
| **H-02 — Eén veld, één team tegelijk** | Twee **verschillende** teams mogen niet overlappen op **hetzelfde veld** (zelfde locatie + veldnaam). |
| **H-03 — Uitzondering mini’s (gelijktijdige training)** | Alleen **mini’s (N5)** mogen **meerdere trainingen tegelijk** hebben: hetzelfde team mag op **hetzelfde tijdstip** meer dan één slot hebben, **mits** op **verschillende velden** (parallel). **Alle andere teams:** hoogstens één overlappend tijdslot tegelijk (geen dubbele parallelle training voor hetzelfde team). |
| **H-04 — Aantal trainingen en fairness** | **Doel:** elk team met `trainings_per_week > 0` exact die hoeveelheid. **Als dat niet past binnen H-01–H-03, H-05–H-08:** plan **eerlijk gedeeltelijk** — elk team krijgt **minstens één** geplaatste training waar mogelijk, en het resultaat mag **niet** zijn dat team A **0** gepland krijgt van N terwijl team B **volledig N** krijgt. Concreet: **minimaliseer ongelijkheid** (bijv. maximaal het verschil in “geplaatst / gevraagd” tussen teams). *Exacte optimalisatieformulering (max-min, lexicografisch, enz.) in implementatie.* |
| **H-05 — Duur** | Elke geplaatste training respecteert `min_training_minutes` en `max_training_minutes` (na kwantisatie op roosterrooster). |
| **H-06 — Rustdag** | Zelfde team: geen trainingen op **opeenvolgende kalenderdagen** (definitie zondag↔maandag: open punt §9 indien nog niet vastgelegd). |
| **H-07 — Aanvullen** | Bevroren slots: **identiek** terug in output (zelfde team, dag, tijd, veld, locatie). |
| **H-08 — Coach: eerst coachen, dan zelf trainen** | Voor elke coach met zowel **coachteams** als **eigen team**: de slot(s) waarin hij/zij **coacht** liggen **vóór** het slot waarin hij/zij **als speler** traint, op **dezelfde locatie**, en vormen met dat eigen-trainingsslot **opeenvolgende** blokken (geen andere clubactiviteit of training van die coach op een **andere locatie** ertussen). *Detail: geen tussenruimte behalve eventueel vaste wisseltijd — vast te leggen.* |

**Implementatie (lokale automatische planner):** Er is (nog) geen aparte tabel met “positieve” openingsuren per veld. **Beschikbaarheid** wordt daarom gemodelleerd als een **configureerbaar basisvenster per dag** (standaard 08:00–**23:00** als uiterlijke eindtijd, aanpasbaar via `TRAINING_AVAIL_BASE_START_HOUR` / `TRAINING_AVAIL_BASE_END_HOUR`) **minus** `training_venue_unavailability`, met dezelfde blauwdruk-/weekfilter als de planner-UI. **Voorkeur** om voor **22:30** te eindigen: `TRAINING_AVAIL_PREFERRED_END_MIN` (minuten sinds middernacht, default 1350); overtreding levert een zachte waarschuwing, de solver probeert eerst binnen de voorkeur te plannen. Zie `server/lib/training-schedule-availability.js`.

**Geen onmogelijke planning:** als er **geen enkele** toewijzing mogelijk is die H-01–H-08 respecteert, moet het systeem **falen met duidelijke melding** (geen synthetische slots die regels breken).

---

## 6. Zachte regels / prioriteit (leeftijd op de avond)

Binnen alle **toegestane** beschikbaarheid en na harde regels:

| ID | Voorkeur (hoog → laag) |
|----|-------------------------|
| **Z-01 — Leeftijdsladder op de avond** | **Mini’s (N5)** zo **vroeg mogelijk** in de beschikbare avond; daarna **jeugd**; daarna **senioren en recreanten**. Dit is het planningsprincipe “op leeftijd”; afwijkingen zijn toegestaan als anders geen (eerlijke) oplossing, maar moeten in het rapport terugkomen. |
| **Z-02 — Naadloosheid op het veld** | Op één veld op één dag: blokken liever **aansluitend** (kleine tussenruimte als voorkeur, bijv. ≤ 15 min). |
| **Z-03 — Spreiding over dagen** | Geen onnodige clustering van alle zware teams op één dag als alternatieven bestaan. |

---

## 7. Use cases — automatische maker

### UC-A1 — Nieuw rooster genereren

Modus **Nieuw** → volledige planning; alle regels §5–§6; rapport zoals §4.2.

### UC-A2 — Aanvullen

Modus **Aanvullen** → bevroren slots behouden; alleen tekorten aanvullen volgens **H-07** en overige regels.

### UC-A3 — Gedeeltelijke planning + transparante terugkoppeling

Bij capaciteitstekort: output + **welke teams** onder hun `trainings_per_week` blijven + **tekort aan trainingstijd** (duur/gemiste sessies). Gebruiker kan beslissen tot handmatige bijsturing (buiten dit document).

### UC-A4 — Validatie

Zelfde regels als bij generatie, alleen controleren op een voorgestelde set slots.

---

## 8. Functionele vereisten voor de maker

| ID | Vereiste |
|----|-----------|
| FR-M1 | Eén gedeelde **regelset** voor genereren en valideren. |
| FR-M2 | **Deterministisch** bij gelijke invoer (tenzij bewust anders). |
| FR-M3 | Tijdsresolutie (bijv. kwartier) expliciet en gelijk aan handmatige planning. |
| FR-M4 | Rapport: **harde fouten** vs **zachte afwijkingen**; bij tekort: **teams + tijdtekort**. |
| FR-M5 | Acceptabele rekentijd bij typische clubgrootte. |
| FR-M6 | **Fairness (H-04):** geen oplossing waarbij één team structureel leeg blijft terwijl anderen vol zitten; streef naar **evenwichtige** gedeeltelijke bezetting. |

---

## 9. Open punten

1. **Zondag ↔ maandag** voor **H-06** (rustdag): cyclisch ja/nee?  
2. **Coach-data:** komt uit bestaande `users` / teamrol-tabellen of moet de club expliciet “coach van team X” vastleggen?  
3. **Exacte categorie-indeling** (regex op naam vs DB-veld) voor mini / jeugd / senioren / recreanten.  
4. **Wisseltijd** tussen coachblok en eigen training: 0 min of vaste marge?  

---

## 10. Relatie met bestaande code en AI

- Een eerdere deterministische oplosser is uit de repo verwijderd; dit document is de **functionele** basis voor een nieuwe implementatie.
- De **AI-webhook** ([n8n-training-optimizer-prompt.md](./n8n-training-optimizer-prompt.md)) kent nog een **optimize**-modus; voor **deze** automatische maker gelden alleen **new** en **complete**. AI-flows kunnen op termijn op die twee modi worden beperkt of een aparte prompt krijgen — buiten scope van dit regeldocument.

---

## 11. Referenties

| Document | Waarvoor |
|----------|-----------|
| [22-teamplanner-architecture-and-data-flows.md](./technical/22-teamplanner-architecture-and-data-flows.md) | Waar rooster- en blauwdrukdata leven. |
| [n8n-training-optimizer-prompt.md](./n8n-training-optimizer-prompt.md) | Parallelle AI; modi historisch drie — hier bewust twee voor de automatische maker. |
