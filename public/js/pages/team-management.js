import { api, state, showToast, navigate } from '../app.js';
import { escHtml } from '../escape-html.js';

const escAttr = escHtml;

function uniqClubsFromRoles(roles) {
  const map = new Map();
  for (const r of roles || []) {
    if (r.role === 'club_admin' && r.club_id) {
      map.set(r.club_id, { id: r.club_id, name: r.club_name || `Club ${r.club_id}` });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

function clubDisplayName(clubId, fromRoles, user) {
  const id = Number(clubId);
  const fromRole = fromRoles.find((c) => Number(c.id) === id);
  if (fromRole?.name) return fromRole.name;
  const mem = (user?.memberships || []).find((m) => Number(m.club_id) === id);
  if (mem?.club_name) return mem.club_name;
  return null;
}

/** Unieke club-id's waar de gebruiker teamlid van is (zelfde bron als /me). */
function uniqueMembershipClubIds(user) {
  const ids = new Set();
  for (const m of user?.memberships || []) {
    if (m.club_id != null && m.club_id !== '') ids.add(Number(m.club_id));
  }
  return [...ids];
}

export async function render(container, params = {}) {
  container.innerHTML = '<div class="spinner"></div>';

  if (!state.user) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><p>Log in om teams te beheren.</p></div>`;
    return;
  }

  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    try {
      localStorage.setItem('vb_user', JSON.stringify(me.user));
    } catch (_) {}
  } catch (_) {}

  let roles;
  try {
    ({ roles } = await api('/api/admin/my-roles'));
  } catch {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><p>Geen toegang.</p></div>`;
    return;
  }

  const isSuper = roles.some((r) => r.role === 'super_admin');
  const fromRoles = uniqClubsFromRoles(roles);
  const canManageClub = (clubId) => {
    const id = Number(clubId);
    if (isSuper) return true;
    return fromRoles.some((c) => Number(c.id) === id);
  };

  const memClubIds = uniqueMembershipClubIds(state.user);
  let implicitClubId = null;
  if (state.user.club_id != null && state.user.club_id !== '') {
    const x = parseInt(String(state.user.club_id), 10);
    if (!Number.isNaN(x)) implicitClubId = x;
  }
  if (implicitClubId == null && memClubIds.length === 1) {
    implicitClubId = memClubIds[0];
  }

  let clubOptions = [];

  if (implicitClubId != null && canManageClub(implicitClubId)) {
    const nm = clubDisplayName(implicitClubId, fromRoles, state.user) || 'Je vereniging';
    clubOptions = [{ id: implicitClubId, name: nm }];
  } else if (fromRoles.length === 1) {
    clubOptions = fromRoles;
  } else if (fromRoles.length > 1) {
    clubOptions = fromRoles;
  } else if (isSuper) {
    try {
      const { clubs } = await api('/api/clubs');
      clubOptions = (clubs || []).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
    } catch {
      clubOptions = [];
    }
  }

  if (!clubOptions.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔒</div>
        <h3>Geen clubbeheer</h3>
        <p>Je hebt geen clubbeheerdersrol. Teams beheren kan via een beheerder van je vereniging.</p>
      </div>`;
    return;
  }

  let selectedClubId = params.clubId ? parseInt(params.clubId, 10) : null;
  if (
    !selectedClubId ||
    !clubOptions.some((c) => Number(c.id) === Number(selectedClubId))
  ) {
    selectedClubId = Number(clubOptions[0].id);
  }

  const clubSelectHtml =
    clubOptions.length > 1
      ? `<div class="form-group mb-3">
          <label class="form-label" for="tm-club-select">Vereniging</label>
          <select id="tm-club-select" class="form-select">
            ${clubOptions.map((c) => `<option value="${c.id}"${c.id === selectedClubId ? ' selected' : ''}>${escHtml(c.name)}</option>`).join('')}
          </select>
        </div>`
      : '';

  container.innerHTML = `
    <div class="page-hero">
      <div class="container">
        <h1>🏐 Teams</h1>
        <p>Teams aanmaken, koppelen aan Nevobo, leden en status</p>
      </div>
    </div>
    <div class="container">
      ${clubSelectHtml}
      <div class="flex gap-2 mb-3" style="flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-primary btn-sm" id="tm-new-team">+ Nieuw team</button>
        <button type="button" class="btn btn-secondary btn-sm" id="tm-refresh">↻ Vernieuwen</button>
        <a href="#" class="text-small text-muted" id="tm-open-admin">→ Leden &amp; rollen (gebruikersbeheer)</a>
      </div>
      <div id="tm-list"><div class="spinner" style="padding:2rem;text-align:center"></div></div>
    </div>`;

  const listEl = container.querySelector('#tm-list');
  const clubSelect = container.querySelector('#tm-club-select');

  let lastClub = null;

  const currentClubId = () =>
    clubSelect ? parseInt(clubSelect.value, 10) : selectedClubId;

  async function loadTeams(clubId) {
    listEl.innerHTML = '<div class="spinner" style="padding:2rem;text-align:center"></div>';
    try {
      const data = await api(`/api/admin/clubs/${clubId}/teams-manage`);
      lastClub = data.club;
      renderTeamList(listEl, data.club, data.teams || [], clubId, loadTeams);
    } catch (err) {
      listEl.innerHTML = `<p class="text-muted">${escHtml(err.message)}</p>`;
    }
  }

  if (clubSelect) {
    clubSelect.addEventListener('change', () => loadTeams(parseInt(clubSelect.value, 10)));
  }

  container.querySelector('#tm-new-team').addEventListener('click', () => {
    const cid = currentClubId();
    showTeamModal({ club: lastClub, clubId: cid, mode: 'create', onSaved: () => loadTeams(cid) });
  });
  container.querySelector('#tm-refresh').addEventListener('click', () => loadTeams(currentClubId()));
  container.querySelector('#tm-open-admin').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('admin', { clubId: currentClubId() });
  });

  await loadTeams(selectedClubId);
}

function renderTeamList(container, club, teams, clubId, reloadFn) {
  if (!teams.length) {
    container.innerHTML = `<p class="text-muted text-small">Nog geen teams. Voeg een team toe of synchroniseer via Nevobo (RSS) vanuit andere beheerflows.</p>`;
    return;
  }

  container.innerHTML = teams
    .map((t) => {
      const active = Number(t.is_active) !== 0;
      const nevobo =
        t.nevobo_team_type && t.nevobo_number != null
          ? `${escHtml(t.nevobo_team_type)} · ${t.nevobo_number}`
          : '— geen Nevobo-koppeling —';
      return `
      <div class="card mb-2 tm-team-card" style="padding:0.85rem 1rem">
        <div style="display:flex;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;align-items:flex-start">
          <div>
            <strong>${escHtml(t.display_name)}</strong>
            ${active ? '' : '<span class="chip chip-neutral" style="font-size:0.65rem;margin-left:0.35rem">Inactief</span>'}
            <div class="text-muted text-small" style="margin-top:0.25rem">${nevobo}</div>
            <div class="text-muted text-small">${t.member_count ?? 0} leden</div>
          </div>
          <div class="flex gap-1" style="flex-wrap:wrap">
            <button type="button" class="btn btn-secondary btn-sm tm-edit" data-id="${t.id}">Bewerken</button>
            <button type="button" class="btn btn-ghost btn-sm tm-members" data-id="${t.id}">Leden</button>
            <button type="button" class="btn btn-danger btn-sm tm-del" data-id="${t.id}" data-name="${escAttr(t.display_name)}">Verwijderen</button>
          </div>
        </div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.tm-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const team = teams.find((x) => String(x.id) === btn.dataset.id);
      if (team) showTeamModal({ club, clubId, team, mode: 'edit', onSaved: () => reloadFn(clubId) });
    });
  });
  container.querySelectorAll('.tm-members').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigate('admin', { teamId: parseInt(btn.dataset.id, 10), clubId });
    });
  });
  container.querySelectorAll('.tm-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Team “${btn.dataset.name}” permanent verwijderen? Alle koppelingen (leden, trainingen, …) gaan mee.`)) return;
      try {
        await api(`/api/clubs/${clubId}/teams/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Team verwijderd', 'success');
        reloadFn(clubId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

let nevoboCache = { clubId: null, teams: [] };

async function fetchNevoboTeams(clubId) {
  const { teams } = await api(`/api/clubs/${clubId}/nevobo-competition-teams`);
  nevoboCache = { clubId, teams: teams || [] };
  return nevoboCache.teams;
}

function nevoboSelectOptions(teams, currentPath) {
  const opts = [
    `<option value="">— Geen / koppeling wissen —</option>`,
    ...teams.map((nt) => {
      const path = nt.team_path || '';
      const label = `${nt.naam || path}${nt.standpositietekst ? ` (${nt.standpositietekst})` : ''}`;
      const sel = path && path === currentPath ? ' selected' : '';
      return `<option value="${escAttr(path)}" data-nevobo-naam="${escAttr(nt.naam || '')}"${sel}>${escHtml(label)}</option>`;
    }),
  ];
  return opts.join('');
}

/** Rebuild path for current team from DB nevobo fields (preselect in edit). */
function inferCurrentPath(club, team) {
  const code = (club?.nevobo_code || '').toLowerCase();
  if (!code || !team?.nevobo_team_type) return '';
  return `/competitie/teams/${code}/${team.nevobo_team_type}/${team.nevobo_number}`;
}

function showTeamModal({ club, clubId, team, mode, onSaved }) {
  const isEdit = mode === 'edit';
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:420px;width:92vw;padding:1.25rem;text-align:left;position:relative;z-index:1">
      <h3 style="margin-top:0">${isEdit ? 'Team bewerken' : 'Nieuw team'}</h3>
      <div class="form-group">
        <label class="form-label" for="tm-dn">Teamnaam in app</label>
        <input type="text" id="tm-dn" class="form-input" value="${isEdit ? escAttr(team.display_name) : ''}" placeholder="Bijv. MA 1" />
      </div>
      <div class="form-group">
        <label class="form-label">
          <input type="checkbox" id="tm-active" ${!isEdit || Number(team.is_active) !== 0 ? 'checked' : ''} />
          Team is actief (zichtbaar in app, nieuwe leden toegestaan)
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">Nevobo-competitieteam</label>
        <p class="text-muted text-small" style="margin:0 0 0.5rem">Kies een team uit de officiële Nevobo-lijst van je vereniging.</p>
        <button type="button" class="btn btn-secondary btn-sm mb-2" id="tm-load-nevobo">Laad / ververs Nevobo-teams</button>
        <select id="tm-nevobo" class="form-select">${nevoboSelectOptions([], '')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">
          <input type="checkbox" id="tm-sync-name" checked />
          Teamnaam overnemen van Nevobo bij koppelen
        </label>
      </div>
      <div class="flex gap-2" style="justify-content:flex-end;margin-top:1rem">
        <button type="button" class="btn btn-ghost" id="tm-cancel">Annuleren</button>
        <button type="button" class="btn btn-primary" id="tm-save">Opslaan</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const sel = overlay.querySelector('#tm-nevobo');
  const loadBtn = overlay.querySelector('#tm-load-nevobo');

  async function populateNevoboSelect() {
    loadBtn.disabled = true;
    try {
      const list = await fetchNevoboTeams(clubId);
      const current = isEdit ? inferCurrentPath(club, team) : '';
      sel.innerHTML = nevoboSelectOptions(list, current);
    } catch (err) {
      showToast(err.message || 'Nevobo laden mislukt', 'error');
    } finally {
      loadBtn.disabled = false;
    }
  }

  populateNevoboSelect();

  loadBtn.addEventListener('click', () => populateNevoboSelect());

  overlay.querySelector('#tm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#tm-save').addEventListener('click', async () => {
    const display_name = overlay.querySelector('#tm-dn').value.trim();
    const is_active = overlay.querySelector('#tm-active').checked;
    const path = overlay.querySelector('#tm-nevobo').value.trim();
    const syncName = overlay.querySelector('#tm-sync-name').checked;
    const opt = path ? overlay.querySelector('#tm-nevobo option:checked') : null;
    const naam_from_nevobo = opt?.dataset?.nevoboNaam || '';

    try {
      if (isEdit) {
        const body = { display_name, is_active };
        if (!path) {
          body.clear_nevobo = true;
        } else {
          body.nevobo_team_path = path;
          if (syncName && naam_from_nevobo) {
            body.sync_display_name_from_nevobo = true;
            body.naam_from_nevobo = naam_from_nevobo;
          }
        }
        await api(`/api/clubs/${clubId}/teams/${team.id}`, { method: 'PATCH', body });
      } else {
        if (!display_name && !path) {
          showToast('Vul een teamnaam in of kies een Nevobo-team', 'error');
          return;
        }
        const body = {};
        if (path) {
          body.nevobo_team_path = path;
          body.sync_display_name_from_nevobo = syncName;
          body.naam_from_nevobo = naam_from_nevobo;
          if (!syncName || !naam_from_nevobo) body.display_name = display_name;
        } else {
          body.display_name = display_name;
        }
        await api(`/api/clubs/${clubId}/teams`, { method: 'POST', body });
      }
      showToast('Opgeslagen', 'success');
      overlay.remove();
      onSaved?.();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
