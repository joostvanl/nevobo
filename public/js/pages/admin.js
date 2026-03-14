import { api, state, showToast } from '../app.js';

export async function render(container) {
  container.innerHTML = '<div class="spinner"></div>';

  if (!state.user) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><p>Log in om dit te bekijken.</p></div>`;
    return;
  }

  try {
    const { roles } = await api('/api/admin/my-roles');
    state.user.roles = roles;

    if (!roles.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔒</div>
          <h3>Geen beheerdersrechten</h3>
          <p>Je hebt nog geen beheerdersrol. Neem contact op met een beheerder van je club.</p>
        </div>`;
      return;
    }

    const isSuperAdmin = roles.some(r => r.role === 'super_admin');
    const clubAdminRoles = roles.filter(r => r.role === 'club_admin');
    const teamAdminRoles = roles.filter(r => r.role === 'team_admin');

    // Build tabs list
    const tabs = [];
    if (isSuperAdmin) tabs.push({ id: 'super', label: '⚡ Opperbeheerder' });
    clubAdminRoles.forEach(r => tabs.push({ id: `club_${r.club_id}`, label: `🏛 ${r.club_name || 'Club'}` }));
    teamAdminRoles.forEach(r => tabs.push({ id: `team_${r.team_id}`, label: `👥 ${r.team_name || 'Team'}` }));

    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <h1>⚙️ Beheer</h1>
          <p>Rollen &amp; ledenbeheer</p>
        </div>
      </div>
      <div class="container">
        <div class="filter-pills mb-3" id="admin-tabs">
          ${tabs.map((t, i) => `
            <button class="filter-pill${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>
          `).join('')}
        </div>
        <div id="admin-panel"></div>
      </div>`;

    const panel = container.querySelector('#admin-panel');

    // Tab switching
    container.querySelectorAll('.filter-pill[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.filter-pill[data-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTab(btn.dataset.tab, panel, roles);
      });
    });

    // Render first tab
    if (tabs.length) renderTab(tabs[0].id, panel, roles);

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

// ─── Tab renderers ────────────────────────────────────────────────────────────

async function renderTab(tabId, panel, roles) {
  panel.innerHTML = '<div class="spinner" style="padding:2rem;text-align:center"></div>';

  if (tabId === 'super') {
    await renderSuperAdminTab(panel);
  } else if (tabId.startsWith('club_')) {
    const clubId = parseInt(tabId.replace('club_', ''));
    await renderClubAdminTab(panel, clubId);
  } else if (tabId.startsWith('team_')) {
    const teamId = parseInt(tabId.replace('team_', ''));
    await renderTeamAdminTab(panel, teamId);
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
  } catch (err) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

// ─── Team Admin Tab ───────────────────────────────────────────────────────────

async function renderTeamAdminTab(panel, teamId) {
  try {
    const { members, team } = await api(`/api/admin/teams/${teamId}/members`);

    const groups = [
      { key: 'player', label: '🏐 Spelers',         list: members.filter(m => m.membership_type === 'player') },
      { key: 'coach',  label: '📋 Trainer / Coach',  list: members.filter(m => m.membership_type === 'coach') },
      { key: 'staff',  label: '🎽 Begeleiding',       list: members.filter(m => m.membership_type === 'staff') },
      { key: 'parent', label: '👨‍👩‍👧 Ouders / Contacten', list: members.filter(m => m.membership_type === 'parent') },
    ];

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <span class="text-muted text-small">${team?.club_name || ''} · ${members.length} leden</span>
        <button class="btn btn-primary btn-sm" id="add-member-btn">+ Lid toevoegen</button>
      </div>
      ${groups.map(g => `
        <div class="section-header mt-3 mb-1">
          <span class="section-title">${g.label} (${g.list.length})</span>
        </div>
        <div id="group-${g.key}">
          ${g.list.length
            ? g.list.map(m => memberRow(m, teamId)).join('')
            : `<p class="text-muted text-small" style="padding:0.35rem 0.5rem">Geen ${g.label.replace(/^[^ ]+ /, '').toLowerCase()}.</p>`}
        </div>`).join('')}`;

    panel.querySelector('#add-member-btn').addEventListener('click', () => {
      showAddMemberModal(teamId, team.club_id, () => renderTeamAdminTab(panel, teamId));
    });

    panel.querySelectorAll('.edit-member-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showEditPlayerModal({
          userId:    btn.dataset.userid,
          name:      btn.dataset.name,
          email:     btn.dataset.email,
          shirt:     btn.dataset.shirt,
          position:  btn.dataset.position,
          birthDate: btn.dataset.birthdate,
        }, () => renderTeamAdminTab(panel, teamId));
      });
    });

    panel.querySelectorAll('.change-role-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showChangeRoleModal(teamId, btn.dataset.userid, btn.dataset.name, btn.dataset.role,
          () => renderTeamAdminTab(panel, teamId));
      });
    });

    panel.querySelectorAll('.remove-member-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Lid verwijderen uit team?')) return;
        try {
          await api(`/api/admin/teams/${teamId}/members/${btn.dataset.userid}`, { method: 'DELETE' });
          showToast('Lid verwijderd', 'info');
          renderTeamAdminTab(panel, teamId);
        } catch (err) { showToast(err.message, 'error'); }
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
  player: 'Speler',
  coach:  'Trainer/Coach',
  staff:  'Begeleiding',
  parent: 'Ouder',
};

function memberRow(m, teamId) {
  const posLabel   = m.position     ? `<span class="chip chip-neutral" style="font-size:0.62rem">${escHtml(m.position)}</span>` : '';
  const shirtLabel = m.shirt_number != null ? `<span class="chip chip-neutral" style="font-size:0.62rem">#${m.shirt_number}</span>` : '';
  const roleLabel  = ROLE_LABELS[m.membership_type] || m.membership_type;
  return `
    <div class="admin-user-row" data-member-id="${m.user_id}">
      <div class="admin-user-info" style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
          <strong>${escHtml(m.name)}</strong>
          ${shirtLabel}${posLabel}
        </div>
        <span class="text-muted text-small">${escHtml(m.email)}</span>
      </div>
      <div class="flex gap-1 items-center" style="flex-shrink:0">
        <button class="btn btn-ghost btn-sm change-role-btn"
          data-userid="${m.user_id}"
          data-name="${escAttr(m.name)}"
          data-role="${m.membership_type}"
          style="font-size:0.72rem;color:var(--accent);padding:0.2rem 0.45rem;border:1px solid var(--border);border-radius:999px"
          title="Rol wijzigen">${roleLabel} ▾</button>
        <button class="btn btn-ghost btn-sm edit-member-btn"
          data-userid="${m.user_id}"
          data-name="${escAttr(m.name)}"
          data-email="${escAttr(m.email)}"
          data-shirt="${m.shirt_number ?? ''}"
          data-position="${escAttr(m.position || '')}"
          data-birthdate="${escAttr(m.birth_date || '')}"
          data-team="${teamId}"
          style="color:var(--primary)">✏️</button>
        <button class="btn btn-secondary btn-sm remove-member-btn" data-userid="${m.user_id}" data-team="${teamId}">✕</button>
      </div>
    </div>`;
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

function showChangeRoleModal(teamId, userId, userName, currentRole, onSuccess) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:320px">
      <h3 style="margin-bottom:0.5rem">Rol wijzigen</h3>
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem"><strong>${escHtml(userName)}</strong></p>
      <div class="form-group">
        <label class="form-label">Rol</label>
        <select id="cr-role" class="form-input">
          <option value="player"  ${currentRole === 'player'  ? 'selected' : ''}>🏐 Speler</option>
          <option value="coach"   ${currentRole === 'coach'   ? 'selected' : ''}>📋 Trainer / Coach</option>
          <option value="staff"   ${currentRole === 'staff'   ? 'selected' : ''}>🎽 Begeleiding</option>
          <option value="parent"  ${currentRole === 'parent'  ? 'selected' : ''}>👨‍👩‍👧 Ouder / Contact</option>
        </select>
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-secondary" style="flex:1" id="cr-cancel">Annuleren</button>
        <button class="btn btn-primary" style="flex:1" id="cr-confirm">Opslaan</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#cr-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cr-confirm').addEventListener('click', async () => {
    const membership_type = overlay.querySelector('#cr-role').value;
    try {
      await api(`/api/admin/teams/${teamId}/members/${userId}`, { method: 'PATCH', body: { membership_type } });
      overlay.remove();
      showToast('Rol bijgewerkt', 'success');
      onSuccess();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function showEditPlayerModal({ userId, name, email, shirt, position, birthDate }, onSuccess) {
  const POSITIONS = ['Libero', 'Setter', 'Outside hitter', 'Opposite', 'Middle blocker', 'Defensive specialist'];

  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:380px">
      <h3 style="margin-bottom:0.25rem">✏️ Speler bewerken</h3>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1.25rem">
        ℹ️ Persoonlijke gegevens — alleen zichtbaar voor beheerders
      </p>
      <div class="form-group">
        <label class="form-label">Naam</label>
        <input type="text" id="ep-name" class="form-input" value="${escAttr(name)}" />
      </div>
      <div class="form-group">
        <label class="form-label">E-mailadres</label>
        <input type="email" id="ep-email" class="form-input" value="${escAttr(email)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Shirtnummer</label>
        <input type="number" id="ep-shirt" class="form-input" value="${escAttr(shirt)}" min="1" max="99" placeholder="Bijv. 7" />
      </div>
      <div class="form-group">
        <label class="form-label">Positie</label>
        <select id="ep-position" class="form-input">
          <option value="">— Geen —</option>
          ${POSITIONS.map(p => `<option value="${p}"${position === p ? ' selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Geboortedatum</label>
        <input type="date" id="ep-birthdate" class="form-input" value="${escAttr(birthDate)}" />
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-secondary" style="flex:1" id="ep-cancel">Annuleren</button>
        <button class="btn btn-primary" style="flex:1" id="ep-save">Opslaan</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#ep-cancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#ep-save').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#ep-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Bezig…';
    try {
      await api(`/api/admin/users/${userId}/profile`, {
        method: 'POST',
        body: {
          name:         overlay.querySelector('#ep-name').value.trim(),
          email:        overlay.querySelector('#ep-email').value.trim(),
          shirt_number: overlay.querySelector('#ep-shirt').value,
          position:     overlay.querySelector('#ep-position').value,
          birth_date:   overlay.querySelector('#ep-birthdate').value,
        },
      });
      overlay.remove();
      showToast('Profiel bijgewerkt', 'success');
      if (onSuccess) onSuccess();
    } catch (err) {
      showToast(err.message || 'Opslaan mislukt', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Opslaan';
    }
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;');
}
