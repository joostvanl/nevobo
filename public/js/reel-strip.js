/**
 * Horizontale reel-thumbnails (home / team / wedstrijd) — één HTML-builder + video-autoplay.
 */

const TIKTOK_THUMB_SVG =
  '<svg class="hm-reel-social-logo" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.3 6.3 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.77a4.85 4.85 0 01-1.01-.08z"/></svg>';

const INSTAGRAM_THUMB_SVG =
  '<svg class="hm-reel-social-logo" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>';

function mediaThumbHtml(m, esc, includeSocialEmbeds) {
  if (m.file_type === 'video') {
    return `<video class="hm-reel-media" src="${esc(m.file_path)}" muted playsinline loop preload="metadata"></video>
                 <div class="hm-reel-play-icon">▶</div>`;
  }
  if (includeSocialEmbeds && m.file_type === 'tiktok') {
    return `<div class="hm-reel-media hm-reel-social-thumb hm-reel-social-tiktok">${TIKTOK_THUMB_SVG}</div>`;
  }
  if (includeSocialEmbeds && m.file_type === 'instagram') {
    return `<div class="hm-reel-media hm-reel-social-thumb hm-reel-social-ig">${INSTAGRAM_THUMB_SVG}</div>`;
  }
  return `<img class="hm-reel-media" src="${esc(m.file_path)}" alt="Media" loading="lazy" />`;
}

function statsRowHtml(m, statsMode) {
  if (statsMode === 'likes_comments') {
    return `
              ${m.like_count > 0 ? `<span>❤️ ${m.like_count}</span>` : ''}
              ${m.comment_count > 0 ? `<span>💬 ${m.comment_count}</span>` : ''}`;
  }
  return `
              ${m.like_count > 0 ? `<span>❤️ ${m.like_count}</span>` : ''}
              ${m.view_count > 0 ? `<span>👁 ${m.view_count}</span>` : ''}`;
}

/**
 * @param {object[]} media
 * @param {(s: string) => string} esc
 * @param {object} [options]
 * @param {(m: object) => string|null} [options.getClubLogoUrl]
 * @param {boolean} [options.showTeamCaption]
 * @param {'likes_views'|'likes_comments'} [options.statsMode]
 * @param {boolean} [options.includeSocialEmbeds]
 * @param {string} [options.extraCardAttrs] — bv. style="" op de card
 */
export function buildReelStripCardsHtml(media, esc, options = {}) {
  const {
    getClubLogoUrl = () => null,
    showTeamCaption = false,
    statsMode = 'likes_views',
    includeSocialEmbeds = true,
    extraCardAttrs = '',
  } = options;

  return media
    .map((m, i) => {
      const logoUrl = getClubLogoUrl(m);
      const logoBlock = logoUrl ? `<div class="hm-reel-club-logo"><img src="${esc(logoUrl)}" alt="" /></div>` : '';
      const teamLine =
        showTeamCaption && (m.team_name || m.club_name_media)
          ? `<span class="hm-reel-team">${esc(m.team_name || m.club_name_media)}</span>`
          : '';
      return `
          <div class="hm-reel-card" data-index="${i}"${extraCardAttrs ? ' ' + extraCardAttrs : ''}>
            ${logoBlock}
            ${mediaThumbHtml(m, esc, includeSocialEmbeds)}
            <div class="hm-reel-gradient"></div>
            <div class="hm-reel-info">
              ${teamLine}
              <div class="hm-reel-stats">
                ${statsRowHtml(m, statsMode)}
              </div>
            </div>
          </div>`;
    })
    .join('');
}

/** IntersectionObserver: preview-video’s afspelen in de strip */
export function setupReelStripVideoAutoplay(reelTrack) {
  if (!reelTrack) return;
  const videos = reelTrack.querySelectorAll('video.hm-reel-media');
  if (!videos.length) return;
  const obs = new IntersectionObserver(
    entries => {
      entries.forEach(e => {
        const vid = e.target;
        if (e.isIntersecting) {
          vid.play().catch(() => {});
          vid.closest('.hm-reel-card')?.querySelector('.hm-reel-play-icon')?.style.setProperty('display', 'none');
        } else {
          vid.pause();
        }
      });
    },
    { threshold: 0.6 }
  );
  videos.forEach(v => obs.observe(v));
}
