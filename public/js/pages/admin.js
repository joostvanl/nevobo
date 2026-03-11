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

    const players = members.filter(m => m.membership_type === 'player');
    const parents = members.filter(m => m.membership_type === 'parent');

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <span class="text-muted text-small">${team?.club_name || ''} · ${members.length} leden</span>
        <button class="btn btn-primary btn-sm" id="add-member-btn">+ Lid toevoegen</button>
      </div>

      <div class="section-header mb-1"><span class="section-title">Spelers (${players.length})</span></div>
      <div id="players-list">
        ${players.length
          ? players.map(m => memberRow(m, teamId)).join('')
          : `<p class="text-muted text-small" style="padding:0.5rem">Geen spelers.</p>`}
      </div>

      <div class="section-header mt-3 mb-1"><span class="section-title">Ouders / Contacten (${parents.length})</span></div>
      <div id="parents-list">
        ${parents.length
          ? parents.map(m => memberRow(m, teamId)).join('')
          : `<p class="text-muted text-small" style="padding:0.5rem">Geen ouders/contacten.</p>`}
      </div>`;

    panel.querySelector('#add-member-btn').addEventListener('click', () => {
      showAddMemberModal(teamId, () => renderTeamAdminTab(panel, teamId));
    });

    panel.querySelectorAll('.remove-member-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
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

function memberRow(m, teamId) {
  return `
    <div class="admin-user-row">
      <div class="admin-user-info">
        <strong>${escHtml(m.name)}</strong>
        <span class="text-muted text-small">${escHtml(m.email)}</span>
      </div>
      <button class="btn btn-secondary btn-sm remove-member-btn" data-userid="${m.user_id}" data-team="${teamId}">Verwijderen</button>
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

function showAddMemberModal(teamId, onSuccess) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:1rem">Teamlid toevoegen</h3>
      <div class="form-group">
        <label class="form-label">E-mailadres</label>
        <input type="email" id="member-email" class="form-input" placeholder="naam@voorbeeld.nl" />
      </div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select id="member-type" class="form-input">
          <option value="player">Speler</option>
          <option value="parent">Ouder / Contact</option>
        </select>
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-secondary" style="flex:1" id="m-cancel">Annuleren</button>
        <button class="btn btn-primary" style="flex:1" id="m-confirm">Toevoegen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#m-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#m-confirm').addEventListener('click', async () => {
    const email = overlay.querySelector('#member-email').value.trim();
    const membership_type = overlay.querySelector('#member-type').value;
    if (!email) { showToast('Voer een e-mailadres in', 'error'); return; }
    try {
      await api(`/api/admin/teams/${teamId}/members`, { method: 'POST', body: { email, membership_type } });
      overlay.remove();
      showToast('Lid toegevoegd', 'success');
      onSuccess();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;');
}
