import { api, state, renderAvatar, relativeTime, showToast, showQualityWarningModal } from '../app.js';
import { FilePicker } from '../file-picker.js';

let currentTab = 'feed';

export async function render(container) {
  container.innerHTML = '<div class="spinner"></div>';
  const user = state.user;
  if (!user) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><p>Log in om het sociale feed te zien.</p></div>`;
    return;
  }

  renderSocialPage(container, currentTab);
}

async function renderSocialPage(container, tab) {
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const user = state.user;

    // Determine which data we need per tab
    const [feedData, discoverData, followingData] = await Promise.all([
      tab === 'feed'
        ? api('/api/social/feed?limit=20').catch(() => ({ posts: [] }))
        : Promise.resolve({ posts: [] }),
      tab === 'discover'
        ? loadDiscoverData(user)
        : Promise.resolve(null),
      api('/api/social/following').catch(() => ({ follows: [] })),
    ]);

    const posts = feedData.posts || [];
    const following = followingData.follows || [];
    const followingTeamIds = new Set(following.filter(f => f.followee_type === 'team').map(f => f.followee_id));
    const followingClubIds = new Set(following.filter(f => f.followee_type === 'club').map(f => f.followee_id));

    const followCount = following.length;

    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <h1>💬 Sociaal</h1>
          <p>Updates van teams en clubs die je volgt</p>
        </div>
      </div>
      <div class="container">

        <!-- Post composer (only shown on feed tab) -->
        ${tab === 'feed' && user ? `
          <div class="card mb-3">
            <div class="card-body">
              <div class="flex items-center gap-2 mb-2">
                ${renderAvatar(user.name, user.avatar_url, 'sm')}
                <input type="text" id="post-input" class="form-input" placeholder="Deel iets met je team… 🏐" style="flex:1" />
              </div>
              <div id="composer-picker-wrap"></div>
              <div class="flex gap-2 mt-2">
                <button class="compose-media-btn" id="toggle-picker-btn" type="button">📎 Bijlage</button>
                <button class="btn btn-primary btn-sm" id="post-submit" style="margin-left:auto">Plaatsen</button>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Tabs -->
        <div class="tabs">
          <button class="tab-btn ${tab === 'feed' ? 'active' : ''}" data-tab="feed">Feed</button>
          <button class="tab-btn ${tab === 'discover' ? 'active' : ''}" data-tab="discover">Teams ontdekken</button>
          <button class="tab-btn ${tab === 'following' ? 'active' : ''}" data-tab="following">Volgend (${followCount})</button>
        </div>

        <!-- Feed tab -->
        ${tab === 'feed' ? `
          <div id="social-feed">
            ${posts.length === 0 ? `
              <div class="empty-state">
                <div class="empty-icon">💬</div>
                <p>Nog geen berichten. Volg teams via "Teams ontdekken"!</p>
                <button class="btn btn-primary btn-sm mt-2" id="go-discover-btn">Teams ontdekken →</button>
              </div>
            ` : posts.filter(hasContent).map(p => renderPostCard(p)).join('')}
          </div>
        ` : ''}

        <!-- Discover tab -->
        ${tab === 'discover' ? renderDiscoverTab(discoverData, user, followingTeamIds, followingClubIds) : ''}

        <!-- Following tab -->
        ${tab === 'following' ? renderFollowingTab(following) : ''}

      </div>
    `;

    // Tab switching
    container.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTab = btn.dataset.tab;
        renderSocialPage(container, currentTab);
      });
    });

    // Go-to-discover shortcut
    document.getElementById('go-discover-btn')?.addEventListener('click', () => {
      currentTab = 'discover';
      renderSocialPage(container, 'discover');
    });

    // Set up FilePicker in composer (feed tab only)
    let composerPicker = null;
    let pickerVisible = false;
    const pickerWrap = document.getElementById('composer-picker-wrap');
    const toggleBtn = document.getElementById('toggle-picker-btn');

    if (pickerWrap && toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        pickerVisible = !pickerVisible;
        if (pickerVisible) {
          if (!composerPicker) {
            composerPicker = new FilePicker(pickerWrap, {
              accept: 'image/*,video/*',
              multiple: true,
              maxFiles: 10,
              label: "Foto's of video's toevoegen",
              hint: 'Klik of sleep bestanden hierheen',
            });
          }
          pickerWrap.style.display = '';
          toggleBtn.textContent = '✕ Bijlage verwijderen';
          toggleBtn.style.color = 'var(--danger)';
          toggleBtn.style.borderColor = 'var(--danger)';
        } else {
          pickerWrap.style.display = 'none';
          composerPicker?.reset();
          toggleBtn.textContent = '📎 Bijlage';
          toggleBtn.style.color = '';
          toggleBtn.style.borderColor = '';
        }
      });
      pickerWrap.style.display = 'none'; // hidden until toggled
    }

    // Post submission
    document.getElementById('post-submit')?.addEventListener('click', async () => {
      const input = document.getElementById('post-input');
      const text = input?.value?.trim();
      const files = composerPicker?.getFiles() ?? [];

      if (!text && files.length === 0) return;

      try {
        if (files.length > 0) {
          const fd = new FormData();
          files.forEach(f => fd.append('files', f));
          if (text) fd.append('caption', text);
          const resp = await fetch('/api/social/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${state.token}` },
            body: fd,
          });
          const data = await resp.json().catch(() => ({}));
          showToast('Bericht geplaatst! 📣', 'success');
          if (data.qualityIssues?.length) {
            showQualityWarningModal(data.qualityIssues, () => renderSocialPage(container, 'feed'));
          }
        } else {
          await api('/api/social/post', { method: 'POST', body: { body: text, team_id: user.team_id || null } });
          showToast('Bericht geplaatst! 📣', 'success');
        }
        renderSocialPage(container, 'feed');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Follow/unfollow team buttons
    container.querySelectorAll('.follow-team-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        const isFollowing = btn.dataset.following === 'true';
        try {
          if (isFollowing) {
            await api('/api/social/follow', { method: 'DELETE', body: { followee_type: 'team', followee_id: id } });
          } else {
            await api('/api/social/follow', { method: 'POST', body: { followee_type: 'team', followee_id: id } });
            showToast('Team gevolgd! 📣', 'success');
          }
          renderSocialPage(container, 'discover');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Follow/unfollow club buttons
    container.querySelectorAll('.follow-club-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        const isFollowing = btn.dataset.following === 'true';
        try {
          if (isFollowing) {
            await api('/api/social/follow', { method: 'DELETE', body: { followee_type: 'club', followee_id: id } });
          } else {
            await api('/api/social/follow', { method: 'POST', body: { followee_type: 'club', followee_id: id } });
            showToast('Club gevolgd! 📣', 'success');
          }
          renderSocialPage(container, 'discover');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Unfollow buttons in following tab
    container.querySelectorAll('.unfollow-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/social/follow', {
            method: 'DELETE',
            body: { followee_type: btn.dataset.type, followee_id: parseInt(btn.dataset.id) },
          });
          showToast('Ontvolgt', 'info');
          renderSocialPage(container, 'following');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

async function loadDiscoverData(user) {
  const [clubsData, myTeamsData] = await Promise.all([
    api('/api/clubs').catch(() => ({ clubs: [] })),
    user.club_id
      ? api(`/api/clubs/${user.club_id}/teams?userId=${user.id}`).catch(() => ({ teams: [] }))
      : Promise.resolve({ teams: [] }),
  ]);
  return {
    clubs: clubsData.clubs || [],
    myTeams: myTeamsData.teams || [],
  };
}

function renderDiscoverTab(data, user, followingTeamIds, followingClubIds) {
  if (!data) return '<div class="spinner"></div>';
  const { clubs, myTeams } = data;

  const ownClub = user.club_id ? clubs.find(c => c.id === user.club_id) : null;
  const otherClubs = clubs.filter(c => c.id !== user.club_id);

  let html = '';

  // ── Own club teams ────────────────────────────────────────────────────────
  if (ownClub && myTeams.length > 0) {
    html += `
      <div class="discover-section">
        <div class="discover-section-title">🏐 Teams in jouw club — ${ownClub.name}</div>
        <p class="text-muted text-small mb-2">Volg andere teams uit jouw club om hun wedstrijden en updates te zien.</p>
        ${myTeams.map(t => {
          const isOwn = t.id === user.team_id;
          const isFollowing = followingTeamIds.has(t.id);
          return `
            <div class="card mb-2">
              <div class="card-body">
                <div class="flex items-center gap-3">
                  <div class="avatar avatar-md" style="background:linear-gradient(135deg,var(--primary),var(--accent));font-size:1.1rem">👕</div>
                  <div style="flex:1">
                    <div style="font-weight:700;font-size:0.95rem">${t.display_name}</div>
                    <div class="text-muted text-small">${ownClub.name}</div>
                  </div>
                  ${isOwn
                    ? `<span class="chip chip-primary" style="font-size:0.75rem">Jouw team</span>`
                    : `<div class="flex gap-1">
                        <button class="btn btn-sm btn-ghost" onclick="navigate('team',{teamId:${t.id},clubId:${ownClub.id}})">Bekijken</button>
                        <button class="btn btn-sm ${isFollowing ? 'btn-secondary' : 'btn-accent'} follow-team-btn"
                          data-id="${t.id}" data-following="${isFollowing}">
                          ${isFollowing ? '✓' : '+'}
                        </button>
                      </div>`
                  }
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  } else if (ownClub && myTeams.length === 0) {
    html += `
      <div class="discover-section">
        <div class="discover-section-title">🏐 Teams in jouw club — ${ownClub.name}</div>
        <div class="empty-state" style="padding:1rem 0">
          <p class="text-muted text-small">Nog geen teams gevonden. Ga naar Profiel → synchroniseer teams.</p>
          <button class="btn btn-ghost btn-sm mt-1" onclick="navigate('profile')">Ga naar profiel →</button>
        </div>
      </div>`;
  }

  // ── Other clubs ───────────────────────────────────────────────────────────
  if (otherClubs.length > 0) {
    html += `
      <div class="discover-section">
        <div class="discover-section-title">🌐 Andere clubs</div>
        ${otherClubs.map(club => {
          const isFollowing = followingClubIds.has(club.id);
          return `
            <div class="card mb-2">
              <div class="card-body">
                <div class="flex items-center gap-3">
                  <div class="avatar avatar-md" style="background:linear-gradient(135deg,var(--secondary),var(--primary));font-size:1.2rem">🏐</div>
                  <div style="flex:1">
                    <div style="font-weight:700">${club.name}</div>
                    <div class="text-muted text-small">${club.nevobo_code}${club.region ? ' · ' + club.region : ''}</div>
                  </div>
                  <button class="btn btn-sm ${isFollowing ? 'btn-secondary' : 'btn-accent'} follow-club-btn"
                    data-id="${club.id}" data-following="${isFollowing}">
                    ${isFollowing ? '✓ Gevolgd' : '+ Volgen'}
                  </button>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  if (!html) {
    html = `<div class="empty-state"><div class="empty-icon">🏐</div><p>Geen clubs of teams gevonden. Voeg eerst een club toe via Profiel.</p></div>`;
  }

  return html;
}

function renderFollowingTab(following) {
  if (following.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">📣</div>
        <p>Je volgt nog niemand. Ga naar "Teams ontdekken" om teams te vinden.</p>
      </div>`;
  }

  const teams = following.filter(f => f.followee_type === 'team');
  const clubs = following.filter(f => f.followee_type === 'club');

  let html = '';

  if (teams.length > 0) {
    html += `<div style="font-weight:700;font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:0.75rem 0 0.5rem">👕 Teams (${teams.length})</div>`;
    html += teams.map(f => renderFollowItem(f, '👕')).join('');
  }

  if (clubs.length > 0) {
    html += `<div style="font-weight:700;font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:0.75rem 0 0.5rem">🏐 Clubs (${clubs.length})</div>`;
    html += clubs.map(f => renderFollowItem(f, '🏐')).join('');
  }

  return html;
}

function renderFollowItem(f, icon) {
  return `
    <div class="card mb-2">
      <div class="card-body flex items-center gap-3">
        <div class="avatar avatar-sm" style="background:linear-gradient(135deg,var(--primary),var(--accent))">${icon}</div>
        <div style="flex:1">
          <span class="chip chip-neutral" style="margin-bottom:0.2rem;font-size:0.7rem">${f.followee_type === 'team' ? 'Team' : 'Club'}</span>
          <div style="font-weight:700;font-size:0.9rem">${f.followee_name || 'ID ' + f.followee_id}</div>
          ${f.followee_type === 'team' ? `<div class="text-muted text-small">👁️ Alleen lezen</div>` : ''}
        </div>
        <button class="btn btn-secondary btn-sm unfollow-btn" data-type="${f.followee_type}" data-id="${f.followee_id}">
          Ontvolgen
        </button>
      </div>
    </div>`;
}

function hasContent(post) {
  return post.body?.trim() || post.media?.length > 0;
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

  const typeIcon = { post: '💬', media: '📸', badge: '🏆', match_result: '🏐' }[post.type] || '💬';

  return `
    <div class="post-card">
      <div class="post-header">
        ${renderAvatar(post.author_name, post.author_avatar, 'sm')}
        <div class="post-author">
          <div class="post-author-name">${post.author_name} <span style="font-size:0.8rem">${typeIcon}</span></div>
          <div class="post-author-meta">${relativeTime(post.created_at)}${post.team_name ? ' · ' + post.team_name : ''}${post.club_name ? ' · ' + post.club_name : ''}</div>
        </div>
      </div>
      ${post.body ? `<div class="post-body">${escapeHtml(post.body)}</div>` : ''}
      ${mediaHtml}
    </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
