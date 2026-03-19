import { escHtml } from './escape-html.js';

/**
 * @param {(d: string) => string} formatDate
 * @param {(t: string) => string} formatTime
 */
export function renderCompactMatch(m, isResult, myTeamName, nevoboCode, formatDate, formatTime, scheduleIdx = null) {
  const nameLower = myTeamName.toLowerCase();
  const homeIsMe = (m.home_team || '').toLowerCase().includes(nameLower);

  let resultClass = '';
  if (isResult && m.score_home !== null) {
    const myScore  = homeIsMe ? m.score_home : m.score_away;
    const oppScore = homeIsMe ? m.score_away : m.score_home;
    resultClass = myScore > oppScore ? 'win' : myScore < oppScore ? 'loss' : 'draw';
  }

  const score = isResult && m.score !== null
    ? `<span class="compact-score ${resultClass}">${m.score_home}–${m.score_away}</span>`
    : `<span class="compact-score tbd">vs</span>`;

  const matchId = encodeURIComponent(m.match_id || m.link?.replace(/.*\//, '') || m.title?.slice(0, 40) || 'onbekend');

  const meetupPlaceholder = (!isResult && scheduleIdx !== null)
    ? `<div class="compact-meetup" data-schedule-idx="${scheduleIdx}" style="display:none"></div>`
    : '';

  const ht = escHtml(m.home_team || '—');
  const at = escHtml(m.away_team || '—');
  const vn = m.venue_name ? escHtml(m.venue_name) : '';

  return `
    <div class="compact-match-row clickable-row" data-match-id="${matchId}"
         data-team-name="${escHtml(myTeamName)}" data-nevobo-code="${escHtml(nevoboCode)}">
      <div class="compact-teams">
        <span class="compact-team ${homeIsMe ? 'me' : ''}">${ht}</span>
        ${score}
        <span class="compact-team away ${!homeIsMe ? 'me' : ''}">${at}</span>
      </div>
      <div class="compact-meta">
        ${m.datetime ? `<span>📅 ${formatDate(m.datetime)}</span>` : ''}
        ${m.datetime ? `<span>🕐 ${formatTime(m.datetime)}</span>` : ''}
        ${vn ? `<span>📍 ${vn}</span>` : ''}
      </div>
      ${meetupPlaceholder}
    </div>`;
}
