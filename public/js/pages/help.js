import { api, state, navigate, showToast } from '../app.js';
import { escHtml } from '../escape-html.js';

/** @param {Record<string, unknown>} block */
function blockPlainText(block) {
  if (!block || typeof block !== 'object') return '';
  const t = block.type;
  if (t === 'p' || t === 'callout' || t === 'code') {
    return [block.title, block.text].filter(Boolean).join(' ');
  }
  if (t === 'ul' && Array.isArray(block.items)) return block.items.join(' ');
  if (t === 'table' && Array.isArray(block.headers) && Array.isArray(block.rows)) {
    return [...block.headers, ...block.rows.flat()].join(' ');
  }
  return '';
}

function blocksPlainText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map(blockPlainText).join(' ');
}

function renderBlocks(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map(b => renderBlock(b)).join('');
}

function renderBlock(block) {
  if (!block || typeof block !== 'object') return '';
  switch (block.type) {
    case 'p':
      return `<p class="help-block help-p">${escHtml(block.text)}</p>`;
    case 'ul':
      return `<ul class="help-block help-ul">${(block.items || []).map(i => `<li>${escHtml(i)}</li>`).join('')}</ul>`;
    case 'table': {
      const headers = block.headers || [];
      const rows = block.rows || [];
      return `<div class="help-table-wrap"><table class="help-block help-table"><thead><tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${(row || []).map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    case 'callout': {
      const v = block.variant === 'warning' ? 'warning' : 'note';
      const title = block.title ? `<div class="help-callout-title">${escHtml(block.title)}</div>` : '';
      return `<div class="help-block help-callout help-callout--${v}">${title}<div class="help-callout-text">${escHtml(block.text)}</div></div>`;
    }
    case 'code':
      return `<pre class="help-block help-code"><code>${escHtml(block.text)}</code></pre>`;
    default:
      return '';
  }
}

function collectionRequiresUser(col) {
  const r = col.requiresRole;
  if (!r || r === 'authenticated') return !!state.user;
  if (r === 'admin') return (state.user?.roles?.length ?? 0) > 0;
  if (r === 'super_admin') return state.user?.roles?.some(x => x.role === 'super_admin');
  return !!state.user;
}

function userRoleSlugs() {
  return (state.user?.roles || []).map(r => r.role).filter(Boolean);
}

function guideVisibleForUser(guide) {
  const aud = guide.audience;
  if (!Array.isArray(aud) || aud.length === 0) return true;
  const mine = new Set(userRoleSlugs());
  return aud.some(a => mine.has(a));
}

function parseFunctionalHash(rest, data) {
  for (const ch of data.chapters || []) {
    const prefix = `${ch.id}-`;
    if (rest === ch.id) return { chapterId: ch.id, sectionId: null };
    if (rest.startsWith(prefix)) {
      const secId = rest.slice(prefix.length);
      const sec = (ch.sections || []).find(s => s.id === secId);
      if (sec) return { chapterId: ch.id, sectionId: secId };
    }
  }
  return null;
}

function parseAdminHash(rest, data) {
  const guides = data.guides || [];
  const sorted = [...guides].sort((a, b) => (b.id || '').length - (a.id || '').length);
  for (const g of sorted) {
    if (!g.id) continue;
    if (rest === g.id) return { guideId: g.id, stepN: null };
    const stepPrefix = `${g.id}-`;
    if (rest.startsWith(stepPrefix)) {
      const tail = rest.slice(stepPrefix.length);
      const n = parseInt(tail, 10);
      if (!Number.isNaN(n) && String(n) === tail) return { guideId: g.id, stepN: n };
    }
  }
  return null;
}

function scrollToHelpTarget(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let helpHashListener = null;

export async function render(container, params = {}) {
  container.innerHTML = '<div class="spinner"></div>';

  if (helpHashListener) {
    window.removeEventListener('hashchange', helpHashListener);
    helpHashListener = null;
  }

  if (!state.user) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📖</div>
        <h3>Naslag</h3>
        <p>Log in om de documentatie te bekijken.</p>
        <button class="btn btn-primary mt-3" onclick="navigate('profile')">Naar profiel</button>
      </div>`;
    return;
  }

  try {
    const meData = await api('/api/auth/me');
    state.user = meData.user;
    if (meData.features) state.features = meData.features;
    localStorage.setItem('vb_user', JSON.stringify(meData.user));
  } catch (_) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Sessie kon niet worden gevalideerd.</p>
        <button class="btn btn-primary mt-3" onclick="navigate('profile')">Terug</button>
      </div>`;
    return;
  }

  let manifest;
  try {
    const r = await fetch('/help/manifest.json');
    if (!r.ok) throw new Error('Manifest niet gevonden');
    manifest = await r.json();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escHtml(e.message)}</p></div>`;
    return;
  }

  const allCols = (manifest.collections || []).filter(collectionRequiresUser);
  if (!allCols.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Er is geen documentatie beschikbaar voor jouw account.</p>
      </div>`;
    return;
  }

  const loaded = await Promise.all(
    allCols.map(async col => {
      const path = col.path || '';
      const res = await fetch(path);
      if (!res.ok) throw new Error(`Kan ${path} niet laden`);
      const json = await res.json();
      return { col, json };
    })
  );

  /** @type {Map<string, { col: object, json: object }>} */
  const byId = new Map(loaded.map(({ col, json }) => [col.id, { col, json }]));

  const initialColId = allCols[0].id;
  let activeColId = initialColId;
  let lastSearch = '';

  function buildFunctionalHtmlInner(data, q) {
    const meta = data.meta || {};
    let toc = '';
    let main = '';
    for (const ch of data.chapters || []) {
      const chAnchor = `help-functional-ch-${ch.id}`;
      const chText = [ch.title, ch.intro, ...(ch.sections || []).map(s => [s.title, s.summary, blocksPlainText(s.blocks)].join(' '))].join(' ');
      const chapterHasVisible =
        !q ||
        chText.toLowerCase().includes(q) ||
        (ch.sections || []).some(sec => {
          const secText = [sec.title, sec.summary, blocksPlainText(sec.blocks)].join(' ');
          return secText.toLowerCase().includes(q);
        });

      toc += `<div class="help-toc-chapter" data-help-toc-ch="${ch.id}"><a href="#functional-${ch.id}" class="help-toc-link help-toc-ch-link" data-help-hash="functional-${ch.id}">${escHtml(ch.title)}</a>`;

      if (!chapterHasVisible) {
        toc += `</div>`;
        continue;
      }

      main += `<details class="help-accordion help-chapter" id="${chAnchor}" data-chapter="${ch.id}" data-help-hash="functional-${ch.id}" open><summary class="help-chapter-summary"><span class="help-chapter-title">${escHtml(ch.title)}</span></summary><div class="help-chapter-body">`;
      if (ch.intro) main += `<p class="help-intro">${escHtml(ch.intro)}</p>`;

      for (const sec of ch.sections || []) {
        const secText = [sec.title, sec.summary, blocksPlainText(sec.blocks)].join(' ');
        const secMatch = !q || secText.toLowerCase().includes(q);
        const secId = `help-functional-${ch.id}-${sec.id}`;
        const secHash = `functional-${ch.id}-${sec.id}`;
        if (secMatch) {
          toc += `<a href="#${secHash}" class="help-toc-link help-toc-sec-link" data-help-hash="${escHtml(secHash)}">${escHtml(sec.title)}</a>`;
        }

        if (!secMatch) continue;
        main += `<section class="help-section" id="${secId}" data-help-hash="${escHtml(secHash)}">`;
        main += `<h3 class="help-section-title">${escHtml(sec.title)}</h3>`;
        if (sec.summary) main += `<p class="help-summary">${escHtml(sec.summary)}</p>`;
        main += renderBlocks(sec.blocks);
        main += `</section>`;
      }
      main += `</div></details>`;
      toc += `</div>`;
    }
    return {
      toc,
      main,
      title: escHtml(meta.title || 'Functionele naslag'),
      updated: meta.updated ? `<span class="help-meta">Bijgewerkt: ${escHtml(meta.updated)}</span>` : '',
    };
  }

  function buildAdminHtml(pack, searchQ) {
    const data = pack.json;
    const meta = data.meta || {};
    const q = (searchQ || '').trim().toLowerCase();
    let toc = '';
    let main = '';

    for (const g of data.guides || []) {
      if (!guideVisibleForUser(g)) continue;
      const steps = g.steps || [];
      const guideText = [g.title, g.prerequisites, ...steps.map(st => [st.title, st.screenHint, blocksPlainText(st.body)].join(' '))].join(' ');
      const guideMatch = !q || guideText.toLowerCase().includes(q);
      if (!guideMatch) continue;

      const gAnchor = `help-admin-${g.id}`;
      const gHash = `admin-manual-${g.id}`;
      toc += `<a href="#${gHash}" class="help-toc-link help-toc-ch-link" data-help-hash="${escHtml(gHash)}">${escHtml(g.title)}</a>`;
      for (const st of steps) {
        const stText = [st.title, st.screenHint, blocksPlainText(st.body)].join(' ');
        if (!q || stText.toLowerCase().includes(q)) {
          const stHash = `admin-manual-${g.id}-${st.n}`;
          toc += `<a href="#${stHash}" class="help-toc-link help-toc-sec-link" data-help-hash="${escHtml(stHash)}">Stap ${st.n}: ${escHtml(st.title)}</a>`;
        }
      }

      main += `<article class="help-guide" id="${gAnchor}" data-help-hash="${escHtml(gHash)}">`;
      main += `<h2 class="help-guide-title">${escHtml(g.title)}</h2>`;
      if (g.prerequisites) main += `<p class="help-prereq"><strong>Voorwaarden:</strong> ${escHtml(g.prerequisites)}</p>`;
      if (g.relatedRoute) main += `<p class="help-route-hint text-muted text-small">Scherm: <code>${escHtml(g.relatedRoute)}</code></p>`;

      for (const st of steps) {
        const stText = [st.title, st.screenHint, blocksPlainText(st.body)].join(' ');
        if (q && !stText.toLowerCase().includes(q) && !guideText.toLowerCase().includes(q)) continue;
        const sid = `help-admin-${g.id}-step-${st.n}`;
        const stHash = `admin-manual-${g.id}-${st.n}`;
        main += `<section class="help-step" id="${sid}" data-help-hash="${escHtml(stHash)}">`;
        main += `<h3 class="help-section-title"><span class="help-step-n">${st.n}</span> ${escHtml(st.title)}</h3>`;
        if (st.screenHint) main += `<p class="help-screen-hint">📍 ${escHtml(st.screenHint)}</p>`;
        main += renderBlocks(st.body);
        main += `</section>`;
      }
      main += `</article>`;
    }

    return {
      toc,
      main,
      title: escHtml(meta.title || 'Handleiding beheer'),
      updated: meta.updated ? `<span class="help-meta">Bijgewerkt: ${escHtml(meta.updated)}</span>` : '',
    };
  }

  function applyHashFromString(h) {
    const raw = (h || '').replace(/^#/, '');
    if (!raw) return;

    if (raw.startsWith('functional-')) {
      const rest = raw.slice('functional-'.length);
      const pack = byId.get('functional');
      if (!pack?.json) return;
      const loc = parseFunctionalHash(rest, pack.json);
      if (!loc) return;
      if (activeColId !== 'functional') {
        activeColId = 'functional';
        renderHelpShell(lastSearch);
      }
      requestAnimationFrame(() => {
        if (loc.sectionId) scrollToHelpTarget(`help-functional-${loc.chapterId}-${loc.sectionId}`);
        else scrollToHelpTarget(`help-functional-ch-${loc.chapterId}`);
      });
      return;
    }

    if (raw.startsWith('admin-manual-')) {
      const rest = raw.slice('admin-manual-'.length);
      const pack = byId.get('admin-manual');
      if (!pack?.json) return;
      const loc = parseAdminHash(rest, pack.json);
      if (!loc) return;
      if (activeColId !== 'admin-manual') {
        activeColId = 'admin-manual';
        renderHelpShell(lastSearch);
      }
      requestAnimationFrame(() => {
        if (loc.stepN != null) scrollToHelpTarget(`help-admin-${loc.guideId}-step-${loc.stepN}`);
        else scrollToHelpTarget(`help-admin-${loc.guideId}`);
      });
    }
  }

  function setupIntersectionToc(root) {
    const toc = root.querySelector('#help-toc');
    if (!toc) return;
    const main = root.querySelector('#help-main');
    if (!main) return;
    const marked = main.querySelectorAll('[data-help-hash]');
    if (!marked.length) return;

    const obs = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (!visible.length) return;
        const hash = visible[0].target.getAttribute('data-help-hash');
        if (!hash) return;
        toc.querySelectorAll('.help-toc-link').forEach(l => {
          l.classList.toggle('active', l.getAttribute('data-help-hash') === hash);
        });
      },
      { root: null, rootMargin: '-64px 0px -55% 0px', threshold: [0, 0.1, 0.25, 0.5, 1] }
    );
    marked.forEach(el => obs.observe(el));
  }

  function renderHelpShell(searchQ = '') {
    lastSearch = searchQ;
    const pack = byId.get(activeColId);
    if (!pack) return;

    const isFunc = pack.col.type === 'functional';
    const built = isFunc ? buildFunctionalHtmlInner(pack.json, searchQ) : buildAdminHtml(pack, searchQ);

    const colTabs = allCols
      .map(
        c => `
      <button type="button" class="help-col-tab${c.id === activeColId ? ' active' : ''}" data-help-col="${escHtml(c.id)}">
        ${escHtml(c.title)}
      </button>`
      )
      .join('');

    container.innerHTML = `
      <div class="help-page" id="help-root">
        <div class="help-toolbar print-hidden">
          <div class="help-toolbar-row">
            <button type="button" class="btn btn-ghost btn-sm" id="help-back" aria-label="Terug">← Terug</button>
            <div class="help-col-tabs">${colTabs}</div>
          </div>
          <div class="help-toolbar-row help-toolbar-actions">
            <input type="search" class="form-input help-search" id="help-search" placeholder="Zoeken…" value="${escHtml(searchQ)}" autocomplete="off" />
            <button type="button" class="btn btn-secondary btn-sm" id="help-copy-link" title="Kopieer link met anker">Link</button>
            <button type="button" class="btn btn-primary btn-sm" id="help-print">Afdrukken</button>
          </div>
          <div class="help-collection-head">
            <h1 class="help-h1">${built.title}</h1>
            ${built.updated}
          </div>
        </div>
        <div class="help-layout">
          <aside class="help-toc print-hidden" id="help-toc" aria-label="Inhoud">${built.toc || '<p class="text-muted text-small">Geen resultaten.</p>'}</aside>
          <div class="help-main" id="help-main">${built.main || '<p class="text-muted">Geen resultaten voor je zoekopdracht.</p>'}</div>
        </div>
      </div>`;

    const root = container.querySelector('#help-root');

    container.querySelector('#help-back')?.addEventListener('click', () => navigate('profile'));

    container.querySelectorAll('[data-help-col]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeColId = btn.dataset.helpCol;
        const q = container.querySelector('#help-search')?.value || '';
        renderHelpShell(q);
      });
    });

    container.querySelector('#help-search')?.addEventListener('input', e => {
      renderHelpShell(e.target.value);
    });

    container.querySelector('#help-copy-link')?.addEventListener('click', async () => {
      let hash = (window.location.hash || '').replace(/^#/, '');
      const okForCol =
        (activeColId === 'functional' && hash.startsWith('functional-')) ||
        (activeColId === 'admin-manual' && hash.startsWith('admin-manual-'));
      if (!okForCol) {
        const el = root.querySelector('#help-main [data-help-hash]');
        hash = el?.getAttribute('data-help-hash') || '';
      }
      if (!hash) {
        hash = activeColId === 'functional' ? 'functional-algemeen' : 'admin-manual-team-leden';
      }
      const fullUrl = `${window.location.origin}${window.location.pathname}${window.location.search}#${hash}`;
      try {
        await navigator.clipboard.writeText(fullUrl);
        window.history.replaceState(null, '', `#${hash}`);
        showToast('Link gekopieerd', 'success');
      } catch (_) {
        window.prompt('Kopieer deze link:', fullUrl);
      }
    });

    container.querySelector('#help-print')?.addEventListener('click', () => {
      const details = root.querySelectorAll('details.help-accordion');
      const wasOpen = [...details].map(d => d.open);
      details.forEach(d => {
        d.open = true;
      });
      root.classList.add('help-print-expand');
      const onAfter = () => {
        root.classList.remove('help-print-expand');
        details.forEach((d, i) => {
          d.open = wasOpen[i];
        });
      };
      window.addEventListener('afterprint', onAfter, { once: true });
      setTimeout(() => window.print(), 0);
    });

    root.querySelectorAll('.help-toc-link').forEach(a => {
      a.addEventListener('click', ev => {
        ev.preventDefault();
        const h = a.getAttribute('href')?.replace(/^#/, '') || '';
        window.location.hash = h;
        applyHashFromString(h);
      });
    });

    setupIntersectionToc(root);
  }

  renderHelpShell('');

  helpHashListener = () => {
    if (state.currentRoute !== 'help') return;
    applyHashFromString(window.location.hash);
  };
  window.addEventListener('hashchange', helpHashListener);

  const routeHash = (params.hash || '').replace(/^#/, '');
  if (params.hash) delete params.hash;
  const initial = routeHash || window.location.hash.replace(/^#/, '');
  if (initial) requestAnimationFrame(() => applyHashFromString(initial));
}
