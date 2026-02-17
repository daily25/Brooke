import { api, avatarMarkup, connectStateStream, escapeHtml, formatDelta, initThemeToggle } from './shared.js';

const dom = {};
const DISPLAY_VIEW_DEFAULTS = {
  showHeader: true,
  showConnectionStatus: true,
  showThemeToggle: true,
  showLeaderboardTopPoints: true,
  showLeaderboardMovement: true,
  showLeaderboardStreak: true,
  showLeaderboardLevel: true,
  showFooterNav: true
};
let classroom = null;
let disconnectStream = null;

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  initThemeToggle(dom.themeToggleBtn);
  initialize().catch((error) => {
    dom.displayConnection.textContent = 'Offline';
    dom.displayConnection.classList.remove('online');
    dom.displayConnection.classList.add('offline');
    renderEmpty(error.message || 'Failed to load leaderboards.');
  });
});

function cacheDom() {
  dom.displayHeader = document.querySelector('#displayHeader');
  dom.displayClassName = document.querySelector('#displayClassName');
  dom.displayLeaderboardLine = document.querySelector('#displayLeaderboardLine');
  dom.displayConnection = document.querySelector('#displayConnection');
  dom.themeToggleBtn = document.querySelector('#themeToggleBtn');
  dom.boardTopPointsPanel = document.querySelector('#boardTopPointsPanel');
  dom.boardMovementPanel = document.querySelector('#boardMovementPanel');
  dom.boardStreakPanel = document.querySelector('#boardStreakPanel');
  dom.boardLevelPanel = document.querySelector('#boardLevelPanel');
  dom.displayFooter = document.querySelector('#displayFooter');
  dom.boardTopPoints = document.querySelector('#boardTopPoints');
  dom.boardMovement = document.querySelector('#boardMovement');
  dom.boardStreak = document.querySelector('#boardStreak');
  dom.boardLevel = document.querySelector('#boardLevel');
}

function displayViewSetting(key) {
  const configured = classroom?.viewSettings?.display?.[key];
  if (typeof configured === 'boolean') {
    return configured;
  }
  return DISPLAY_VIEW_DEFAULTS[key] ?? true;
}

function applyVisibility() {
  const showHeader = displayViewSetting('showHeader');
  dom.displayHeader.classList.toggle('hidden', !showHeader);
  dom.displayConnection.classList.toggle('hidden', !showHeader || !displayViewSetting('showConnectionStatus'));
  dom.themeToggleBtn.classList.toggle('hidden', !showHeader || !displayViewSetting('showThemeToggle'));
  dom.boardTopPointsPanel.classList.toggle('hidden', !displayViewSetting('showLeaderboardTopPoints'));
  dom.boardMovementPanel.classList.toggle('hidden', !displayViewSetting('showLeaderboardMovement'));
  dom.boardStreakPanel.classList.toggle('hidden', !displayViewSetting('showLeaderboardStreak'));
  dom.boardLevelPanel.classList.toggle('hidden', !displayViewSetting('showLeaderboardLevel'));
  dom.displayFooter.classList.toggle('hidden', !displayViewSetting('showFooterNav'));
}

async function initialize() {
  const payload = await api('/api/state');
  classroom = payload.state;
  renderAll();

  disconnectStream = connectStateStream({
    onState: (payload) => {
      classroom = payload.state;
      renderAll();
    },
    onOpen: () => setConnectionOnline(true),
    onError: () => setConnectionOnline(false)
  });
}

function setConnectionOnline(isOnline) {
  dom.displayConnection.textContent = isOnline ? 'Live Sync' : 'Reconnecting';
  dom.displayConnection.classList.toggle('online', isOnline);
  dom.displayConnection.classList.toggle('offline', !isOnline);
}

function renderAll() {
  if (!classroom) {
    return;
  }
  dom.displayClassName.textContent = classroom.className || "Brooke's Classroom";
  dom.displayLeaderboardLine.textContent = 'Leaderboard view';
  applyVisibility();

  const students = classroom.students ?? [];
  renderLeaderboard(
    dom.boardTopPoints,
    [...students].sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name)).slice(0, 10),
    (student) => `${student.points} pts`
  );
  renderLeaderboard(
    dom.boardMovement,
    [...students].sort((a, b) => ((b.weeklyDelta || 0) - (a.weeklyDelta || 0)) || (b.points - a.points) || a.name.localeCompare(b.name)).slice(0, 10),
    (student) => `${formatDelta(student.weeklyDelta || 0)} this week`
  );
  renderLeaderboard(
    dom.boardStreak,
    [...students].sort((a, b) => ((b.streakCurrent || 0) - (a.streakCurrent || 0)) || (b.streakBest || 0) - (a.streakBest || 0) || a.name.localeCompare(b.name)).slice(0, 10),
    (student) => `${student.streakCurrent || 0} day streak`
  );
  renderLeaderboard(
    dom.boardLevel,
    [...students].sort((a, b) => ((b.level || 1) - (a.level || 1)) || ((b.xpTotal || 0) - (a.xpTotal || 0)) || a.name.localeCompare(b.name)).slice(0, 10),
    (student) => `L${student.level || 1} | ${student.xpTotal || 0} XP`
  );
}

function renderLeaderboard(container, rows, detailText) {
  if (!rows.length) {
    container.innerHTML = '<p class="mini-empty">No students yet.</p>';
    return;
  }
  container.innerHTML = rows
    .map((student, index) => {
      return `
        <div class="leaderboard-mini-row">
          <div class="leaderboard-mini-main">
            <span class="leader-rank-chip">#${index + 1}</span>
            ${avatarMarkup(student, 'medium')}
            <div>
              <p class="event-text">${escapeHtml(student.name)}</p>
              <p class="event-time">${escapeHtml(detailText(student))}</p>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderEmpty(message) {
  const safe = `<p class="mini-empty">${escapeHtml(message)}</p>`;
  dom.boardTopPoints.innerHTML = safe;
  dom.boardMovement.innerHTML = safe;
  dom.boardStreak.innerHTML = safe;
  dom.boardLevel.innerHTML = safe;
}

window.addEventListener('beforeunload', () => {
  if (disconnectStream) {
    disconnectStream();
  }
});
