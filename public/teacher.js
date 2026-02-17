import {
  api,
  avatarMarkup,
  connectStateStream,
  escapeHtml,
  formatDelta,
  initThemeToggle,
  relativeTime,
  toDataUrl
} from './shared.js';

const VIEW_SETTING_OPTIONS = {
  display: [
    { key: 'showHeader', label: 'Header Area', detail: 'Display title and subtitle' },
    { key: 'showConnectionStatus', label: 'Live Sync Pill', detail: 'Connection status indicator' },
    { key: 'showThemeToggle', label: 'Theme Button', detail: 'Light or dark mode toggle' },
    { key: 'showSoundToggle', label: 'Sound Button', detail: 'Sound control on display home' },
    { key: 'showClassPoints', label: 'Class Points', detail: 'Home student points grid' },
    { key: 'showRecentActivity', label: 'Recent Activity', detail: 'Home activity feed panel' },
    { key: 'showStoreItems', label: 'Store Items', detail: 'Store page item list' },
    { key: 'showLeaderboardTopPoints', label: 'Leaderboard Top Points', detail: 'Leaderboards: top points panel' },
    { key: 'showLeaderboardMovement', label: 'Leaderboard Movement', detail: 'Leaderboards: weekly movement panel' },
    { key: 'showLeaderboardStreak', label: 'Leaderboard Streak', detail: 'Leaderboards: streak panel' },
    { key: 'showLeaderboardLevel', label: 'Leaderboard Level + XP', detail: 'Leaderboards: level and XP panel' },
    { key: 'showFooterNav', label: 'Footer Navigation', detail: 'Bottom navigation tabs' },
    { key: 'showEventOverlay', label: 'Celebration Overlay', detail: 'Large point or shoutout animation' }
  ],
  student: [
    { key: 'showHeader', label: 'Header Area', detail: 'Student title and subtitle' },
    { key: 'showConnectionStatus', label: 'Live Sync Pill', detail: 'Student connection status' },
    { key: 'showAvatarPanel', label: 'Avatar Panel', detail: '3D model and avatar card' },
    { key: 'showModelControls', label: '3D Controls', detail: 'Spin and animation controls' },
    { key: 'showStats', label: 'Stats Panel', detail: 'Level, XP, streak freeze, and rank stats' },
    { key: 'showSkillTotals', label: 'Skill Totals', detail: 'Skill totals summary panel' },
    { key: 'showBadgesAndStreak', label: 'Badges And Streak', detail: 'Badge strip and streak summary' },
    { key: 'showShoutoutClassmate', label: 'Shoutout A Classmate', detail: 'Student shoutout form and queue' },
    { key: 'showRecentActivity', label: 'Recent Activity', detail: 'Student event feed panel' },
    { key: 'showFooterNav', label: 'Footer Navigation', detail: 'Bottom navigation tabs' }
  ]
};

const dom = {};
let classroom = null;
let selectedStudentId = null;
let activeSheetTab = 'positive';
let shoutoutFilter = 'pending';
let activeTeacherTab = 'home';
let disconnectStream = null;
let noticeTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  initThemeToggle(dom.themeToggleBtn);
  bindEvents();
  initialize().catch((error) => {
    showNotice(error.message || 'Failed to load classroom.', true);
  });
});

function cacheDom() {
  dom.classroomTitle = document.querySelector('#classroomTitle');
  dom.connectionState = document.querySelector('#connectionState');
  dom.themeToggleBtn = document.querySelector('#themeToggleBtn');

  dom.classForm = document.querySelector('#classForm');
  dom.classNameInput = document.querySelector('#classNameInput');

  dom.metricSeasonCountdown = document.querySelector('#metricSeasonCountdown');
  dom.metricSeasonProgress = document.querySelector('#metricSeasonProgress');
  dom.metricSeasonStatus = document.querySelector('#metricSeasonStatus');
  dom.metricSeasonRange = document.querySelector('#metricSeasonRange');
  dom.metricStreakHealth = document.querySelector('#metricStreakHealth');
  dom.metricTopStreak = document.querySelector('#metricTopStreak');
  dom.metricMovement = document.querySelector('#metricMovement');
  dom.metricMovementSub = document.querySelector('#metricMovementSub');

  dom.seasonStartForm = document.querySelector('#seasonStartForm');
  dom.seasonNameInput = document.querySelector('#seasonNameInput');
  dom.seasonLengthInput = document.querySelector('#seasonLengthInput');
  dom.closeSeasonBtn = document.querySelector('#closeSeasonBtn');
  dom.closeDayBtn = document.querySelector('#closeDayBtn');
  dom.leaderboardModeInput = document.querySelector('#leaderboardModeInput');
  dom.leaderboardFocusInput = document.querySelector('#leaderboardFocusInput');
  dom.saveLeaderboardModeBtn = document.querySelector('#saveLeaderboardModeBtn');

  dom.studentForm = document.querySelector('#studentForm');
  dom.studentNameInput = document.querySelector('#studentNameInput');
  dom.studentPhotoInput = document.querySelector('#studentPhotoInput');

  dom.studentsGrid = document.querySelector('#studentsGrid');
  dom.studentsEmpty = document.querySelector('#studentsEmpty');
  dom.studentCount = document.querySelector('#studentCount');
  dom.accessCodesList = document.querySelector('#accessCodesList');
  dom.shoutoutCount = document.querySelector('#shoutoutCount');
  dom.shoutoutFilterInput = document.querySelector('#shoutoutFilterInput');
  dom.shoutoutQueue = document.querySelector('#shoutoutQueue');

  dom.skillForm = document.querySelector('#skillForm');
  dom.skillTypeInput = document.querySelector('#skillTypeInput');
  dom.skillLabelInput = document.querySelector('#skillLabelInput');
  dom.skillPointsInput = document.querySelector('#skillPointsInput');
  dom.skillIconInput = document.querySelector('#skillIconInput');
  dom.positiveSkillList = document.querySelector('#positiveSkillList');
  dom.negativeSkillList = document.querySelector('#negativeSkillList');

  dom.storeForm = document.querySelector('#storeForm');
  dom.storeNameInput = document.querySelector('#storeNameInput');
  dom.storeCostInput = document.querySelector('#storeCostInput');
  dom.storeStockInput = document.querySelector('#storeStockInput');
  dom.storeTypeInput = document.querySelector('#storeTypeInput');
  dom.storeFreezeAmountInput = document.querySelector('#storeFreezeAmountInput');
  dom.storeList = document.querySelector('#storeList');
  dom.displayVisibilityList = document.querySelector('#displayVisibilityList');
  dom.studentVisibilityList = document.querySelector('#studentVisibilityList');

  dom.panelBackdrop = document.querySelector('#studentPanelBackdrop');
  dom.studentPanel = document.querySelector('#studentPanel');
  dom.closeSheetBtn = document.querySelector('#closeSheetBtn');
  dom.sheetStudentAvatar = document.querySelector('#sheetStudentAvatar');
  dom.sheetStudentPhotoPicker = document.querySelector('#sheetStudentPhotoPicker');
  dom.sheetStudentName = document.querySelector('#sheetStudentName');
  dom.sheetStudentPoints = document.querySelector('#sheetStudentPoints');
  dom.removeStudentBtn = document.querySelector('#removeStudentBtn');
  dom.sheetTabs = [...document.querySelectorAll('#sheetTabs .tab-button')];

  dom.sheetBehaviorSection = document.querySelector('#sheetBehaviorSection');
  dom.sheetSeasonSection = document.querySelector('#sheetSeasonSection');
  dom.sheetStoreSection = document.querySelector('#sheetStoreSection');
  dom.sheetHistorySection = document.querySelector('#sheetHistorySection');

  dom.sheetSkillButtons = document.querySelector('#sheetSkillButtons');
  dom.quickAdjustRow = document.querySelector('#quickAdjustRow');
  dom.sheetStoreList = document.querySelector('#sheetStoreList');
  dom.sheetHistory = document.querySelector('#sheetHistory');

  dom.quickSkillForm = document.querySelector('#quickSkillForm');
  dom.quickSkillLabelInput = document.querySelector('#quickSkillLabelInput');
  dom.quickSkillPointsInput = document.querySelector('#quickSkillPointsInput');
  dom.quickSkillIconInput = document.querySelector('#quickSkillIconInput');

  dom.seasonProgressFill = document.querySelector('#seasonProgressFill');
  dom.seasonProgressText = document.querySelector('#seasonProgressText');
  dom.sheetStudentStreak = document.querySelector('#sheetStudentStreak');
  dom.streakCheckinBtn = document.querySelector('#streakCheckinBtn');
  dom.useFreezeBtn = document.querySelector('#useFreezeBtn');
  dom.sheetRewardTrack = document.querySelector('#sheetRewardTrack');

  dom.teacherMessage = document.querySelector('#teacherMessage');
  dom.teacherSections = [...document.querySelectorAll('.teacher-view-section')];
  dom.teacherTabButtons = [...document.querySelectorAll('[data-teacher-tab-btn]')];
}

function bindEvents() {
  dom.classForm.addEventListener('submit', handleClassNameSubmit);
  dom.seasonStartForm.addEventListener('submit', handleSeasonStart);
  dom.closeSeasonBtn.addEventListener('click', handleSeasonClose);
  dom.closeDayBtn.addEventListener('click', handleDayClose);
  dom.saveLeaderboardModeBtn.addEventListener('click', handleLeaderboardModeSave);

  dom.studentForm.addEventListener('submit', handleAddStudent);
  dom.studentsGrid.addEventListener('click', handleStudentCardClick);
  dom.accessCodesList.addEventListener('click', handleAccessCodeActions);
  dom.shoutoutQueue.addEventListener('click', handleShoutoutActions);
  dom.shoutoutFilterInput.addEventListener('change', () => {
    shoutoutFilter = dom.shoutoutFilterInput.value;
    renderShoutoutQueue();
  });

  dom.skillForm.addEventListener('submit', handleSkillCreate);
  dom.positiveSkillList.addEventListener('click', handleSkillDeleteClick);
  dom.negativeSkillList.addEventListener('click', handleSkillDeleteClick);

  dom.storeForm.addEventListener('submit', handleStoreCreate);
  dom.storeList.addEventListener('click', handleStoreDeleteClick);
  dom.displayVisibilityList.addEventListener('click', handleVisibilityToggle);
  dom.studentVisibilityList.addEventListener('click', handleVisibilityToggle);

  dom.closeSheetBtn.addEventListener('click', closeStudentSheet);
  dom.panelBackdrop.addEventListener('click', closeStudentSheet);
  dom.sheetTabs.forEach((button) => {
    button.addEventListener('click', () => {
      activeSheetTab = button.dataset.tab;
      renderStudentSheet();
    });
  });

  dom.sheetSkillButtons.addEventListener('click', handleSkillAwardClick);
  dom.quickAdjustRow.addEventListener('click', handleQuickAdjustClick);
  dom.sheetStoreList.addEventListener('click', handleRedeemClick);
  dom.quickSkillForm.addEventListener('submit', handleQuickSkillCreate);
  dom.removeStudentBtn.addEventListener('click', handleStudentRemove);
  dom.useFreezeBtn.addEventListener('click', handleUseFreeze);
  dom.streakCheckinBtn.addEventListener('click', handleStreakCheckin);
  dom.sheetStudentAvatar.addEventListener('click', handleSheetAvatarClick);
  dom.sheetStudentAvatar.addEventListener('keydown', handleSheetAvatarKeydown);
  dom.sheetStudentPhotoPicker.addEventListener('change', handleSheetAvatarPhotoPick);

  dom.storeTypeInput.addEventListener('change', () => {
    const isFreeze = dom.storeTypeInput.value === 'streak_freeze';
    dom.storeFreezeAmountInput.disabled = !isFreeze;
  });
  dom.storeFreezeAmountInput.disabled = dom.storeTypeInput.value !== 'streak_freeze';

  dom.teacherTabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setTeacherTab(button.dataset.teacherTabBtn || 'home');
    });
  });
}

async function initialize() {
  const payload = await api('/api/state');
  classroom = payload.state;
  renderAll();

  disconnectStream = connectStateStream({
    onState: (payload) => {
      classroom = payload.state;
      if (selectedStudentId && !getStudent(selectedStudentId)) {
        closeStudentSheet();
      }
      renderAll();
    },
    onOpen: () => setConnectionOnline(true),
    onError: () => setConnectionOnline(false)
  });
}

function setConnectionOnline(isOnline) {
  dom.connectionState.textContent = isOnline ? 'Live Sync' : 'Reconnecting';
  dom.connectionState.classList.toggle('online', isOnline);
  dom.connectionState.classList.toggle('offline', !isOnline);
}

function showNotice(message, isError = false) {
  dom.teacherMessage.textContent = message;
  dom.teacherMessage.classList.toggle('error', isError);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    dom.teacherMessage.textContent = '';
    dom.teacherMessage.classList.remove('error');
  }, 3200);
}

function haptic(ms = 18) {
  if (navigator.vibrate) {
    navigator.vibrate(ms);
  }
}

function parseDay(dayKey) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  return date;
}

function dateRangeLabel(start, end) {
  const startDate = parseDay(start);
  const endDate = parseDay(end);
  if (!startDate || !endDate) {
    return '-';
  }
  return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
}

function seasonProgress() {
  const season = classroom?.gamification?.season;
  if (!season) {
    return { pct: 0, daysLeft: 0, status: 'Inactive', range: '-', label: '0% complete' };
  }
  const start = parseDay(season.startDate);
  const end = parseDay(season.endDate);
  const today = parseDay(new Date().toISOString().slice(0, 10));
  if (!start || !end || !today) {
    return { pct: 0, daysLeft: 0, status: season.isActive ? 'Active' : 'Closed', range: '-', label: '0% complete' };
  }
  const total = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const elapsed = Math.max(0, Math.min(total, Math.round((today - start) / 86400000) + 1));
  const pct = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  const daysLeft = Math.max(0, Math.round((end - today) / 86400000));
  return {
    pct,
    daysLeft,
    status: season.isActive ? 'Active' : 'Closed',
    range: dateRangeLabel(season.startDate, season.endDate),
    label: `${pct}% complete`
  };
}

function getStudent(studentId) {
  return classroom?.students?.find((student) => student.id === studentId) ?? null;
}

function sortedStudentsByPoints() {
  return [...(classroom?.students ?? [])].sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    return a.name.localeCompare(b.name);
  });
}

function renderAll() {
  if (!classroom) {
    return;
  }
  dom.classroomTitle.textContent = classroom.className || "Brooke's Classroom";
  dom.classNameInput.value = classroom.className || '';

  renderMetrics();
  renderLeaderboardModeControls();
  renderStudents();
  renderAccessCodes();
  renderShoutoutQueue();
  renderSkillLibrary();
  renderStoreLibrary();
  renderViewSettings();
  renderStudentSheet();
  setTeacherTab(activeTeacherTab);
}

function setTeacherTab(nextTab) {
  const tab = ['home', 'store', 'settings'].includes(nextTab) ? nextTab : 'home';
  activeTeacherTab = tab;
  dom.teacherSections.forEach((section) => {
    const shouldHide = section.dataset.teacherTab !== tab;
    section.hidden = shouldHide;
    section.classList.toggle('hidden', shouldHide);
  });
  dom.teacherTabButtons.forEach((button) => {
    const isActive = button.dataset.teacherTabBtn === tab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  if (tab !== 'home' && selectedStudentId) {
    closeStudentSheet();
  }
}
function renderMetrics() {
  const students = classroom.students ?? [];
  const seasonInfo = seasonProgress();
  dom.metricSeasonCountdown.textContent = `${seasonInfo.daysLeft} days left`;
  dom.metricSeasonProgress.textContent = seasonInfo.label;
  dom.metricSeasonStatus.textContent = seasonInfo.status;
  dom.metricSeasonRange.textContent = seasonInfo.range;

  const streaks = students.map((student) => student.streakCurrent || 0);
  const averageStreak = streaks.length > 0 ? (streaks.reduce((sum, value) => sum + value, 0) / streaks.length).toFixed(1) : '0.0';
  dom.metricStreakHealth.textContent = `${averageStreak} avg`;

  const topStreakStudent = [...students].sort((a, b) => (b.streakCurrent || 0) - (a.streakCurrent || 0))[0];
  dom.metricTopStreak.textContent = topStreakStudent
    ? `${topStreakStudent.name} (${topStreakStudent.streakCurrent} days)`
    : 'Top streak -';

  const mover = [...students].sort((a, b) => (b.weeklyDelta || 0) - (a.weeklyDelta || 0))[0];
  if (mover && (mover.weeklyDelta || 0) !== 0) {
    dom.metricMovement.textContent = `${mover.name} ${formatDelta(mover.weeklyDelta)}`;
    dom.metricMovementSub.textContent = 'Best weekly movement';
  } else {
    dom.metricMovement.textContent = 'No movement yet';
    dom.metricMovementSub.textContent = 'Award points to start';
  }
}

function renderLeaderboardModeControls() {
  const board = classroom.gamification?.leaderboard;
  dom.leaderboardModeInput.value = board?.currentMode || 'top';

  const options = sortedStudentsByPoints();
  if (options.length === 0) {
    dom.leaderboardFocusInput.innerHTML = '<option value="">No students yet</option>';
    dom.leaderboardFocusInput.disabled = true;
    return;
  }

  dom.leaderboardFocusInput.disabled = false;
  const focusId = board?.focusStudentId || options[0].id;
  dom.leaderboardFocusInput.innerHTML = options
    .map((student) => `<option value="${student.id}">${escapeHtml(student.name)}</option>`)
    .join('');
  dom.leaderboardFocusInput.value = options.some((student) => student.id === focusId) ? focusId : options[0].id;
}

function renderStudents() {
  const students = sortedStudentsByPoints();
  dom.studentCount.textContent = `${students.length} student${students.length === 1 ? '' : 's'}`;
  dom.studentsEmpty.hidden = students.length > 0;

  dom.studentsGrid.innerHTML = students
    .map((student) => {
      const isActive = student.id === selectedStudentId;
      const pointsClass = student.points >= 0 ? 'points-positive' : 'points-negative';
      return `
        <button type="button" class="student-card ${isActive ? 'selected' : ''}" data-student-id="${student.id}">
          ${avatarMarkup(student, 'medium')}
          <span class="student-name">${escapeHtml(student.name)}</span>
          <span class="student-points ${pointsClass}">${student.points} pts</span>
        </button>
      `;
    })
    .join('');
}

function studentProfileUrlForCode(code) {
  return `${window.location.origin}/student?code=${encodeURIComponent(code)}`;
}

function renderAccessCodes() {
  const students = sortedStudentsByPoints();
  if (students.length === 0) {
    dom.accessCodesList.innerHTML = '<p class="mini-empty">No students yet.</p>';
    return;
  }
  dom.accessCodesList.innerHTML = students
    .map((student) => {
      const code = String(student.accessCode || '').toUpperCase();
      return `
        <div class="history-row access-code-row">
          <div>
            <p class="history-reason">${escapeHtml(student.name)}</p>
            <p class="history-time">Code ${escapeHtml(code)} | /student?code=${escapeHtml(code)}</p>
          </div>
          <div class="access-code-actions">
            <button type="button" class="secondary-button" data-copy-student-code="${escapeHtml(code)}">Copy Code</button>
            <button type="button" class="secondary-button" data-copy-student-link="${escapeHtml(code)}">Copy Link</button>
            <button type="button" class="ghost-button" data-reset-student-code="${student.id}">New Code</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderShoutoutQueue() {
  dom.shoutoutFilterInput.value = shoutoutFilter;
  const shoutouts = [...(classroom.shoutouts ?? [])];
  const pendingCount = shoutouts.filter((entry) => entry.status === 'pending').length;
  dom.shoutoutCount.textContent = `${pendingCount} pending`;

  const filtered = shoutoutFilter === 'all' ? shoutouts : shoutouts.filter((entry) => entry.status === shoutoutFilter);
  if (filtered.length === 0) {
    dom.shoutoutQueue.innerHTML = '<p class="mini-empty">No shoutouts in this view.</p>';
    return;
  }

  const nameById = new Map((classroom.students ?? []).map((student) => [student.id, student.name]));
  dom.shoutoutQueue.innerHTML = filtered
    .map((entry) => {
      const fromName = nameById.get(entry.fromStudentId) || 'Unknown';
      const toName = nameById.get(entry.toStudentId) || 'Unknown';
      const status = entry.status || 'pending';
      return `
        <div class="history-row shoutout-row">
          <div>
            <p class="history-reason">${escapeHtml(fromName)} -> ${escapeHtml(toName)}</p>
            <p class="history-time">${escapeHtml(entry.message)}</p>
            <p class="history-time">${escapeHtml(relativeTime(entry.createdAt))} | ${escapeHtml(status)}</p>
          </div>
          <div class="access-code-actions">
            <span class="status-pill ${status}">${escapeHtml(status)}</span>
            ${status === 'approved' ? '' : `<button type="button" class="secondary-button" data-shoutout-action="approve" data-shoutout-id="${entry.id}">Approve</button>`}
            ${status === 'archived' ? '' : `<button type="button" class="secondary-button" data-shoutout-action="archive" data-shoutout-id="${entry.id}">Archive</button>`}
            <button type="button" class="ghost-button danger" data-shoutout-action="delete" data-shoutout-id="${entry.id}">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderSkillLibrary() {
  const positiveSkills = classroom.skills?.positive ?? [];
  const negativeSkills = classroom.skills?.negative ?? [];
  dom.positiveSkillList.innerHTML = renderSkillTokens(positiveSkills, 'positive');
  dom.negativeSkillList.innerHTML = renderSkillTokens(negativeSkills, 'negative');
}

function renderSkillTokens(skills, type) {
  if (skills.length === 0) {
    return '<p class="mini-empty">No skills yet.</p>';
  }
  return skills
    .map(
      (skill) => `
      <div class="token">
        <span class="token-icon">${escapeHtml(skill.icon || '--')}</span>
        <span class="token-label">${escapeHtml(skill.label)}</span>
        <span class="token-points">${formatDelta(skill.points)}</span>
        <button
          type="button"
          class="icon-delete"
          data-delete-skill-id="${skill.id}"
          data-delete-skill-type="${type}"
          aria-label="Delete ${escapeHtml(skill.label)}"
        >
          x
        </button>
      </div>
    `
    )
    .join('');
}

function renderStoreLibrary() {
  const items = [...(classroom.storeItems ?? [])].sort((a, b) => a.cost - b.cost);
  if (items.length === 0) {
    dom.storeList.innerHTML = '<p class="mini-empty">No store items yet.</p>';
    return;
  }
  dom.storeList.innerHTML = items
    .map(
      (item) => `
      <div class="store-item-row">
        <div>
          <p class="store-item-name">${escapeHtml(item.name)}</p>
          <p class="store-item-meta">${item.cost} pts | stock ${item.stock}${item.type === 'streak_freeze' ? ` | +${item.freezeAmount} freeze` : ''}</p>
        </div>
        <button type="button" class="icon-delete" data-delete-store-id="${item.id}" aria-label="Delete ${escapeHtml(item.name)}">x</button>
      </div>
    `
    )
    .join('');
}

function viewSettingEnabled(scope, key) {
  return classroom?.viewSettings?.[scope]?.[key] !== false;
}

function renderViewSettings() {
  renderVisibilityList('display', dom.displayVisibilityList);
  renderVisibilityList('student', dom.studentVisibilityList);
}

function renderVisibilityList(scope, container) {
  const options = VIEW_SETTING_OPTIONS[scope] || [];
  if (!container) {
    return;
  }
  container.innerHTML = options
    .map((option) => {
      const enabled = viewSettingEnabled(scope, option.key);
      return `
        <div class="view-toggle-row">
          <div class="view-toggle-copy">
            <p class="view-toggle-title">${escapeHtml(option.label)}</p>
            <p class="view-toggle-sub">${escapeHtml(option.detail)}</p>
          </div>
          <button
            type="button"
            class="secondary-button compact visibility-toggle-btn ${enabled ? 'is-on' : 'is-off'}"
            data-view-setting-scope="${scope}"
            data-view-setting-key="${option.key}"
            data-view-setting-label="${escapeHtml(option.label)}"
            aria-pressed="${enabled ? 'true' : 'false'}"
          >
            ${enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      `;
    })
    .join('');
}

function renderStudentSheet() {
  const student = selectedStudentId ? getStudent(selectedStudentId) : null;
  const isOpen = Boolean(student);
  dom.studentPanel.classList.toggle('open', isOpen);
  dom.panelBackdrop.classList.toggle('hidden', !isOpen);
  dom.studentPanel.setAttribute('aria-hidden', String(!isOpen));

  if (!student) {
    return;
  }

  dom.sheetStudentAvatar.innerHTML = avatarMarkup(student, 'large');
  dom.sheetStudentAvatar.setAttribute('aria-label', `Update ${student.name} photo`);
  dom.sheetStudentAvatar.setAttribute('title', `Update ${student.name} photo`);
  dom.sheetStudentName.textContent = student.name;
  dom.sheetStudentPoints.textContent = `${student.points} pts | Level ${student.level || 1} | Code ${student.accessCode || '-----'}`;

  dom.sheetTabs.forEach((button) => {
    const active = button.dataset.tab === activeSheetTab;
    button.classList.toggle('active', active);
  });

  dom.sheetBehaviorSection.classList.toggle('hidden', !(activeSheetTab === 'positive' || activeSheetTab === 'negative'));
  dom.sheetSeasonSection.classList.toggle('hidden', activeSheetTab !== 'season');
  dom.sheetStoreSection.classList.toggle('hidden', activeSheetTab !== 'store');
  dom.sheetHistorySection.classList.toggle('hidden', activeSheetTab !== 'history');

  if (activeSheetTab === 'positive' || activeSheetTab === 'negative') {
    renderBehaviorPane(student);
  }
  if (activeSheetTab === 'season') {
    renderSeasonPane(student);
  }
  if (activeSheetTab === 'store') {
    renderStorePane(student);
  }
  if (activeSheetTab === 'history') {
    renderHistoryPane(student);
  }
}

function renderBehaviorPane(student) {
  const skillList = classroom.skills?.[activeSheetTab] ?? [];
  if (skillList.length === 0) {
    dom.sheetSkillButtons.innerHTML = '<p class="mini-empty">Add a skill to get started.</p>';
    return;
  }
  dom.sheetSkillButtons.innerHTML = skillList
    .map(
      (skill) => `
        <button
          type="button"
          class="skill-action ${skill.points >= 0 ? 'positive' : 'negative'}"
          data-award-skill-id="${skill.id}"
          data-student-id="${student.id}"
        >
          <span class="skill-action-icon">${escapeHtml(skill.icon || '--')}</span>
          <span class="skill-action-label">${escapeHtml(skill.label)}</span>
          <span class="skill-action-points">${formatDelta(skill.points)}</span>
        </button>
      `
    )
    .join('');
}

function renderSeasonPane(student) {
  const rewards = classroom.gamification?.rewardsTrack ?? [];
  const maxTrack = rewards.length > 0 ? rewards[rewards.length - 1].xpRequired : 1;
  const pct = Math.max(0, Math.min(100, Math.round(((student.seasonXp || 0) / maxTrack) * 100)));
  dom.seasonProgressFill.style.width = `${pct}%`;
  dom.seasonProgressText.textContent = `${student.seasonXp || 0} season XP | ${pct}% of reward track`;
  dom.sheetStudentStreak.textContent = `Streak ${student.streakCurrent || 0} | Best ${student.streakBest || 0} | Freezes ${student.streakFreezes || 0}`;
  dom.useFreezeBtn.disabled = (student.streakFreezes || 0) < 1;

  if (rewards.length === 0) {
    dom.sheetRewardTrack.innerHTML = '<p class="mini-empty">No rewards configured.</p>';
    return;
  }

  dom.sheetRewardTrack.innerHTML = rewards
    .map((reward) => {
      const unlocked = (student.badges ?? []).includes(reward.badge);
      return `
        <div class="history-row ${unlocked ? 'reward-unlocked' : ''}">
          <div>
            <p class="history-reason">${escapeHtml(reward.title)}</p>
            <p class="history-time">Unlock at ${reward.xpRequired} XP</p>
          </div>
          <strong class="history-delta ${unlocked ? 'plus' : ''}">${unlocked ? 'UNLOCKED' : `${reward.xpRequired} XP`}</strong>
        </div>
      `;
    })
    .join('');
}

function renderStorePane(student) {
  const items = [...(classroom.storeItems ?? [])].sort((a, b) => a.cost - b.cost);
  if (items.length === 0) {
    dom.sheetStoreList.innerHTML = '<p class="mini-empty">Store is empty.</p>';
    return;
  }
  dom.sheetStoreList.innerHTML = items
    .map((item) => {
      const canRedeem = item.stock > 0 && student.points >= item.cost;
      return `
        <div class="store-item-row">
          <div>
            <p class="store-item-name">${escapeHtml(item.name)}</p>
            <p class="store-item-meta">${item.cost} pts | stock ${item.stock}${item.type === 'streak_freeze' ? ` | +${item.freezeAmount} freeze` : ''}</p>
          </div>
          <button type="button" class="secondary-button" data-redeem-item-id="${item.id}" ${canRedeem ? '' : 'disabled'}>Redeem</button>
        </div>
      `;
    })
    .join('');
}

function renderHistoryPane(student) {
  const studentHistory = (classroom.events ?? []).filter((event) => event.studentId === student.id).slice(0, 10);
  if (studentHistory.length === 0) {
    dom.sheetHistory.innerHTML = '<p class="mini-empty">No activity yet.</p>';
    return;
  }
  dom.sheetHistory.innerHTML = studentHistory
    .map((event) => {
      const deltaClass = event.delta >= 0 ? 'plus' : 'minus';
      return `
        <div class="history-row">
          <div>
            <p class="history-reason">${escapeHtml(event.reason)}</p>
            <p class="history-time">${escapeHtml(relativeTime(event.timestamp))} | ${escapeHtml(event.type || 'activity')}</p>
          </div>
          <strong class="history-delta ${deltaClass}">${formatDelta(event.delta || 0)}</strong>
        </div>
      `;
    })
    .join('');
}

function openStudentSheet(studentId) {
  selectedStudentId = studentId;
  activeSheetTab = 'positive';
  renderStudentSheet();
}

function closeStudentSheet() {
  selectedStudentId = null;
  renderStudentSheet();
}
async function handleClassNameSubmit(event) {
  event.preventDefault();
  const className = dom.classNameInput.value.trim();
  if (!className) {
    showNotice('Class name cannot be empty.', true);
    return;
  }
  try {
    await api('/api/class', { method: 'POST', body: { className } });
    showNotice('Class name saved.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleSeasonStart(event) {
  event.preventDefault();
  const name = dom.seasonNameInput.value.trim();
  const lengthDays = Number.parseInt(dom.seasonLengthInput.value, 10);
  try {
    await api('/api/season/start', {
      method: 'POST',
      body: { name, lengthDays }
    });
    showNotice('New season started.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleSeasonClose() {
  const confirmed = window.confirm('Close the current season now?');
  if (!confirmed) {
    return;
  }
  try {
    await api('/api/season/close', { method: 'POST', body: {} });
    showNotice('Season closed.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleDayClose() {
  try {
    const result = await api('/api/day/close', { method: 'POST', body: {} });
    showNotice(`Day closed. ${result.impacted.length} streak updates.`);
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleLeaderboardModeSave() {
  const mode = dom.leaderboardModeInput.value;
  const studentId = dom.leaderboardFocusInput.value;
  try {
    await api('/api/leaderboard/mode', {
      method: 'POST',
      body: {
        mode,
        studentId: mode === 'relative' ? studentId : ''
      }
    });
    showNotice('Display mode synced.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleAddStudent(event) {
  event.preventDefault();
  const name = dom.studentNameInput.value.trim();
  if (!name) {
    showNotice('Student name is required.', true);
    return;
  }
  try {
    const file = dom.studentPhotoInput.files?.[0];
    let photo = '';
    if (file) {
      photo = await toDataUrl(file);
      if (!photo) {
        throw new Error('Please upload a valid image file.');
      }
    }
    await api('/api/students', {
      method: 'POST',
      body: { name, photo }
    });
    dom.studentForm.reset();
    showNotice('Student added.');
  } catch (error) {
    showNotice(error.message || 'Unable to add student.', true);
  }
}

function handleStudentCardClick(event) {
  const button = event.target.closest('[data-student-id]');
  if (!button) {
    return;
  }
  openStudentSheet(button.dataset.studentId);
}

async function copyText(value, successMessage) {
  if (!value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    showNotice(successMessage);
  } catch {
    window.prompt('Copy this value', value);
  }
}

async function handleAccessCodeActions(event) {
  const copyCodeButton = event.target.closest('[data-copy-student-code]');
  if (copyCodeButton) {
    await copyText(copyCodeButton.dataset.copyStudentCode || '', 'Code copied.');
    return;
  }

  const copyLinkButton = event.target.closest('[data-copy-student-link]');
  if (copyLinkButton) {
    const code = copyLinkButton.dataset.copyStudentLink || '';
    await copyText(studentProfileUrlForCode(code), 'Profile link copied.');
    return;
  }

  const resetButton = event.target.closest('[data-reset-student-code]');
  if (!resetButton) {
    return;
  }
  const studentId = resetButton.dataset.resetStudentCode;
  if (!studentId) {
    return;
  }
  const confirmed = window.confirm('Generate a new access code for this student?');
  if (!confirmed) {
    return;
  }
  try {
    await api(`/api/students/${encodeURIComponent(studentId)}/access-code/reset`, {
      method: 'POST',
      body: {}
    });
    showNotice('New access code generated.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleShoutoutActions(event) {
  const button = event.target.closest('[data-shoutout-action]');
  if (!button) {
    return;
  }
  const shoutoutId = button.dataset.shoutoutId;
  const action = button.dataset.shoutoutAction;
  if (!shoutoutId || !action) {
    return;
  }
  try {
    if (action === 'delete') {
      await api(`/api/shoutouts/${encodeURIComponent(shoutoutId)}`, { method: 'DELETE' });
      showNotice('Shoutout deleted.');
      return;
    }
    await api(`/api/shoutouts/${encodeURIComponent(shoutoutId)}`, {
      method: 'PATCH',
      body: { action }
    });
    showNotice(action === 'approve' ? 'Shoutout approved.' : 'Shoutout archived.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleSkillCreate(event) {
  event.preventDefault();
  const type = dom.skillTypeInput.value;
  const label = dom.skillLabelInput.value.trim();
  const icon = dom.skillIconInput.value.trim();
  let points = Number.parseInt(dom.skillPointsInput.value, 10);

  if (!label) {
    showNotice('Skill name is required.', true);
    return;
  }
  if (!Number.isInteger(points) || points === 0) {
    showNotice('Skill points must be a non-zero number.', true);
    return;
  }
  if (type === 'positive' && points < 0) {
    points = Math.abs(points);
  }
  if (type === 'negative' && points > 0) {
    points = -Math.abs(points);
  }

  try {
    await api('/api/skills', {
      method: 'POST',
      body: { type, label, icon, points }
    });
    dom.skillForm.reset();
    dom.skillTypeInput.value = type;
    showNotice('Skill added.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleSkillDeleteClick(event) {
  const button = event.target.closest('[data-delete-skill-id]');
  if (!button) {
    return;
  }
  const skillId = button.dataset.deleteSkillId;
  const type = button.dataset.deleteSkillType;
  try {
    await api(`/api/skills/${encodeURIComponent(skillId)}?type=${encodeURIComponent(type)}`, {
      method: 'DELETE'
    });
    showNotice('Skill removed.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleStoreCreate(event) {
  event.preventDefault();
  const name = dom.storeNameInput.value.trim();
  const cost = Number.parseInt(dom.storeCostInput.value, 10);
  const stock = Number.parseInt(dom.storeStockInput.value, 10);
  const type = dom.storeTypeInput.value;
  const freezeAmount = Number.parseInt(dom.storeFreezeAmountInput.value, 10);

  if (!name) {
    showNotice('Store item name is required.', true);
    return;
  }
  if (!Number.isInteger(cost) || cost < 1) {
    showNotice('Cost must be 1 point or more.', true);
    return;
  }
  if (!Number.isInteger(stock) || stock < 1) {
    showNotice('Stock must be at least 1.', true);
    return;
  }

  try {
    await api('/api/store', {
      method: 'POST',
      body: {
        name,
        cost,
        stock,
        type,
        freezeAmount: Number.isInteger(freezeAmount) ? freezeAmount : 1
      }
    });
    dom.storeForm.reset();
    dom.storeTypeInput.value = 'standard';
    dom.storeFreezeAmountInput.value = '1';
    dom.storeFreezeAmountInput.disabled = true;
    showNotice('Store item added.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleStoreDeleteClick(event) {
  const button = event.target.closest('[data-delete-store-id]');
  if (!button) {
    return;
  }
  const itemId = button.dataset.deleteStoreId;
  try {
    await api(`/api/store/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    showNotice('Store item removed.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleVisibilityToggle(event) {
  const button = event.target.closest('[data-view-setting-scope][data-view-setting-key]');
  if (!button) {
    return;
  }
  const scope = button.dataset.viewSettingScope;
  const key = button.dataset.viewSettingKey;
  const label = button.dataset.viewSettingLabel || 'Setting';
  if (!scope || !key) {
    return;
  }
  const enabled = !viewSettingEnabled(scope, key);
  button.disabled = true;
  try {
    await api('/api/view-settings', {
      method: 'POST',
      body: { scope, key, enabled }
    });
    showNotice(`${label} ${enabled ? 'enabled' : 'disabled'}.`);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function handleSkillAwardClick(event) {
  const button = event.target.closest('[data-award-skill-id]');
  if (!button) {
    return;
  }
  const student = selectedStudentId ? getStudent(selectedStudentId) : null;
  if (!student) {
    return;
  }
  const list = classroom.skills?.[activeSheetTab] ?? [];
  const skill = list.find((entry) => entry.id === button.dataset.awardSkillId);
  if (!skill) {
    return;
  }
  try {
    await api('/api/points', {
      method: 'POST',
      body: {
        studentId: student.id,
        delta: skill.points,
        reason: skill.label
      }
    });
    haptic(skill.points > 0 ? 15 : 25);
    showNotice(`${skill.label}: ${formatDelta(skill.points)}`);
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleQuickAdjustClick(event) {
  const button = event.target.closest('[data-adjust-delta]');
  if (!button) {
    return;
  }
  const student = selectedStudentId ? getStudent(selectedStudentId) : null;
  if (!student) {
    return;
  }
  const delta = Number.parseInt(button.dataset.adjustDelta, 10);
  const reason = button.dataset.adjustReason || 'Quick adjustment';
  if (!Number.isInteger(delta) || delta === 0) {
    return;
  }
  try {
    await api('/api/points', {
      method: 'POST',
      body: { studentId: student.id, delta, reason }
    });
    haptic(delta > 0 ? 12 : 20);
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleRedeemClick(event) {
  const button = event.target.closest('[data-redeem-item-id]');
  if (!button) {
    return;
  }
  const student = selectedStudentId ? getStudent(selectedStudentId) : null;
  if (!student) {
    return;
  }
  const itemId = button.dataset.redeemItemId;
  try {
    await api('/api/redeem', {
      method: 'POST',
      body: { studentId: student.id, itemId }
    });
    showNotice('Store item redeemed.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleQuickSkillCreate(event) {
  event.preventDefault();
  if (!(activeSheetTab === 'positive' || activeSheetTab === 'negative')) {
    showNotice('Switch to Positive or Needs Work tab first.', true);
    return;
  }
  const label = dom.quickSkillLabelInput.value.trim();
  const icon = dom.quickSkillIconInput.value.trim();
  let points = Number.parseInt(dom.quickSkillPointsInput.value, 10);

  if (!label) {
    showNotice('Skill name is required.', true);
    return;
  }
  if (!Number.isInteger(points) || points === 0) {
    showNotice('Skill points must be non-zero.', true);
    return;
  }
  if (activeSheetTab === 'positive' && points < 0) {
    points = Math.abs(points);
  }
  if (activeSheetTab === 'negative' && points > 0) {
    points = -Math.abs(points);
  }

  try {
    await api('/api/skills', {
      method: 'POST',
      body: { type: activeSheetTab, label, icon, points }
    });
    dom.quickSkillForm.reset();
    showNotice('Custom skill added.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleUseFreeze() {
  const student = selectedStudentId ? getStudent(selectedStudentId) : null;
  if (!student) {
    return;
  }
  try {
    await api('/api/streak/freeze/use', {
      method: 'POST',
      body: { studentId: student.id }
    });
    showNotice('Streak freeze consumed.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleStreakCheckin() {
  const student = selectedStudentId ? getStudent(selectedStudentId) : null;
  if (!student) {
    return;
  }
  try {
    await api(`/api/students/${encodeURIComponent(student.id)}/streak/checkin`, {
      method: 'POST',
      body: {}
    });
    haptic(10);
    showNotice('Check-in recorded.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function handleStudentRemove() {
  const student = selectedStudentId ? getStudent(selectedStudentId) : null;
  if (!student) {
    return;
  }
  const confirmed = window.confirm(`Remove ${student.name} from class?`);
  if (!confirmed) {
    return;
  }
  try {
    await api(`/api/students/${encodeURIComponent(student.id)}`, { method: 'DELETE' });
    closeStudentSheet();
    showNotice('Student removed.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

function handleSheetAvatarClick() {
  const student = selectedStudentId ? getStudent(selectedStudentId) : null;
  if (!student) {
    showNotice('Select a student first.', true);
    return;
  }
  dom.sheetStudentPhotoPicker.value = '';
  dom.sheetStudentPhotoPicker.click();
}

function handleSheetAvatarKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  event.preventDefault();
  handleSheetAvatarClick();
}

async function handleSheetAvatarPhotoPick(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const student = selectedStudentId ? getStudent(selectedStudentId) : null;
  if (!student) {
    showNotice('Student is no longer selected.', true);
    dom.sheetStudentPhotoPicker.value = '';
    return;
  }
  try {
    const photo = await toDataUrl(file);
    if (!photo) {
      throw new Error('Please choose a valid image file.');
    }
    await api(`/api/students/${encodeURIComponent(student.id)}`, {
      method: 'PATCH',
      body: { photo }
    });
    haptic(10);
    showNotice(`${student.name}'s photo updated.`);
  } catch (error) {
    showNotice(error.message || 'Unable to update student photo.', true);
  } finally {
    dom.sheetStudentPhotoPicker.value = '';
  }
}

window.addEventListener('beforeunload', () => {
  if (disconnectStream) {
    disconnectStream();
  }
});
