import { api, state, renderAvatar, relativeTime, formatDate } from '../app.js';

export async function render(container) {
  container.innerHTML = '<div class="spinner"></div>';

  const user = state.user;
  if (!user) { container.innerHTML = renderLoginPrompt(); return; }

  try {
    const [meData, feedData] = await Promise.all([
      api('/api/auth/me').catch(() => null),
      user.club_id
        ? api(`/api/social/feed?limit=10`).catch(() => ({ posts: [] }))
        : Promise.resolve({ posts: [] }),
    ]);

    const me = meData?.user || user;
    const posts = feedData?.posts || [];
    const badges = meData?.badges || [];
    const nextLevel = meData?.nextLevel;
    const currentLevel = meData?.currentLevel;

    const earnedBadges = badges.filter(b => b.earned_at).slice(0, 3);

    // XP bar percentage
    const xpProgress = nextLevel
      ? Math.min(100, Math.round(((me.xp - (currentLevel?.xp_required || 0)) / (nextLevel.xp_required - (currentLevel?.xp_required || 0))) * 100))
      : 100;

    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <div class="flex items-center gap-3 mb-3">
            ${renderAvatar(me.name, me.avatar_url, 'md')}
            <div>
              <h1 style="font-size:1.2rem">Hey, ${me.name.split(' ')[0]}! 👋</h1>
              <div class="flex gap-2 mt-1">
                <span class="chip chip-primary">${currentLevel?.label || 'Niveau ' + me.level}</span>
                <span class="chip" style="background:rgba(255,255,255,0.2);color:#fff">${me.xp} XP</span>
              </div>
            </div>
          </div>
          <!-- XP bar -->
          <div>
            <div class="flex justify-between mb-1" style="font-size:0.78rem;color:rgba(255,255,255,0.75)">
              <span>${currentLevel?.label || ''} • ${me.xp} XP</span>
              ${nextLevel ? `<span>Volgend: ${nextLevel.label} (${nextLevel.xp_required} XP)</span>` : '<span>Max level! 🔥</span>'}
            </div>
            <div class="xp-bar-track" style="background:rgba(255,255,255,0.2)">
              <div class="xp-bar-fill" id="xp-fill" style="width:0%" ></div>
            </div>
          </div>
        </div>
      </div>

      <div class="container">

        ${earnedBadges.length > 0 ? `
          <div class="section">
            <div class="section-header">
              <span class="section-title">Jouw badges</span>
              <button class="btn btn-ghost btn-sm" onclick="navigate('badges')">Alles →</button>
            </div>
            <div class="scroll-x">
              ${earnedBadges.map(b => `
                <div style="display:flex;flex-direction:column;align-items:center;gap:0.25rem;min-width:72px">
                  <div style="font-size:2.2rem">${b.icon_emoji}</div>
                  <span style="font-size:0.7rem;font-weight:700;text-align:center;max-width:72px;color:var(--text-muted)">${b.label}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : `
          <div class="section">
            <div class="card">
              <div class="card-body text-center">
                <div style="font-size:2.5rem">🏆</div>
                <h3 class="mt-2">Verdien je eerste badge!</h3>
                <p class="text-muted mt-1">Wees aanwezig bij een wedstrijd of upload een foto.</p>
                <button class="btn btn-primary btn-sm mt-3" onclick="navigate('badges')">Bekijk badges</button>
              </div>
            </div>
          </div>
        `}

        ${!user.club_id ? `
          <div class="section">
            <div class="card" style="border-color:var(--primary);border-width:2px">
              <div class="card-body">
                <h3>🏐 Sluit je aan bij een club</h3>
                <p class="text-muted mt-1">Koppel je account aan jouw volleybalclub om wedstrijden, carpool en het social feed te zien.</p>
                <button class="btn btn-primary mt-3" onclick="navigate('profile')">Profiel instellen</button>
              </div>
            </div>
          </div>
        ` : ''}

        <div class="section">
          <div class="section-header">
            <span class="section-title">Activiteitenfeed</span>
            <button class="btn btn-ghost btn-sm" onclick="navigate('social')">Meer →</button>
          </div>
          ${posts.length === 0 ? `
            <div class="empty-state" style="padding:2rem 0">
              <div class="empty-icon">💬</div>
              <p>Nog geen berichten. Volg teams of clubs om updates te zien!</p>
              <button class="btn btn-primary btn-sm mt-2" onclick="navigate('social')">Ontdekken</button>
            </div>
          ` : posts.filter(p => p.body?.trim() || p.media?.length > 0).map(renderPostCard).join('')}
        </div>

        <div class="section" style="padding-bottom:0.5rem">
          <div class="flex gap-2" style="flex-wrap:wrap">
            <button class="btn btn-secondary" style="flex:1" onclick="navigate('matches')">📅 Wedstrijden</button>
            <button class="btn btn-secondary" style="flex:1" onclick="navigate('carpool')">🚗 Carpool</button>
          </div>
        </div>

      </div>
    `;

    // Animate XP bar after render
    setTimeout(() => {
      const fill = document.getElementById('xp-fill');
      if (fill) fill.style.width = xpProgress + '%';
    }, 150);

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

function renderPostCard(post) {
  const mediaHtml = post.media?.length > 0 ? `
    <div class="post-media-grid cols-${Math.min(post.media.length, 3)}" style="margin-top:0.5rem">
      ${post.media.slice(0, 3).map(m =>
        m.file_type === 'video'
          ? `<video src="${m.file_path}" controls style="width:100%;aspect-ratio:1;object-fit:cover"></video>`
          : `<img src="${m.file_path}" alt="Foto" loading="lazy" />`
      ).join('')}
    </div>` : '';

  return `
    <div class="post-card">
      <div class="post-header">
        ${renderAvatar(post.author_name, post.author_avatar, 'sm')}
        <div class="post-author">
          <div class="post-author-name">${post.author_name}</div>
          <div class="post-author-meta">${relativeTime(post.created_at)} ${post.team_name ? '· ' + post.team_name : ''}</div>
        </div>
      </div>
      ${post.body ? `<div class="post-body">${escapeHtml(post.body)}</div>` : ''}
      ${mediaHtml}
    </div>`;
}

function renderLoginPrompt() {
  return `<div class="empty-state"><div class="empty-icon">🏐</div><h2>Welkom!</h2><p>Log in of maak een account aan om te beginnen.</p></div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
