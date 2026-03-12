// ─── App State ───────────────────────────────────────────────────────────────
export const state = {
  user: null,
  token: null,
  currentRoute: 'home',
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
function saveSession(token, user) {
  localStorage.setItem('vb_token', token);
  localStorage.setItem('vb_user', JSON.stringify(user));
  state.token = token;
  state.user = user;
}

function clearSession() {
  localStorage.removeItem('vb_token');
  localStorage.removeItem('vb_user');
  state.token = null;
  state.user = null;
}

// ─── Router ───────────────────────────────────────────────────────────────────
const routes = {};

export function registerRoute(name, fn) {
  routes[name] = fn;
}

const PAGE_TITLES = {
  home:     'Home',
  matches:  'Wedstrijden',
  carpool:  'Carpool',  // kept for deep links from match pages
  badges:   'Badges & Doelen',
  social:   'Sociaal',
  profile:  'Mijn Profiel',
  team:     'Team',
  admin:    'Beheer',
};

export function navigate(route, params = {}) {
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
      opt.textContent = `${c.name} (${c.nevobo_code})`;
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
      saveSession(data.token, data.user);
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
      saveSession(data.token, data.user);
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
    import('./pages/privacy.js'),
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
      localStorage.setItem('vb_user', JSON.stringify(me.user));
      sessionValid = true;
    } catch (_) {
      clearSession();
    }
  }

  const [homePage, matchesPage, carpoolPage, badgesPage, socialPage, profilePage, teamPage, adminPage, privacyPage] = await pagesPromise;

  registerRoute('home',    homePage.render);
  registerRoute('matches', matchesPage.render);
  registerRoute('carpool', carpoolPage.render);
  registerRoute('badges',  badgesPage.render);
  registerRoute('social',  socialPage.render);
  registerRoute('profile', profilePage.render);
  registerRoute('team',    teamPage.render);
  registerRoute('admin',   adminPage.render);
  registerRoute('privacy', privacyPage.render);

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
  }
}

window.navigate = navigate;
window.showToast = showToast;
window.showBadgeUnlock = showBadgeUnlock;
window.appState = state;
window.appApi = api;

boot();
