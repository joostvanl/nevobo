import { escHtml } from './escape-html.js';

// ─── App State ───────────────────────────────────────────────────────────────
export const state = {
  user: null,
  token: null,
  currentRoute: 'home',
  /** Platform feature flags from API — { scout, social_embeds, face_blur } */
  features: null,
};

// ─── API helper ──────────────────────────────────────────────────────────────
export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    options.body = JSON.stringify(options.body);
  } else if (options.body instanceof FormData) {
    delete headers['Content-Type']; // let browser set multipart boundary
  }
  const resp = await fetch(path, { ...options, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error(data.error || 'Fout'), { status: resp.status, data });
  return data;
}

// ─── Toast notifications ──────────────────────────────────────────────────────
export function showToast(message, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ─── Quality debug panel ──────────────────────────────────────────────────────
/**
 * Shows a dismissable debug panel with raw quality measurements vs thresholds.
 * Stays visible until the user closes it. Helps calibrate threshold values.
 */
export function showQualityDebugPanel(qualityDebug) {
  if (!qualityDebug?.length) return;
  const existing = document.getElementById('quality-debug-panel');
  if (existing) existing.remove();

  function bar(value, min, max, low, high) {
    // Renders a small visual bar showing where the value falls within 0-255
    const pct = Math.round((value / 255) * 100);
    const lowPct  = Math.round((low  / 255) * 100);
    const highPct = Math.round((high / 255) * 100);
    return `
      <div style="position:relative;height:8px;background:#e9ecef;border-radius:4px;margin-top:3px">
        <div style="position:absolute;left:${lowPct}%;width:${highPct - lowPct}%;height:100%;background:rgba(40,167,69,0.25);border-radius:4px"></div>
        <div style="position:absolute;left:${Math.max(0,pct-1)}%;width:2%;height:100%;background:${value < low || value > high ? '#dc3545' : '#28a745'};border-radius:2px"></div>
      </div>`;
  }

  const panel = document.createElement('div');
  panel.id = 'quality-debug-panel';
  panel.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    width:min(96vw,420px);background:#fff;border:2px solid #f0ad4e;
    border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.18);
    z-index:9998;font-family:monospace;overflow:hidden`;

  panel.innerHTML = `
    <div style="background:#f0ad4e;padding:0.55rem 0.75rem;display:flex;align-items:center;justify-content:space-between">
      <span style="font-weight:700;font-size:0.85rem;color:#fff">🔬 Kwaliteitscheck debug</span>
      <button id="qdb-close" style="background:none;border:none;color:#fff;font-size:1.1rem;cursor:pointer;padding:0 0.2rem">✕</button>
    </div>
    <div style="padding:0.75rem;font-size:0.78rem;max-height:60vh;overflow-y:auto">
      ${qualityDebug.map(q => {
        const t = q.thresholds || {};
        const bOk = q.brightness >= (t.minBrightness||35) && q.brightness <= (t.maxBrightness||220);
        const sOk = q.sharpness  >= (t.minSharpness||2);
        const gOk = !q.grainRatio || q.grainRatio <= (t.maxGrainRatio||3.2);
        const minPx = t.minPixels || 200;
        const shortSide = Math.min(q.width || 9999, q.height || 9999);
        const rOk = shortSide >= minPx;
        const res = (q.width && q.height) ? `${q.width}×${q.height}` : '?';
        return `
          <div style="margin-bottom:0.9rem;padding-bottom:0.9rem;border-bottom:1px solid #eee">
            <div style="font-weight:700;color:#333;margin-bottom:0.5rem;font-size:0.8rem">📁 ${escHtml(q.file)}</div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;margin-bottom:0.4rem">
              <div style="background:${bOk?'#f0fff4':'#fff5f5'};border:1px solid ${bOk?'#b7ebc0':'#ffd0d0'};border-radius:6px;padding:0.4rem 0.5rem">
                <div style="color:#666;font-size:0.7rem">Helderheid ${bOk?'✅':'❌'}</div>
                <div style="font-size:0.95rem;font-weight:700;color:${bOk?'#28a745':'#dc3545'}">${q.brightness}</div>
                <div style="color:#888;font-size:0.68rem">${t.minBrightness||35}–${t.maxBrightness||220}</div>
                ${bar(q.brightness, 0, 255, t.minBrightness||35, t.maxBrightness||220)}
              </div>
              <div style="background:${sOk?'#f0fff4':'#fff5f5'};border:1px solid ${sOk?'#b7ebc0':'#ffd0d0'};border-radius:6px;padding:0.4rem 0.5rem">
                <div style="color:#666;font-size:0.7rem">Scherpte (640px) ${sOk?'✅':'❌'}</div>
                <div style="font-size:0.95rem;font-weight:700;color:${sOk?'#28a745':'#dc3545'}">${q.sharpness}</div>
                <div style="color:#888;font-size:0.68rem">min: ${t.minSharpness||2} · @80px: ${q.sharpness80||'?'}</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem">
              <div style="background:${gOk?'#f0fff4':'#fff5f5'};border:1px solid ${gOk?'#b7ebc0':'#ffd0d0'};border-radius:6px;padding:0.4rem 0.5rem">
                <div style="color:#666;font-size:0.7rem">Grain ratio ${gOk?'✅':'❌'}</div>
                <div style="font-size:0.95rem;font-weight:700;color:${gOk?'#28a745':'#dc3545'}">${q.grainRatio??'?'}</div>
                <div style="color:#888;font-size:0.68rem">max: ${t.maxGrainRatio||3.2} · lager = beter</div>
              </div>
              <div style="background:${rOk?'#f0fff4':'#fff5f5'};border:1px solid ${rOk?'#b7ebc0':'#ffd0d0'};border-radius:6px;padding:0.4rem 0.5rem">
                <div style="color:#666;font-size:0.7rem">Resolutie ${rOk?'✅':'❌'}</div>
                <div style="font-size:0.95rem;font-weight:700;color:${rOk?'#28a745':'#dc3545'}">${res}</div>
                <div style="color:#888;font-size:0.68rem">min: ${minPx}px korte zijde</div>
              </div>
            </div>

            <div style="margin-top:0.4rem;font-size:0.72rem;color:${q.passed?'#28a745':'#dc3545'};font-weight:600">
              ${q.passed ? '✅ Kwaliteit OK — blur uitgevoerd' : '⚠️ Kwaliteit onvoldoende — blur overgeslagen'}
            </div>
          </div>`;
      }).join('')}
      <div style="font-size:0.72rem;color:#888;margin-top:0.25rem">
        Thresholds in <code>server/services/faceBlur.js</code> · Grain ratio = scherpte@640 / scherpte@80
      </div>
    </div>`;

  document.body.appendChild(panel);
  panel.querySelector('#qdb-close').addEventListener('click', () => panel.remove());
}

// ─── Quality warning modal ────────────────────────────────────────────────────
/**
 * Shows a persistent modal when uploaded photos were not anonymised due to
 * insufficient quality (too dark / blurry).
 *
 * qualityIssues: [{ mediaId, file_path, warnings: string[] }]
 * onDelete(mediaId): called after successful server-side delete (reload gallery etc.)
 */
export function showQualityWarningModal(qualityIssues, onDelete) {
  if (!qualityIssues?.length) return;

  const modal = document.createElement('div');
  modal.className = 'badge-unlock-overlay';
  modal.style.cssText = 'z-index:9999';
  modal.innerHTML = `
    <div class="badge-unlock-card" style="max-width:380px;padding:1.25rem">
      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem">
        <span style="font-size:1.4rem">⚠️</span>
        <div>
          <div style="font-weight:800;font-size:1rem;color:var(--danger)">Foto niet geanonimiseerd</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.1rem">
            De kwaliteit was onvoldoende voor betrouwbare gezichtsherkenning
          </div>
        </div>
      </div>
      <p style="font-size:0.82rem;color:var(--text);line-height:1.5;margin-bottom:1rem">
        Personen die anoniem willen blijven zijn mogelijk <strong>herkenbaar</strong> op onderstaande foto's.
        Verwijder de foto's om dit te voorkomen, of behoud ze als anonimisering niet nodig is.
      </p>
      <div id="qw-items" style="display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1.1rem"></div>
      <button class="btn btn-secondary btn-block" id="qw-keep" style="margin-top:0.25rem">Alles behouden</button>
    </div>`;

  document.body.appendChild(modal);

  const itemsEl = modal.querySelector('#qw-items');
  const remaining = new Set(qualityIssues.map(q => q.mediaId));

  function renderItems() {
    itemsEl.innerHTML = qualityIssues
      .filter(q => remaining.has(q.mediaId))
      .map(q => `
        <div style="display:flex;align-items:center;gap:0.75rem;background:rgba(220,53,69,0.05);border:1px solid rgba(220,53,69,0.2);border-radius:10px;padding:0.6rem 0.75rem" data-mid="${q.mediaId}">
          <img src="${escHtml(q.file_path)}" style="width:52px;height:52px;object-fit:cover;border-radius:7px;flex-shrink:0" />
          <div style="flex:1;min-width:0">
            ${q.warnings.map(w => `<div style="font-size:0.75rem;color:var(--danger)">• ${escHtml(w.replace(/—.*/, '').trim())}</div>`).join('')}
          </div>
          <button class="btn btn-sm" data-del="${q.mediaId}"
            style="background:var(--danger);color:#fff;flex-shrink:0;padding:0.35rem 0.7rem;font-size:0.78rem;border-radius:8px">
            🗑 Verwijder
          </button>
        </div>`).join('');

    // Bind delete buttons
    itemsEl.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mid = parseInt(btn.dataset.del);
        btn.disabled = true; btn.textContent = '…';
        try {
          await fetch(`/api/social/media/${mid}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${state.token || localStorage.getItem('vb_token')}` },
          });
          remaining.delete(mid);
          if (typeof onDelete === 'function') onDelete(mid);
          if (remaining.size === 0) { modal.remove(); return; }
          renderItems();
        } catch (_) {
          btn.disabled = false; btn.textContent = '🗑 Verwijder';
          showToast('Verwijderen mislukt', 'error');
        }
      });
    });
  }

  renderItems();

  modal.querySelector('#qw-keep').addEventListener('click', () => modal.remove());
}

// ─── Team picker (when user has multiple team memberships) ───────────────────
const ROLE_LABELS = { player: 'Speler', coach: 'Trainer/Coach', trainer: 'Trainer/Coach', parent: 'Ouder' };

function showTeamPicker(memberships) {
  const existing = document.getElementById('team-picker-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'team-picker-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);
    display:flex;align-items:flex-end;justify-content:center;
    animation:fadeIn .15s ease;
  `;

  overlay.innerHTML = `
    <div style="background:var(--bg-card);border-radius:1rem 1rem 0 0;width:100%;max-width:480px;
                padding:1.25rem 1rem 2rem;max-height:80vh;overflow-y:auto;
                box-shadow:0 -4px 24px rgba(0,0,0,0.15)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
        <span style="font-weight:700;font-size:1rem">Kies een team</span>
        <button id="team-picker-close" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted)">✕</button>
      </div>
      ${memberships.map(m => {
        const logoUrl = m.nevobo_code
          ? `https://assets.nevobo.nl/organisatie/logo/${m.nevobo_code.toUpperCase()}.jpg`
          : null;
        const initials = avatarInitials(m.club_name || m.team_name || '?');
        const logoHtml = logoUrl
          ? `<div style="width:2.5rem;height:2.5rem;border-radius:10px;background:#fff;border:1.5px solid var(--border);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center">
               <img src="${logoUrl}" alt="${m.club_name}"
                    onload="this.style.opacity=1"
                    onerror="this.parentElement.style.background='var(--primary)';this.parentElement.style.color='#fff';this.parentElement.style.fontWeight='900';this.parentElement.innerHTML='${initials}'"
                    style="width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity .2s" />
             </div>`
          : `<div style="width:2.5rem;height:2.5rem;border-radius:10px;background:var(--primary);color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0">${initials}</div>`;
        return `
        <button class="team-picker-item" data-team-id="${m.team_id}" data-club-id="${m.club_id}"
          style="display:flex;align-items:center;gap:0.75rem;width:100%;padding:0.875rem 0.75rem;
                 background:none;border:none;border-radius:var(--radius);cursor:pointer;text-align:left;
                 transition:background .15s">
          ${logoHtml}
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:0.9rem">${m.team_name}</div>
            <div style="font-size:0.78rem;color:var(--text-muted)">${m.club_name} · ${ROLE_LABELS[m.membership_type] || m.membership_type}</div>
          </div>
          <span style="color:var(--text-muted);font-size:1.1rem">›</span>
        </button>`;
      }).join('')}
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelectorAll('.team-picker-item').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.remove();
      navigate('team', { teamId: parseInt(btn.dataset.teamId), clubId: parseInt(btn.dataset.clubId) });
    });
    btn.addEventListener('mouseenter', () => btn.style.background = 'var(--border)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'none');
  });

  document.getElementById('team-picker-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ─── Badge unlock animation ───────────────────────────────────────────────────
export function showBadgeUnlock(badge) {
  spawnConfetti();
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card">
      <span class="badge-unlock-icon">${badge.icon_emoji}</span>
      <h2>Badge ontgrendeld!</h2>
      <p class="mt-2"><strong>${badge.label}</strong></p>
      <p class="text-muted mt-1">${badge.description}</p>
      <p class="mt-2 chip chip-warning">+${badge.xp_reward} XP</p>
      <button class="btn btn-primary btn-block mt-4" onclick="this.closest('.badge-unlock-overlay').remove()">Super! 🎉</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function spawnConfetti() {
  const colors = ['#FF5722','#2196F3','#FFC107','#4CAF50','#9C27B0','#FF4081'];
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `
      left: ${Math.random() * 100}vw;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      animation-duration: ${0.8 + Math.random() * 1.4}s;
      animation-delay: ${Math.random() * 0.4}s;
      transform: rotate(${Math.random() * 360}deg);
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }
}

// ─── Avatar initials helper ───────────────────────────────────────────────────
export function avatarInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export function renderAvatar(name, avatarUrl, size = 'md') {
  if (avatarUrl) return `<div class="avatar avatar-${size}"><img src="${avatarUrl}" alt="${name}" /></div>`;
  return `<div class="avatar avatar-${size}">${avatarInitials(name)}</div>`;
}

/**
 * Renders a Nevobo club logo with automatic fallback to initials.
 * @param {string} nevoboCode  e.g. "ckl9x7n"
 * @param {string} fallbackName  Club/team name for initials fallback
 * @param {'sm'|'md'|'lg'} size
 */
export function renderClubLogo(nevoboCode, fallbackName, size = 'md') {
  const initials = avatarInitials(fallbackName || nevoboCode || '?');
  if (!nevoboCode) {
    return `<div class="club-logo club-logo-${size} club-logo-fallback">${initials}</div>`;
  }
  const url = `https://assets.nevobo.nl/organisatie/logo/${nevoboCode.toUpperCase()}.jpg`;
  return `
    <div class="club-logo club-logo-${size}">
      <img src="${url}" alt="${fallbackName || nevoboCode}"
           onload="this.style.opacity=1"
           onerror="this.parentElement.classList.add('club-logo-fallback');this.parentElement.innerHTML='${initials}'"
           style="width:100%;height:100%;object-fit:contain;border-radius:inherit;opacity:0;transition:opacity .2s" />
    </div>`;
}

// ─── Relative time ────────────────────────────────────────────────────────────
export function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60)    return 'Zojuist';
  if (diff < 3600)  return `${Math.floor(diff / 60)} min geleden`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} uur geleden`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} dagen geleden`;
  return new Date(dateStr).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

// ─── Format date ──────────────────────────────────────────────────────────────
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('nl-NL', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

// ─── Storage ──────────────────────────────────────────────────────────────────
function saveSession(token, user, features = null) {
  localStorage.setItem('vb_token', token);
  localStorage.setItem('vb_user', JSON.stringify(user));
  state.token = token;
  state.user = user;
  if (features) state.features = features;
}

function clearSession() {
  localStorage.removeItem('vb_token');
  localStorage.removeItem('vb_user');
  state.token = null;
  state.user = null;
  state.features = null;
}

// ─── Router ───────────────────────────────────────────────────────────────────
const routes = {};

export function registerRoute(name, fn) {
  routes[name] = fn;
}

const PAGE_TITLES = {
  home:          'Home',
  matches:       'Wedstrijden',
  carpool:       'Carpool',
  badges:        'Badges & Doelen',
  social:        'Sociaal',
  profile:       'Mijn Profiel',
  team:          'Team',
  admin:         'Beheer',
  settings:      'Platform',
  help:          'Naslag',
  privacy:       'Privacy',
  'scout-setup': '🏐 Scout setup',
  'scout-match': '🏐 Scouting',
};

/** Zet document-scroll bovenaan (SPA: nieuwe route of volledige inhoudswissel). */
export function scrollAppToTop() {
  // Directe toewijzing om html { scroll-behavior: smooth } te omzeilen
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
}

let headerGearMenuBound = false;

function bindHeaderGearMenu() {
  if (headerGearMenuBound) return;
  const gearWrap = document.getElementById('header-gear-wrap');
  const gearBtn = document.getElementById('header-gear-btn');
  const menu = document.getElementById('header-gear-menu');
  if (!gearWrap || !gearBtn || !menu) return;
  headerGearMenuBound = true;

  const closeMenu = () => {
    menu.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
    gearBtn.setAttribute('aria-expanded', 'false');
  };

  gearBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const opening = menu.classList.contains('hidden');
    if (opening) {
      // Na document-handlers laten lopen, anders sluit buitenklik het menu direct weer
      requestAnimationFrame(() => {
        menu.classList.remove('hidden');
        menu.setAttribute('aria-hidden', 'false');
        gearBtn.setAttribute('aria-expanded', 'true');
      });
    } else {
      closeMenu();
    }
  });

  menu.addEventListener('click', e => {
    const item = e.target.closest('[data-nav]');
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    const r = item.dataset.nav;
    if (r === 'settings' || r === 'admin') navigate(r);
  });

  // Sluit alleen bij klik buiten tandwiel + dropdown (capture: vóór andere handlers)
  document.addEventListener(
    'click',
    e => {
      if (gearWrap.classList.contains('hidden')) return;
      const t = e.target;
      const el = t && t.nodeType === Node.ELEMENT_NODE ? t : t?.parentElement;
      if (!el || gearWrap.contains(el)) return;
      closeMenu();
    },
    true
  );

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
  });
}

/** Profielfoto/initialen + beheer-menu in de app-header (na login of user-update). */
export function syncAppHeaderChrome() {
  const profileBtn = document.getElementById('header-profile-btn');
  const gearWrap = document.getElementById('header-gear-wrap');
  const menu = document.getElementById('header-gear-menu');
  const gearBtn = document.getElementById('header-gear-btn');
  if (!profileBtn) return;

  bindHeaderGearMenu();

  if (menu) {
    menu.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
  }
  if (gearBtn) gearBtn.setAttribute('aria-expanded', 'false');

  const user = state.user;
  if (!user) {
    profileBtn.innerHTML = '👤';
    profileBtn.classList.remove('header-action--profile');
    gearWrap?.classList.add('hidden');
    if (menu) menu.innerHTML = '';
    return;
  }

  profileBtn.classList.add('header-action--profile');
  profileBtn.innerHTML = renderAvatar(user.name, user.avatar_url, 'sm');

  const isSuperAdmin = user.roles?.some(r => r.role === 'super_admin');
  const hasAdminRole = (user.roles?.length ?? 0) > 0;
  const showGear = isSuperAdmin || hasAdminRole;

  if (!showGear || !gearWrap || !menu) {
    gearWrap?.classList.add('hidden');
    menu && (menu.innerHTML = '');
    return;
  }

  let items = '';
  if (isSuperAdmin) {
    items += '<button type="button" class="header-gear-item" data-nav="settings" role="menuitem">🎛️ Platform</button>';
  }
  if (hasAdminRole) {
    items += '<button type="button" class="header-gear-item" data-nav="admin" role="menuitem">⚙️ Gebruikersbeheer</button>';
  }
  menu.innerHTML = items;
  gearWrap.classList.remove('hidden');
}

export function navigate(route, params = {}) {
  scrollAppToTop();
  state.currentRoute = route;
  // Persist so the route survives a camera-triggered page reload
  try { sessionStorage.setItem('vb_route', JSON.stringify({ route, params })); } catch (_) {}

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(btn => {
    const btnRoute = btn.dataset.route;
    const isActive = btnRoute === route || (btnRoute === 'team-own' && route === 'team');
    btn.classList.toggle('active', isActive);
  });

  // Update header title
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = PAGE_TITLES[route] || route;

  syncAppHeaderChrome();

  document.getElementById('app')?.classList.remove('tp-fullwidth');

  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="spinner"></div>';

  const fn = routes[route];
  if (fn) {
    Promise.resolve(fn(container, params)).catch(err => {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <h3>Oeps!</h3>
          <p>${err.message || 'Er is iets misgegaan'}</p>
          <button class="btn btn-primary mt-3" onclick="navigate('home')">Terug naar home</button>
        </div>`;
    });
  } else {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Pagina niet gevonden</p></div>`;
  }
}

// ─── Auth screen ──────────────────────────────────────────────────────────────
function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

async function initAuth() {
  // Auth tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('login-form').classList.toggle('hidden', target !== 'login');
      document.getElementById('register-form').classList.toggle('hidden', target !== 'register');
    });
  });

  // Load clubs for register form
  try {
    const { clubs } = await fetch('/api/clubs').then(r => r.json());
    const select = document.getElementById('reg-club');
    clubs.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });
  } catch (_) {}

  // Login
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Even geduld…';
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { email: document.getElementById('login-email').value, password: document.getElementById('login-password').value },
      });
      saveSession(data.token, data.user, data.features);
      showApp();
      navigate('home');
    } catch (err) {
      showToast(err.message || 'Inloggen mislukt', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Inloggen';
    }
  });

  // Register
  document.getElementById('register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Even geduld…';
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: {
          name: document.getElementById('reg-name').value,
          email: document.getElementById('reg-email').value,
          password: document.getElementById('reg-password').value,
          club_id: document.getElementById('reg-club').value || null,
        },
      });
      saveSession(data.token, data.user, data.features);
      showApp();
      navigate('home');
      showToast('Welkom bij VolleyApp! 🏐', 'success');
    } catch (err) {
      showToast(err.message || 'Registratie mislukt', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Account aanmaken';
    }
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function boot() {
  // Restore session from localStorage
  const token = localStorage.getItem('vb_token');
  const user = JSON.parse(localStorage.getItem('vb_user') || 'null');

  // Load pages in parallel while checking auth
  const pagesPromise = Promise.all([
    import('./pages/home.js'),
    import('./pages/matches.js'),
    import('./pages/carpool.js'),
    import('./pages/badges.js'),
    import('./pages/social.js'),
    import('./pages/profile.js'),
    import('./pages/team.js'),
    import('./pages/admin.js'),
    import('./pages/settings.js'),
    import('./pages/help.js'),
    import('./pages/privacy.js'),
    import('./pages/scout-setup.js'),
    import('./pages/scout-match.js'),
    import('./pages/training-planner.js'),
  ]);

  if (token && user) {
    state.token = token;
    state.user = user;
    // Show the app immediately — no login flash on camera return
    showApp();
  }

  // Verify token validity in parallel with page loading
  let sessionValid = false;
  if (token && user) {
    try {
      const me = await api('/api/auth/me');
      state.user = me.user;
      state.features = me.features || null;
      localStorage.setItem('vb_user', JSON.stringify(me.user));
      sessionValid = true;
    } catch (_) {
      clearSession();
    }
  }

  const [homePage, matchesPage, carpoolPage, badgesPage, socialPage, profilePage, teamPage, adminPage, settingsPage, helpPage, privacyPage, scoutSetupPage, scoutMatchPage, trainingPlannerPage] = await pagesPromise;

  registerRoute('home',         homePage.render);
  registerRoute('matches',      matchesPage.render);
  registerRoute('carpool',      carpoolPage.render);
  registerRoute('badges',       badgesPage.render);
  registerRoute('social',       socialPage.render);
  registerRoute('profile',      profilePage.render);
  registerRoute('team',         teamPage.render);
  registerRoute('admin',        adminPage.render);
  registerRoute('settings',     settingsPage.render);
  registerRoute('help',         helpPage.render);
  registerRoute('privacy',      privacyPage.render);
  registerRoute('scout-setup',  scoutSetupPage.render);
  registerRoute('scout-match',  scoutMatchPage.render);
  registerRoute('training-planner', trainingPlannerPage.render);

  // Bottom nav clicks
  document.querySelectorAll('.nav-item[data-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.route === 'team-own') {
        const u = state.user;
        const mems = u?.memberships || [];
        if (mems.length > 1) {
          showTeamPicker(mems);
        } else if (mems.length === 1) {
          navigate('team', { teamId: mems[0].team_id, clubId: mems[0].club_id });
        } else if (u?.team_id && u?.club_id) {
          navigate('team', { teamId: u.team_id, clubId: u.club_id });
        } else {
          navigate('profile');
        }
      } else {
        navigate(btn.dataset.route);
      }
    });
  });

  // Profile header button
  document.getElementById('header-profile-btn').addEventListener('click', () => navigate('profile'));

  // Init auth UI
  await initAuth();

  if (state.token && state.user) {
    showApp();
    // Restore the route from before the camera/reload if available
    let restored = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem('vb_route') || 'null');
      if (saved?.route) {
        navigate(saved.route, saved.params || {});
        restored = true;
      }
    } catch (_) {}
    if (!restored) navigate('home');
  } else {
    showAuth();
    syncAppHeaderChrome();
  }
}

window.navigate = navigate;
window.showToast = showToast;
window.showBadgeUnlock = showBadgeUnlock;
window.appState = state;
window.appApi = api;

boot();
