'use strict';

/** Shared URL parser (mirrors the one in admin.js) */
function parseSocialUrlForSocial(url) {
  if (!url) return null;
  const clean = url.trim();
  const ttMatch = clean.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (ttMatch) return { platform: 'tiktok', embed_id: ttMatch[1] };
  const igReel = clean.match(/instagram\.com\/reel\/([A-Za-z0-9_-]+)/);
  if (igReel) return { platform: 'instagram', embed_id: igReel[1] };
  const igPost = clean.match(/instagram\.com\/p\/([A-Za-z0-9_-]+)/);
  if (igPost) return { platform: 'instagram', embed_id: igPost[1] };
  return null;
}

module.exports = parseSocialUrlForSocial;
