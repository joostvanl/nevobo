'use strict';

/**
 * Platform feature toggles — DB override met fallback naar environment defaults.
 * Alleen super admins mogen schrijven (via admin routes).
 */

const db = require('../db/db');

const DEFINITIONS = {
  scout_enabled: {
    label: 'Wedstrijd scouting',
    description: 'Scout-setup, wedstrijd-scouting en /api/scout voor coaches/beheerders.',
    envDefault: () => true,
    dbDefault: true,
  },
  social_embeds_enabled: {
    label: 'Social embeds in feeds',
    description: 'TikTok- en Instagram-items in home- en team-media (reel).',
    envKey: 'SOCIAL_EMBEDS_ENABLED',
    envDefault: (v) => (v ?? '') !== 'false',
    dbDefault: true,
  },
  face_blur_enabled: {
    label: 'Automatische gezichtsblur',
    description: 'Face-api modellen en blur bij uploads (anonieme modus).',
    envKey: 'FACE_BLUR_ENABLED',
    envDefault: (v) => (v || '').trim() === 'true',
    dbDefault: false,
  },
  face_blur_debug: {
    label: 'Blur debug (upload)',
    description: 'Stuurt extra kwaliteitsdebug naar de client bij uploads.',
    envKey: 'FACE_BLUR_DEBUG',
    envDefault: (v) => (v || '').trim() === 'true',
    dbDefault: false,
  },
};

function parseStoredValue(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return null;
}

function getBoolean(key) {
  const def = DEFINITIONS[key];
  if (!def) return false;

  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  const parsed = row ? parseStoredValue(row.value) : null;
  if (parsed !== null) return parsed;

  if (def.envKey) {
    const ev = process.env[def.envKey];
    if (ev !== undefined && ev !== '') return def.envDefault(ev);
  }
  return def.envDefault(undefined);
}

/** Publieke flags voor clients (auth/me, login). */
function getClientFeatures() {
  return {
    scout: getBoolean('scout_enabled'),
    social_embeds: getBoolean('social_embeds_enabled'),
    face_blur: getBoolean('face_blur_enabled'),
  };
}

function getAdminSettingsList() {
  return Object.entries(DEFINITIONS).map(([key, meta]) => {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    const parsed = row ? parseStoredValue(row.value) : null;
    let source = 'default';
    if (parsed !== null) source = 'database';
    else if (meta.envKey && process.env[meta.envKey] !== undefined && process.env[meta.envKey] !== '') source = 'environment';

    const value = getBoolean(key);
    return {
      key,
      label: meta.label,
      description: meta.description,
      value,
      source,
    };
  });
}

function setBoolean(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFINITIONS, key)) {
    return { ok: false, error: 'Onbekende instelling' };
  }
  const v = !!value;
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, v ? 'true' : 'false');
  return { ok: true };
}

module.exports = {
  DEFINITIONS,
  getBoolean,
  getClientFeatures,
  getAdminSettingsList,
  setBoolean,
  isScoutEnabled: () => getBoolean('scout_enabled'),
  isSocialEmbedsEnabled: () => getBoolean('social_embeds_enabled'),
  isFaceBlurEnabled: () => getBoolean('face_blur_enabled'),
  isFaceBlurDebugEnabled: () => getBoolean('face_blur_debug'),
};
