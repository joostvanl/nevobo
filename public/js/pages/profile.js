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
            ${renderAvatar(me.name, me.avatar_url, 'lg')}
            <div style="flex:1;min-width:0">
              <h1 style="color:#fff;font-size:1.4rem;margin:0">${esc(me.name)}</h1>
              <div style="display:flex;gap:0.5rem;margin-top:0.35rem;flex-wrap:wrap">
                <span class="chip" style="background:rgba(255,255,255,0.2);color:#fff">Level ${me.level}</span>
                <span class="chip" style="background:rgba(255,255,255,0.2);color:#fff">${me.xp} XP</span>
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

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

/* ─── Media grid ─────────────────────────────────────────────────────────── */
async function loadMyMedia(userId, container) {
  const el = document.getElementById('my-media-grid');
  if (!el) return;
  try {
    const data = await api(`/api/social/my-media`);
    const items = data.media || [];
    if (!items.length) {
      el.innerHTML = `<div class="card"><div class="card-body"><p class="text-muted text-small">Je hebt nog geen media geplaatst.</p></div></div>`;
      return;
    }

    // Normalise field so viewer works (liked_by_me, counts)
    items.forEach(m => {
      m.like_count    = m.like_count    || 0;
      m.comment_count = m.comment_count || 0;
      m.view_count    = m.view_count    || 0;
      m.liked_by_me   = false;
    });

    el.innerHTML = `
      <div class="prof-media-grid">
        ${items.map((m, i) => `
          <div class="prof-media-item" data-idx="${i}">
            ${m.file_type === 'video'
              ? `<video src="${esc(m.file_path)}" muted playsinline preload="metadata" class="prof-media-thumb"></video>
                 <span class="prof-media-type-icon">▶</span>`
              : `<img src="${esc(m.file_path)}" class="prof-media-thumb" loading="lazy" />`}
          </div>`).join('')}
      </div>`;

    // Click → open fullscreen viewer with delete option
    el.querySelectorAll('.prof-media-item').forEach(card => {
      card.addEventListener('click', () => {
        const startIdx = parseInt(card.dataset.idx);
        openReelViewer(items, startIdx, {
          canDelete: () => true,
          onDelete: async (m) => {
            await api(`/api/social/media/${m.id}`, { method: 'DELETE' });
            showToast('Verwijderd', 'success');
            // Remove from grid
            const gridCard = el.querySelector(`.prof-media-item[data-idx="${items.indexOf(m)}"]`);
            gridCard?.remove();
            // Re-index remaining cards
            el.querySelectorAll('.prof-media-item').forEach((c, i) => c.dataset.idx = i);
            if (!el.querySelector('.prof-media-item')) {
              el.innerHTML = `<div class="card"><div class="card-body"><p class="text-muted text-small">Je hebt nog geen media geplaatst.</p></div></div>`;
            }
            return true;
          },
        });
      });
    });
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
        <button type="submit" class="btn btn-primary btn-block" id="prof-save">Opslaan</button>
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

  // Profile form
  overlay.querySelector('#profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = overlay.querySelector('#prof-save');
    btn.disabled = true; btn.textContent = 'Opslaan…';
    try {
      const data = await api('/api/auth/profile', {
        method: 'PATCH',
        body: {
          name: overlay.querySelector('#prof-name').value,
          club_id: overlay.querySelector('#prof-club').value || null,
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

/* ─── Backend: my-media endpoint ─────────────────────────────────────────── */

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

