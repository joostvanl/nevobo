'use strict';

/**
 * Twee-fasen aanroep naar dezelfde N8N-training-webhook: kleine stap (dagplan) + grote stap (volledige schedule).
 * De agent blijft "leeg"; alle prompts en context komen uit de app. Body bevat `pipeline` zodat N8N optioneel kan routeren.
 */

const { dependencyFetch, DEPS } = require('./dependencyFetch');

const STEP_TIMEOUT_MS = 120_000;

function unwrapN8nWebhookBody(result) {
  if (result == null || typeof result !== 'object') return result;
  if (Array.isArray(result) && result.length > 0) {
    const first = result[0];
    if (first && typeof first === 'object' && first.json && typeof first.json === 'object') {
      return first.json;
    }
  }
  if (result.json && typeof result.json === 'object') {
    return result.json;
  }
  if (result.body && typeof result.body === 'object' && result.schedule == null) {
    return result.body;
  }
  return result;
}

function parseInnerJsonString(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(t);
  } catch (_) {
    return null;
  }
}

/** Haal plat object uit N8N-response; voor stap 1: object met team_plans; voor stap 2: schedule. */
function normalizeAgentPayload(result) {
  let r = unwrapN8nWebhookBody(result);
  if (!r || typeof r !== 'object') return r;
  if (Array.isArray(r) && r.length > 0) r = r[0];
  if (r.team_plans || r.step === 1) return r;
  if (r.schedule && Array.isArray(r.schedule)) return r;
  if (r.output) {
    const inner = typeof r.output === 'string' ? parseInnerJsonString(r.output) : r.output;
    if (inner && typeof inner === 'object') {
      if (inner.schedule || inner.team_plans || inner.step === 1) return inner;
    }
  }
  if (r.text) {
    const inner = typeof r.text === 'string' ? parseInnerJsonString(r.text) : r.text;
    if (inner && typeof inner === 'object') {
      if (inner.schedule || inner.team_plans || inner.step === 1) return inner;
    }
  }
  return r;
}

/** Zelfde logica als /ai-optimize voor finaal schedule-object. */
function normalizeScheduleResult(result) {
  let r = unwrapN8nWebhookBody(result);
  if (!r || typeof r !== 'object') return r;
  if (!r.schedule && Array.isArray(r) && r.length > 0) r = r[0];
  if (!r.schedule && r.output) {
    try {
      const inner = typeof r.output === 'string' ? parseInnerJsonString(r.output) : r.output;
      if (inner && inner.schedule) r = inner;
    } catch (_) {}
  }
  if (!r.schedule && r.text) {
    try {
      const inner = typeof r.text === 'string' ? parseInnerJsonString(r.text) : r.text;
      if (inner && inner.schedule) r = inner;
    } catch (_) {}
  }
  return r;
}

function computeShortageContext(trainingPayload) {
  const teams = trainingPayload.teams || [];
  const schedule = trainingPayload.schedule || [];
  return teams.map((t) => {
    const count = schedule.filter((s) => s.team === t.name).length;
    const req = t.trainings_per_week || 0;
    const shortage = Math.max(0, req - count);
    return { team: t.name, trainings_per_week: req, scheduled_count: count, shortage };
  });
}

const STEP1_SYSTEM_PROMPT = `Je bent assistent voor zaalvolleybal trainingsplanning (Nederlandse club).
Je krijgt JSON in de webhookvelden "teams" en "training".

Dit is PIPELINE STAP 1 van 2. Je maakt GEEN volledig rooster (geen start_time, geen velden).
Je levert alleen een compact dagplan.

training.venue_unavailability[] = zaal niet gehuurd / geblokkeerd. Elementen met iso_week null/leeg zijn TERUGKEREND.
Kies new_session_days zo dat het aannemelijk is dat stap 2 nog vrije, gehuurde tijd vindt op die dagen (niet structureel dagen kiezen waar alle relevante velden door terugkerende huur dicht zitten voor jeugd/seniorenvensters). Als een dag voor een teamtype praktisch dicht is door huur, kies een andere dag binnen 0–3.

ANTWOORD (alleen JSON, geen markdown):
{"step":1,"team_plans":[{"team":"<exacte naam uit shortage_context>","new_session_days":[<int>,...]}],"evening_character":{"0":"competition|recreant|mixed","1":"...","2":"...","3":"..."},"advice":""}

Regels:
- dagnummers: 0=ma … 6=zo. Voor doordeweekse trainingen voorkeur 0–3 (ma–do) tenzij de gebruiker anders vraagt.
- Voor elke regel in shortage_context met shortage > 0: precies één team_plans-item met die teamnaam; new_session_days heeft exact "shortage" elementen (één dag per nieuwe sessie).
- Sorteer new_session_days per team oplopend; tussen opeenvolgende dagen minimaal 2 dagen verschil (|d[i+1]-d[i]| >= 2), tenzij de gebruiker expliciet anders vraagt.
- Groepeer logisch: competitie/senioren vs recreant vs jeugd op avonden waar dat past; evening_character beschrijft kort de bedoeling per ma–do-avond (0–3).
- Teamnamen exact gelijk aan het veld "team" in shortage_context.`;

function buildStep1UserMessage(mode, extraMessage, shortageContext) {
  const modeLabel = { new: 'VOLLEDIG NIEUW', complete: 'AANVULLEN', optimize: 'OPTIMALISEREN' }[mode] || 'AANVULLEN';
  let msg = `MODUS: ${modeLabel}\n\n`;
  msg += `══ shortage_context (verplicht: team_plans moet dit afdekken) ══\n${JSON.stringify(shortageContext)}\n\n`;
  if (extraMessage) msg += `══ EXTRA OPDRACHT ══\n${extraMessage}\n\n`;
  msg += 'Antwoord met alleen het JSON-object (step, team_plans, evening_character, advice).';
  return msg;
}

function step2Appendix(planObj) {
  return `

══ PIPELINE — RESULTAAT STAP 1 (DAGEN BINDEND) ══
Het volgende object komt uit stap 1 van de pipeline. Gebruik deze dagen voor de NIEUWE sessies per team; vul tijden en velden in volgens je hoofdopdracht. Wijk alleen af als het echt onmogelijk is; licht toe in advice.
${JSON.stringify(planObj)}
`;
}

function validateStep1(shortageContext, step1Obj) {
  const warnings = [];
  if (!step1Obj || typeof step1Obj !== 'object') {
    return { ok: false, warnings: ['stap 1: geen object'], planByTeam: {} };
  }
  const plans = step1Obj.team_plans;
  if (!Array.isArray(plans)) {
    return { ok: false, warnings: ['stap 1: team_plans ontbreekt of is geen array'], planByTeam: {} };
  }
  const byName = {};
  for (const p of plans) {
    if (p && typeof p.team === 'string') byName[p.team] = p;
  }
  for (const row of shortageContext) {
    if (row.shortage <= 0) continue;
    const p = byName[row.team];
    if (!p) {
      warnings.push(`Ontbrekend in team_plans: "${row.team}"`);
      continue;
    }
    const days = p.new_session_days;
    if (!Array.isArray(days) || days.length !== row.shortage) {
      warnings.push(`Team "${row.team}": verwacht ${row.shortage} dagen in new_session_days, gekregen ${Array.isArray(days) ? days.length : 0}`);
    }
    for (const d of Array.isArray(days) ? days : []) {
      if (typeof d !== 'number' || d < 0 || d > 6) warnings.push(`Team "${row.team}": ongeldige dag ${d}`);
    }
  }
  return { ok: warnings.length === 0, warnings, planByTeam: byName };
}

async function postWebhook(webhookUrl, body) {
  const response = await dependencyFetch(DEPS.n8n_webhook, webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
  const rawText = await response.text().catch(() => '');
  return { response, rawText };
}

/**
 * @param {object} opts
 * @param {string} opts.webhookUrl
 * @param {string} opts.mode
 * @param {object} opts.teamsPayload
 * @param {object} opts.trainingPayload
 * @param {string} opts.extraMessage
 * @param {() => string} opts.getStep2SystemPrompt — zelfde bron als enkele aanroep (bijv. getActiveSystemPrompt(mode))
 * @param {(mode: string, extra: string) => string} opts.buildStep2UserMessage
 */
async function runMultiStepTrainingAi(opts) {
  const {
    webhookUrl,
    mode,
    teamsPayload,
    trainingPayload,
    extraMessage = '',
    getStep2SystemPrompt,
    buildStep2UserMessage,
  } = opts;

  const shortageContext = computeShortageContext(trainingPayload);
  const steps = [];

  const step1Body = {
    systemPrompt: STEP1_SYSTEM_PROMPT,
    userMessage: buildStep1UserMessage(mode, extraMessage, shortageContext),
    teams: teamsPayload,
    training: trainingPayload,
    pipeline: { multiStep: true, phase: 1, totalPhases: 2 },
  };

  const r1 = await postWebhook(webhookUrl, step1Body);
  steps.push({
    phase: 1,
    request: step1Body,
    httpStatus: r1.response.status,
    responseRaw: r1.rawText,
  });

  if (!r1.response.ok) {
    return {
      ok: false,
      phaseFailed: 1,
      error: `HTTP ${r1.response.status}`,
      steps,
    };
  }

  let parsed1;
  try {
    parsed1 = JSON.parse(r1.rawText);
  } catch (e) {
    return {
      ok: false,
      phaseFailed: 1,
      error: 'invalid_json',
      parseError: e.message,
      steps,
    };
  }

  const step1Obj = normalizeAgentPayload(parsed1);
  steps[0].responseParsedFinal = step1Obj;

  const validation = validateStep1(shortageContext, step1Obj);

  const baseStep2Prompt = getStep2SystemPrompt();
  let systemPrompt2 = baseStep2Prompt + step2Appendix(step1Obj);
  if (!validation.ok && validation.warnings.length) {
    systemPrompt2 += `\n\n══ LET OP STAP 1-VALIDATIE (app) ══\nDe vorige stap had afrondingsproblemen; probeer alsnog een consistent rooster te maken en noem dit in advice:\n${validation.warnings.join('\n')}`;
  }

  const userMessage2 = buildStep2UserMessage(mode, extraMessage);

  const step2Body = {
    systemPrompt: systemPrompt2,
    userMessage: userMessage2,
    teams: teamsPayload,
    training: trainingPayload,
    pipeline: { multiStep: true, phase: 2, totalPhases: 2 },
    previousStepResult: step1Obj,
  };

  const r2 = await postWebhook(webhookUrl, step2Body);
  steps.push({
    phase: 2,
    request: step2Body,
    httpStatus: r2.response.status,
    responseRaw: r2.rawText,
  });

  if (!r2.response.ok) {
    return {
      ok: false,
      phaseFailed: 2,
      error: `HTTP ${r2.response.status}`,
      step1Result: step1Obj,
      step1Validation: validation,
      steps,
    };
  }

  let parsed2;
  try {
    parsed2 = JSON.parse(r2.rawText);
  } catch (e) {
    return {
      ok: false,
      phaseFailed: 2,
      error: 'invalid_json',
      parseError: e.message,
      step1Result: step1Obj,
      step1Validation: validation,
      steps,
    };
  }

  const finalResult = normalizeScheduleResult(parsed2);
  steps[1].responseParsedFinal = finalResult;

  return {
    ok: true,
    step1Result: step1Obj,
    step1Validation: validation,
    finalResult,
    lastRawText: r2.rawText,
    steps,
  };
}

module.exports = {
  runMultiStepTrainingAi,
  computeShortageContext,
  validateStep1,
  STEP1_SYSTEM_PROMPT,
};
