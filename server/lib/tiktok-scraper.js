/**
 * TikTok URL helpers: resolve vm.tiktok.com short links via 301 and extract video ID.
 * Used when adding team social links so vm.tiktok.com URLs are accepted.
 * Production-safe: timeouts and catch-all errors → return null (no server crash).
 */

const { dependencyFetch, DEPS } = require('./dependencyFetch');

const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0';

/**
 * Resolve a vm.tiktok.com short URL: follow redirects (301), get final URL, extract video ID.
 * @param {string} url - Full URL (e.g. https://vm.tiktok.com/ZGduHPGRn/)
 * @returns {Promise<{ videoId: string, finalUrl: string } | null>}
 */
async function resolveVmTiktokToVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^https?:\/\/vm\.tiktok\.com\/[^/?#]+/i.test(trimmed)) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await dependencyFetch(DEPS.tiktok, trimmed, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timeout);

    const finalUrl = res.url || trimmed;
    // Final URL format: https://www.tiktok.com/@user/video/7123456789012345678
    const match = finalUrl.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
    if (!match) return null;

    return { videoId: match[1], finalUrl };
  } catch (_) {
    return null;
  }
}

/**
 * Fetch TikTok profile page and extract video IDs from embedded JSON (for sync script).
 * Returns empty array on failure so script doesn't crash.
 * @param {string} username - TikTok username without @
 * @returns {Promise<{ videoIds: string[] }>}
 */
async function fetchProfileVideoIds(username) {
  if (!username || typeof username !== 'string') return { videoIds: [] };
  const clean = username.replace(/^@/, '').trim();
  if (!clean) return { videoIds: [] };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await dependencyFetch(DEPS.tiktok, `https://www.tiktok.com/@${encodeURIComponent(clean)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timeout);

    const html = await res.text();
    const ids = [];

    // __UNIVERSAL_DATA_FOR_REHYDRATION__ or similar: look for "video":{"id":"7123..." or itemList with id
    const idMatches = html.matchAll(/"id"\s*:\s*"(\d{15,})"/g);
    for (const m of idMatches) {
      if (m[1] && !ids.includes(m[1])) ids.push(m[1]);
    }

    return { videoIds: ids };
  } catch (_) {
    return { videoIds: [] };
  }
}

module.exports = {
  resolveVmTiktokToVideoId,
  fetchProfileVideoIds,
};
