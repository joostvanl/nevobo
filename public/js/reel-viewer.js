/**
 * Shared fullscreen portrait media viewer (TikTok-style).
 *
 * openReelViewer(items, startIdx, options)
 *   items      — array of media objects { id, file_path, file_type, caption,
 *                  like_count, comment_count, view_count, liked_by_me }
 *   startIdx   — index to open at
 *   options    — {
 *     sourceVideo: HTMLVideoElement | null   — already-playing video to reuse
 *     onDelete:   async (item) => boolean    — called when user deletes; return true to confirm removal from list
 *     canDelete:  (item) => boolean          — whether to show delete button for an item
 *   }
 */
import { api, state, showToast } from './app.js';

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function openReelViewer(items, startIdx = 0, options = {}) {
  const { sourceVideo = null, onDelete = null, canDelete = null } = options;

  // Work on a mutable copy so deletions don't affect the caller's array
  let list = [...items];
  let idx  = startIdx;
  let touchStartX = 0;
  let touchStartY = 0;

  const overlay = document.createElement('div');
  overlay.className = 'rv-overlay';
  overlay.innerHTML = `
    <div class="rv-bg" id="rv-bg"></div>

    <div class="rv-frame">
      <button class="rv-close" aria-label="Sluiten">✕</button>
      <div class="rv-track" id="rv-track"></div>
    </div>

    <div class="rv-actions" id="rv-actions">
      <button class="rv-act-btn rv-like-btn" id="rv-like">
        <span class="rv-act-icon rv-heart" id="rv-like-icon">❤️</span>
        <span class="rv-act-label" id="rv-like-count">0</span>
      </button>
      <button class="rv-act-btn rv-comment-btn" id="rv-comment">
        <span class="rv-act-icon">💬</span>
        <span class="rv-act-label" id="rv-comment-count">0</span>
      </button>
      <span class="rv-act-btn">
        <span class="rv-act-icon">👁</span>
        <span class="rv-act-label" id="rv-view-count">0</span>
      </span>
      <button class="rv-delete-btn" id="rv-delete" style="display:none" title="Verwijderen">🗑</button>
    </div>

    <div class="rv-infobar" id="rv-infobar">
      <div class="rv-caption" id="rv-caption"></div>
    </div>

    <div class="rv-comments" id="rv-comments" style="display:none">
      <div class="rv-comments-handle"></div>
      <div class="rv-comments-hd">
        <strong>Reacties</strong>
        <button class="rv-comments-close" id="rv-comments-close">✕</button>
      </div>
      <div class="rv-comments-list" id="rv-comments-list"></div>
      <form class="rv-comment-form" id="rv-comment-form">
        <input class="rv-comment-input" id="rv-comment-input" placeholder="Schrijf een reactie…" autocomplete="off" />
        <button type="submit" class="rv-comment-send">➤</button>
      </form>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const track      = overlay.querySelector('#rv-track');
  const likeBtn    = overlay.querySelector('#rv-like');
  const commentBtn = overlay.querySelector('#rv-comment');
  const commentsEl = overlay.querySelector('#rv-comments');
  const deleteBtn  = overlay.querySelector('#rv-delete');

  function buildSlides() {
    track.innerHTML = list.map((m, i) => `
      <div class="rv-slide" data-i="${i}" id="rv-slide-${i}">
        ${m.file_type !== 'video'
          ? `<img class="rv-media" src="${esc(m.file_path)}" alt="" loading="lazy" />`
          : ''}
      </div>`).join('');

    list.forEach((m, i) => {
      if (m.file_type !== 'video') return;
      const slide = track.querySelector(`#rv-slide-${i}`);
      if (!slide) return;
      let vid;
      if (i === startIdx && sourceVideo && !track._sourceReused) {
        track._sourceReused = true;
        vid = sourceVideo;
        vid.style.cssText = '';
      } else {
        vid = document.createElement('video');
        vid.src = m.file_path;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
      }
      vid.classList.add('rv-media');
      slide.appendChild(vid);
    });
  }

  function syncTrackSize() {
    const frame = overlay.querySelector('.rv-frame');
    if (!frame) return;
    const w = frame.offsetWidth;
    const h = frame.offsetHeight;
    if (!w || !h) return;
    track.style.width  = (w * list.length) + 'px';
    track.style.height = h + 'px';
    track.querySelectorAll('.rv-slide').forEach(s => {
      s.style.width  = w + 'px';
      s.style.height = h + 'px';
    });
  }

  function goTo(i, animate = true) {
    i = Math.max(0, Math.min(i, list.length - 1));
    idx = i;

    const frame = overlay.querySelector('.rv-frame');
    const w = frame ? frame.offsetWidth : window.innerWidth;
    track.style.transition = animate ? 'transform 0.28s cubic-bezier(.4,0,.2,1)' : 'none';
    track.style.transform  = `translateX(-${i * w}px)`;

    track.querySelectorAll('.rv-slide').forEach(slide => {
      const si = parseInt(slide.dataset.i);
      const v  = slide.querySelector('video');
      if (!v) return;
      if (si === i) { v.muted = true; v.currentTime = 0; v.loop = true; v.play().catch(() => {}); }
      else          { v.pause(); v.currentTime = 0; }
    });

    updateMeta();
    recordView();
  }

  function updateMeta() {
    const m = list[idx];
    if (!m) return;
    overlay.querySelector('#rv-caption').textContent       = m.caption || '';
    overlay.querySelector('#rv-like-count').textContent    = m.like_count    || 0;
    overlay.querySelector('#rv-comment-count').textContent = m.comment_count || 0;
    overlay.querySelector('#rv-view-count').textContent    = m.view_count    || 0;
    const heartEl = overlay.querySelector('#rv-like-icon');
    heartEl.classList.toggle('rv-heart--liked', !!m.liked_by_me);
    likeBtn.dataset.liked = m.liked_by_me ? 'true' : 'false';
    overlay.querySelector('#rv-bg').style.backgroundImage =
      m.file_type === 'image' ? `url(${esc(m.file_path)})` : '';

    // Show/hide delete button
    const showDel = !!(onDelete && canDelete && canDelete(m));
    deleteBtn.style.display = showDel ? 'flex' : 'none';
  }

  async function recordView() {
    try {
      const m = list[idx];
      const data = await fetch(`/api/social/media/${m.id}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: state.user?.id || null }),
      }).then(r => r.json());
      if (data.ok) {
        m.view_count = data.view_count;
        overlay.querySelector('#rv-view-count').textContent = data.view_count;
      }
    } catch (_) {}
  }

  async function toggleLike() {
    if (!state.token) { alert('Log in om te liken'); return; }
    const m = list[idx];
    try {
      const data = await api(`/api/social/media/${m.id}/like`, { method: 'POST' });
      m.like_count  = data.like_count;
      m.liked_by_me = data.liked;
      overlay.querySelector('#rv-like-count').textContent = data.like_count;
      overlay.querySelector('#rv-like-icon').classList.toggle('rv-heart--liked', !!data.liked);
      likeBtn.dataset.liked = data.liked ? 'true' : 'false';
      likeBtn.classList.remove('rv-like-burst');
      void likeBtn.offsetWidth;
      if (data.liked) likeBtn.classList.add('rv-like-burst');
    } catch (_) {}
  }

  async function deleteCurrentItem() {
    const m = list[idx];
    if (!confirm('Media verwijderen?')) return;
    try {
      const removed = await onDelete(m);
      if (removed === false) return;
      // Pause & remove the slide
      const slide = track.querySelector(`#rv-slide-${idx}`);
      slide?.querySelector('video')?.pause();
      list.splice(idx, 1);
      if (list.length === 0) { close(); return; }
      // Rebuild slides from scratch
      buildSlides();
      syncTrackSize();
      const newIdx = Math.min(idx, list.length - 1);
      // Renumber data-i attributes is already done by buildSlides
      idx = -1; // force goTo to re-render
      goTo(newIdx, false);
    } catch (_) {
      showToast('Verwijderen mislukt', 'error');
    }
  }

  async function openComments() {
    commentsEl.style.display = 'flex';
    const listEl = overlay.querySelector('#rv-comments-list');
    listEl.innerHTML = '<p class="rv-comments-empty">Laden…</p>';
    try {
      const { comments } = await api(`/api/social/media/${list[idx].id}/comments`);
      if (!comments?.length) {
        listEl.innerHTML = '<p class="rv-comments-empty">Nog geen reacties. Wees de eerste!</p>';
      } else {
        listEl.innerHTML = comments.map(c => `
          <div class="rv-comment-row">
            <img src="${esc(c.author_avatar||'')}" class="rv-comment-avatar" onerror="this.style.display='none'" />
            <div class="rv-comment-body">
              <strong>${esc(c.author_name)}</strong>
              <span>${esc(c.body)}</span>
            </div>
          </div>`).join('');
        listEl.scrollTop = listEl.scrollHeight;
      }
    } catch (_) {
      listEl.innerHTML = '<p class="rv-comments-empty">Laden mislukt.</p>';
    }
  }

  function close() {
    track.querySelectorAll('video').forEach(v => v.pause());
    if (sourceVideo) {
      const reelCard = document.querySelector(`.hm-reel-card[data-index="${startIdx}"]`);
      if (reelCard) {
        sourceVideo.classList.remove('rv-media');
        sourceVideo.classList.add('hm-reel-media');
        sourceVideo.style.cssText = '';
        reelCard.insertBefore(sourceVideo, reelCard.firstChild);
      }
    }
    window.removeEventListener('resize', syncTrackSize);
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    overlay.remove();
  }

  // Build & position
  buildSlides();
  syncTrackSize();
  window.addEventListener('resize', syncTrackSize);

  const frameW = overlay.querySelector('.rv-frame')?.offsetWidth || window.innerWidth;
  track.style.transition = 'none';
  track.style.transform  = `translateX(-${startIdx * frameW}px)`;
  idx = startIdx;

  const startVid = track.querySelector(`#rv-slide-${startIdx} video`);
  if (startVid) { startVid.muted = true; startVid.play().catch(() => {}); }

  updateMeta();
  recordView();

  // Swipe
  overlay.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  overlay.addEventListener('touchend', e => {
    if (commentsEl.style.display !== 'none') return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) goTo(idx + (dx < 0 ? 1 : -1));
  }, { passive: true });

  // Keyboard
  const onKey = e => {
    if (e.key === 'Escape')      close();
    if (e.key === 'ArrowRight')  goTo(idx + 1);
    if (e.key === 'ArrowLeft')   goTo(idx - 1);
  };
  document.addEventListener('keydown', onKey);

  // Double-tap to like
  let lastTap = 0;
  overlay.querySelector('.rv-frame').addEventListener('click', e => {
    const now = Date.now();
    if (now - lastTap < 300) toggleLike();
    lastTap = now;
  });

  // Buttons
  overlay.querySelector('.rv-frame .rv-close').addEventListener('click', close);
  likeBtn.addEventListener('click', toggleLike);
  commentBtn.addEventListener('click', openComments);
  deleteBtn.addEventListener('click', deleteCurrentItem);
  overlay.querySelector('#rv-comments-close').addEventListener('click', () => { commentsEl.style.display = 'none'; });

  overlay.querySelector('#rv-comment-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const input = overlay.querySelector('#rv-comment-input');
    const body  = input.value.trim();
    if (!body) return;
    try {
      await api(`/api/social/media/${list[idx].id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      list[idx].comment_count = (list[idx].comment_count || 0) + 1;
      overlay.querySelector('#rv-comment-count').textContent = list[idx].comment_count;
      input.value = '';
      openComments();
    } catch (_) {}
  });
}
