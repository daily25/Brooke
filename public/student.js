import { api, connectStateStream, escapeHtml, formatDelta, initials, relativeTime, safePhoto } from './shared.js';

const STUDENT_CODE_STORAGE_KEY = 'brooke_student_code';
const STUDENT_CODE_PATTERN = /^[A-Z]{5}$/;
const STUDENT_STREAM_RETRY_MS = 1500;
const STUDENT_VIEW_DEFAULTS = {
  showHeader: true,
  showConnectionStatus: true,
  showAvatarPanel: true,
  showModelControls: true,
  showStats: true,
  showSkillTotals: true,
  showBadgesAndStreak: true,
  showShoutoutClassmate: true,
  showRecentActivity: true,
  showFooterNav: true
};

const dom = {};
let profileState = null;
let studentId = '';
let accessCode = '';
let disconnectStream = null;
let shoutoutNoticeTimer = null;
let activeModelViewer = null;
let modelHasAnimations = false;
let modelIsPlaying = false;

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  bindEvents();
  initialize().catch((error) => {
    setConnectionOnline(false);
    renderError(error.message || 'Failed to load student profile.');
  });
});

function cacheDom() {
  dom.studentHeader = document.querySelector('#studentHeader');
  dom.studentClassName = document.querySelector('#studentClassName');
  dom.studentPageSubtitle = document.querySelector('#studentPageSubtitle');
  dom.studentConnection = document.querySelector('#studentConnection');
  dom.studentAccessGate = document.querySelector('#studentAccessGate');
  dom.studentAccessForm = document.querySelector('#studentAccessForm');
  dom.studentAccessCodeInput = document.querySelector('#studentAccessCodeInput');
  dom.studentAccessMessage = document.querySelector('#studentAccessMessage');
  dom.studentProfileSection = document.querySelector('#studentProfileSection');
  dom.studentAvatarPanel = document.querySelector('#studentAvatarPanel');
  dom.studentStatsPanel = document.querySelector('#studentStatsPanel');
  dom.studentSkillPanel = document.querySelector('#studentSkillPanel');
  dom.studentBadgesPanel = document.querySelector('#studentBadgesPanel');
  dom.studentShoutoutPanel = document.querySelector('#studentShoutoutPanel');
  dom.studentActivityPanel = document.querySelector('#studentActivityPanel');
  dom.studentFooter = document.querySelector('#studentFooter');

  dom.studentAvatarStage = document.querySelector('#studentAvatarStage');
  dom.studentAvatarName = document.querySelector('#studentAvatarName');
  dom.studentAvatarMeta = document.querySelector('#studentAvatarMeta');
  dom.studentModelControls = document.querySelector('#studentModelControls');
  dom.modelSpinToggleBtn = document.querySelector('#modelSpinToggleBtn');
  dom.modelPlayBtn = document.querySelector('#modelPlayBtn');
  dom.modelPauseBtn = document.querySelector('#modelPauseBtn');
  dom.modelControlHint = document.querySelector('#modelControlHint');
  dom.studentRankLine = document.querySelector('#studentRankLine');
  dom.studentStatsGrid = document.querySelector('#studentStatsGrid');
  dom.studentSkillTotals = document.querySelector('#studentSkillTotals');
  dom.studentBadgeStrip = document.querySelector('#studentBadgeStrip');
  dom.studentStreakLine = document.querySelector('#studentStreakLine');
  dom.studentRecentActivity = document.querySelector('#studentRecentActivity');
  dom.studentShoutoutForm = document.querySelector('#studentShoutoutForm');
  dom.studentShoutoutTargetInput = document.querySelector('#studentShoutoutTargetInput');
  dom.studentShoutoutMessageInput = document.querySelector('#studentShoutoutMessageInput');
  dom.studentShoutoutNotice = document.querySelector('#studentShoutoutNotice');
  dom.studentShoutoutHistory = document.querySelector('#studentShoutoutHistory');
}

function bindEvents() {
  dom.studentAccessForm.addEventListener('submit', handleAccessSubmit);
  dom.studentShoutoutForm.addEventListener('submit', handleShoutoutSubmit);
  dom.modelSpinToggleBtn.addEventListener('click', handleModelSpinToggle);
  dom.modelPlayBtn.addEventListener('click', handleModelPlay);
  dom.modelPauseBtn.addEventListener('click', handleModelPause);
}

function normalizeAccessCode(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const sanitized = value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 5);
  return STUDENT_CODE_PATTERN.test(sanitized) ? sanitized : '';
}

function readStoredAccessCode() {
  try {
    return normalizeAccessCode(localStorage.getItem(STUDENT_CODE_STORAGE_KEY) || '');
  } catch {
    return '';
  }
}

function writeStoredAccessCode(code) {
  try {
    if (code) {
      localStorage.setItem(STUDENT_CODE_STORAGE_KEY, code);
    } else {
      localStorage.removeItem(STUDENT_CODE_STORAGE_KEY);
    }
  } catch {}
}

async function initialize() {
  const params = new URLSearchParams(window.location.search);
  studentId = params.get('id')?.trim() || '';
  const queryCode = normalizeAccessCode(params.get('code') || '');
  accessCode = queryCode || (studentId ? '' : readStoredAccessCode());
  if (accessCode) {
    try {
      await startCodeMode(accessCode);
    } catch (error) {
      writeStoredAccessCode('');
      accessCode = '';
      showAccessGate(error.message || 'That code is not valid.');
      setConnectionOnline(false);
    }
    return;
  }
  if (studentId) {
    await startIdMode(studentId);
    return;
  }
  showAccessGate('Enter your 5-letter student code to continue.');
  setConnectionOnline(false);
}

async function startIdMode(id) {
  const payload = await api('/api/state');
  const nextState = buildProfileFromClassState(payload.state, id);
  if (!nextState) {
    renderError('This student no longer exists. Open from the board again.');
    return;
  }
  profileState = nextState;
  accessCode = '';
  writeStoredAccessCode('');
  renderProfile();
  connectTeacherStream();
}

async function startCodeMode(code) {
  const normalized = normalizeAccessCode(code);
  if (!normalized) {
    throw new Error('Code must be exactly 5 letters.');
  }
  const payload = await api(`/api/student/state?code=${encodeURIComponent(normalized)}`);
  profileState = payload.state || null;
  if (!profileState?.viewer?.id) {
    throw new Error('That code is not valid. Ask your teacher for a new one.');
  }
  accessCode = normalized;
  writeStoredAccessCode(accessCode);
  studentId = profileState.viewer.id;
  renderProfile();
  connectStudentStream(accessCode);
}

function connectTeacherStream() {
  disconnectStream?.();
  disconnectStream = connectStateStream({
    onState: (streamPayload) => {
      const nextState = buildProfileFromClassState(streamPayload.state, studentId);
      if (!nextState) {
        renderError('This student no longer exists.');
        return;
      }
      profileState = nextState;
      renderProfile();
    },
    onOpen: () => setConnectionOnline(true),
    onError: () => setConnectionOnline(false)
  });
}

function connectStudentStream(code) {
  disconnectStream?.();
  let source = null;
  let retryHandle = null;
  let stopped = false;

  const open = () => {
    if (stopped) {
      return;
    }
    source = new EventSource(`/api/student/events?code=${encodeURIComponent(code)}`);
    source.addEventListener('state', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.state?.viewer?.id) {
          profileState = payload.state;
          studentId = payload.state.viewer.id;
          renderProfile();
        }
      } catch (error) {
        console.error('Failed to parse student stream payload:', error);
      }
    });
    source.onopen = () => {
      setConnectionOnline(true);
    };
    source.onerror = () => {
      setConnectionOnline(false);
      source?.close();
      clearTimeout(retryHandle);
      retryHandle = setTimeout(open, STUDENT_STREAM_RETRY_MS);
    };
  };

  open();

  disconnectStream = () => {
    stopped = true;
    clearTimeout(retryHandle);
    source?.close();
  };
}

function buildProfileFromClassState(classState, targetStudentId) {
  if (!classState) {
    return null;
  }
  const students = classState.students || [];
  const viewer = students.find((entry) => entry.id === targetStudentId);
  if (!viewer) {
    return null;
  }
  const ranked = sortedByPoints(students);
  const rankIndex = ranked.findIndex((entry) => entry.id === viewer.id);
  return {
    className: classState.className || "Brooke's Classroom",
    viewSettings: classState.viewSettings || null,
    viewer,
    classmates: students.map((entry) => ({
      id: entry.id,
      name: entry.name,
      points: entry.points,
      level: entry.level,
      photo: entry.photo
    })),
    rank: rankIndex === -1 ? 0 : rankIndex + 1,
    events: (classState.events || []).filter((event) => event.studentId === viewer.id).slice(0, 30),
    shoutouts: (classState.shoutouts || [])
      .filter((entry) => entry.fromStudentId === viewer.id || entry.toStudentId === viewer.id)
      .slice(0, 30),
    updatedAt: classState.updatedAt || ''
  };
}

function showAccessGate(message = '') {
  dom.studentAccessGate.classList.remove('hidden');
  dom.studentProfileSection.classList.add('hidden');
  dom.studentAccessMessage.textContent = message;
}

function showProfileView() {
  dom.studentAccessGate.classList.add('hidden');
  dom.studentProfileSection.classList.remove('hidden');
}

function setConnectionOnline(isOnline) {
  dom.studentConnection.textContent = isOnline ? 'Live Sync' : 'Reconnecting';
  dom.studentConnection.classList.toggle('online', isOnline);
  dom.studentConnection.classList.toggle('offline', !isOnline);
}

function sortedByPoints(students) {
  return [...students].sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    return a.name.localeCompare(b.name);
  });
}

function studentViewSetting(key) {
  const configured = profileState?.viewSettings?.student?.[key];
  if (typeof configured === 'boolean') {
    return configured;
  }
  return STUDENT_VIEW_DEFAULTS[key] ?? true;
}

function applyStudentVisibility() {
  const showHeader = studentViewSetting('showHeader');
  dom.studentHeader.classList.toggle('hidden', !showHeader);
  dom.studentConnection.classList.toggle('hidden', !showHeader || !studentViewSetting('showConnectionStatus'));
  dom.studentAvatarPanel.classList.toggle('hidden', !studentViewSetting('showAvatarPanel'));
  dom.studentStatsPanel.classList.toggle('hidden', !studentViewSetting('showStats'));
  dom.studentSkillPanel.classList.toggle('hidden', !studentViewSetting('showSkillTotals'));
  dom.studentBadgesPanel.classList.toggle('hidden', !studentViewSetting('showBadgesAndStreak'));
  dom.studentShoutoutPanel.classList.toggle('hidden', !studentViewSetting('showShoutoutClassmate'));
  dom.studentActivityPanel.classList.toggle('hidden', !studentViewSetting('showRecentActivity'));
  dom.studentFooter.classList.toggle('hidden', !studentViewSetting('showFooterNav'));
}

function skillTotals(events) {
  const totals = new Map();
  for (const event of events) {
    if (event.type !== 'points') {
      continue;
    }
    const key = event.reason || 'Skill';
    totals.set(key, (totals.get(key) || 0) + (event.delta || 0));
  }
  return [...totals.entries()]
    .sort((a, b) => {
      if (Math.abs(b[1]) !== Math.abs(a[1])) {
        return Math.abs(b[1]) - Math.abs(a[1]);
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 8);
}

function milestoneTitle(level) {
  if (level >= 7) {
    return 'Legend';
  }
  if (level >= 5) {
    return 'All-Star';
  }
  if (level >= 3) {
    return 'Rising';
  }
  return 'Starter';
}

function avatarStageMarkup(student) {
  const model = typeof student.avatarModel === 'string' ? student.avatarModel.trim() : '';
  if (model) {
    return `
      <model-viewer
        class="character-model"
        src="${escapeHtml(model)}"
        alt="${escapeHtml(student.name)} 3D avatar"
        camera-controls
        disable-pan
        auto-rotate-delay="0"
        rotation-per-second="22deg"
        interaction-prompt="none"
        shadow-intensity="0.85"
        exposure="1"
        environment-image="neutral"
        camera-target="auto auto auto"
        camera-orbit="0deg 75deg 78%"
        min-camera-orbit="auto auto 56%"
        max-camera-orbit="auto auto 220%"
        field-of-view="24deg"
        min-field-of-view="14deg"
        max-field-of-view="38deg"
        auto-rotate-delay="1200"
        ar="false"
      ></model-viewer>
    `;
  }
  const photo = safePhoto(student.photo);
  if (photo) {
    return `
      <div class="character-stand">
        <img class="character-image" src="${photo}" alt="${escapeHtml(student.name)} avatar">
      </div>
    `;
  }
  return `
    <div class="character-stand">
      <div class="character-fallback">${escapeHtml(initials(student.name))}</div>
    </div>
  `;
}

function refreshModelControls() {
  const hasModel = Boolean(activeModelViewer);
  const showControls = studentViewSetting('showModelControls');
  dom.studentModelControls.classList.toggle('hidden', !hasModel || !showControls);
  dom.modelControlHint.classList.toggle('hidden', !hasModel || !showControls);
  if (!hasModel || !showControls) {
    dom.modelControlHint.textContent = '';
    return;
  }
  const spinEnabled = activeModelViewer.hasAttribute('auto-rotate');
  dom.modelSpinToggleBtn.textContent = spinEnabled ? 'Spin: On' : 'Spin: Off';
  dom.modelPlayBtn.disabled = !modelHasAnimations || modelIsPlaying;
  dom.modelPauseBtn.disabled = !modelHasAnimations || !modelIsPlaying;
  dom.modelControlHint.textContent = modelHasAnimations
    ? 'Standing pose is default. Click Play Move to animate.'
    : 'This model has no animation clips. Spin is available.';
}

function detectModelAnimations(modelViewer) {
  if (!modelViewer) {
    return;
  }
  const list = Array.isArray(modelViewer.availableAnimations)
    ? modelViewer.availableAnimations.filter((name) => typeof name === 'string' && name.trim())
    : [];
  modelHasAnimations = list.length > 0;
  if (!modelHasAnimations) {
    modelIsPlaying = false;
    refreshModelControls();
    return;
  }
  const preferredAnimation = list[0];
  if (preferredAnimation && modelViewer.getAttribute('animation-name') !== preferredAnimation) {
    modelViewer.setAttribute('animation-name', preferredAnimation);
  }
  modelIsPlaying = false;
  if (typeof modelViewer.pause === 'function') {
    try {
      modelViewer.pause();
    } catch {
      // Ignore pause errors for models that are not yet fully initialized.
    }
  }
  refreshModelControls();
}

function setupModelControls() {
  activeModelViewer = dom.studentAvatarStage.querySelector('model-viewer');
  modelHasAnimations = false;
  modelIsPlaying = false;
  refreshModelControls();
  if (!activeModelViewer) {
    return;
  }
  const modelViewer = activeModelViewer;
  const detectForCurrentModel = () => {
    if (activeModelViewer !== modelViewer) {
      return;
    }
    detectModelAnimations(modelViewer);
  };
  modelViewer.addEventListener(
    'load',
    () => {
      detectForCurrentModel();
      window.setTimeout(detectForCurrentModel, 180);
    },
    { once: true }
  );
  window.requestAnimationFrame(() => {
    detectForCurrentModel();
  });
}

function handleModelSpinToggle() {
  if (!activeModelViewer) {
    return;
  }
  if (activeModelViewer.hasAttribute('auto-rotate')) {
    activeModelViewer.removeAttribute('auto-rotate');
  } else {
    activeModelViewer.setAttribute('auto-rotate', '');
  }
  refreshModelControls();
}

function handleModelPlay() {
  if (!activeModelViewer || !modelHasAnimations) {
    return;
  }
  if (typeof activeModelViewer.play === 'function') {
    try {
      activeModelViewer.play();
      modelIsPlaying = true;
    } catch {}
  }
  refreshModelControls();
}

function handleModelPause() {
  if (!activeModelViewer || !modelHasAnimations) {
    return;
  }
  if (typeof activeModelViewer.pause === 'function') {
    try {
      activeModelViewer.pause();
      modelIsPlaying = false;
    } catch {}
  }
  refreshModelControls();
}

function renderProfile() {
  if (!profileState?.viewer) {
    renderError('Profile unavailable.');
    return;
  }
  showProfileView();
  const student = profileState.viewer;
  const events = profileState.events || [];
  const classmates = profileState.classmates || [];
  const totals = skillTotals(events);
  const rank = profileState.rank || '-';

  dom.studentClassName.textContent = `${student.name} - ${student.points} pts`;
  dom.studentPageSubtitle.textContent = `${profileState.className || "Brooke's Classroom"} | Live character profile`;
  dom.studentAvatarName.textContent = student.name;
  dom.studentAvatarMeta.textContent = `Level ${student.level || 1} ${milestoneTitle(student.level || 1)}`;
  dom.studentAvatarStage.innerHTML = avatarStageMarkup(student);
  setupModelControls();

  dom.studentRankLine.textContent = `Total Points: ${student.points} (Rank #${rank})`;
  const metrics = [
    { label: 'Level', value: String(student.level || 1) },
    { label: 'XP Total', value: String(student.xpTotal || 0) },
    { label: 'Season XP', value: String(student.seasonXp || 0) },
    { label: 'Weekly Delta', value: formatDelta(student.weeklyDelta || 0) },
    { label: 'Streak Freeze', value: String(student.streakFreezes || 0) },
    { label: 'Verified', value: student.verifiedStatus ? 'Yes' : 'No' }
  ];
  dom.studentStatsGrid.innerHTML = metrics
    .map(
      (metric) => `
        <div class="student-metric">
          <p class="metric-label">${escapeHtml(metric.label)}</p>
          <p class="metric-value">${escapeHtml(metric.value)}</p>
        </div>
      `
    )
    .join('');

  if (totals.length === 0) {
    dom.studentSkillTotals.innerHTML = '<p class="mini-empty">No point events yet.</p>';
  } else {
    dom.studentSkillTotals.innerHTML = totals
      .map(([label, total]) => {
        const deltaClass = total >= 0 ? 'plus' : 'minus';
        return `
          <div class="student-skill-row">
            <p>${escapeHtml(label)}</p>
            <strong class="event-delta ${deltaClass}">${formatDelta(total)}</strong>
          </div>
        `;
      })
      .join('');
  }

  const badges = Array.isArray(student.badges) ? student.badges : [];
  if (badges.length === 0) {
    dom.studentBadgeStrip.innerHTML = '<p class="mini-empty">No badges unlocked yet.</p>';
  } else {
    dom.studentBadgeStrip.innerHTML = badges
      .map((badge) => `<span class="student-badge-pill">${escapeHtml(String(badge).replaceAll('_', ' '))}</span>`)
      .join('');
  }

  dom.studentStreakLine.textContent = `Current streak ${student.streakCurrent || 0} | Best ${student.streakBest || 0} | Freeze ${student.streakFreezes || 0}`;

  if (events.length === 0) {
    dom.studentRecentActivity.innerHTML = '<p class="mini-empty">No activity yet.</p>';
  } else {
    dom.studentRecentActivity.innerHTML = events
      .map((event) => {
        const deltaClass = event.delta >= 0 ? 'plus' : 'minus';
        return `
          <div class="event-row">
            <div>
              <p class="event-text">${escapeHtml(event.reason)}</p>
              <p class="event-time">${escapeHtml(relativeTime(event.timestamp))} | ${escapeHtml(event.type || 'activity')}</p>
            </div>
            <strong class="event-delta ${deltaClass}">${formatDelta(event.delta || 0)}</strong>
          </div>
        `;
      })
      .join('');
  }

  renderShoutoutTargets(classmates, student.id);
  renderShoutoutHistory(profileState.shoutouts || [], student.id);
  applyStudentVisibility();
}

function renderShoutoutTargets(classmates, selfId) {
  const peers = classmates.filter((entry) => entry.id !== selfId);
  const submitButton = dom.studentShoutoutForm.querySelector('button');
  if (peers.length === 0) {
    dom.studentShoutoutTargetInput.innerHTML = '<option value="">No classmates available</option>';
    dom.studentShoutoutTargetInput.disabled = true;
    submitButton.disabled = true;
    return;
  }
  const current = dom.studentShoutoutTargetInput.value;
  const canSubmit = Boolean(currentShoutoutCode());
  dom.studentShoutoutTargetInput.disabled = false;
  dom.studentShoutoutTargetInput.innerHTML = peers
    .map((entry) => `<option value="${entry.id}">${escapeHtml(entry.name)}</option>`)
    .join('');
  dom.studentShoutoutTargetInput.value = peers.some((entry) => entry.id === current) ? current : peers[0].id;
  submitButton.disabled = !canSubmit;
  if (!canSubmit) {
    dom.studentShoutoutNotice.textContent = 'Open with your 5-letter code to send shoutouts.';
  } else if (dom.studentShoutoutNotice.textContent === 'Open with your 5-letter code to send shoutouts.') {
    dom.studentShoutoutNotice.textContent = '';
  }
}

function renderShoutoutHistory(shoutouts, selfId) {
  if (!Array.isArray(shoutouts) || shoutouts.length === 0) {
    dom.studentShoutoutHistory.innerHTML = '<p class="mini-empty">No shoutouts yet.</p>';
    return;
  }
  const nameById = new Map((profileState.classmates || []).map((entry) => [entry.id, entry.name]));
  dom.studentShoutoutHistory.innerHTML = shoutouts
    .map((entry) => {
      const fromName = nameById.get(entry.fromStudentId) || 'Unknown';
      const toName = nameById.get(entry.toStudentId) || 'Unknown';
      const direction = entry.fromStudentId === selfId ? `To ${toName}` : `From ${fromName}`;
      return `
        <div class="history-row">
          <div>
            <p class="history-reason">${escapeHtml(direction)}</p>
            <p class="history-time">${escapeHtml(entry.message)}</p>
            <p class="history-time">${escapeHtml(relativeTime(entry.createdAt))} | ${escapeHtml(entry.status || 'pending')}</p>
          </div>
          <strong class="history-delta ${entry.status === 'approved' ? 'plus' : entry.status === 'archived' ? 'minus' : ''}">
            ${escapeHtml((entry.status || 'pending').toUpperCase())}
          </strong>
        </div>
      `;
    })
    .join('');
}

async function handleAccessSubmit(event) {
  event.preventDefault();
  const code = normalizeAccessCode(dom.studentAccessCodeInput.value || '');
  if (!code) {
    showAccessGate('Code must be exactly 5 letters.');
    return;
  }
  try {
    await startCodeMode(code);
    dom.studentAccessCodeInput.value = code;
    dom.studentAccessMessage.textContent = '';
  } catch (error) {
    writeStoredAccessCode('');
    showAccessGate(error.message || 'Access code not found.');
  }
}

function showShoutoutNotice(message, isError = false) {
  dom.studentShoutoutNotice.textContent = message;
  dom.studentShoutoutNotice.classList.toggle('error', isError);
  clearTimeout(shoutoutNoticeTimer);
  shoutoutNoticeTimer = setTimeout(() => {
    dom.studentShoutoutNotice.textContent = '';
    dom.studentShoutoutNotice.classList.remove('error');
  }, 3200);
}

function currentShoutoutCode() {
  const explicit = normalizeAccessCode(accessCode);
  if (explicit) {
    return explicit;
  }
  return normalizeAccessCode(profileState?.viewer?.accessCode || '');
}

async function handleShoutoutSubmit(event) {
  event.preventDefault();
  const shoutoutCode = currentShoutoutCode();
  if (!shoutoutCode) {
    showShoutoutNotice('Open with your 5-letter code to send shoutouts.', true);
    return;
  }
  const toStudentId = dom.studentShoutoutTargetInput.value;
  const message = dom.studentShoutoutMessageInput.value.trim();
  if (!toStudentId) {
    showShoutoutNotice('Choose a classmate first.', true);
    return;
  }
  if (message.length < 4) {
    showShoutoutNotice('Please add at least 4 characters.', true);
    return;
  }
  try {
    await api('/api/shoutouts', {
      method: 'POST',
      body: {
        accessCode: shoutoutCode,
        toStudentId,
        message
      }
    });
    dom.studentShoutoutForm.reset();
    showShoutoutNotice('Shoutout sent to teacher for review.');
  } catch (error) {
    showShoutoutNotice(error.message || 'Unable to submit shoutout.', true);
  }
}

function renderError(message) {
  showAccessGate(message);
  dom.studentPageSubtitle.textContent = message;
  dom.studentAvatarName.textContent = 'Student';
  dom.studentAvatarMeta.textContent = 'Profile unavailable';
  dom.studentAvatarStage.innerHTML = '<div class="character-stand"><div class="character-fallback">?</div></div>';
  setupModelControls();
  dom.studentRankLine.textContent = message;
  dom.studentStatsGrid.innerHTML = '';
  dom.studentSkillTotals.innerHTML = '<p class="mini-empty">No data to show.</p>';
  dom.studentBadgeStrip.innerHTML = '<p class="mini-empty">No data to show.</p>';
  dom.studentStreakLine.textContent = '';
  dom.studentRecentActivity.innerHTML = '<p class="mini-empty">No activity to show.</p>';
  dom.studentShoutoutHistory.innerHTML = '<p class="mini-empty">No shoutouts to show.</p>';
}

window.addEventListener('beforeunload', () => {
  if (disconnectStream) {
    disconnectStream();
  }
});
