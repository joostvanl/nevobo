import { api, state, renderAvatar, renderClubLogo, showToast, navigate } from '../app.js';

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

    const memberships = me.memberships || [];

    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <div class="flex items-center gap-3">
            ${renderAvatar(me.name, me.avatar_url, 'lg')}
            <div>
              <h1 style="color:#fff;font-size:1.4rem">${me.name}</h1>
              <div class="flex gap-2 mt-1">
                <span class="chip" style="background:rgba(255,255,255,0.2);color:#fff">Level ${me.level}</span>
                <span class="chip" style="background:rgba(255,255,255,0.2);color:#fff">${me.xp} XP</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="container">

        <!-- Admin shortcut -->
        ${me.roles?.length > 0 ? `
          <div class="card mb-3" style="margin-top:-0.5rem;border:2px solid var(--primary)">
            <div class="card-body flex items-center gap-3">
              <span style="font-size:1.4rem">⚙️</span>
              <div style="flex:1">
                <div style="font-weight:700;font-size:0.9rem">Beheerderspaneel</div>
                <div style="font-size:0.8rem;color:var(--text-muted)">${me.roles.map(r => r.role === 'super_admin' ? 'Opperbeheerder' : r.role === 'club_admin' ? `Clubbeheerder ${r.club_name || ''}` : `Teambeheerder ${r.team_name || ''}`).join(' · ')}</div>
              </div>
              <button class="btn btn-primary btn-sm" onclick="navigate('admin')">Beheer →</button>
            </div>
          </div>` : ''}

        <!-- XP bar -->
        <div class="xp-bar-wrap mb-3" style="margin-top:-0.5rem">
          <div class="xp-bar-header">
            <span class="xp-level-label">${currentLevel?.label || 'Niveau ' + me.level}</span>
            ${nextLevel ? `<span class="text-muted" style="font-size:0.8rem">${nextLevel.xp_required - me.xp} XP nodig</span>` : ''}
          </div>
          <div class="xp-bar-track">
            <div class="xp-bar-fill" id="xp-fill" style="width:0%"></div>
          </div>
        </div>

        <!-- Badges -->
        ${badges.length > 0 ? `
          <div class="section">
            <div class="section-header">
              <span class="section-title">Verdiende badges (${badges.length})</span>
              <button class="btn btn-ghost btn-sm" onclick="navigate('badges')">Alles →</button>
            </div>
            <div class="scroll-x">
              ${badges.map(b => `
                <div style="display:flex;flex-direction:column;align-items:center;gap:0.25rem;min-width:64px">
                  <div style="font-size:2rem">${b.icon_emoji}</div>
                  <span style="font-size:0.65rem;font-weight:700;text-align:center;color:var(--text-muted)">${b.label}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Profile settings -->
        <div class="section">
          <div class="section-header"><span class="section-title">Profiel bewerken</span></div>
          <div class="card">
            <div class="card-body">
              <form id="profile-form">
                <div class="form-group">
                  <label class="form-label">Naam</label>
                  <input type="text" id="prof-name" class="form-input" value="${escapeHtml(me.name)}" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Club</label>
                  <select class="form-select" id="prof-club">
                    <option value="">— Geen club —</option>
                    ${clubs.map(c => `<option value="${c.id}" ${c.id === me.club_id ? 'selected' : ''}>${c.name}</option>`).join('')}
                  </select>
                </div>
                <button type="submit" class="btn btn-primary btn-block" id="prof-save">Opslaan</button>
              </form>
            </div>
          </div>
        </div>

        <!-- Team memberships -->
        <div class="section">
          <div class="section-header"><span class="section-title">👥 Mijn teams</span></div>
          <div class="card">
            <div id="memberships-list">
              ${memberships.length === 0
                ? `<div class="card-body"><p class="text-muted text-small">Je bent nog aan geen enkel team gekoppeld.</p></div>`
                : memberships.map(m => membershipRow(m)).join('')}
            </div>
            <!-- Add membership form -->
            <div class="card-body" style="border-top:1px solid var(--border)">
              <div style="font-weight:600;font-size:0.85rem;margin-bottom:0.75rem">Team toevoegen</div>
              <div class="form-group" style="margin-bottom:0.5rem">
                <select class="form-select" id="add-mem-club">
                  <option value="">— Selecteer club —</option>
                  ${clubs.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" style="margin-bottom:0.5rem">
                <select class="form-select" id="add-mem-team" disabled>
                  <option value="">— Selecteer eerst een club —</option>
                </select>
              </div>
              <div class="form-group" style="margin-bottom:0.75rem">
                <select class="form-select" id="add-mem-role">
                  <option value="player">Speler</option>
                  <option value="coach">Trainer/Coach</option>
                  <option value="parent">Ouder</option>
                </select>
              </div>
              <button class="btn btn-secondary btn-block" id="add-mem-btn" disabled>Team toevoegen</button>
            </div>
          </div>
        </div>

        <!-- Add club section -->
        <div class="section">
          <div class="section-header"><span class="section-title">Club toevoegen</span></div>
          <div class="card">
            <div class="card-body">
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

                <!-- How to find code guide -->
                <div style="background:rgba(33,150,243,0.07);border-radius:var(--radius);padding:0.875rem;margin-bottom:1rem;border:1px solid rgba(33,150,243,0.2)">
                  <div style="font-weight:700;font-size:0.85rem;color:var(--accent);margin-bottom:0.5rem">📖 Hoe vind je je Nevobo-code?</div>
                  <ol style="font-size:0.8rem;color:var(--text-muted);padding-left:1.25rem;line-height:1.8">
                    <li>Ga naar <a href="https://www.volleybal.nl" target="_blank" style="color:var(--accent)">volleybal.nl</a></li>
                    <li>Zoek jouw club of team</li>
                    <li>Klik op <strong>Programma</strong></li>
                    <li>Scroll naar beneden → klik <strong>"Exporteren"</strong></li>
                    <li>Klik rechts op <strong>RSS Feed</strong> → "Link kopiëren"</li>
                    <li>De code staat in de URL: <code style="background:var(--border);padding:1px 4px;border-radius:4px;font-size:0.75rem">/vereniging/<strong>ckl9x7n</strong>/</code></li>
                  </ol>
                </div>

                <div class="form-group">
                  <label class="form-label">Regio</label>
                  <select class="form-select" id="club-region">
                    <option value="">— Selecteer regio (optioneel) —</option>
                    <option>regio-noord</option>
                    <option>regio-oost</option>
                    <option>regio-west</option>
                    <option>regio-zuid</option>
                    <option>nationale-competitie</option>
                  </select>
                </div>
                <button type="submit" class="btn btn-secondary btn-block" id="club-save">Club toevoegen</button>
              </form>
            </div>
          </div>
        </div>

        <!-- Leaderboard -->
        ${me.club_id ? `
          <div class="section">
            <div class="section-header"><span class="section-title">🏅 Ranglijst club</span></div>
            <div id="leaderboard"><div class="spinner"></div></div>
          </div>
        ` : ''}

        <!-- Logout -->
        <div class="section">
          <button class="btn btn-secondary btn-block" id="logout-btn">Uitloggen</button>
        </div>

      </div>
    `;

    // Animate XP bar
    setTimeout(() => {
      const fill = document.getElementById('xp-fill');
      if (fill) fill.style.width = xpProgress + '%';
    }, 100);

    // Load leaderboard
    if (me.club_id) {
      loadLeaderboard(me.club_id, me.id);
    }

    // Profile form (name + primary club only)
    document.getElementById('profile-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.getElementById('prof-save');
      btn.disabled = true; btn.textContent = 'Opslaan…';
      try {
        const body = {
          name: document.getElementById('prof-name').value,
          club_id: document.getElementById('prof-club').value || null,
        };
        const data = await api('/api/auth/profile', { method: 'PATCH', body });
        state.user = { ...data.user, memberships: me.memberships, roles: me.roles };
        localStorage.setItem('vb_user', JSON.stringify(state.user));
        showToast('Profiel opgeslagen! ✅', 'success');
        render(container);
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false; btn.textContent = 'Opslaan';
      }
    });

    // Membership manager — club picker loads teams
    document.getElementById('add-mem-club')?.addEventListener('change', async function () {
      const clubId = this.value;
      const teamSel = document.getElementById('add-mem-team');
      const addBtn  = document.getElementById('add-mem-btn');
      if (!clubId) {
        teamSel.innerHTML = '<option value="">— Selecteer eerst een club —</option>';
        teamSel.disabled = true; addBtn.disabled = true; return;
      }
      teamSel.innerHTML = '<option value="">Laden…</option>';
      teamSel.disabled = true; addBtn.disabled = true;
      try {
        const data = await api(`/api/clubs/${clubId}/teams?userId=${me.id}`);
        const list = data.teams || [];
        teamSel.innerHTML = '<option value="">— Selecteer team —</option>'
          + list.map(t => `<option value="${t.id}">${t.display_name}</option>`).join('');
        teamSel.disabled = false;
        teamSel.addEventListener('change', () => {
          addBtn.disabled = !teamSel.value;
        });
      } catch (_) {
        teamSel.innerHTML = '<option value="">Laden mislukt</option>';
      }
    });

    // Add membership
    document.getElementById('add-mem-btn')?.addEventListener('click', async () => {
      const teamId = document.getElementById('add-mem-team')?.value;
      const role   = document.getElementById('add-mem-role')?.value;
      if (!teamId) return;
      const btn = document.getElementById('add-mem-btn');
      btn.disabled = true; btn.textContent = 'Bezig…';
      try {
        const data = await api('/api/auth/memberships', {
          method: 'POST',
          body: { team_id: parseInt(teamId), membership_type: role },
        });
        // Update state
        const meRefresh = await api('/api/auth/me');
        state.user = meRefresh.user;
        localStorage.setItem('vb_user', JSON.stringify(state.user));
        showToast('Team toegevoegd! ✅', 'success');
        render(container);
      } catch (err) {
        showToast(err.message || 'Toevoegen mislukt', 'error');
        btn.disabled = false; btn.textContent = 'Team toevoegen';
      }
    });

    // Remove membership (delegated)
    document.getElementById('memberships-list')?.addEventListener('click', async e => {
      const btn = e.target.closest('.mem-remove-btn');
      if (!btn) return;
      const teamId = btn.dataset.teamId;
      btn.disabled = true; btn.textContent = '…';
      try {
        await api(`/api/auth/memberships/${teamId}`, { method: 'DELETE' });
        const meRefresh = await api('/api/auth/me');
        state.user = meRefresh.user;
        localStorage.setItem('vb_user', JSON.stringify(state.user));
        showToast('Team verwijderd', 'success');
        render(container);
      } catch (err) {
        showToast(err.message || 'Verwijderen mislukt', 'error');
        btn.disabled = false; btn.textContent = '✕';
      }
    });

    // Club form
    document.getElementById('club-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.getElementById('club-save');
      btn.disabled = true; btn.textContent = 'Bezig…';
      try {
        const clubResp = await api('/api/clubs', {
          method: 'POST',
          body: {
            name: document.getElementById('club-name').value,
            nevobo_code: document.getElementById('club-code').value.trim().toLowerCase(),
            region: document.getElementById('club-region').value,
          },
        });
        showToast('Club toegevoegd! Teams worden gesynchroniseerd 🏐', 'success');
        // Reload page so the new club appears in the dropdown and teams are loaded
        setTimeout(() => render(container), 800);
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false; btn.textContent = 'Club toevoegen';
      }
    });

    // Validate Nevobo code button
    document.getElementById('validate-code-btn')?.addEventListener('click', async () => {
      const code = document.getElementById('club-code').value.trim();
      const hint = document.getElementById('code-hint');
      const btn = document.getElementById('validate-code-btn');
      if (!code) { showToast('Voer een code in', 'error'); return; }
      btn.disabled = true; btn.textContent = '⏳';
      hint.textContent = 'Code wordt gecontroleerd…';
      hint.style.color = 'var(--text-muted)';
      try {
        await api('/api/nevobo/validate', { method: 'POST', body: { code } });
        hint.textContent = '✅ Geldige Nevobo-code! Je kunt de club nu toevoegen.';
        hint.style.color = 'var(--success)';
        btn.textContent = '✓';
      } catch (err) {
        hint.textContent = '❌ ' + (err.message || 'Ongeldige code — controleer de code op volleybal.nl');
        hint.style.color = 'var(--danger)';
        btn.textContent = '✗';
      } finally {
        btn.disabled = false;
      }
    });

    // Live lowercase transform for code input
    document.getElementById('club-code')?.addEventListener('input', function() {
      this.value = this.value.toLowerCase();
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      localStorage.removeItem('vb_token');
      localStorage.removeItem('vb_user');
      state.token = null;
      state.user = null;
      window.location.reload();
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

async function loadLeaderboard(clubId, myId) {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  try {
    const { users } = await api(`/api/gamification/leaderboard/${clubId}`);
    if (!users || users.length === 0) {
      el.innerHTML = '<p class="text-muted text-small">Nog geen spelers op de ranglijst.</p>';
      return;
    }
    el.innerHTML = users.map((u, i) => {
      const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
      const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
      return `
        <div class="leaderboard-item" style="${u.id === myId ? 'border-color:var(--primary);background:rgba(255,87,34,0.03)' : ''}">
          <div class="leaderboard-rank ${rankClass}">${rankIcon}</div>
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

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const ROLE_LABELS = { player: 'Speler', coach: 'Trainer/Coach', trainer: 'Trainer/Coach', parent: 'Ouder' };

function membershipRow(m) {
  return `
    <div class="team-member-row" style="padding:0.75rem 1rem">
      ${renderClubLogo(m.nevobo_code, m.club_name, 'sm')}
      <div style="flex:1;min-width:0;margin-left:0.625rem">
        <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.team_name)}</div>
        <div style="font-size:0.78rem;color:var(--text-muted)">${escapeHtml(m.club_name)}</div>
      </div>
      <span class="chip chip-primary" style="font-size:0.72rem;white-space:nowrap">${ROLE_LABELS[m.membership_type] || m.membership_type}</span>
      <button class="mem-remove-btn btn btn-ghost btn-sm" data-team-id="${m.team_id}"
        style="color:var(--danger);padding:0.25rem 0.5rem;margin-left:0.25rem;flex-shrink:0" title="Verwijderen">✕</button>
    </div>`;
}
