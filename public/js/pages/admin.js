import { api, state, showToast, navigate } from '../app.js';
import { escHtml } from '../escape-html.js';

/** Same as escHtml — data-* and quoted attribute values */
const escAttr = escHtml;

export async function render(container, params = {}) {
  container.innerHTML = '<div class="spinner"></div>';

  if (!state.user) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><p>Log in om dit te bekijken.</p></div>`;
    return;
  }

  try {
    const { roles, coach_teams: coachTeamsRaw } = await api('/api/admin/my-roles');
    state.user.roles = roles;
    const coachTeams = coachTeamsRaw || [];

    if (!roles.length && !coachTeams.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔒</div>
          <h3>Geen beheerdersrechten</h3>
          <p>Je hebt nog geen beheerdersrol of coach-toegang. Neem contact op met een beheerder van je club.</p>
        </div>`;
      return;
    }

    const isSuperAdmin = roles.some(r => r.role === 'super_admin');
    const clubAdminRoles = roles.filter(r => r.role === 'club_admin');
    const teamAdminRoles = roles.filter(r => r.role === 'team_admin');
    const teamAdminIds = new Set(teamAdminRoles.map(r => r.team_id));

    // Build tabs list
    const tabs = [];
    if (isSuperAdmin) tabs.push({ id: 'super', label: '⚡ Opperbeheerder' });
    clubAdminRoles.forEach(r => tabs.push({ id: `club_${r.club_id}`, label: `🏛 ${r.club_name || 'Club'}` }));
    teamAdminRoles.forEach(r => tabs.push({ id: `team_${r.team_id}`, label: `👥 ${r.team_name || 'Team'}` }));
    coachTeams.forEach(ct => {
      if (!teamAdminIds.has(ct.team_id)) {
        tabs.push({ id: `coach_${ct.team_id}`, label: `📋 ${ct.team_name || 'Team'} (coach)` });
      }
    });

    let initialTabId = tabs[0]?.id ?? null;

    const wishTeamId = params.teamId != null && params.teamId !== '' ? parseInt(String(params.teamId), 10) : NaN;
    const wishClubId = params.clubId != null && params.clubId !== '' ? parseInt(String(params.clubId), 10) : NaN;

    if (!Number.isNaN(wishTeamId)) {
      const existing = tabs.find(t => t.id === `team_${wishTeamId}` || t.id === `coach_${wishTeamId}`);
      if (existing) {
        initialTabId = existing.id;
      } else if (!Number.isNaN(wishClubId)) {
        const canOpenTeam =
          isSuperAdmin || clubAdminRoles.some(r => Number(r.club_id) === wishClubId);
        if (canOpenTeam) {
          let label = '👥 Team leden';
          try {
            const d = await api(`/api/clubs/${wishClubId}/teams/${wishTeamId}`);
            if (d.team?.display_name) label = `👥 ${d.team.display_name}`;
          } catch (_) {}
          const newTab = { id: `team_${wishTeamId}`, label };
          const clubIdx = tabs.findIndex(t => t.id === `club_${wishClubId}`);
          if (clubIdx >= 0) tabs.splice(clubIdx + 1, 0, newTab);
          else if (isSuperAdmin) {
            const sIdx = tabs.findIndex(t => t.id === 'super');
            tabs.splice(sIdx >= 0 ? sIdx + 1 : 0, 0, newTab);
          } else {
            tabs.unshift(newTab);
          }
          initialTabId = `team_${wishTeamId}`;
        }
      }
    } else if (!Number.isNaN(wishClubId)) {
      const clubTab = tabs.find(t => t.id === `club_${wishClubId}`);
      if (clubTab) initialTabId = clubTab.id;
    }

    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <h1>⚙️ Beheer</h1>
          <p>Rollen &amp; ledenbeheer</p>
        </div>
      </div>
      <div class="container">
        <div class="filter-pills mb-3" id="admin-tabs">
          ${tabs.map(t => `
            <button class="filter-pill${t.id === initialTabId ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>
          `).join('')}
        </div>
        <div id="admin-panel"></div>
      </div>`;

    const panel = container.querySelector('#admin-panel');

    document.getElementById('admin-help-manual')?.addEventListener('click', () =>
      navigate('help', { hash: 'admin-manual-team-leden' })
    );

    // Tab switching
    container.querySelectorAll('.filter-pill[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.filter-pill[data-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTab(btn.dataset.tab, panel, roles, coachTeams);
      });
    });

    if (tabs.length && initialTabId) {
      renderTab(initialTabId, panel, roles, coachTeams);
    }

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

// ─── Tab renderers ────────────────────────────────────────────────────────────

async function renderTab(tabId, panel, roles, coachTeams = []) {
  panel.innerHTML = '<div class="spinner" style="padding:2rem;text-align:center"></div>';

  if (tabId === 'super') {
    await renderSuperAdminTab(panel);
  } else if (tabId.startsWith('club_')) {
    const clubId = parseInt(tabId.replace('club_', ''));
    await renderClubAdminTab(panel, clubId);
  } else if (tabId.startsWith('team_')) {
    const teamId = parseInt(tabId.replace('team_', ''));
    await renderTeamAdminTab(panel, teamId, { canManageMembers: true });
  } else if (tabId.startsWith('coach_')) {
    const teamId = parseInt(tabId.replace('coach_', ''));
    await renderTeamAdminTab(panel, teamId, { canManageMembers: false });
  }
}

// ─── Super Admin Tab ──────────────────────────────────────────────────────────

async function renderSuperAdminTab(panel) {
  panel.innerHTML = `
    <div class="section-header mb-2"><span class="section-title">Gebruikers zoeken</span></div>
    <div class="flex gap-2 mb-3">
      <input type="text" id="sa-search" class="form-input" placeholder="Naam of e-mail…" style="flex:1" />
      <button class="btn btn-primary btn-sm" id="sa-search-btn">Zoeken</button>
    </div>
    <div id="sa-results"></div>

    <div class="section-header mt-4 mb-2"><span class="section-title">Opperbeheerders</span></div>
    <div id="sa-superadmins"><div class="spinner" style="padding:1rem;text-align:center"></div></div>`;

  await loadSuperAdminList(panel);

  panel.querySelector('#sa-search-btn').addEventListener('click', () => searchUsers(panel));
  panel.querySelector('#sa-search').addEventListener('keydown', e => { if (e.key === 'Enter') searchUsers(panel); });
}

async function loadSuperAdminList(panel) {
  const el = panel.querySelector('#sa-superadmins');
  if (!el) return;
  try {
    const { roles } = await api('/api/admin/my-roles');
    const superAdmins = roles.filter(r => r.role === 'super_admin');
    // Fetch all super admins across the system
    const { users } = await api('/api/admin/users?q=');
    const allSuperRoles = await api('/api/admin/my-roles').catch(() => ({ roles: [] }));
    // Use a dedicated endpoint — fall back to what we have
    el.innerHTML = superAdmins.length
      ? superAdmins.map(r => adminRoleRow(r)).join('')
      : `<p class="text-muted text-small" style="padding:0.5rem">Geen andere opperbeheerders gevonden.</p>`;
  } catch (_) {
    el.innerHTML = `<p class="text-muted text-small" style="padding:0.5rem">Laden mislukt.</p>`;
  }
}

async function searchUsers(panel) {
  const q = panel.querySelector('#sa-search').value.trim();
  const el = panel.querySelector('#sa-results');
  el.innerHTML = '<div class="spinner" style="padding:1rem;text-align:center"></div>';
  try {
    const { users } = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
    if (!users.length) { el.innerHTML = `<p class="text-muted text-small" style="padding:0.5rem">Geen resultaten.</p>`; return; }
    el.innerHTML = users.map(u => `
      <div class="admin-user-row">
        <div class="admin-user-info">
          <strong>${escHtml(u.name)}</strong>
          <span class="text-muted text-small">${escHtml(u.email)}</span>
        </div>
        <div class="flex gap-1" style="flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm assign-club-btn" data-userid="${u.id}" data-username="${escAttr(u.name)}">+ Clubbeheerder</button>
          <button class="btn btn-ghost btn-sm assign-super-btn" data-userid="${u.id}" data-username="${escAttr(u.name)}">+ Opperbeheerder</button>
        </div>
      </div>`).join('');

    el.querySelectorAll('.assign-super-btn').forEach(btn => {
      btn.addEventListener('click', () => assignRole({ user_id: btn.dataset.userid, role: 'super_admin', name: btn.dataset.username }, () => searchUsers(panel)));
    });
    el.querySelectorAll('.assign-club-btn').forEach(btn => {
      btn.addEventListener('click', () => showAssignClubModal(btn.dataset.userid, btn.dataset.username, () => searchUsers(panel)));
    });
  } catch (err) {
    el.innerHTML = `<p class="text-muted text-small" style="padding:0.5rem">${err.message}</p>`;
  }
}

// ─── Club Admin Tab ───────────────────────────────────────────────────────────

async function renderClubAdminTab(panel, clubId) {
  try {
    const data = await api(`/api/admin/clubs/${clubId}/admins`);
    const { club_admins, team_admins, teams } = data;

    panel.innerHTML = `
      <div class="section-header mb-2">
        <span class="section-title">Clubbeheerders</span>
      </div>
      <div id="club-admins-list">
        ${club_admins.length
          ? club_admins.map(r => adminRoleRow(r, clubId)).join('')
          : `<p class="text-muted text-small" style="padding:0.5rem">Geen clubbeheerders.</p>`}
      </div>

      <div class="section-header mt-4 mb-2">
        <span class="section-title">Teambeheerders</span>
        <button class="btn btn-primary btn-sm" id="add-team-admin-btn">+ Teambeheerder toevoegen</button>
      </div>
      <div id="team-admins-list">
        ${team_admins.length
          ? team_admins.map(r => adminRoleRow(r, clubId)).join('')
          : `<p class="text-muted text-small" style="padding:0.5rem">Geen teambeheerders.</p>`}
      </div>

      <div class="section-header mt-4 mb-2">
        <span class="section-title">Gebruikers verwijderen</span>
      </div>
      <div id="club-users-list">
        <p class="text-muted text-small" style="padding:0.5rem">Laden…</p>
      </div>`;

    // Wire revoke buttons
    panel.querySelectorAll('.revoke-role-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Rol intrekken?')) return;
        try {
          await api(`/api/admin/roles/${btn.dataset.roleid}`, { method: 'DELETE' });
          showToast('Rol ingetrokken', 'info');
          renderClubAdminTab(panel, clubId);
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    panel.querySelector('#add-team-admin-btn').addEventListener('click', () => {
      showAddTeamAdminModal(clubId, teams, () => renderClubAdminTab(panel, clubId));
    });

    // Load users list
    const usersEl = panel.querySelector('#club-users-list');
    try {
      const { users } = await api(`/api/admin/clubs/${clubId}/users`);
      if (!users.length) {
        usersEl.innerHTML = `<p class="text-muted text-small" style="padding:0.5rem">Geen gebruikers gevonden.</p>`;
      } else {
        usersEl.innerHTML = users.map(u => `
          <div class="admin-user-row" style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.25rem;border-bottom:1px solid var(--border)">
            <div>
              <strong style="font-size:0.9rem">${escHtml(u.name)}</strong>
              ${u.is_npc ? '<span class="chip" style="font-size:0.65rem;margin-left:0.35rem">NPC</span>' : ''}
              <span class="text-muted text-small" style="display:block">${escHtml(u.email || '')}${u.team_names ? ` · ${escHtml(u.team_names)}` : ''}</span>
            </div>
            <div style="display:flex;gap:0.4rem;flex-shrink:0;margin-left:0.5rem">
              <button class="btn btn-secondary btn-sm edit-user-btn"
                data-userid="${u.id}"
                data-username="${escAttr(u.name)}"
                data-email="${escAttr(u.email || '')}"
                data-teamnames="${escAttr(u.team_names || '')}">✏️ Bewerk</button>
              <button class="btn btn-danger btn-sm delete-user-btn"
                data-userid="${u.id}"
                data-username="${escAttr(u.name)}">🗑</button>
            </div>
          </div>`).join('');

        usersEl.querySelectorAll('.edit-user-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            showEditUserModal({
              userId:    btn.dataset.userid,
              name:      btn.dataset.username,
              email:     btn.dataset.email,
              teamNames: btn.dataset.teamnames,
            }, () => renderClubAdminTab(panel, clubId));
          });
        });

        usersEl.querySelectorAll('.delete-user-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm(`Gebruiker "${btn.dataset.username}" permanent verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
            const restoreNpc = confirm(
              'Ooit een echte speler gekoppeld aan een NPC? Kies OK om (indien van toepassing) een team-placeholder (NPC) terug te zetten vóór verwijderen. Annuleren = alleen account wissen.'
            );
            try {
              const q = restoreNpc ? '?restore_npc=1' : '';
              await api(`/api/admin/users/${btn.dataset.userid}${q}`, { method: 'DELETE' });
              showToast(`Gebruiker verwijderd`, 'success');
              renderClubAdminTab(panel, clubId);
            } catch (err) { showToast(err.message, 'error'); }
          });
        });
      }
    } catch (_) {
      usersEl.innerHTML = `<p class="text-muted text-small" style="padding:0.5rem">Laden mislukt.</p>`;
    }
  } catch (err) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

// ─── Team Admin Tab ───────────────────────────────────────────────────────────

async function renderTeamAdminTab(panel, teamId, opts = {}) {
  const canManageMembers = opts.canManageMembers !== false;
  try {
    const { members, team } = await api(`/api/admin/teams/${teamId}/members`);

    const groups = [
      { key: 'player', label: '🏐 Spelers',         list: members.filter(m => m.membership_type === 'player') },
      { key: 'coach',  label: '📋 Trainer / Coach',  list: members.filter(m => m.membership_type === 'coach' || m.membership_type === 'trainer') },
      { key: 'staff',  label: '🎽 Begeleiding',       list: members.filter(m => m.membership_type === 'staff') },
      { key: 'parent', label: '👨‍👩‍👧 Ouders / Contacten', list: members.filter(m => m.membership_type === 'parent') },
    ];

    const refresh = () => renderTeamAdminTab(panel, teamId, opts);

    panel.innerHTML = `
      <p class="text-muted text-small" style="margin-bottom:0.75rem">
        ${canManageMembers
          ? 'Tik op <strong>Bewerken</strong> voor e-mail, rol, rugnummer, positie, NPC en verwijderen.'
          : 'Tik op <strong>Bewerken</strong> om naam en contact te wijzigen.'}
      </p>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem">
        <span class="text-muted text-small">${team?.club_name || ''} · ${members.length} leden</span>
        ${canManageMembers ? `<button class="btn btn-primary btn-sm" id="add-member-btn">+ Lid toevoegen</button>` : ''}
      </div>
      ${groups.map(g => `
        <div class="section-header mt-3 mb-1">
          <span class="section-title">${g.label} (${g.list.length})</span>
        </div>
        <div id="group-${g.key}">
          ${g.list.length
            ? g.list.map(m => memberRow(m, teamId, canManageMembers)).join('')
            : `<p class="text-muted text-small" style="padding:0.35rem 0.5rem">Geen ${g.label.replace(/^[^ ]+ /, '').toLowerCase()}.</p>`}
        </div>`).join('')}`;

    const addBtn = panel.querySelector('#add-member-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        showAddMemberModal(teamId, team.club_id, refresh);
      });
    }

    panel.querySelectorAll('.edit-member-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showEditPlayerModal({
          userId:           btn.dataset.userid,
          teamId,
          name:             btn.dataset.name,
          email:            btn.dataset.email,
          shirt:            btn.dataset.shirt,
          position:         btn.dataset.position,
          birthDate:        btn.dataset.birthdate,
          membershipType:   btn.dataset.role,
          isNpc:            btn.dataset.npc === '1',
          canManageMembers,
        }, refresh);
      });
    });
  } catch (err) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function adminRoleRow(r, currentClubId) {
  const canRevoke = state.user?.roles?.some(ur =>
    ur.role === 'super_admin' || (ur.role === 'club_admin' && ur.club_id === currentClubId)
  );
  return `
    <div class="admin-user-row">
      <div class="admin-user-info">
        <strong>${escHtml(r.name)}</strong>
        <span class="text-muted text-small">${escHtml(r.email)}</span>
        ${r.team_name ? `<span class="chip chip-neutral" style="font-size:0.7rem">${escHtml(r.team_name)}</span>` : ''}
      </div>
      ${canRevoke ? `<button class="btn btn-secondary btn-sm revoke-role-btn" data-roleid="${r.id}">Intrekken</button>` : ''}
    </div>`;
}

const ROLE_LABELS = {
  player:  'Speler',
  coach:   'Trainer/Coach',
  trainer: 'Trainer',
  staff:   'Begeleiding',
  parent:  'Ouder',
};

function memberRow(m, teamId, canManageMembers = true) {
  const roleLabel = ROLE_LABELS[m.membership_type] || m.membership_type;
  const shirtPart =
    m.shirt_number != null && String(m.shirt_number).trim() !== ''
      ? `#${m.shirt_number}`
      : '—';
  const npc = Number(m.is_npc) === 1 ? '1' : '0';
  return `
    <div class="admin-user-row tm-member-row" data-member-id="${m.user_id}" style="align-items:center">
      <div class="admin-user-info" style="flex:1;min-width:0">
        <strong style="font-size:0.95rem">${escHtml(m.name)}</strong>
        <div class="text-muted text-small" style="margin-top:0.2rem;line-height:1.35">
          ${escHtml(shirtPart)} · ${escHtml(roleLabel)}
        </div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm edit-member-btn"
        data-userid="${m.user_id}"
        data-name="${escAttr(m.name)}"
        data-email="${escAttr(m.email)}"
        data-shirt="${m.shirt_number ?? ''}"
        data-position="${escAttr(m.position || '')}"
        data-birthdate="${escAttr(m.birth_date || '')}"
        data-role="${escAttr(m.membership_type)}"
        data-npc="${npc}"
        data-team="${teamId}"
        style="flex-shrink:0">Bewerken</button>
    </div>`;
}

function showNpcMergeModal(teamId, npcUserId, npcName, onSuccess) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:400px">
      <h3 style="margin-bottom:0.5rem">NPC koppelen</h3>
      <p class="text-muted text-small" style="margin-bottom:1rem">
        Alle teamdata van <strong>${escHtml(npcName)}</strong> gaat naar het gekozen account (éénmalig, niet omkeerbaar via deze knop).
      </p>
      <div class="form-group">
        <label class="form-label">Zoek geregistreerde speler (e-mail of naam)</label>
        <input type="text" id="npc-merge-q" class="form-input" placeholder="Minimaal 2 tekens…" autocomplete="off" />
        <div id="npc-merge-suggestions" style="margin-top:4px;border:1px solid var(--border);border-radius:8px;overflow:hidden;display:none;max-height:200px;overflow-y:auto;background:var(--card-bg)"></div>
      </div>
      <div id="npc-merge-selected" style="display:none;padding:0.5rem 0.75rem;background:var(--bg-subtle,#f5f5f5);border-radius:8px;margin-bottom:0.5rem;font-size:0.9rem"></div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-secondary" style="flex:1" id="npc-merge-cancel">Annuleren</button>
        <button class="btn btn-primary" style="flex:1" id="npc-merge-confirm" disabled>Koppelen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let selectedRealId = null;
  let debounceTimer = null;
  const qInput = overlay.querySelector('#npc-merge-q');
  const sugg = overlay.querySelector('#npc-merge-suggestions');
  const selectedBox = overlay.querySelector('#npc-merge-selected');
  const confirmBtn = overlay.querySelector('#npc-merge-confirm');

  function pickUser(u) {
    selectedRealId = u.id;
    selectedBox.textContent = `${u.name} (${u.email})`;
    selectedBox.style.display = 'block';
    qInput.value = u.name;
    sugg.style.display = 'none';
    confirmBtn.disabled = false;
  }

  qInput.addEventListener('input', () => {
    selectedRealId = null;
    confirmBtn.disabled = true;
    selectedBox.style.display = 'none';
    clearTimeout(debounceTimer);
    const q = qInput.value.trim();
    if (q.length < 2) { sugg.style.display = 'none'; return; }
    debounceTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/admin/teams/${teamId}/users-search?q=${encodeURIComponent(q)}`);
        const users = (data.users || []).filter(u => u.id !== npcUserId);
        if (!users.length) {
          sugg.innerHTML = '<div style="padding:0.5rem 0.75rem;color:var(--text-muted);font-size:0.85rem">Geen resultaten</div>';
        } else {
          sugg.innerHTML = users.map(u => `
            <div class="member-suggestion-item" data-id="${u.id}" data-name="${escAttr(u.name)}" data-email="${escAttr(u.email)}"
              style="padding:0.5rem 0.75rem;cursor:pointer;border-bottom:1px solid var(--border)">
              <div style="font-size:0.9rem;font-weight:500">${escHtml(u.name)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted)">${escHtml(u.email)}</div>
            </div>`).join('');
          sugg.querySelectorAll('.member-suggestion-item').forEach(item => {
            item.addEventListener('mousedown', e => {
              e.preventDefault();
              pickUser({ id: +item.dataset.id, name: item.dataset.name, email: item.dataset.email });
            });
          });
        }
        sugg.style.display = 'block';
      } catch (_) {
        sugg.style.display = 'none';
      }
    }, 220);
  });

  qInput.addEventListener('blur', () => {
    setTimeout(() => { sugg.style.display = 'none'; }, 150);
  });

  overlay.querySelector('#npc-merge-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#npc-merge-confirm').addEventListener('click', async () => {
    if (!selectedRealId) return;
    if (!confirm(`Gegevens van NPC naar dit account verplaatsen? De NPC wordt daarna verwijderd.`)) return;
    try {
      await api('/api/admin/npc/merge', {
        method: 'POST',
        body: { npc_user_id: npcUserId, real_user_id: selectedRealId },
      });
      overlay.remove();
      showToast('NPC gekoppeld — data staat nu op het echte account', 'success');
      onSuccess?.();
    } catch (err) {
      showToast(err.message || 'Koppelen mislukt', 'error');
    }
  });
}

// ─── Modals ───────────────────────────────────────────────────────────────────

async function assignRole(params, onSuccess) {
  try {
    await api('/api/admin/roles', { method: 'POST', body: params });
    showToast('Rol toegewezen', 'success');
    if (onSuccess) onSuccess();
  } catch (err) { showToast(err.message, 'error'); }
}

async function showAssignClubModal(userId, userName, onSuccess) {
  // Fetch clubs first
  let clubs = [];
  try {
    const data = await fetch('/api/clubs').then(r => r.json());
    clubs = data.clubs || [];
  } catch (_) {}

  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:1rem">Clubbeheerder toewijzen</h3>
      <p style="margin-bottom:1rem;font-size:0.9rem">Aan: <strong>${escHtml(userName)}</strong></p>
      <div class="form-group">
        <label class="form-label">Club</label>
        ${clubs.length
          ? `<select id="modal-club-id" class="form-input">
              ${clubs.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
            </select>`
          : `<input type="number" id="modal-club-id" class="form-input" placeholder="Club ID" />`}
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-secondary" style="flex:1" id="modal-cancel">Annuleren</button>
        <button class="btn btn-primary" style="flex:1" id="modal-confirm">Toewijzen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#modal-confirm').addEventListener('click', async () => {
    const clubId = parseInt(overlay.querySelector('#modal-club-id').value);
    if (!clubId) { showToast('Selecteer een club', 'error'); return; }
    overlay.remove();
    await assignRole({ user_id: userId, role: 'club_admin', club_id: clubId }, onSuccess);
  });
}

function showAddTeamAdminModal(clubId, teams, onSuccess) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:1rem">Teambeheerder toevoegen</h3>
      <div class="form-group">
        <label class="form-label">Zoek gebruiker (e-mail of naam)</label>
        <div class="flex gap-2">
          <input type="text" id="ta-search-input" class="form-input" placeholder="naam of e-mail…" style="flex:1" />
          <button class="btn btn-ghost btn-sm" id="ta-search-btn">Zoeken</button>
        </div>
        <div id="ta-search-results" style="margin-top:0.5rem"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Team</label>
        <select id="ta-team-select" class="form-input">
          ${teams.map(t => `<option value="${t.id}">${escHtml(t.display_name)}</option>`).join('')}
        </select>
      </div>
      <div id="ta-selected-user" style="margin-bottom:0.75rem;font-size:0.85rem;color:var(--text-muted)"></div>
      <div class="flex gap-2">
        <button class="btn btn-secondary" style="flex:1" id="ta-cancel">Annuleren</button>
        <button class="btn btn-primary" style="flex:1" id="ta-confirm">Toewijzen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let selectedUserId = null;

  overlay.querySelector('#ta-cancel').addEventListener('click', () => overlay.remove());

  async function searchInModal() {
    const q = overlay.querySelector('#ta-search-input').value.trim();
    const resultsEl = overlay.querySelector('#ta-search-results');
    resultsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted)">Laden…</span>';
    try {
      const { users } = await api(`/api/admin/clubs/${clubId}/users?q=${encodeURIComponent(q)}`);
      if (!users.length) { resultsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted)">Geen resultaten.</span>'; return; }
      resultsEl.innerHTML = users.map(u => `
        <div class="admin-user-row selectable-user" data-userid="${u.id}" data-username="${escAttr(u.name)}" style="cursor:pointer">
          <div class="admin-user-info">
            <strong>${escHtml(u.name)}</strong>
            <span class="text-muted text-small">${escHtml(u.email)}</span>
          </div>
          <span style="font-size:0.75rem;color:var(--primary)">Selecteer</span>
        </div>`).join('');
      resultsEl.querySelectorAll('.selectable-user').forEach(row => {
        row.addEventListener('click', () => {
          selectedUserId = row.dataset.userid;
          overlay.querySelector('#ta-selected-user').textContent = `Geselecteerd: ${row.dataset.username}`;
          resultsEl.querySelectorAll('.selectable-user').forEach(r => r.style.background = '');
          row.style.background = 'var(--surface-hover, #f0f0f0)';
        });
      });
    } catch (_) {
      resultsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted)">Laden mislukt.</span>';
    }
  }

  overlay.querySelector('#ta-search-btn').addEventListener('click', searchInModal);
  overlay.querySelector('#ta-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchInModal(); });

  overlay.querySelector('#ta-confirm').addEventListener('click', async () => {
    if (!selectedUserId) { showToast('Selecteer eerst een gebruiker', 'error'); return; }
    const teamId = parseInt(overlay.querySelector('#ta-team-select').value);
    overlay.remove();
    await assignRole({ user_id: selectedUserId, role: 'team_admin', team_id: teamId }, onSuccess);
  });
}

function showAddMemberModal(teamId, clubId, onSuccess) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:1rem">Teamlid toevoegen</h3>
      <div class="form-group">
        <label class="form-label">Zoek op naam</label>
        <input type="text" id="member-search" class="form-input" placeholder="Begin met typen…" autocomplete="off" />
        <div id="member-suggestions" style="margin-top:4px;border:1px solid var(--border);border-radius:8px;overflow:hidden;display:none;max-height:200px;overflow-y:auto;background:var(--card-bg)"></div>
      </div>
      <div id="member-selected" style="display:none;padding:0.5rem 0.75rem;background:var(--bg-subtle,#f5f5f5);border-radius:8px;margin-bottom:0.5rem;font-size:0.9rem"></div>
      <div class="form-group">
        <label class="form-label">Rol</label>
        <select id="member-type" class="form-input">
          <option value="player">Speler</option>
          <option value="coach">Trainer / Coach</option>
          <option value="trainer">Trainer</option>
          <option value="staff">Begeleiding</option>
          <option value="parent">Ouder / Contact</option>
        </select>
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-secondary" style="flex:1" id="m-cancel">Annuleren</button>
        <button class="btn btn-primary" style="flex:1" id="m-confirm" disabled>Toevoegen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let selectedUserId = null;
  let debounceTimer = null;

  const searchInput   = overlay.querySelector('#member-search');
  const suggestions   = overlay.querySelector('#member-suggestions');
  const selectedBox   = overlay.querySelector('#member-selected');
  const confirmBtn    = overlay.querySelector('#m-confirm');

  function selectUser(user) {
    selectedUserId = user.id;
    searchInput.value = user.name;
    suggestions.style.display = 'none';
    selectedBox.textContent = `${user.name} (${user.email})`;
    selectedBox.style.display = 'block';
    confirmBtn.disabled = false;
  }

  searchInput.addEventListener('input', () => {
    selectedUserId = null;
    confirmBtn.disabled = true;
    selectedBox.style.display = 'none';
    clearTimeout(debounceTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { suggestions.style.display = 'none'; return; }
    debounceTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/admin/clubs/${clubId}/users?q=${encodeURIComponent(q)}`);
        const users = data.users || [];
        if (!users.length) {
          suggestions.innerHTML = '<div style="padding:0.5rem 0.75rem;color:var(--text-muted);font-size:0.85rem">Geen resultaten</div>';
        } else {
          suggestions.innerHTML = users.map(u => `
            <div class="member-suggestion-item" data-id="${u.id}" data-name="${escAttr(u.name)}" data-email="${escAttr(u.email)}"
              style="padding:0.5rem 0.75rem;cursor:pointer;display:flex;align-items:center;gap:0.5rem;border-bottom:1px solid var(--border)">
              ${u.avatar_url ? `<img src="${escAttr(u.avatar_url)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover" />` : `<div style="width:28px;height:28px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.75rem">${escHtml(u.name.charAt(0))}</div>`}
              <div><div style="font-size:0.9rem;font-weight:500">${escHtml(u.name)}</div><div style="font-size:0.75rem;color:var(--text-muted)">${escHtml(u.email)}</div></div>
            </div>`).join('');
        }
        suggestions.style.display = 'block';
        suggestions.querySelectorAll('.member-suggestion-item').forEach(item => {
          item.addEventListener('mousedown', e => {
            e.preventDefault();
            selectUser({ id: +item.dataset.id, name: item.dataset.name, email: item.dataset.email });
          });
        });
      } catch (_) {}
    }, 220);
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => { suggestions.style.display = 'none'; }, 150);
  });

  overlay.querySelector('#m-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#m-confirm').addEventListener('click', async () => {
    if (!selectedUserId) { showToast('Selecteer eerst een persoon', 'error'); return; }
    const membership_type = overlay.querySelector('#member-type').value;
    try {
      await api(`/api/admin/teams/${teamId}/members`, { method: 'POST', body: { userId: selectedUserId, membership_type } });
      overlay.remove();
      showToast('Lid toegevoegd', 'success');
      onSuccess();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function showEditPlayerModal(
  {
    userId,
    teamId,
    name,
    email,
    shirt,
    position,
    birthDate,
    membershipType,
    isNpc,
    canManageMembers,
  },
  onSuccess,
) {
  const POSITIONS = ['Libero', 'Setter', 'Outside hitter', 'Opposite', 'Middle blocker', 'Defensive specialist'];
  const mt = membershipType || 'player';

  const teamSection = canManageMembers
    ? `
      <p style="font-size:0.8rem;font-weight:600;color:var(--primary);margin:0 0 0.35rem;text-transform:uppercase;letter-spacing:0.05em">Team &amp; lidmaatschap</p>
      <p class="text-muted text-small" style="margin:0 0 0.75rem;font-size:0.76rem;line-height:1.4">
        NPC = placeholder zonder login. <strong>Koppel</strong> zet teamdata op een geregistreerd account.
      </p>
      <div class="form-group">
        <label class="form-label">Rol in dit team</label>
        <select id="ep-role" class="form-input">
          <option value="player"  ${mt === 'player'  ? 'selected' : ''}>🏐 Speler</option>
          <option value="coach"   ${mt === 'coach'   ? 'selected' : ''}>📋 Trainer / Coach</option>
          <option value="trainer" ${mt === 'trainer' ? 'selected' : ''}>📋 Trainer</option>
          <option value="staff"   ${mt === 'staff'   ? 'selected' : ''}>🎽 Begeleiding</option>
          <option value="parent"  ${mt === 'parent'  ? 'selected' : ''}>👨‍👩‍👧 Ouder / Contact</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Rugnummer</label>
        <input type="number" id="ep-shirt" class="form-input" value="${escAttr(shirt)}" min="1" max="99" placeholder="—" />
      </div>
      <div class="form-group">
        <label class="form-label">Positie op het veld</label>
        <select id="ep-position" class="form-input">
          <option value="">— Geen —</option>
          ${POSITIONS.map(p => `<option value="${p}"${position === p ? ' selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;font-size:0.86rem;line-height:1.35">
          <input type="checkbox" id="ep-npc" ${isNpc ? 'checked' : ''} style="margin-top:0.2rem;flex-shrink:0" />
          <span>Team-placeholder (NPC) — geen login</span>
        </label>
      </div>
      <div class="form-group" id="ep-merge-wrap" style="display:${isNpc ? 'block' : 'none'}">
        <button type="button" class="btn btn-primary btn-sm" style="width:100%" id="ep-merge">↗ Koppel aan geregistreerd account</button>
      </div>
      <div class="form-group" style="margin-bottom:1rem">
        <button type="button" class="btn btn-ghost btn-sm" id="ep-remove" style="color:var(--danger,#b91c1c);border:1px solid currentColor;width:100%">Verwijderen uit dit team</button>
      </div>
      `
    : `
      <p class="text-muted text-small" style="margin:0 0 0.75rem;font-size:0.8rem">
        Je kunt hier alleen naam en contact wijzigen. Teambeheer (rol, rugnummer, verwijderen) gaat via een teambeheerder.
      </p>
      `;

  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:400px;max-height:90vh;overflow-y:auto;text-align:left;padding:1.35rem 1.25rem 1.5rem">
      <h3 style="margin:0 0 0.75rem;font-size:1.1rem">✏️ ${escHtml(name)}</h3>
      ${teamSection}
      <p style="font-size:0.8rem;font-weight:600;color:var(--primary);margin:0 0 0.5rem;text-transform:uppercase;letter-spacing:0.05em">Persoonsgegevens</p>
      <div class="form-group">
        <label class="form-label">Naam</label>
        <input type="text" id="ep-name" class="form-input" value="${escAttr(name)}" />
      </div>
      <div class="form-group">
        <label class="form-label">E-mailadres</label>
        <input type="email" id="ep-email" class="form-input" value="${escAttr(email)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Geboortedatum</label>
        <input type="date" id="ep-birthdate" class="form-input" value="${escAttr(birthDate)}" />
      </div>
      <div class="flex gap-2 mt-3">
        <button type="button" class="btn btn-secondary" style="flex:1" id="ep-cancel">Annuleren</button>
        <button type="button" class="btn btn-primary" style="flex:1" id="ep-save">Opslaan</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const npcCb = overlay.querySelector('#ep-npc');
  const mergeWrap = overlay.querySelector('#ep-merge-wrap');
  if (canManageMembers && npcCb && mergeWrap) {
    npcCb.addEventListener('change', () => {
      mergeWrap.style.display = npcCb.checked ? 'block' : 'none';
    });
  }

  overlay.querySelector('#ep-merge')?.addEventListener('click', () => {
    overlay.remove();
    showNpcMergeModal(teamId, +userId, name, onSuccess);
  });

  overlay.querySelector('#ep-remove')?.addEventListener('click', async () => {
    if (!confirm(`${name} verwijderen uit dit team?`)) return;
    try {
      await api(`/api/admin/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
      overlay.remove();
      showToast('Lid verwijderd', 'info');
      onSuccess?.();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  overlay.querySelector('#ep-cancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#ep-save').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#ep-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Bezig…';
    try {
      const nameVal = overlay.querySelector('#ep-name').value.trim();
      const emailVal = overlay.querySelector('#ep-email').value.trim();
      if (!nameVal) {
        showToast('Naam is verplicht', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Opslaan';
        return;
      }

      if (canManageMembers) {
        await api(`/api/admin/teams/${teamId}/members/${userId}`, {
          method: 'PATCH',
          body: {
            membership_type: overlay.querySelector('#ep-role').value,
            shirt_number:    overlay.querySelector('#ep-shirt').value,
            position:        overlay.querySelector('#ep-position').value,
          },
        });
        await api(`/api/admin/users/${userId}/npc`, {
          method: 'PATCH',
          body: { is_npc: overlay.querySelector('#ep-npc').checked },
        });
      }

      await api(`/api/admin/users/${userId}/profile`, {
        method: 'POST',
        body: {
          name:       nameVal,
          email:      emailVal,
          birth_date: overlay.querySelector('#ep-birthdate').value,
        },
      });

      overlay.remove();
      showToast('Opgeslagen', 'success');
      onSuccess?.();
    } catch (err) {
      showToast(err.message || 'Opslaan mislukt', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Opslaan';
    }
  });
}

// ─── Edit user modal (club admin) ─────────────────────────────────────────────

function showEditUserModal({ userId, name, email, teamNames }, onSuccess) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:400px">
      <h3 style="margin-bottom:1rem">✏️ Gebruiker bewerken</h3>
      <p class="text-muted text-small" style="margin-bottom:1rem">${escHtml(teamNames || 'Geen team')}</p>
      <div class="form-group" style="margin-bottom:1rem">
        <label class="form-label" style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
          <input type="checkbox" id="eu-is-npc" />
          Team-placeholder (NPC) — geen login, alleen voor rooster
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">Naam</label>
        <input type="text" id="eu-name" class="form-input" value="${escAttr(name)}" />
      </div>
      <div class="form-group">
        <label class="form-label">E-mailadres</label>
        <input type="email" id="eu-email" class="form-input" value="${escAttr(email)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Geboortedatum</label>
        <input type="date" id="eu-birth" class="form-input" />
      </div>
      <div class="form-group" style="border-top:1px solid var(--border);padding-top:1rem;margin-top:0.5rem">
        <label class="form-label">Nieuw wachtwoord <span class="text-muted">(leeglaten = niet wijzigen)</span></label>
        <input type="password" id="eu-password" class="form-input" placeholder="Minimaal 6 tekens" autocomplete="new-password" />
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-secondary" style="flex:1" id="eu-cancel">Annuleren</button>
        <button class="btn btn-primary" style="flex:1" id="eu-save">Opslaan</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Pre-load current user data
  api(`/api/admin/users/${userId}/profile`).then(data => {
    if (data.user) {
      if (data.user.birth_date) overlay.querySelector('#eu-birth').value = data.user.birth_date;
      if (data.user.is_npc) overlay.querySelector('#eu-is-npc').checked = true;
    }
  }).catch(() => {});

  overlay.querySelector('#eu-cancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#eu-save').addEventListener('click', async () => {
    const body = {
      name:       overlay.querySelector('#eu-name').value.trim(),
      email:      overlay.querySelector('#eu-email').value.trim(),
      birth_date: overlay.querySelector('#eu-birth').value,
    };
    const pw = overlay.querySelector('#eu-password').value;
    if (pw) body.password = pw;

    if (!body.name) { showToast('Naam is verplicht', 'error'); return; }

    try {
      await api(`/api/admin/users/${userId}/profile`, { method: 'POST', body });
      await api(`/api/admin/users/${userId}/npc`, {
        method: 'PATCH',
        body: { is_npc: overlay.querySelector('#eu-is-npc').checked },
      });
      showToast('Gebruiker opgeslagen', 'success');
      overlay.remove();
      onSuccess?.();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
