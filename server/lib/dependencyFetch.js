'use strict';

/**
 * Wraps node-fetch for outbound calls with Prometheus dependency SRE metrics.
 * Labels: dependency name, outcome (success | client_error | server_error | network_error | timeout).
 */

const baseFetch = require('node-fetch');
const metrics = require('./metrics');

/**
 * Stable dependency names for dashboards (keep lowercase snake_case).
 * @type {Readonly<Record<string, string>>}
 */
const DEPS = Object.freeze({
  nominatim: 'nominatim',
  osrm: 'osrm',
  volleybal_nl: 'volleybal_nl',
  nevobo_rss_export: 'nevobo_rss_export',
  nevobo_ld_api: 'nevobo_ld_api',
  nevobo_rss_probe: 'nevobo_rss_probe',
  nevobo_ics_export: 'nevobo_ics_export',
  tiktok: 'tiktok',
  n8n_webhook: 'n8n_webhook',
  nevobo_match_page: 'nevobo_match_page',
});

/**
 * @param {string} dependency - use DEPS.* or a plain string
 * @param {string|import('node-fetch').Request} url
 * @param {import('node-fetch').RequestInit} [options]
 * @returns {Promise<import('node-fetch').Response>}
 */
async function dependencyFetch(dependency, url, options = {}) {
  const start = process.hrtime.bigint();
  try {
    const res = await baseFetch(url, options);
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const outcome = res.ok ? 'success' : res.status >= 500 ? 'server_error' : 'client_error';
    metrics.recordDependencyRequest(dependency, outcome, duration);
    return res;
  } catch (err) {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const outcome =
      err && (err.name === 'AbortError' || err.name === 'TimeoutError') ? 'timeout' : 'network_error';
    metrics.recordDependencyRequest(dependency, outcome, duration);
    throw err;
  }
}

module.exports = { dependencyFetch, DEPS };
