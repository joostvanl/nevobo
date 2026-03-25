import { api, state, navigate, showToast } from '../app.js';
import { escHtml } from '../escape-html.js';
import { renderExerciseMarkdown } from '../markdown-render.js';

const DIFF_LABEL = { easy: 'Makkelijk', medium: 'Gemiddeld', hard: 'Moeilijk' };

const LS_GUIDELINES = (cid) => `volley_tm_guidelines_${cid}`;
const LS_PINS = (cid) => `volley_tm_pins_${cid}`;

let _ctx = null;
let _onKey = null;

function hasClubAdminAccess() {
  return (state.user?.roles?.length ?? 0) > 0;
}

function clubDisplayName() {
  const u = state.user;
  const r = u?.roles?.find((x) => x.club_name);
  if (r?.club_name) return r.club_name;
  const m = u?.memberships?.[0];
  if (m?.club_name) return m.club_name;
  return 'Je club';
}

function readPins(clubId) {
  try {
    const raw = localStorage.getItem(LS_PINS(clubId));
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : [];
  } catch (_) {
    return [];
  }
}

function writePins(clubId, ids) {
  localStorage.setItem(LS_PINS(clubId), JSON.stringify(ids));
}

function readGuidelines(clubId) {
  try {
    return localStorage.getItem(LS_GUIDELINES(clubId)) || '';
  } catch (_) {
    return '';
  }
}

function writeGuidelines(clubId, text) {
  localStorage.setItem(LS_GUIDELINES(clubId), text);
}

export async function render(container) {
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }

  if (!state.user) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-icon">🔒</div><p>Log in om deze pagina te openen.</p></div>';
    return;
  }
  if (!hasClubAdminAccess()) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🚫</div>
        <p>Alleen clubbeheerders hebben toegang tot de trainingsmodule.</p>
        <button type="button" class="btn btn-primary mt-2" onclick="navigate('home')">Naar home</button>
      </div>`;
    return;
  }
  if (!state.user.club_id) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-icon">📋</div><p>Geen club gekoppeld aan je account.</p></div>';
    return;
  }

  document.getElementById('app')?.classList.add('tp-fullwidth');

  const clubId = state.user.club_id;
  _ctx = {
    container,
    clubId,
    tab: 'workflow',
    pending: [],
    tags: [],
    exercisesAll: [],
    exercisesClub: [],
    search: '',
    diffFilter: '',
    tagFilter: '',
    sort: 'name',
    drawerMode: null,
    drawerEx: null,
    pins: readPins(clubId),
  };

  container.innerHTML = buildShellHtml();
  bindShell();
  container.querySelector('#tm-main').innerHTML =
    '<div class="tm-lib-empty">Laden…</div>';

  try {
    await reloadData();
  } catch (e) {
    showToast(e.message || 'Laden mislukt', 'error');
    container.querySelector('#tm-main').innerHTML = `<div class="tm-lib-empty">${escHtml(e.message || 'Fout')}</div>`;
    return;
  }

  updateStatsStrip();
  renderTabPanel();
  wireGlobalKeys();
}

function buildShellHtml() {
  return `
    <div class="tm-shell training-module-page">
      <div class="tm-hero">
        <div class="tm-hero-inner">
          <div class="tm-topbar">
            <div class="tm-brand">
              <span class="tm-kicker">Beheer · Oefeningen · Richtlijnen</span>
              <h1 class="tm-title-xl">Trainingsmodule</h1>
              <p class="tm-lead">
                Centrale cockpit voor <strong>${escHtml(clubDisplayName())}</strong>: keur coach-aanvragen goed,
                bouw een levendige oefeningenbibliotheek, beheer vaardigheidstags en borg technische richtlijnen voor jeugd en senioren.
              </p>
            </div>
            <div class="tm-top-actions">
              <button type="button" class="tm-btn-planner" id="tm-goto-planner" title="Blauwdruk en weekplanning">
                📋 Trainingsplanner
              </button>
            </div>
          </div>
          <div class="tm-stats" id="tm-stats-strip">
            <div class="tm-stat tm-stat--pending"><div class="tm-stat-value" id="tm-st-pend">0</div><div class="tm-stat-label">Open aanvragen</div></div>
            <div class="tm-stat tm-stat--lib"><div class="tm-stat-value" id="tm-st-lib">0</div><div class="tm-stat-label">Club-oefeningen</div></div>
            <div class="tm-stat tm-stat--tags"><div class="tm-stat-value" id="tm-st-tags">0</div><div class="tm-stat-label">Vaardigheidstags</div></div>
            <div class="tm-stat tm-stat--memo"><div class="tm-stat-value" id="tm-st-memo">—</div><div class="tm-stat-label">Clubnotities</div></div>
          </div>
        </div>
      </div>
      <div class="tm-shell-inner">
        <nav class="tm-tabs" role="tablist" aria-label="Trainingsmodule">
          <button type="button" class="tm-tab active" data-tab="workflow" role="tab" aria-selected="true">
            Workflow<span class="tm-tab-badge" id="tm-tab-badge-pend" hidden>0</span>
          </button>
          <button type="button" class="tm-tab" data-tab="library" role="tab" aria-selected="false">Bibliotheek</button>
          <button type="button" class="tm-tab" data-tab="skills" role="tab" aria-selected="false">Vaardigheden</button>
          <button type="button" class="tm-tab" data-tab="docs" role="tab" aria-selected="false">Richtlijnen</button>
        </nav>
        <main class="tm-main" id="tm-main"></main>
      </div>
      <div class="tm-drawer-backdrop" id="tm-drawer-backdrop" aria-hidden="true"></div>
      <aside class="tm-drawer" id="tm-drawer-panel" aria-hidden="true" aria-label="Oefening"></aside>
    </div>`;
}

function bindShell() {
  const c = _ctx.container;
  c.querySelector('#tm-goto-planner')?.addEventListener('click', () => navigate('training-planner'));

  c.querySelectorAll('.tm-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tab;
      if (!t || t === _ctx.tab) return;
      _ctx.tab = t;
      c.querySelectorAll('.tm-tab').forEach((b) => {
        const on = b.dataset.tab === t;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderTabPanel();
    });
  });

  c.querySelector('#tm-drawer-backdrop')?.addEventListener('click', closeDrawer);
}

function wireGlobalKeys() {
  _onKey = (e) => {
    if (e.key === 'Escape') closeDrawer();
    if (
      e.key === '/' &&
      _ctx.tab === 'library' &&
      e.target &&
      !e.target.closest('input, textarea, select, [contenteditable]')
    ) {
      e.preventDefault();
      _ctx.container.querySelector('#tm-lib-search')?.focus();
    }
  };
  document.addEventListener('keydown', _onKey);
}

async function reloadData() {
  const [pend, tags, allEx] = await Promise.all([
    api('/api/training/exercises/pending-share').catch(() => ({ exercises: [] })),
    api('/api/training/skill-tags'),
    api('/api/training/exercises?q='),
  ]);
  _ctx.pending = pend.exercises || [];
  _ctx.tags = tags.tags || [];
  _ctx.exercisesAll = allEx.exercises || [];
  _ctx.exercisesClub = _ctx.exercisesAll.filter((x) => x.scope === 'club');
}

function updateStatsStrip() {
  const c = _ctx.container;
  const pend = _ctx.pending.length;
  const lib = _ctx.exercisesClub.length;
  const tags = _ctx.tags.length;
  const memo = readGuidelines(_ctx.clubId).trim();
  const memoLabel = memo.length ? `${Math.min(99, Math.ceil(memo.length / 200))}×` : '—';

  const elP = c.querySelector('#tm-st-pend');
  const elL = c.querySelector('#tm-st-lib');
  const elT = c.querySelector('#tm-st-tags');
  const elM = c.querySelector('#tm-st-memo');
  if (elP) elP.textContent = String(pend);
  if (elL) elL.textContent = String(lib);
  if (elT) elT.textContent = String(tags);
  if (elM) elM.textContent = memoLabel;

  const badge = c.querySelector('#tm-tab-badge-pend');
  if (badge) {
    badge.textContent = String(pend);
    badge.hidden = pend === 0;
  }
}

function renderTabPanel() {
  const main = _ctx.container.querySelector('#tm-main');
  if (!main) return;

  if (_ctx.tab === 'workflow') main.innerHTML = renderWorkflowHtml();
  else if (_ctx.tab === 'library') main.innerHTML = renderLibraryHtml();
  else if (_ctx.tab === 'skills') main.innerHTML = renderSkillsHtml();
  else main.innerHTML = renderDocsHtml();

  wireTabEvents();
}

function renderWorkflowHtml() {
  const n = _ctx.pending.length;
  const pipeActive = n > 0 ? ' tm-pipe-step--active' : '';
  return `
    <div class="tm-pipeline" aria-label="Goedkeuringsstappen">
      <div class="tm-pipe-step">
        <div class="tm-pipe-num">1</div>
        <p class="tm-pipe-title">Coach deelt</p>
        <p class="tm-pipe-desc">Een privé-oefening wordt aangeboden met motivatie — zichtbaar op de teampagina.</p>
      </div>
      <span class="tm-pipe-arrow" aria-hidden="true">→</span>
      <div class="tm-pipe-step${pipeActive}">
        <div class="tm-pipe-num">2</div>
        <p class="tm-pipe-title">Jouw beoordeling</p>
        <p class="tm-pipe-desc">Controleer inhoud, niveau en tags. Goedkeuren promoveert naar de clubbibliotheek.</p>
      </div>
      <span class="tm-pipe-arrow" aria-hidden="true">→</span>
      <div class="tm-pipe-step">
        <div class="tm-pipe-num">3</div>
        <p class="tm-pipe-title">Clubbibliotheek</p>
        <p class="tm-pipe-desc">Alle teams en coaches kunnen de oefening in trainingen gebruiken.</p>
      </div>
    </div>
    <div class="tm-flow-grid" id="tm-flow-list">
      ${n ? _ctx.pending.map(renderPendingCard).join('') : `<div class="tm-lib-empty" style="grid-column:1/-1">
        Geen openstaande aanvragen. Coaches kunnen vanuit een trainingssessie een privé-oefening aan de club aanbieden.
      </div>`}
    </div>`;
}

function diffChipClass(d) {
  if (d === 'easy') return 'tm-flow-chip--diff-easy';
  if (d === 'hard') return 'tm-flow-chip--diff-hard';
  return 'tm-flow-chip--diff-medium';
}

function renderPendingCard(ex) {
  const tags = (ex.tags || []).map((t) => `<span class="tm-flow-chip">${escHtml(t.name)}</span>`).join('');
  const desc = (ex.description || '').trim();
  const pitch = ex.share_pitch ? escHtml(ex.share_pitch) : '<em class="text-muted">Geen toelichting</em>';
  return `
    <article class="tm-flow-card" data-id="${ex.id}">
      <div class="tm-flow-card-head">
        <h3 class="tm-flow-title">${escHtml(ex.name)}</h3>
        <span class="tm-flow-meta">Indiener: ${escHtml(ex.author_name || '—')} · ${ex.default_duration_minutes} min ·
          <span class="tm-flow-chip ${diffChipClass(ex.difficulty)}">${escHtml(DIFF_LABEL[ex.difficulty] || ex.difficulty)}</span>
        </span>
      </div>
      ${tags ? `<div class="tm-flow-chips">${tags}</div>` : ''}
      ${desc ? `<div class="text-small tm-md-desc md-exercise" style="margin:0;color:var(--text-secondary)">${renderExerciseMarkdown(desc)}</div>` : ''}
      <div class="tm-flow-pitch"><strong style="display:block;margin-bottom:0.35rem;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;opacity:0.85">Motivatie voor de club</strong>${pitch}</div>
      <div class="tm-flow-actions">
        <button type="button" class="tm-btn-primary tm-ex-approve" data-id="${ex.id}">Goedkeuren</button>
        <button type="button" class="tm-btn-danger tm-ex-reject" data-id="${ex.id}">Afwijzen</button>
      </div>
    </article>`;
}

function filteredSortedLibrary() {
  let list = [..._ctx.exercisesClub];
  const q = _ctx.search.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (ex) =>
        (ex.name || '').toLowerCase().includes(q) ||
        (ex.description || '').toLowerCase().includes(q)
    );
  }
  if (_ctx.diffFilter) {
    list = list.filter((ex) => ex.difficulty === _ctx.diffFilter);
  }
  const tid = _ctx.tagFilter ? parseInt(_ctx.tagFilter, 10) : null;
  if (tid) {
    list = list.filter((ex) => (ex.tags || []).some((t) => t.id === tid));
  }
  const pins = new Set(_ctx.pins);
  list.sort((a, b) => {
    const pa = pins.has(a.id) ? 0 : 1;
    const pb = pins.has(b.id) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (_ctx.sort === 'duration') {
      return (a.default_duration_minutes || 0) - (b.default_duration_minutes || 0);
    }
    if (_ctx.sort === 'difficulty') {
      const order = { easy: 0, medium: 1, hard: 2 };
      return (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1);
    }
    return (a.name || '').localeCompare(b.name || '', 'nl', { sensitivity: 'base' });
  });
  return list;
}

function renderLibraryHtml() {
  const list = filteredSortedLibrary();
  const tagOpts =
    '<option value="">Alle tags</option>' +
    _ctx.tags
      .map(
        (t) =>
          `<option value="${t.id}"${_ctx.tagFilter === String(t.id) ? ' selected' : ''}>${escHtml(t.name)}</option>`
      )
      .join('');

  return `
    <div class="tm-lib-actions-row">
      <button type="button" class="tm-btn-primary" id="tm-lib-new">+ Nieuwe club-oefening</button>
      <button type="button" class="tm-btn-ghost" id="tm-lib-refresh">↻ Vernieuwen</button>
      <button type="button" class="tm-btn-ghost" id="tm-lib-export">Export JSON</button>
    </div>
    <div class="tm-lib-toolbar">
      <div class="tm-lib-search-wrap">
        <input type="search" class="tm-lib-search" id="tm-lib-search" placeholder="Zoek op naam of beschrijving…" value="${escHtml(_ctx.search)}" autocomplete="off" />
        <span class="tm-kbd-hint" title="Sneltoets">/</span>
      </div>
      <select class="tm-filter-select" id="tm-lib-sort" aria-label="Sorteren">
        <option value="name"${_ctx.sort === 'name' ? ' selected' : ''}>Naam A–Z</option>
        <option value="duration"${_ctx.sort === 'duration' ? ' selected' : ''}>Duur</option>
        <option value="difficulty"${_ctx.sort === 'difficulty' ? ' selected' : ''}>Moeilijkheid</option>
      </select>
      <select class="tm-filter-select" id="tm-lib-tag" aria-label="Filter tag">${tagOpts}</select>
      <div class="tm-diff-toggle" role="group" aria-label="Moeilijkheid">
        <button type="button" data-diff="" class="${!_ctx.diffFilter ? 'active' : ''}">Alle</button>
        <button type="button" data-diff="easy" class="${_ctx.diffFilter === 'easy' ? 'active' : ''}">Makkelijk</button>
        <button type="button" data-diff="medium" class="${_ctx.diffFilter === 'medium' ? 'active' : ''}">Gemiddeld</button>
        <button type="button" data-diff="hard" class="${_ctx.diffFilter === 'hard' ? 'active' : ''}">Moeilijk</button>
      </div>
    </div>
    <div class="tm-ex-grid" id="tm-ex-grid">
      ${
        list.length
          ? list.map((ex) => renderExerciseCard(ex)).join('')
          : '<div class="tm-lib-empty" style="grid-column:1/-1">Geen oefeningen voor deze filters. Pas zoekterm of filters aan, of voeg een nieuwe club-oefening toe.</div>'
      }
    </div>`;
}

function renderExerciseCard(ex) {
  const pinned = _ctx.pins.includes(ex.id);
  const tagSpans = (ex.tags || [])
    .slice(0, 4)
    .map((t) => `<span>${escHtml(t.name)}</span>`)
    .join('');
  const more = (ex.tags || []).length > 4 ? `<span>+${(ex.tags || []).length - 4}</span>` : '';
  return `
    <button type="button" class="tm-ex-card${pinned ? ' tm-ex-card--pin' : ''}" data-ex-id="${ex.id}">
      <div class="tm-ex-card-name">${escHtml(ex.name)}</div>
      <p class="tm-ex-card-sub">${ex.default_duration_minutes} min · ${escHtml(DIFF_LABEL[ex.difficulty] || ex.difficulty)}</p>
      <div class="tm-ex-card-tags">${tagSpans}${more}</div>
    </button>`;
}

function renderSkillsHtml() {
  const pills =
    _ctx.tags.length > 0
      ? _ctx.tags
          .map(
            (t) => `
        <span class="tm-tag-pill">
          ${escHtml(t.name)}
          <button type="button" class="tm-tag-del" data-id="${t.id}" title="Verwijderen" aria-label="Verwijder ${escHtml(t.name)}">×</button>
        </span>`
          )
          .join('')
      : '<p class="text-muted text-small" style="margin:0">Nog geen tags — voeg de eerste toe om oefeningen te structureren.</p>';

  return `
    <div class="tm-skills-layout">
      <div class="tm-panel">
        <h3>Waarom tags?</h3>
        <p class="text-small" style="margin:0;line-height:1.55;color:var(--text-secondary)">
          Vaardigheidstags koppelen oefeningen aan thema’s (bijv. pass, service, rotatie). Coaches filteren sneller in de bibliotheek
          en jeugdtrainers houden overzicht over ontwikkelpaden.
        </p>
      </div>
      <div class="tm-panel">
        <h3>Actieve tags</h3>
        <div class="tm-tag-cloud" id="tm-tag-cloud">${pills}</div>
        <div class="tm-add-tag-row">
          <input type="text" id="tm-tag-new-name" placeholder="Nieuwe tag (bijv. aanval)" maxlength="80" />
          <button type="button" class="tm-btn-primary" id="tm-tag-add-btn">Toevoegen</button>
        </div>
      </div>
    </div>`;
}

function renderDocsHtml() {
  return `
    <div class="tm-panel" style="margin-bottom:1rem">
      <h3>Richtlijnen &amp; kaders</h3>
      <p class="text-small" style="margin:0 0 1rem;line-height:1.55;color:var(--text-secondary)">
        Gebruik dit als levend handboek: afspraken voor trainingsopbouw, veiligheid en jeugdontwikkeling binnen ${escHtml(clubDisplayName())}.
        De clubnotities onderaan worden lokaal op dit apparaat bewaard (handig voor snelle afspraken op de tablet).
      </p>
      <div class="tm-doc-acc">
        <details open>
          <summary>Jeugd &amp; ontwikkeling</summary>
          <div class="tm-doc-body">
            <ul>
              <li>Varieer in belasting: korte blocks, veel ballen per speler, duidelijke leerdoelen per blok.</li>
              <li>Wissel moeilijkheid af — begin met succeservaring, bouw daarna complexiteit op.</li>
              <li>Leg de link naar wedstrijd: waarom deze oefening? Wat moet een speler voelen?</li>
            </ul>
          </div>
        </details>
        <details>
          <summary>Technische lijn (senioren &amp; jeugd)</summary>
          <div class="tm-doc-body">
            <ul>
              <li>Houd kernvaardigheden in balans: pass, aanval, service, verdediging, rotatie-inzicht.</li>
              <li>Gebruik de bibliotheek om periodiseren te ondersteunen (voorbereiding, competitie, top).</li>
              <li>Documenteer afwijkingen per team in sessienotities op de teampagina.</li>
            </ul>
          </div>
        </details>
        <details>
          <summary>Veiligheid &amp; organisatie</summary>
          <div class="tm-doc-body">
            <ul>
              <li>Controleer netten, antennes en vrije zone vóór de training.</li>
              <li>Warm-up is verplicht; let op belasting bij jeugd en na rustdagen.</li>
              <li>Houd noodprocedures en EHBO-bereikbaarheid in de zaal zichtbaar.</li>
            </ul>
          </div>
        </details>
      </div>
    </div>
    <div class="tm-memo-box">
      <h3>Clubnotities (dit apparaat)</h3>
      <p class="text-small" style="margin:0 0 0.5rem;color:var(--text-muted)">Alleen zichtbaar in deze browser — ideaal voor snelle afspraken tijdens een TC-vergadering.</p>
      <textarea id="tm-guidelines-memo" placeholder="Bv. minimale serve-oefeningen per week voor MC, of link naar extern document…"></textarea>
      <div class="tm-memo-actions">
        <button type="button" class="tm-btn-primary" id="tm-guidelines-save">Opslaan</button>
        <button type="button" class="tm-btn-ghost" id="tm-guidelines-clear">Wissen</button>
      </div>
    </div>`;
}

function wireTabEvents() {
  const c = _ctx.container;
  if (_ctx.tab === 'workflow') {
    c.querySelectorAll('.tm-ex-approve').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/training/exercises/${btn.dataset.id}/approve-share`, { method: 'POST', body: {} });
          showToast('Oefening staat nu in de clubbibliotheek', 'success');
          await reloadData();
          updateStatsStrip();
          renderTabPanel();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
    c.querySelectorAll('.tm-ex-reject').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Aanvraag afwijzen? De oefening blijft privé bij de coach.')) return;
        try {
          await api(`/api/training/exercises/${btn.dataset.id}/reject-share`, { method: 'POST', body: {} });
          showToast('Aanvraag afgewezen', 'success');
          await reloadData();
          updateStatsStrip();
          renderTabPanel();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
  }

  if (_ctx.tab === 'library') {
    const search = c.querySelector('#tm-lib-search');
    search?.addEventListener('input', () => {
      _ctx.search = search.value;
      refreshLibraryGrid();
    });

    c.querySelector('#tm-lib-sort')?.addEventListener('change', (e) => {
      _ctx.sort = e.target.value;
      refreshLibraryGrid();
    });
    c.querySelector('#tm-lib-tag')?.addEventListener('change', (e) => {
      _ctx.tagFilter = e.target.value;
      refreshLibraryGrid();
    });
    c.querySelectorAll('.tm-diff-toggle button').forEach((b) => {
      b.addEventListener('click', () => {
        _ctx.diffFilter = b.dataset.diff || '';
        c.querySelectorAll('.tm-diff-toggle button').forEach((x) => x.classList.toggle('active', x === b));
        refreshLibraryGrid();
      });
    });

    c.querySelector('#tm-lib-new')?.addEventListener('click', () => openDrawerCreate());
    c.querySelector('#tm-lib-refresh')?.addEventListener('click', async () => {
      try {
        await reloadData();
        updateStatsStrip();
        renderTabPanel();
        showToast('Bibliotheek vernieuwd', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
    c.querySelector('#tm-lib-export')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(_ctx.exercisesClub, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `club-oefeningen-${_ctx.clubId}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('Export gestart', 'success');
    });

    wireLibraryGrid();
  }

  if (_ctx.tab === 'skills') {
    c.querySelectorAll('.tm-tag-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Tag verwijderen?')) return;
        try {
          await api(`/api/training/skill-tags/${btn.dataset.id}`, { method: 'DELETE' });
          await reloadData();
          updateStatsStrip();
          renderTabPanel();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
    c.querySelector('#tm-tag-add-btn')?.addEventListener('click', async () => {
      const inp = c.querySelector('#tm-tag-new-name');
      const name = inp?.value?.trim();
      if (!name) return;
      try {
        await api('/api/training/skill-tags', { method: 'POST', body: { name } });
        inp.value = '';
        await reloadData();
        updateStatsStrip();
        renderTabPanel();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  }

  if (_ctx.tab === 'docs') {
    const memoTa = c.querySelector('#tm-guidelines-memo');
    if (memoTa) memoTa.value = readGuidelines(_ctx.clubId);
    c.querySelector('#tm-guidelines-save')?.addEventListener('click', () => {
      const t = c.querySelector('#tm-guidelines-memo')?.value ?? '';
      writeGuidelines(_ctx.clubId, t);
      updateStatsStrip();
      showToast('Clubnotities opgeslagen', 'success');
    });
    c.querySelector('#tm-guidelines-clear')?.addEventListener('click', () => {
      if (!confirm('Clubnotities wissen op dit apparaat?')) return;
      writeGuidelines(_ctx.clubId, '');
      c.querySelector('#tm-guidelines-memo').value = '';
      updateStatsStrip();
      showToast('Gewist', 'success');
    });
  }
}

function refreshLibraryGrid() {
  const c = _ctx.container;
  const grid = c.querySelector('#tm-ex-grid');
  if (!grid) return;
  const list = filteredSortedLibrary();
  grid.innerHTML = list.length
    ? list.map(renderExerciseCard).join('')
    : '<div class="tm-lib-empty" style="grid-column:1/-1">Geen oefeningen voor deze filters.</div>';
  wireLibraryGrid();
}

function wireLibraryGrid() {
  _ctx.container.querySelectorAll('.tm-ex-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.exId, 10);
      const ex = _ctx.exercisesClub.find((x) => x.id === id);
      if (ex) openDrawerEdit(ex);
    });
  });
}

function closeDrawer() {
  const c = _ctx?.container;
  if (!c) return;
  c.querySelector('#tm-drawer-backdrop')?.classList.remove('tm-open');
  c.querySelector('#tm-drawer-panel')?.classList.remove('tm-open');
  c.querySelector('#tm-drawer-backdrop')?.setAttribute('aria-hidden', 'true');
  c.querySelector('#tm-drawer-panel')?.setAttribute('aria-hidden', 'true');
}

function openDrawerCreate() {
  _ctx.drawerMode = 'create';
  _ctx.drawerEx = null;
  renderDrawerContent();
  openDrawerAnim();
}

function openDrawerEdit(ex) {
  _ctx.drawerMode = 'edit';
  _ctx.drawerEx = ex;
  renderDrawerContent();
  openDrawerAnim();
}

function openDrawerAnim() {
  const c = _ctx.container;
  c.querySelector('#tm-drawer-backdrop')?.classList.add('tm-open');
  c.querySelector('#tm-drawer-panel')?.classList.add('tm-open');
  c.querySelector('#tm-drawer-backdrop')?.setAttribute('aria-hidden', 'false');
  c.querySelector('#tm-drawer-panel')?.setAttribute('aria-hidden', 'false');
}

function renderDrawerContent() {
  const panel = _ctx.container.querySelector('#tm-drawer-panel');
  if (!panel) return;

  const isCreate = _ctx.drawerMode === 'create';
  const ex = _ctx.drawerEx;
  const tagChecks = _ctx.tags
    .map((t) => {
      const on = isCreate ? false : (ex?.tags || []).some((x) => x.id === t.id);
      return `<label><input type="checkbox" value="${t.id}"${on ? ' checked' : ''} /> ${escHtml(t.name)}</label>`;
    })
    .join('');

  panel.innerHTML = `
    <div class="tm-drawer-head">
      <h2 id="tm-d-title"></h2>
      <button type="button" class="tm-drawer-close" id="tm-drawer-x" aria-label="Sluiten">×</button>
    </div>
    <div class="tm-drawer-body">
      <div class="tm-field">
        <label for="tm-d-name">Naam</label>
        <input type="text" id="tm-d-name" />
      </div>
      <div class="tm-field">
        <label for="tm-d-desc">Beschrijving</label>
        <p class="text-small text-muted" style="margin:0 0 0.35rem">Markdown toegestaan: koppen, lijsten, <strong>vet</strong>, cursief, code, links.</p>
        <textarea id="tm-d-desc" placeholder="Bijv. kopjes met ##, bullets met - …"></textarea>
      </div>
      <div class="tm-field">
        <label for="tm-d-dur">Duur (min)</label>
        <input type="number" id="tm-d-dur" min="1" max="480" />
      </div>
      <div class="tm-field">
        <label for="tm-d-diff">Moeilijkheid</label>
        <select id="tm-d-diff">
          <option value="easy">Makkelijk</option>
          <option value="medium" selected>Gemiddeld</option>
          <option value="hard">Moeilijk</option>
        </select>
      </div>
      <div class="tm-field">
        <label>Tags</label>
        <div class="tm-tag-checks" id="tm-d-tags">${tagChecks || '<span class="text-muted text-small">Geen tags beschikbaar</span>'}</div>
      </div>
    </div>
    <div class="tm-drawer-foot">
      ${isCreate ? '' : `<button type="button" class="tm-btn-ghost" id="tm-d-pin">${_ctx.pins.includes(ex.id) ? 'Pin verwijderen' : 'Vastpinnen'}</button>
      <button type="button" class="tm-btn-ghost" id="tm-d-dup">Dupliceren</button>
      <button type="button" class="tm-btn-ghost" id="tm-d-one-json">JSON</button>
      <button type="button" class="tm-btn-danger" id="tm-d-del">Verwijderen</button>`}
      <button type="button" class="tm-btn-ghost" id="tm-d-cancel">Sluiten</button>
      <button type="button" class="tm-btn-primary" id="tm-d-save">${isCreate ? 'Aanmaken' : 'Opslaan'}</button>
    </div>`;

  const titleEl = panel.querySelector('#tm-d-title');
  const nameEl = panel.querySelector('#tm-d-name');
  const descEl = panel.querySelector('#tm-d-desc');
  const durEl = panel.querySelector('#tm-d-dur');
  const diffEl = panel.querySelector('#tm-d-diff');
  if (isCreate) {
    if (titleEl) titleEl.textContent = 'Nieuwe club-oefening';
    if (durEl) durEl.value = '20';
  } else if (ex) {
    if (titleEl) titleEl.textContent = ex.name;
    if (nameEl) nameEl.value = ex.name;
    if (descEl) descEl.value = ex.description || '';
    if (durEl) durEl.value = String(ex.default_duration_minutes ?? 20);
    if (diffEl) diffEl.value = ex.difficulty || 'medium';
  }

  panel.querySelector('#tm-drawer-x')?.addEventListener('click', closeDrawer);
  panel.querySelector('#tm-d-cancel')?.addEventListener('click', closeDrawer);

  panel.querySelector('#tm-d-save')?.addEventListener('click', async () => {
    const name = panel.querySelector('#tm-d-name')?.value?.trim();
    const description = panel.querySelector('#tm-d-desc')?.value?.trim() ?? '';
    const dur = parseInt(panel.querySelector('#tm-d-dur')?.value, 10);
    const difficulty = panel.querySelector('#tm-d-diff')?.value || 'medium';
    const tagIds = [...panel.querySelectorAll('#tm-d-tags input:checked')].map((i) => parseInt(i.value, 10));
    if (!name) {
      showToast('Naam is verplicht', 'error');
      return;
    }
    try {
      if (isCreate) {
        await api('/api/training/exercises', {
          method: 'POST',
          body: {
            name,
            description,
            default_duration_minutes: dur,
            difficulty,
            scope: 'club',
            tag_ids: tagIds,
          },
        });
        showToast('Club-oefening aangemaakt', 'success');
      } else {
        await api(`/api/training/exercises/${ex.id}`, {
          method: 'PATCH',
          body: {
            name,
            description,
            default_duration_minutes: dur,
            difficulty,
            tag_ids: tagIds,
          },
        });
        showToast('Opgeslagen', 'success');
      }
      closeDrawer();
      await reloadData();
      updateStatsStrip();
      renderTabPanel();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  if (!isCreate) {
    panel.querySelector('#tm-d-pin')?.addEventListener('click', () => {
      const wasPinned = _ctx.pins.includes(ex.id);
      const set = new Set(_ctx.pins);
      if (wasPinned) set.delete(ex.id);
      else set.add(ex.id);
      _ctx.pins = [...set];
      writePins(_ctx.clubId, _ctx.pins);
      showToast(wasPinned ? 'Pin verwijderd' : 'Vastgepind', 'success');
      renderDrawerContent();
      openDrawerAnim();
      if (_ctx.tab === 'library') refreshLibraryGrid();
    });

    panel.querySelector('#tm-d-dup')?.addEventListener('click', async () => {
      const name = panel.querySelector('#tm-d-name')?.value?.trim();
      const description = panel.querySelector('#tm-d-desc')?.value?.trim() ?? '';
      const dur = parseInt(panel.querySelector('#tm-d-dur')?.value, 10);
      const difficulty = panel.querySelector('#tm-d-diff')?.value || 'medium';
      const tagIds = [...panel.querySelectorAll('#tm-d-tags input:checked')].map((i) => parseInt(i.value, 10));
      try {
        await api('/api/training/exercises', {
          method: 'POST',
          body: {
            name: `Kopie: ${name}`,
            description,
            default_duration_minutes: dur,
            difficulty,
            scope: 'club',
            tag_ids: tagIds,
          },
        });
        showToast('Duplicaat aangemaakt', 'success');
        closeDrawer();
        await reloadData();
        updateStatsStrip();
        renderTabPanel();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });

    panel.querySelector('#tm-d-one-json')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(ex, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `oefening-${ex.id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    panel.querySelector('#tm-d-del')?.addEventListener('click', async () => {
      if (!confirm('Club-oefening definitief verwijderen?')) return;
      try {
        await api(`/api/training/exercises/${ex.id}`, { method: 'DELETE' });
        showToast('Verwijderd', 'success');
        closeDrawer();
        _ctx.pins = _ctx.pins.filter((id) => id !== ex.id);
        writePins(_ctx.clubId, _ctx.pins);
        await reloadData();
        updateStatsStrip();
        renderTabPanel();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  }
}
