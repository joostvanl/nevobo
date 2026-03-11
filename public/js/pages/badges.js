import { api, state, showBadgeUnlock } from '../app.js';

export async function render(container) {
  container.innerHTML = '<div class="spinner"></div>';

  const user = state.user;
  if (!user) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><p>Log in om je badges te zien.</p></div>`;
    return;
  }

  try {
    const data = await api('/api/gamification/my');
    renderBadgesPage(container, data);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

function renderBadgesPage(container, data) {
  const { xp, level, currentLevel, nextLevel, allLevels, badges, goals } = data;
  const earnedCount = badges.filter(b => b.earned_at).length;

  const xpProgress = nextLevel && currentLevel
    ? Math.min(100, Math.round(((xp - currentLevel.xp_required) / (nextLevel.xp_required - currentLevel.xp_required)) * 100))
    : 100;

  container.innerHTML = `
    <div class="page-hero">
      <div class="container">
        <h1>🏆 Badges & Doelen</h1>
        <p>${earnedCount} van ${badges.length} badges verdiend</p>
      </div>
    </div>
    <div class="container">

      <!-- XP / Level block -->
      <div class="xp-bar-wrap mb-4">
        <div class="xp-bar-header">
          <span class="xp-level-label">Level ${level} — ${currentLevel?.label || ''}</span>
          <span class="text-muted" style="font-size:0.85rem">${xp} XP</span>
        </div>
        <div class="xp-bar-track">
          <div class="xp-bar-fill" id="xp-fill" style="width:0%"></div>
        </div>
        ${nextLevel ? `<p class="text-muted mt-2" style="font-size:0.8rem">Nog ${nextLevel.xp_required - xp} XP voor Level ${nextLevel.level}: ${nextLevel.label}</p>` : '<p class="text-muted mt-2" style="font-size:0.8rem">Je hebt het hoogste niveau bereikt! 🔥</p>'}
      </div>

      <!-- Level map -->
      <div class="section">
        <div class="section-header"><span class="section-title">Niveaus</span></div>
        <div class="scroll-x">
          ${allLevels.map(l => `
            <div style="display:flex;flex-direction:column;align-items:center;gap:0.35rem;min-width:72px">
              <div style="
                width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;
                font-weight:900;font-size:0.9rem;
                background:${l.level <= level ? 'var(--primary)' : 'var(--border)'};
                color:${l.level <= level ? '#fff' : 'var(--text-muted)'};
                border:${l.level === level ? '3px solid var(--primary-dark)' : 'none'};
              ">${l.level}</div>
              <span style="font-size:0.65rem;font-weight:700;text-align:center;color:${l.level <= level ? 'var(--text)' : 'var(--text-muted)'}">${l.label}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Badges -->
      <div class="section">
        <div class="section-header"><span class="section-title">Badges</span></div>
        <div class="badge-grid">
          ${badges.map(b => `
            <div class="badge-item ${b.earned_at ? 'earned' : ''}" ${b.earned_at ? `onclick="showBadgeDetail('${b.slug}')"` : ''} data-badge="${b.slug}">
              <div class="badge-icon">${b.icon_emoji}</div>
              <div class="badge-label">${b.label}</div>
              ${b.earned_at ? `<span class="chip chip-warning" style="font-size:0.65rem;padding:0.15rem 0.4rem">+${b.xp_reward} XP</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Goals -->
      <div class="section">
        <div class="section-header"><span class="section-title">🎯 Doelen</span></div>
        ${goals.map(g => {
          const pct = Math.min(100, Math.round((g.progress / g.target_value) * 100));
          const done = g.completed_at !== null;
          return `
            <div class="goal-item ${done ? 'completed' : ''}">
              <div class="goal-icon">${g.icon_emoji}</div>
              <div class="goal-info">
                <div class="goal-title">${g.label}</div>
                <div class="goal-desc">${g.description}</div>
                <div class="goal-progress-bar">
                  <div class="goal-progress-fill" style="width:${pct}%" data-pct="${pct}"></div>
                </div>
                <div class="text-small text-muted mt-1">${g.progress} / ${g.target_value} ${done ? '✅' : ''}</div>
              </div>
              <span class="chip chip-accent">+${g.xp_reward} XP</span>
            </div>`;
        }).join('')}
      </div>

    </div>
  `;

  // Animate XP bar
  setTimeout(() => {
    const fill = document.getElementById('xp-fill');
    if (fill) fill.style.width = xpProgress + '%';
    // Animate goal bars
    container.querySelectorAll('.goal-progress-fill').forEach(el => {
      const pct = el.dataset.pct;
      el.style.width = '0%';
      setTimeout(() => { el.style.width = pct + '%'; }, 200);
    });
  }, 100);

  // Badge detail click
  window.showBadgeDetail = (slug) => {
    const badge = badges.find(b => b.slug === slug);
    if (badge?.earned_at) showBadgeUnlock(badge);
  };
}
