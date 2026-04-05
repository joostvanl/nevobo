'use strict';

/**
 * Schrijft volledige trainingsplanner AI-webhook aanroepen naar schijf voor review / prompt-tuning.
 * Map: data/ai-training-logs/ (onder data/, meestal .gitignore)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '../..');
const LOG_DIR = path.join(ROOT, 'data', 'ai-training-logs');

/**
 * Toont alleen scheme + host + pathname (geen query; daar kunnen tokens in zitten).
 * @param {string} url
 */
function redactWebhookUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch (_) {
    return '[ongeldige-url]';
  }
}

function ensureDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * @param {object} record
 * @param {string} record.at ISO timestamp
 * @param {number} record.userId
 * @param {number} record.clubId
 * @param {string} [record.clubName]
 * @param {string} record.mode
 * @param {string} record.webhookTarget redacted URL
 * @param {object} record.request — { systemPrompt, userMessage, teams, training }
 * @param {number} [record.httpStatus]
 * @param {string} [record.responseRaw] volledige response body (tekst)
 * @param {object} [record.responseParsedInitial] JSON.parse van raw indien gelukt
 * @param {object} [record.responseParsedFinal] object na unwrap(s) vóór schedule-import
 * @param {string} record.outcome — success | webhook_http_error | invalid_json | no_schedule | snapshot_created | validation_failed | exception | timeout
 * @param {string} [record.error]
 * @param {object} [record.apiResult] korte samenvatting wat naar de client ging (geen enorme payloads)
 * @returns {string} bestandsnaam (niet het volledige pad)
 */
function save(record) {
  ensureDir();
  const stamp = (record.at || new Date().toISOString()).replace(/[:.]/g, '-');
  const rnd = crypto.randomBytes(2).toString('hex');
  const filename = `ai-training-${stamp}-${rnd}.json`;
  const filepath = path.join(LOG_DIR, filename);
  const payload = {
    schemaVersion: 1,
    ...record,
    _readme: 'Volledige request (systemPrompt, userMessage, teams, training) en webhook response (responseRaw). Gebruik voor prompt-review.',
  };
  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8');
  return filename;
}

module.exports = {
  LOG_DIR,
  redactWebhookUrl,
  save,
};
