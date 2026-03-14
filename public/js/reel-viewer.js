/**
 * Shared fullscreen portrait media viewer (TikTok-style).
 *
 * openReelViewer(items, startIdx, options)
 *   items      — array of media objects { id, file_path, file_type, caption,
 *                  like_count, comment_count, view_count, liked_by_me }
 *   startIdx   — index to open at
 *   options    — {
 *     sourceVideo: HTMLVideoElement | null       — already-playing video to reuse
 *     onDelete:   async (item) => boolean        — called when user deletes; return true to confirm removal from list
 *     canDelete:  (item) => boolean              — whether to show delete button for an item
 *     fetchMore:  async (offset) => item[]       — load more items when near the end; return [] when exhausted
 *   }
 *
 * Behaviour:
 *   - When fetchMore is provided and user is within 2 slides of the end, more items are loaded.
 *   - Once all items are loaded (fetchMore returns []), swiping past the last item wraps back to the first.
 */
import { api, state, showToast } from './app.js';

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function openReelViewer(items, startIdx = 0, options = {}) {
  const { sourceVideo = null, onDelete = null, canDelete = null, fetchMore = null, canRevertBlur = null, onClose = null } = options;

  // Work on a mutable copy so deletions don't affect the caller's array
  let list        = [...items];
  let idx         = startIdx;
  let touchStartX = 0;
  let touchStartY = 0;
  let allLoaded   = !fetchMore;   // true when no more items to fetch
  let loadingMore = false;

  // Blur editor state
  let blurMode       = false;
  let selectedStyle  = 'blur';
  let detectedFaces  = [];
  let blurCanvas     = null;
  let blurLoading    = false;

  const overlay = document.createElement('div');
  overlay.className = 'rv-overlay';
  overlay.innerHTML = `
    <div class="rv-bg" id="rv-bg"></div>

    <div class="rv-frame">
      <button class="rv-close" aria-label="Sluiten">✕</button>
      <div class="rv-track" id="rv-track"></div>
    </div>

    <div class="rv-style-picker" id="rv-style-picker">
      <button class="rv-style-btn rv-style-btn--active" data-style="blur" title="Blur">🙈</button>
      <button class="rv-style-btn" data-style="pixel" title="Pixel">🔲</button>
      <button class="rv-style-btn" data-style="heart" title="Hart">❤️</button>
      <button class="rv-style-btn" data-style="smile" title="Smile">😊</button>
      <button class="rv-style-btn" data-style="star" title="Ster">⭐</button>
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
      <button class="rv-revert-btn" id="rv-revert" style="display:none" title="Blur editor">🙈</button>
      <button class="rv-mute-btn" id="rv-mute" style="display:none" title="Geluid aan/uit">🔊</button>
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
  const revertBtn  = overlay.querySelector('#rv-revert');
  const muteBtn    = overlay.querySelector('#rv-mute');
  const stylePicker = overlay.querySelector('#rv-style-picker');
  let isMuted = false; // standaard: geluid aan

  /* ─── Blur editor ─────────────────────────────────────────────────────── */

  function positionStylePicker() {
    const btnRect     = revertBtn.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    stylePicker.style.top       = (btnRect.top - overlayRect.top + btnRect.height / 2) + 'px';
    stylePicker.style.right     = (overlayRect.right - btnRect.left + 8) + 'px';
    stylePicker.style.transform = 'translateX(80px) translateY(-50%)';
  }

  async function enterBlurMode(m) {
    if (!canRevertBlur || !canRevertBlur(m) || m.file_type !== 'image') return;
    blurMode = true;
    revertBtn.classList.add('rv-revert-btn--editing');
    revertBtn.title = 'Sluit blur-editor';
    overlay.classList.add('rv-blur-mode');
    positionStylePicker();
    stylePicker.classList.add('rv-style-picker--visible');

    const slide = track.querySelector(`#rv-slide-${idx}`);
    const img   = slide?.querySelector('img');
    if (!img) return;

    // Show loading state on canvas while detecting
    showCanvasLoading(slide, img);

    try {
      const data = await api(`/api/social/media/${m.id}/detect-faces`);
      detectedFaces = data.faces || [];
      renderFaceOverlays(slide, img, detectedFaces, data.blurRegions || [], !!data.debugOverlay);
      if (!data.debugOverlay) showToast('Tik op een gezicht om te blurren of ontblurren', 'info');
    } catch (err) {
      removeBlurCanvas();
      showToast('Gezichtsdetectie mislukt', 'error');
      exitBlurMode();
    }
  }

  function exitBlurMode() {
    blurMode = false;
    revertBtn.classList.remove('rv-revert-btn--editing');
    revertBtn.title = 'Blur editor';
    overlay.classList.remove('rv-blur-mode');
    stylePicker.classList.remove('rv-style-picker--visible');
    removeBlurCanvas();
    detectedFaces = [];
  }

  function removeBlurCanvas() {
    if (blurCanvas) { blurCanvas.remove(); blurCanvas = null; }
  }

  function showCanvasLoading(slide, img) {
    removeBlurCanvas();
    const c = document.createElement('canvas');
    c.className = 'rv-face-canvas rv-face-canvas--loading';
    slide.appendChild(c);
    c.width  = c.offsetWidth  || img.offsetWidth;
    c.height = c.offsetHeight || img.offsetHeight;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(c.height * 0.035)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Gezichten detecteren…', c.width / 2, c.height / 2);
    blurCanvas = c;
  }

  function renderFaceOverlays(slide, img, faces, blurRegions, debugOverlay = false) {
    removeBlurCanvas();

    const doRender = () => {
      const c = document.createElement('canvas');
      c.className = 'rv-face-canvas';
      slide.appendChild(c);
      c.width  = c.offsetWidth  || img.offsetWidth;
      c.height = c.offsetHeight || img.offsetHeight;
      blurCanvas = c;

      const ctx    = c.getContext('2d');
      const natW   = img.naturalWidth  || img.offsetWidth;
      const natH   = img.naturalHeight || img.offsetHeight;
      const canW   = c.width;
      const canH   = c.height;
      // object-fit: cover scale + offsets
      const scale  = Math.max(canW / natW, canH / natH);
      const xOff   = (natW * scale - canW) / 2;
      const yOff   = (natH * scale - canH) / 2;

      function toCanvas(ix, iy) {
        return [ix * scale - xOff, iy * scale - yOff];
      }

      function isFaceBlurred(face) {
        const fx = face.x + face.width  / 2;
        const fy = face.y + face.height / 2;
        return blurRegions.some(r => {
          const rx = r.x + r.width  / 2;
          const ry = r.y + r.height / 2;
          return Math.hypot(fx - rx, fy - ry) < Math.max(face.width, face.height) * 0.45;
        });
      }

      if (faces.length === 0) {
        // Only show "no faces" message in debug mode; in production silently do nothing
        if (debugOverlay) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(0, 0, canW, canH);
          ctx.fillStyle = '#fff';
          ctx.font      = `${Math.round(canH * 0.03)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Geen gezichten gevonden', canW / 2, canH / 2);
        }
        return;
      }

      if (debugOverlay) {
        const EXPAND = 0.25;
        faces.forEach((face) => {
          const blurred = isFaceBlurred(face);
          const padX = face.width  * EXPAND;
          const padY = face.height * EXPAND;
          const fx = face.x - padX;
          const fy = face.y - padY;
          const fw = face.width  + padX * 2;
          const fh = face.height + padY * 2;

          const [cx, cy] = toCanvas(fx + fw / 2, fy + fh / 2);
          const rx = (fw / 2) * scale;
          const ry = (fh / 2) * scale;

          ctx.beginPath();
          ctx.ellipse(cx, cy, Math.max(3, rx), Math.max(3, ry), 0, 0, Math.PI * 2);
          ctx.fillStyle   = blurred ? 'rgba(231,76,60,0.28)' : 'rgba(46,204,113,0.22)';
          ctx.strokeStyle = blurred ? 'rgba(231,76,60,0.9)'  : 'rgba(46,204,113,0.9)';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Status dot at the top of the ellipse
          const dotR = Math.max(6, Math.round(ry * 0.16));
          ctx.beginPath();
          ctx.arc(cx, cy - ry + dotR + 2, dotR, 0, Math.PI * 2);
          ctx.fillStyle = blurred ? '#e74c3c' : '#2ecc71';
          ctx.fill();
        });
      }

      // Click: find nearest face and toggle (always active regardless of debug)
      c.addEventListener('click', async (e) => {
        e.stopPropagation(); // prevent double-tap-to-like on the frame
        if (blurLoading) return;
        const rect   = c.getBoundingClientRect();
        const canvasX = (e.clientX - rect.left) * (c.width  / rect.width);
        const canvasY = (e.clientY - rect.top)  * (c.height / rect.height);
        const imgX   = (canvasX + xOff) / scale;
        const imgY   = (canvasY + yOff) / scale;

        let bestIdx  = -1;
        let bestDist = Infinity;
        faces.forEach((face, i) => {
          const d = Math.hypot(imgX - (face.x + face.width / 2), imgY - (face.y + face.height / 2));
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        });
        if (bestIdx === -1) return;

        const m = list[idx];
        blurLoading = true;
        c.style.cursor = 'wait';

        // Show loading spinner on the slide (always, regardless of debugOverlay)
        const slide2 = track.querySelector(`#rv-slide-${idx}`);
        let spinner = slide2?.querySelector('.rv-blur-spinner');
        if (!spinner && slide2) {
          spinner = document.createElement('div');
          spinner.className = 'rv-blur-spinner';
          slide2.appendChild(spinner);
        }

        if (debugOverlay) {
          // Dim the selected face while loading (debug only)
          ctx.beginPath();
          const face   = faces[bestIdx];
          const EXPAND2 = 0.25;
          const [cbx, cby] = toCanvas(
            face.x + face.width  / 2,
            face.y + face.height / 2
          );
          ctx.ellipse(cbx, cby, (face.width / 2 + face.width * EXPAND2) * scale, (face.height / 2 + face.height * EXPAND2) * scale, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fill();
        }

        try {
          const data = await api(`/api/social/media/${m.id}/toggle-face-blur`, {
            method: 'POST',
            body: JSON.stringify({ faceIndex: bestIdx, style: selectedStyle }),
          });
          if (data.ok) {
            // Reload image from server (no cache-buster needed — Nginx sends no-cache)
            const imgEl = slide.querySelector('img');
            if (imgEl) imgEl.src = m.file_path.split('?')[0] + '?t=' + Date.now();
            // Reset file_path to clean path (strip any previous cache-buster)
            m.file_path = m.file_path.split('?')[0];
            // Redraw overlays with updated regions
            blurRegions = data.regions || [];
            renderFaceOverlays(slide, imgEl || img, faces, blurRegions, debugOverlay);
            // Update blur state on item
            m._blurred = blurRegions.length > 0;
            updateRevertBtn(m);
          }
        } catch (err) {
          showToast('Actie mislukt', 'error');
          if (debugOverlay) renderFaceOverlays(slide, img, faces, blurRegions, debugOverlay);
        } finally {
          blurLoading = false;
          c.style.cursor = 'crosshair';
          spinner?.remove();
        }
      });
    };

    if (img.complete && img.naturalWidth) {
      doRender();
    } else {
      img.addEventListener('load', doRender, { once: true });
    }
  }

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
        vid.muted = isMuted;
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

  // Append new slides to track without full rebuild (avoids disrupting current video)
  function appendSlides(newItems) {
    const frame = overlay.querySelector('.rv-frame');
    const w = frame ? frame.offsetWidth  : window.innerWidth;
    const h = frame ? frame.offsetHeight : window.innerHeight;
    const startI = list.length;
    list.push(...newItems);
    newItems.forEach((m, j) => {
      const i     = startI + j;
      const slide = document.createElement('div');
      slide.className  = 'rv-slide';
      slide.dataset.i  = i;
      slide.id         = `rv-slide-${i}`;
      slide.style.width  = w + 'px';
      slide.style.height = h + 'px';
      if (m.file_type !== 'video') {
        slide.innerHTML = `<img class="rv-media" src="${esc(m.file_path)}" alt="" loading="lazy" />`;
      } else {
        const vid = document.createElement('video');
        vid.src = m.file_path; vid.loop = true; vid.muted = isMuted; vid.playsInline = true;
        vid.className = 'rv-media';
        slide.appendChild(vid);
      }
      track.appendChild(slide);
    });
    track.style.width = (w * list.length) + 'px';
  }

  // Trigger background load when within 2 items of the end
  function maybeLoadMore() {
    if (allLoaded || loadingMore || !fetchMore) return;
    if (idx < list.length - 2) return;
    loadingMore = true;
    fetchMore(list.length).then(more => {
      if (!more || more.length === 0) {
        allLoaded = true;
      } else {
        appendSlides(more);
      }
      loadingMore = false;
    }).catch(() => { loadingMore = false; });
  }

  function goTo(i, animate = true) {
    // Exit blur editor when navigating away
    if (blurMode) exitBlurMode();
    // Infinite wrap-around once all items are loaded
    if (allLoaded && list.length > 0) {
      if (i >= list.length) i = 0;
      else if (i < 0) i = list.length - 1;
    }
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
      if (si === i) { v.muted = isMuted; v.currentTime = 0; v.loop = true; v.play().catch(() => {}); }
      else          { v.pause(); v.currentTime = 0; }
    });

    updateMeta();
    recordView();
    maybeLoadMore();
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

    // Show/hide mute button — only for videos
    muteBtn.style.display = m.file_type === 'video' ? 'flex' : 'none';

    // Show/hide revert-blur button — only for image items the uploader can manage
    revertBtn.style.display = 'none';
    if (canRevertBlur && canRevertBlur(m) && m.file_type === 'image') {
      // Async check: does a .orig backup exist for this item?
      fetch(`/api/social/media/${m.id}/has-original`, {
        headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
      }).then(r => r.json()).then(data => {
        // Only show if this is still the active item and team has (or had) anon members
        if (list[idx]?.id === m.id && (data.teamHasAnon || data.hasOriginal)) {
          m._blurred    = data.hasOriginal;
          m._teamHasAnon = data.teamHasAnon;
          updateRevertBtn(m);
        }
      }).catch(() => {});
    }
  }

  function updateRevertBtn(m) {
    if (canRevertBlur && canRevertBlur(m) && m.file_type === 'image' && m._blurred !== undefined
        && (m._teamHasAnon || m._blurred)) {
      revertBtn.style.display = 'flex';
      revertBtn.textContent = '🙈';
      if (blurMode) {
        revertBtn.title = 'Sluit blur-editor';
        revertBtn.classList.remove('rv-revert-btn--faded');
      } else if (m._blurred) {
        revertBtn.title = 'Blur editor openen';
        revertBtn.classList.remove('rv-revert-btn--faded');
      } else {
        revertBtn.title = 'Blur editor openen';
        revertBtn.classList.add('rv-revert-btn--faded');
      }
    } else {
      revertBtn.style.display = 'none';
    }
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

  async function revertCurrentBlur() {
    const m = list[idx];
    if (!blurMode) {
      // Enter blur editor mode
      await enterBlurMode(m);
    } else {
      // Exit blur editor mode
      exitBlurMode();
      // Re-sync button state from server after any changes made in editor
      refreshRevertState(m);
    }
  }

  function refreshRevertState(m) {
    if (!canRevertBlur || !canRevertBlur(m) || m.file_type !== 'image') return;
    fetch(`/api/social/media/${m.id}/has-original`, {
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
    }).then(r => r.json()).then(data => {
      if (list[idx]?.id !== m.id) return; // user swiped away
      m._blurred    = data.hasOriginal;
      m._teamHasAnon = data.teamHasAnon;
      updateRevertBtn(m);
    }).catch(() => {});
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
    if (blurMode) exitBlurMode();
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
    if (onClose) onClose(list);
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
  if (startVid) { startVid.muted = isMuted; startVid.play().catch(() => {}); }

  updateMeta();
  recordView();

  // Klik op video → pause/resume toggle (not in blur mode)
  track.addEventListener('click', e => {
    if (blurMode) return;
    const vid = e.target.closest('.rv-slide')?.querySelector('video');
    if (!vid) return;
    if (vid.paused) { vid.play().catch(() => {}); }
    else            { vid.pause(); }
  });

  // Swipe
  overlay.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  overlay.addEventListener('touchend', e => {
    if (commentsEl.style.display !== 'none') return;
    if (blurMode) return; // swipe disabled in blur editor
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

  // Double-tap to like (disabled in blur mode)
  let lastTap = 0;
  overlay.querySelector('.rv-frame').addEventListener('click', e => {
    if (blurMode) return;
    const now = Date.now();
    if (now - lastTap < 300) toggleLike();
    lastTap = now;
  });

  // Style picker — set active style when a button is clicked
  stylePicker.querySelectorAll('.rv-style-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      selectedStyle = btn.dataset.style;
      stylePicker.querySelectorAll('.rv-style-btn').forEach(b => b.classList.remove('rv-style-btn--active'));
      btn.classList.add('rv-style-btn--active');
    });
  });

  // Buttons
  overlay.querySelector('.rv-frame .rv-close').addEventListener('click', close);
  likeBtn.addEventListener('click', toggleLike);
  commentBtn.addEventListener('click', openComments);
  deleteBtn.addEventListener('click', deleteCurrentItem);
  revertBtn.addEventListener('click', revertCurrentBlur);
  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    muteBtn.textContent = isMuted ? '🔇' : '🔊';
    muteBtn.title = isMuted ? 'Geluid aan' : 'Geluid uit';
    track.querySelectorAll('video').forEach(v => { v.muted = isMuted; });
  });
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
