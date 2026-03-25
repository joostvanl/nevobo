/**
 * Trainingsplanner AI — systeemprompts per modus (new / complete / optimize),
 * per omgeving (development / production), met revisiegeschiedenis.
 *
 * Bronnen (in volgorde):
 *   1. data/training-planner-ai-prompts.json  — live (volume op productie)
 *   2. server/config/training-planner-ai-prompts.json — meegeleverd met release (git)
 *   3. Ingebouwde default (fallback)
 *
 * Omgeving: TRAINING_AI_PROMPT_ENV=development|production, anders NODE_ENV.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DATA_PATH = path.join(ROOT, 'data', 'training-planner-ai-prompts.json');
const BUNDLED_PATH = path.join(__dirname, '../config', 'training-planner-ai-prompts.json');

const MODES = ['new', 'complete', 'optimize'];
const ENV_KEYS = ['development', 'production'];

const MODE_INTROS = {
  new: `MODUS: VOLLEDIG NIEUW
Je maakt een COMPLETE planning vanaf nul. Negeer training.schedule[] — start met een leeg rooster.
Plan ALLE teams in volgens hun trainings_per_week. Daarna wordt automatisch AANVULLEN en OPTIMALISEREN uitgevoerd.`,
  complete: `MODUS: AANVULLEN
De bestaande entries in training.schedule[] zijn VOORKEURSTRAININGEN — bewuste keuzes van de club.
Neem ze ONGEWIJZIGD over. Jouw taak: plan de ontbrekende teams BIJ rondom deze blokken.
Daarna wordt automatisch OPTIMALISEREN uitgevoerd.`,
  optimize: `MODUS: OPTIMALISEREN
De planning in training.schedule[] staat al vast. Neem ALLE entries over.
Jouw taak: verschuif trainingen waar nodig zodat alle regels worden nageleefd.
Voeg GEEN teams toe. Wijzig alleen tijden, velden of dagen als dat nodig is om
overlappen op te lossen, gaten te dichten, of duur te corrigeren. Vermeld elke wijziging in advice.`,
};

const PREFIX = `Je bent een trainingsplanning-engine voor een volleybalclub.
Volg het protocol LETTERLIJK en IN VOLGORDE. Sla geen stap over.

`;

const SUFFIX = `════════════════════════════════════════════════════════════════
FASE 1 · DATA VERZAMELEN
════════════════════════════════════════════════════════════════

1a. Gebruik de beschikbare tool om alle teams met spelers en coaches op te halen.
    Dit is VERPLICHT — sla dit NOOIT over.

1b. Lees de input data:
    · training.teams[]     → array van { name, trainings_per_week, min_training_minutes, max_training_minutes }
    · training.venues[]    → array van { name, location, type }
    · training.locations[] → array van { name, is_primary }
    · training.schedule[]  → bestaande planning (kan leeg zijn)

════════════════════════════════════════════════════════════════
FASE 2 · ANALYSE — maak vier lijsten
════════════════════════════════════════════════════════════════

2a. CAPACITEITSKAART
    Rooster: 4 dagen (ma, di, wo, do) × alle velden.
    Per veld per dag: 6 uur beschikbaar (17:00–23:00).
    Noteer per veld per dag BEZETTE slots (uit schedule) en VRIJE ruimte.
    Reken uit hoeveel trainingen er nog bij kunnen per veld per dag.

    BELANGRIJK: gebruik ALLE velden van ALLE locaties.
    De primaire locatie (is_primary: true) vullen we EERST, maar als die vol zit
    MOETEN we uitwijken naar secundaire locaties. Een team zonder plek op de
    primaire locatie krijgt een plek op een secundaire locatie — het mag NIET
    worden overgeslagen.

2b. TEKORTLIJST
    Per team: huidig_aantal = tel entries in schedule. tekort = trainings_per_week - huidig_aantal.
    Teams met tekort > 0 komen op de lijst:
      1. Coach-dubbelrol teams (hoogste prioriteit)
      2. Gezins-koppel teams
      3. Overige, gesorteerd op leeftijd (jongste eerst)

2c. COACH-DUBBELROLLEN
    Als persoon P "coach" is in team A en "player" in team B:
      → Koppel (A, B). Plan op DEZELFDE dag, DEZELFDE locatie, DIRECT aansluitend.

2d. GEZINSVERBANDEN
    Leden met identieke achternaam in verschillende teams → plan op dezelfde dag/locatie.

════════════════════════════════════════════════════════════════
FASE 3 · PLANNEN
════════════════════════════════════════════════════════════════

3.0  STARTPUNT
     In modus AANVULLEN/OPTIMALISEREN: kopieer alle entries uit training.schedule[] ongewijzigd.
     In modus NIEUW: start met leeg rooster.

3.1  COACH-KOPPELS
     Per koppel (teamA, teamB):
     · Als één al in schedule staat op dag D, locatie L:
         → Zoek vrij slot op D, L, direct aansluitend. Plaats de ander daar.
     · Als geen in schedule: kies dag+veld met ruimte, plan achter elkaar.
     · 2e training van elk team: andere dag, rustdag ertussen.

3.2  GEZINS-KOPPELS
     Zelfde dag + locatie, liefst aansluitend.

3.3  OVERIGE TEAMS (tekortlijst van boven naar beneden)
     Per team met tekort:
     · Duur: gebruik max_training_minutes uit training.teams[]. Als ruimte krap is, mag min_training_minutes.
     · Leeftijdsvenster:
         N5: 17:00–18:30 | MC: 17:00–19:00 | MB: 18:00–20:00
         MA/JA/JB: 18:30–20:30 | DS/HS: 19:00–23:00 | HR/DR: 19:00–23:00
     · Zoek een vrij slot:
         1. Primaire locatie, aaneensluitend aan bestaande blokken
         2. Primaire locatie, ander veld
         3. Secundaire locatie — ALS primaire locatie vol zit
         → Een team mag NOOIT worden overgeslagen. Gebruik secundaire locaties als het moet.
     · Bij 2 trainingen: andere dag met rustdag (ma+wo, ma+do, di+do).
     · Update capaciteitskaart na elke plaatsing.

3.4  GATEN DICHTEN
     Per veld per dag: als er >15 min gat zit tussen twee trainingen,
     schuif het latere blok naar voren (tenzij het een vaste entry is uit originele schedule).

════════════════════════════════════════════════════════════════
HARDE REGELS — schending = planning ONGELDIG
════════════════════════════════════════════════════════════════

R1  GEEN OVERLAP
    Zelfde veld + dag: start_A < end_B EN start_B < end_A = VERBODEN.

R2  AANEENSLUITEND
    Zelfde veld + dag: max 15 min gap tussen opeenvolgende trainingen.

R3  FREQUENTIE
    Per team: EXACT trainings_per_week entries (zie training.teams[]).
    Nooit meer dan 2. Nooit minder dan trainings_per_week.
    Teams met trainings_per_week = 0 worden NIET ingepland — sla ze volledig over.
    Tel na afloop per team en controleer.

R4  RUSTDAG
    Team met 2 trainingen: minimaal 1 dag ertussen.
    OK: ma+wo (0+2), ma+do (0+3), di+do (1+3).
    FOUT: ma+di (0+1), di+wo (1+2), wo+do (2+3).

R5  DAGEN
    ALLEEN maandag (0), dinsdag (1), woensdag (2), donderdag (3).
    Vrijdag/zaterdag/zondag = VERBODEN.

R6  TIJDVENSTER
    Start >= 17:00. Einde <= 23:00.

R7  DUUR
    Elk team heeft in training.teams[] de velden min_training_minutes en max_training_minutes.
    · Gebruik bij voorkeur max_training_minutes als duur.
    · Als er onvoldoende ruimte is, mag je terugvallen op min_training_minutes.
    · De duur moet ALTIJD >= min_training_minutes EN <= max_training_minutes.
    · Controleer: end_time - start_time (in minuten) valt binnen [min, max] van dat team.

R8  PRIMAIRE LOCATIE EERST
    Vul eerst alle velden van de primaire locatie. Als die vol zit: gebruik secundaire locaties.
    Secundaire locaties MOETEN worden gebruikt als er anders teams niet geplaatst kunnen worden.

════════════════════════════════════════════════════════════════
FASE 4 · VERIFICATIE — TWEE VOLLEDIGE RONDES
════════════════════════════════════════════════════════════════

Voer alle checks uit. Bij ELKE fout: corrigeer en herstart ALLE checks.
Na foutloze ronde: voer ALLES een TWEEDE keer uit.

V1  OVERLAP         Per (dag,locatie,veld) gesorteerd op start_time:
                    end[i] <= start[i+1]?  Nee → FIX
V2  AANEENSLUITEND  Zelfde groepen: start[i+1] - end[i] <= 15 min?  Nee → FIX
V3  FREQUENTIE      Per team: entries == trainings_per_week? Nooit > 2?
                    Tel LETTERLIJK per teamnaam. ALS afwijking → FIX
V4  RUSTDAG         Per team met 2 entries: |dag1-dag2| >= 2?  Nee → FIX
V5  DAGEN           Elke entry: day_of_week in {0,1,2,3}?  Nee → FIX
V6  TIJDVENSTER     Elke entry: start >= "17:00" en end <= "23:00"?  Nee → FIX
V7  DUUR            Elke entry: end - start >= min_training_minutes EN
                    <= max_training_minutes van dat team?  Nee → FIX
V8  LOCATIE         Alle velden van primaire locatie in schedule?
                    Secundaire locaties gebruikt als primaire vol?
V9  BEHOUD          (modus AANVULLEN/OPTIMALISEREN) Elke originele entry ongewijzigd aanwezig?
                    (modus OPTIMALISEREN) Geen teams toegevoegd die er niet al waren?

════════════════════════════════════════════════════════════════
FASE 5 · OUTPUT — UITSLUITEND JSON
════════════════════════════════════════════════════════════════

Je antwoord BEGINT met { en EINDIGT met }. NIETS anders.
Geen tekst. Geen markdown. Geen code fences.

{
  "name": "AI-optimalisatie <datum>",
  "advice": "Beschrijf: modus, wat je deed, welke teams bijgepland/gewijzigd, coach-koppels, capaciteitsanalyse, en resultaat van beide verificatierondes. Gebruik \\n voor newlines.",
  "schedule": [
    {
      "day": "Maandag",
      "day_of_week": 0,
      "start_time": "17:00",
      "end_time": "18:30",
      "team": "exact teamnaam",
      "venue": "exact veldnaam",
      "location": "exact locatienaam"
    }
  ]
}

VELDREGELS:
· day: "Maandag" | "Dinsdag" | "Woensdag" | "Donderdag"
· day_of_week: 0 | 1 | 2 | 3
· start_time / end_time: "HH:MM", binnen 17:00–23:00
· team / venue / location: exact uit de input, hoofdlettergevoelig
· schedule bevat ALLE trainingen (complete set)`;

function composeBuiltInPrompt(mode) {
  const m = MODES.includes(mode) ? mode : 'complete';
  const intro = MODE_INTROS[m] || MODE_INTROS.complete;
  return `${PREFIX}${intro}

${SUFFIX}`;
}

function getBuiltInDefaultConfig() {
  const now = new Date().toISOString();
  const slot = (mode) => ({
    activeVersion: 1,
    revisions: [
      {
        version: 1,
        prompt: composeBuiltInPrompt(mode),
        savedAt: now,
        note: 'Standaard (meegeleverd met app)',
      },
    ],
  });
  return {
    schemaVersion: 1,
    environments: {
      development: {
        new: slot('new'),
        complete: slot('complete'),
        optimize: slot('optimize'),
      },
      production: {
        new: slot('new'),
        complete: slot('complete'),
        optimize: slot('optimize'),
      },
    },
  };
}

function getResolvedPromptEnvironment() {
  const raw = (process.env.TRAINING_AI_PROMPT_ENV || '').toLowerCase().trim();
  if (raw === 'development' || raw === 'dev') return 'development';
  if (raw === 'production' || raw === 'prod') return 'production';
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return 'Ongeldig configuratie-object';
  if (cfg.schemaVersion !== 1) return 'schemaVersion moet 1 zijn';
  if (!cfg.environments || typeof cfg.environments !== 'object') return 'environments ontbreekt';
  for (const env of ENV_KEYS) {
    const e = cfg.environments[env];
    if (!e || typeof e !== 'object') return `Omgeving "${env}" ontbreekt`;
    for (const mode of MODES) {
      const s = e[mode];
      if (!s || typeof s !== 'object') return `Slot ${env}.${mode} ontbreekt`;
      if (typeof s.activeVersion !== 'number' || !Array.isArray(s.revisions)) {
        return `Slot ${env}.${mode}: activeVersion of revisions ongeldig`;
      }
      if (!s.revisions.length) return `Slot ${env}.${mode}: minimaal één revisie vereist`;
      const vers = new Set(s.revisions.map((r) => r.version));
      if (vers.size !== s.revisions.length) return `Slot ${env}.${mode}: dubbele versienummers`;
      if (!vers.has(s.activeVersion)) return `Slot ${env}.${mode}: activeVersion ${s.activeVersion} bestaat niet`;
      for (const r of s.revisions) {
        if (typeof r.prompt !== 'string' || !r.prompt.trim()) return `Lege prompt in ${env}.${mode} v${r.version}`;
      }
    }
  }
  return null;
}

function normalizeConfig(cfg) {
  const err = validateConfig(cfg);
  if (err) throw new Error(err);
  return cfg;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error('[training-ai-prompts] Kan JSON niet lezen:', filePath, e.message);
    return null;
  }
}

function getConfigSourcePath() {
  if (fs.existsSync(DATA_PATH)) return { path: DATA_PATH, kind: 'data' };
  if (fs.existsSync(BUNDLED_PATH)) return { path: BUNDLED_PATH, kind: 'bundled' };
  return { path: null, kind: 'builtin' };
}

function loadTrainingAiPromptsConfig() {
  const data = readJsonIfExists(DATA_PATH);
  if (data) {
    const err = validateConfig(data);
    if (!err) return { config: data, source: 'data' };
    console.error('[training-ai-prompts] data-bestand ongeldig, val terug op bundled:', err);
  }
  const bundled = readJsonIfExists(BUNDLED_PATH);
  if (bundled) {
    const err = validateConfig(bundled);
    if (!err) return { config: bundled, source: 'bundled' };
    console.error('[training-ai-prompts] bundled ongeldig, val terug op builtin:', err);
  }
  return { config: getBuiltInDefaultConfig(), source: 'builtin' };
}

function ensureDataDir() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveTrainingAiPromptsConfig(cfg) {
  normalizeConfig(cfg);
  ensureDataDir();
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

function readBundledTrainingAiPromptsConfig() {
  const bundled = readJsonIfExists(BUNDLED_PATH);
  if (!bundled) return { config: getBuiltInDefaultConfig(), fromFile: false };
  const err = validateConfig(bundled);
  if (err) return { config: getBuiltInDefaultConfig(), fromFile: false, bundledError: err };
  return { config: bundled, fromFile: true };
}

function getActivePromptForSlot(slot, mode) {
  const rev = slot.revisions.find((r) => r.version === slot.activeVersion);
  if (rev?.prompt) return rev.prompt;
  const latest = slot.revisions.reduce((a, b) => (a.version > b.version ? a : b));
  console.warn(`[training-ai-prompts] activeVersion mist voor modus ${mode}, gebruik v${latest.version}`);
  return latest.prompt;
}

function getActiveSystemPrompt(mode) {
  const m = MODES.includes(mode) ? mode : 'complete';
  const { config } = loadTrainingAiPromptsConfig();
  const env = getResolvedPromptEnvironment();
  const envBlock = config.environments[env] || config.environments.production;
  const slot = envBlock[m];
  if (!slot) return composeBuiltInPrompt(m);
  return getActivePromptForSlot(slot, m);
}

function saveNewRevision(environment, mode, prompt, note) {
  if (!ENV_KEYS.includes(environment)) throw new Error('Ongeldige omgeving');
  if (!MODES.includes(mode)) throw new Error('Ongeldige modus');
  const trimmed = (prompt || '').trim();
  if (!trimmed) throw new Error('Prompt mag niet leeg zijn');

  const { config } = loadTrainingAiPromptsConfig();
  if (!config.environments[environment]) config.environments[environment] = {};
  let slot = config.environments[environment][mode];
  if (!slot || !Array.isArray(slot.revisions)) {
    slot = { activeVersion: 0, revisions: [] };
    config.environments[environment][mode] = slot;
  }
  const maxV = slot.revisions.reduce((n, r) => Math.max(n, r.version || 0), 0);
  const version = maxV + 1;
  const savedAt = new Date().toISOString();
  slot.revisions.push({
    version,
    prompt: trimmed,
    savedAt,
    note: (note || '').trim() || `Versie ${version}`,
  });
  slot.activeVersion = version;
  saveTrainingAiPromptsConfig(config);
  return { version, savedAt };
}

function activateRevision(environment, mode, version) {
  if (!ENV_KEYS.includes(environment)) throw new Error('Ongeldige omgeving');
  if (!MODES.includes(mode)) throw new Error('Ongeldige modus');
  const v = parseInt(version, 10);
  if (!v) throw new Error('Ongeldig versienummer');

  const { config } = loadTrainingAiPromptsConfig();
  const slot = config.environments[environment]?.[mode];
  if (!slot?.revisions?.length) throw new Error('Geen revisies');
  if (!slot.revisions.some((r) => r.version === v)) throw new Error(`Versie ${v} bestaat niet`);
  slot.activeVersion = v;
  saveTrainingAiPromptsConfig(config);
  return { activeVersion: v };
}

function importBundledToLive() {
  const { config, fromFile, bundledError } = readBundledTrainingAiPromptsConfig();
  if (bundledError) throw new Error(`Bundel ongeldig: ${bundledError}`);
  const copy = JSON.parse(JSON.stringify(config));
  saveTrainingAiPromptsConfig(copy);
  return { imported: true, source: fromFile ? 'bundled-file' : 'builtin-seeded' };
}

module.exports = {
  MODES,
  ENV_KEYS,
  composeBuiltInPrompt,
  getBuiltInDefaultConfig,
  getResolvedPromptEnvironment,
  loadTrainingAiPromptsConfig,
  saveTrainingAiPromptsConfig,
  readBundledTrainingAiPromptsConfig,
  getActiveSystemPrompt,
  saveNewRevision,
  activateRevision,
  importBundledToLive,
  validateConfig,
  getConfigSourcePath,
  DATA_PATH,
  BUNDLED_PATH,
};
