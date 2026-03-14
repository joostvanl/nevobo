import { api, state, renderAvatar, showToast, navigate } from '../app.js';
import { openReelViewer } from '../reel-viewer.js';

export async function render(container) {
  container.innerHTML = '<div class="spinner"></div>';

  const user = state.user;
  if (!user) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <p>Log in om je profiel te bekijken.</p>
      </div>`;
    return;
  }

  try {
    const [meData, clubsData] = await Promise.all([
      api('/api/auth/me'),
      api('/api/clubs'),
    ]);

    const me = meData.user;
    const badges = meData.badges?.filter(b => b.earned_at) || [];
    const clubs = clubsData.clubs || [];
    const nextLevel = meData.nextLevel;
    const currentLevel = meData.currentLevel;
    const xpProgress = nextLevel && currentLevel
      ? Math.min(100, Math.round(((me.xp - currentLevel.xp_required) / (nextLevel.xp_required - currentLevel.xp_required)) * 100))
      : 100;

    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <div style="display:flex;align-items:center;gap:1rem">
            <div id="avatar-wrap" style="position:relative;cursor:pointer;flex-shrink:0" title="Profielfoto wijzigen">
              ${renderAvatar(me.name, me.avatar_url, 'lg')}
              <div style="position:absolute;bottom:0;right:0;background:var(--primary);border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;border:2px solid #fff">📷</div>
            </div>
            <div style="flex:1;min-width:0">
              <h1 style="color:#fff;font-size:1.4rem;margin:0">${esc(me.name)}</h1>
              <div style="display:flex;gap:0.5rem;margin-top:0.35rem;flex-wrap:wrap">
                <span class="chip" style="background:rgba(255,255,255,0.2);color:#fff">Level ${me.level}</span>
                <span class="chip" style="background:rgba(255,255,255,0.2);color:#fff">${me.xp} XP</span>
                ${me.anonymous_mode ? `<span class="chip" style="background:rgba(255,255,255,0.2);color:#fff">👤 Anoniem</span>` : ''}
              </div>
            </div>
            <button id="edit-profile-btn" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:50%;width:36px;height:36px;font-size:1rem;cursor:pointer;flex-shrink:0" title="Profiel bewerken">✏️</button>
          </div>
        </div>
      </div>

      <div class="container" style="padding-bottom:5rem">

        <!-- Action row: admin + logout -->
        <div style="display:flex;gap:0.75rem;margin-top:1rem;margin-bottom:1rem">
          ${me.roles?.length > 0 ? `
            <button class="btn btn-secondary" style="flex:1;display:flex;align-items:center;justify-content:center;gap:0.5rem" id="admin-btn">
              ⚙️ Gebruikersbeheer
            </button>` : ''}
          <button class="btn btn-secondary" style="flex:1" id="logout-btn">Uitloggen</button>
        </div>

        <!-- Media section -->
        <div class="section">
          <div class="section-header">
            <span class="section-title">📸 Mijn media</span>
          </div>
          <div id="my-media-grid"><div class="spinner"></div></div>
        </div>

        <!-- Leaderboard -->
        ${me.club_id ? `
          <div class="section">
            <div class="section-header"><span class="section-title">🏅 Ranglijst club</span></div>
            <div id="leaderboard"><div class="spinner"></div></div>
          </div>` : ''}

        <!-- Badges & XP -->
        <div class="section">
          <div class="section-header">
            <span class="section-title">⚡ XP & Badges</span>
            <button class="btn btn-ghost btn-sm" onclick="navigate('badges')">Alles →</button>
          </div>
          <div class="card">
            <div class="card-body">
              <div class="xp-bar-header" style="display:flex;justify-content:space-between;margin-bottom:0.4rem">
                <span style="font-size:0.85rem;font-weight:700">${currentLevel?.label || 'Niveau ' + me.level}</span>
                ${nextLevel ? `<span class="text-muted" style="font-size:0.78rem">${nextLevel.xp_required - me.xp} XP nodig</span>` : ''}
              </div>
              <div class="xp-bar-track"><div class="xp-bar-fill" id="xp-fill" style="width:0%"></div></div>
              ${badges.length > 0 ? `
                <div class="scroll-x" style="margin-top:1rem">
                  ${badges.map(b => `
                    <div style="display:flex;flex-direction:column;align-items:center;gap:0.25rem;min-width:56px">
                      <div style="font-size:1.75rem">${b.icon_emoji}</div>
                      <span style="font-size:0.6rem;font-weight:700;text-align:center;color:var(--text-muted)">${b.label}</span>
                    </div>`).join('')}
                </div>` : `<p class="text-muted text-small" style="margin-top:0.75rem">Nog geen badges verdiend.</p>`}
            </div>
          </div>
        </div>

        <!-- Privacy & Legal -->
        <div class="section">
          <div class="card">
            <div class="card-body" style="padding:0">
              <button class="btn btn-ghost" style="width:100%;text-align:left;padding:0.85rem 1rem;border-radius:var(--radius);display:flex;align-items:center;justify-content:space-between"
                id="privacy-link-btn">
                <span>🔒 Privacy & AVG (GDPR)</span>
                <span style="font-size:0.8rem;color:var(--text-muted)">→</span>
              </button>
            </div>
          </div>
        </div>

      </div>`;

    // Animate XP bar
    setTimeout(() => {
      const fill = document.getElementById('xp-fill');
      if (fill) fill.style.width = xpProgress + '%';
    }, 100);

    // Load media grid
    loadMyMedia(me.id, container);

    // Load leaderboard
    if (me.club_id) loadLeaderboard(me.club_id, me.id);

    // Admin button
    document.getElementById('admin-btn')?.addEventListener('click', () => navigate('admin'));

    // Privacy
    document.getElementById('privacy-link-btn')?.addEventListener('click', () => navigate('privacy'));

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      localStorage.removeItem('vb_token');
      localStorage.removeItem('vb_user');
      state.token = null;
      state.user = null;
      window.location.reload();
    });

    // Edit profile overlay
    document.getElementById('edit-profile-btn')?.addEventListener('click', () => {
      showEditOverlay(me, clubs, container);
    });

    // Avatar click → upload new profile photo
    document.getElementById('avatar-wrap')?.addEventListener('click', () => {
      showAvatarPicker(me, container);
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

/* ─── Media grid ─────────────────────────────────────────────────────────── */
async function loadMyMedia(userId, container) {
  const el = document.getElementById('my-media-grid');
  if (!el) return;

  const PAGE_SIZE = 9;
  let allItems = [];
  let currentPage = 0;

  function renderPage(page) {
    currentPage = page;
    const start = page * PAGE_SIZE;
    const pageItems = allItems.slice(start, start + PAGE_SIZE);
    const totalPages = Math.ceil(allItems.length / PAGE_SIZE);

    el.innerHTML = `
      <div class="prof-media-grid">
        ${pageItems.map((m, i) => `
          <div class="prof-media-item" data-idx="${i}" data-abs="${start + i}">
            ${m.file_type === 'video'
              ? `<video src="${esc(m.file_path)}" muted playsinline preload="metadata" class="prof-media-thumb"></video>
                 <span class="prof-media-type-icon">▶</span>`
              : `<img src="${esc(m.file_path)}" class="prof-media-thumb" loading="lazy" />`}
          </div>`).join('')}
      </div>
      ${totalPages > 1 ? `
        <div class="prof-media-pagination">
          <button class="btn btn-secondary btn-sm" id="pm-prev" ${page === 0 ? 'disabled' : ''}>‹ Vorige</button>
          <span class="text-muted text-small">${page + 1} / ${totalPages}</span>
          <button class="btn btn-secondary btn-sm" id="pm-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Volgende ›</button>
        </div>` : ''}`;

    el.querySelector('#pm-prev')?.addEventListener('click', () => { renderPage(page - 1); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    el.querySelector('#pm-next')?.addEventListener('click', () => { renderPage(page + 1); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

    el.querySelectorAll('.prof-media-item').forEach(card => {
      card.addEventListener('click', () => {
        const absIdx = parseInt(card.dataset.abs);
        openReelViewer(allItems, absIdx, {
          canDelete:     () => true,
          canRevertBlur: (m) => m.file_type === 'image',
          onDelete: async (m) => {
            await api(`/api/social/media/${m.id}`, { method: 'DELETE' });
            showToast('Verwijderd', 'success');
            allItems = allItems.filter(x => x.id !== m.id);
            // Stay on same page, or go back if page is now empty
            const newPage = currentPage > 0 && currentPage * PAGE_SIZE >= allItems.length
              ? currentPage - 1 : currentPage;
            if (!allItems.length) {
              el.innerHTML = `<div class="card"><div class="card-body"><p class="text-muted text-small">Je hebt nog geen media geplaatst.</p></div></div>`;
            } else {
              renderPage(newPage);
            }
            return true;
          },
          onClose: (updatedList) => {
            // Sync blur changes back into allItems and refresh thumbnails
            updatedList.forEach((item) => {
              const orig = allItems.find(x => x.id === item.id);
              if (orig) orig.file_path = item.file_path;
            });
            const start2 = currentPage * PAGE_SIZE;
            el.querySelectorAll('.prof-media-item').forEach((card2) => {
              const abs = parseInt(card2.dataset.abs);
              const item = allItems[abs];
              if (!item || item.file_type !== 'image') return;
              const img = card2.querySelector('img.prof-media-thumb');
              if (img) img.src = item.file_path.split('?')[0] + '?t=' + Date.now();
            });
          },
        });
      });
    });
  }

  try {
    const data = await api(`/api/social/my-media`);
    allItems = data.media || [];
    if (!allItems.length) {
      el.innerHTML = `<div class="card"><div class="card-body"><p class="text-muted text-small">Je hebt nog geen media geplaatst.</p></div></div>`;
      return;
    }
    allItems.forEach(m => {
      m.like_count    = m.like_count    || 0;
      m.comment_count = m.comment_count || 0;
      m.view_count    = m.view_count    || 0;
      m.liked_by_me   = false;
    });
    renderPage(0);
  } catch (_) {
    el.innerHTML = `<div class="card"><div class="card-body"><p class="text-muted text-small">Media kon niet worden geladen.</p></div></div>`;
  }
}

/* ─── Edit profile overlay ───────────────────────────────────────────────── */
function showEditOverlay(me, clubs, container) {
  const memberships = me.memberships || [];

  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:420px;max-height:90vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <h3 style="margin:0">Profiel bewerken</h3>
        <button id="edit-close" style="background:none;border:none;font-size:1.25rem;cursor:pointer;color:var(--text-muted)">✕</button>
      </div>

      <!-- Name & club -->
      <form id="profile-form">
        <div class="form-group">
          <label class="form-label">Naam</label>
          <input type="text" id="prof-name" class="form-input" value="${esc(me.name)}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Primaire club</label>
          <select class="form-select" id="prof-club">
            <option value="">— Geen club —</option>
            ${clubs.map(c => `<option value="${c.id}" ${c.id === me.club_id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>

        <!-- Privacy / anonymous mode -->
        <div class="form-group" style="background:rgba(0,0,0,0.03);border-radius:10px;padding:0.85rem;border:1px solid var(--border)">
          <label style="display:flex;align-items:flex-start;gap:0.75rem;cursor:pointer">
            <input type="checkbox" id="prof-anonymous" style="width:18px;height:18px;margin-top:2px;accent-color:var(--primary);flex-shrink:0" ${me.anonymous_mode ? 'checked' : ''} />
            <div>
              <div style="font-weight:700;font-size:0.9rem">👤 Ik wil anoniem blijven</div>
              <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.2rem;line-height:1.4">
                Je gezicht wordt automatisch vervaagd in foto's en video's die anderen posten. Hiervoor maken we een eenmalige herkenningsfoto.
              </div>
            </div>
          </label>
          <div id="face-ref-section" style="margin-top:0.85rem;display:${me.anonymous_mode ? 'block' : 'none'}">
            <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.3rem;color:var(--text)">
              📸 Herkenningsfoto's
              <span style="font-weight:400;color:var(--text-muted);font-size:0.72rem"> — max. 5, meer hoeken = betere herkenning</span>
            </div>
            <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.6rem;line-height:1.4">
              Voeg foto's toe van jezelf vanuit verschillende hoeken (recht vooraan, zijkant, licht). Ze worden alleen gebruikt om je gezicht te herkennen en nooit gedeeld.
            </p>
            <div id="face-refs-grid" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:0.7rem;min-height:16px"></div>
            <div class="flex gap-2">
              <button type="button" class="btn btn-secondary btn-sm" style="flex:1" id="face-camera-btn">📷 Camera</button>
              <button type="button" class="btn btn-secondary btn-sm" style="flex:1" id="face-upload-btn">📁 Uploaden</button>
            </div>
            <div id="face-upload-status" style="margin-top:0.5rem;font-size:0.78rem"></div>
          </div>
        </div>

        <button type="submit" class="btn btn-primary btn-block" id="prof-save" style="margin-top:0.75rem">Opslaan</button>
      </form>

      <hr style="margin:1.25rem 0;border:none;border-top:1px solid var(--border)" />

      <!-- Add club -->
      <div style="font-weight:700;font-size:0.9rem;margin-bottom:0.75rem">🏐 Club toevoegen</div>
      <form id="club-form">
        <div class="form-group">
          <label class="form-label">Clubnaam</label>
          <input type="text" id="club-name" class="form-input" placeholder="bijv. VTC Woerden" required />
        </div>
        <div class="form-group">
          <label class="form-label">Nevobo-code</label>
          <div class="flex gap-2">
            <input type="text" id="club-code" class="form-input" placeholder="bijv. ckl9x7n" required style="flex:1;text-transform:lowercase" />
            <button type="button" class="btn btn-secondary" id="validate-code-btn" title="Code valideren">✓</button>
          </div>
          <p class="form-hint" id="code-hint">Voer de Nevobo-code in en klik ✓ om te valideren</p>
        </div>
        <div style="background:rgba(33,150,243,0.07);border-radius:var(--radius);padding:0.75rem;margin-bottom:0.75rem;border:1px solid rgba(33,150,243,0.2);font-size:0.78rem;color:var(--text-muted)">
          Ga naar <a href="https://www.volleybal.nl" target="_blank" style="color:var(--accent)">volleybal.nl</a>, zoek je club, klik Programma → RSS Feed. De code staat in de URL: <code>/vereniging/<strong>ckl9x7n</strong>/</code>
        </div>
        <div class="form-group">
          <label class="form-label">Regio</label>
          <select class="form-select" id="club-region">
            <option value="">— Optioneel —</option>
            <option>regio-noord</option><option>regio-oost</option><option>regio-west</option>
            <option>regio-zuid</option><option>nationale-competitie</option>
          </select>
        </div>
        <button type="submit" class="btn btn-secondary btn-block" id="club-save">Club toevoegen</button>
      </form>
    </div>`;

  document.body.appendChild(overlay);

  // Close
  overlay.querySelector('#edit-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Toggle face-ref section when anonymous checkbox changes
  overlay.querySelector('#prof-anonymous').addEventListener('change', function () {
    overlay.querySelector('#face-ref-section').style.display = this.checked ? 'block' : 'none';
  });

  // Load and render existing face references
  loadFaceRefs(overlay);

  // Face reference: camera
  overlay.querySelector('#face-camera-btn')?.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'user'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files?.[0]; inp.remove();
      if (f) uploadFaceRef(f, overlay);
    });
    inp.click();
  });

  // Face reference: file upload
  overlay.querySelector('#face-upload-btn')?.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files?.[0]; inp.remove();
      if (f) uploadFaceRef(f, overlay);
    });
    inp.click();
  });

  // Profile form
  overlay.querySelector('#profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = overlay.querySelector('#prof-save');
    btn.disabled = true; btn.textContent = 'Opslaan…';
    try {
      await api('/api/auth/profile', {
        method: 'PATCH',
        body: {
          name: overlay.querySelector('#prof-name').value,
          club_id: overlay.querySelector('#prof-club').value || null,
          anonymous_mode: overlay.querySelector('#prof-anonymous').checked,
        },
      });
      const meRefresh = await api('/api/auth/me');
      state.user = meRefresh.user;
      localStorage.setItem('vb_user', JSON.stringify(state.user));
      showToast('Profiel opgeslagen! ✅', 'success');
      overlay.remove();
      render(container);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Opslaan';
    }
  });

  // Club form
  overlay.querySelector('#club-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = overlay.querySelector('#club-save');
    btn.disabled = true; btn.textContent = 'Bezig…';
    try {
      await api('/api/clubs', {
        method: 'POST',
        body: {
          name: overlay.querySelector('#club-name').value,
          nevobo_code: overlay.querySelector('#club-code').value.trim().toLowerCase(),
          region: overlay.querySelector('#club-region').value,
        },
      });
      showToast('Club toegevoegd! 🏐', 'success');
      overlay.remove();
      setTimeout(() => render(container), 500);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Club toevoegen';
    }
  });

  // Validate Nevobo code
  overlay.querySelector('#validate-code-btn').addEventListener('click', async () => {
    const code = overlay.querySelector('#club-code').value.trim();
    const hint = overlay.querySelector('#code-hint');
    const btn  = overlay.querySelector('#validate-code-btn');
    if (!code) { showToast('Voer een code in', 'error'); return; }
    btn.disabled = true; btn.textContent = '⏳';
    hint.textContent = 'Controleren…'; hint.style.color = 'var(--text-muted)';
    try {
      await api('/api/nevobo/validate', { method: 'POST', body: { code } });
      hint.textContent = '✅ Geldige code!'; hint.style.color = 'var(--success)';
      btn.textContent = '✓';
    } catch (err) {
      hint.textContent = '❌ Ongeldige code'; hint.style.color = 'var(--danger)';
      btn.textContent = '✗';
    } finally {
      btn.disabled = false;
    }
  });

  overlay.querySelector('#club-code').addEventListener('input', function () { this.value = this.value.toLowerCase(); });
}

/* ─── Avatar picker ─────────────────────────────────────────────────────── */
function showAvatarPicker(me, container) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:320px;text-align:center">
      <h3 style="margin-bottom:0.5rem">Profielfoto</h3>
      ${me.avatar_url ? `<img src="${esc(me.avatar_url)}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0 auto 1rem;display:block;border:3px solid var(--primary)" />` : ''}
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:1rem">Kies een nieuwe profielfoto</p>
      <div class="flex gap-2 mb-2">
        <button class="btn btn-secondary" style="flex:1" id="av-camera">📷 Camera</button>
        <button class="btn btn-secondary" style="flex:1" id="av-upload">📁 Galerij</button>
      </div>
      <button class="btn btn-ghost btn-sm" style="width:100%" id="av-cancel">Annuleren</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#av-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const doUpload = async (file) => {
    showToast('Uploaden…', '');
    const fd = new FormData();
    fd.append('avatar', file);
    const token = state.token || localStorage.getItem('vb_token');
    try {
      const res = await fetch('/api/auth/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      state.user = data.user;
      localStorage.setItem('vb_user', JSON.stringify(state.user));
      showToast('Profielfoto bijgewerkt! 🎉', 'success');
      render(container);
    } catch (err) { showToast(err.message || 'Upload mislukt', 'error'); }
  };

  overlay.querySelector('#av-camera').addEventListener('click', () => {
    overlay.remove();
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'user'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => { const f = inp.files?.[0]; inp.remove(); if (f) doUpload(f); });
    inp.click();
  });

  overlay.querySelector('#av-upload').addEventListener('click', () => {
    overlay.remove();
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => { const f = inp.files?.[0]; inp.remove(); if (f) doUpload(f); });
    inp.click();
  });
}

/* ─── Face reference management ──────────────────────────────────────────── */

async function loadFaceRefs(editOverlay) {
  const grid = editOverlay.querySelector('#face-refs-grid');
  if (!grid) return;
  try {
    const token = state.token || localStorage.getItem('vb_token');
    const data  = await fetch('/api/auth/face-references', {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());
    const refs = data.refs || [];
    renderFaceRefsGrid(refs, grid, editOverlay);
    const maxed = refs.length >= 5;
    const camBtn = editOverlay.querySelector('#face-camera-btn');
    const upBtn  = editOverlay.querySelector('#face-upload-btn');
    if (camBtn) camBtn.disabled = maxed;
    if (upBtn)  upBtn.disabled  = maxed;
  } catch (_) {}
}

function renderFaceRefsGrid(refs, grid, editOverlay) {
  if (!refs.length) {
    grid.innerHTML = `<span style="font-size:0.75rem;color:var(--text-muted)">Nog geen foto's — voeg er minimaal 1 toe</span>`;
    return;
  }
  grid.innerHTML = refs.map(r => `
    <div style="position:relative;width:60px;height:60px" data-ref-id="${r.id}">
      <img src="${r.file_path}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:2px solid var(--border)" />
      <button type="button" data-ref-id="${r.id}"
        style="position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:none;background:var(--danger);color:#fff;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">✕</button>
    </div>`).join('');

  grid.querySelectorAll('button[data-ref-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.refId;
      if (!confirm('Referentiefoto verwijderen?')) return;
      const token = state.token || localStorage.getItem('vb_token');
      try {
        const res = await fetch(`/api/auth/face-reference/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json());
        if (!res.ok) throw new Error(res.error);
        loadFaceRefs(editOverlay);
        showToast('Foto verwijderd', 'success');
      } catch (err) {
        showToast(err.message || 'Verwijderen mislukt', 'error');
      }
    });
  });
}

async function uploadFaceRef(file, editOverlay) {
  const statusEl = editOverlay.querySelector('#face-upload-status');
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted)">Analyseren…</span>';
  const fd = new FormData();
  fd.append('photo', file);
  const token = state.token || localStorage.getItem('vb_token');
  try {
    const res  = await fetch('/api/auth/face-reference', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json();
    if (!data.ok) {
      // Show quality issues with hints
      const hints = data.hints || [];
      const html = `
        <div style="background:rgba(220,53,69,0.08);border:1px solid rgba(220,53,69,0.25);border-radius:8px;padding:0.6rem 0.75rem;margin-top:0.25rem">
          <div style="font-weight:700;color:var(--danger);font-size:0.8rem;margin-bottom:0.35rem">⚠️ Foto afgekeurd</div>
          ${data.issues ? data.issues.map(i => `<div style="font-size:0.78rem;color:var(--danger)">• ${i}</div>`).join('') : `<div style="font-size:0.78rem;color:var(--danger)">• ${data.error}</div>`}
          ${hints.length ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.4rem;border-top:1px solid rgba(0,0,0,0.08);padding-top:0.35rem">
            💡 ${hints[0]}
          </div>` : ''}
        </div>`;
      if (statusEl) statusEl.innerHTML = html;
      return;
    }
    if (statusEl) statusEl.innerHTML = '';
    showToast('Herkenningsfoto toegevoegd ✅', 'success');
    loadFaceRefs(editOverlay);
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${err.message || 'Upload mislukt'}</span>`;
    showToast(err.message || 'Upload mislukt', 'error');
  }
}

/* ─── Leaderboard ────────────────────────────────────────────────────────── */
async function loadLeaderboard(clubId, myId) {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  try {
    const { users } = await api(`/api/gamification/leaderboard/${clubId}`);
    if (!users?.length) { el.innerHTML = '<p class="text-muted text-small">Nog geen spelers op de ranglijst.</p>'; return; }
    el.innerHTML = users.map((u, i) => {
      const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
      return `
        <div class="leaderboard-item" style="${u.id === myId ? 'border-color:var(--primary);background:rgba(255,87,34,0.03)' : ''}">
          <div class="leaderboard-rank">${rankIcon}</div>
          ${renderAvatar(u.name, u.avatar_url, 'sm')}
          <div style="flex:1">
            <div style="font-weight:700;font-size:0.9rem">${u.name}${u.id === myId ? ' <span class="chip chip-primary" style="font-size:0.65rem">Jij</span>' : ''}</div>
            <div class="text-muted text-small">Level ${u.level} · ${u.badge_count} badge${u.badge_count !== 1 ? 's' : ''}</div>
          </div>
          <div class="leaderboard-xp">${u.xp} XP</div>
        </div>`;
    }).join('');
  } catch (_) {
    el.innerHTML = '<p class="text-muted text-small">Ranglijst kon niet worden geladen.</p>';
  }
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

