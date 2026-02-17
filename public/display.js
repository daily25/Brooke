import { api, avatarMarkup, connectStateStream, escapeHtml, formatDelta, initThemeToggle, relativeTime } from './shared.js';

const dom = {};
const OVERLAY_DURATION_MS = 4200;
const DISPLAY_VIEW_DEFAULTS = {
  showHeader: true,
  showConnectionStatus: true,
  showThemeToggle: true,
  showSoundToggle: true,
  showClassPoints: true,
  showRecentActivity: true,
  showFooterNav: true,
  showEventOverlay: true
};
let classroom = null;
let highlightedStudentId = '';
let celebratedStudentId = '';
let highlightTimer = null;
let celebrationTimer = null;
let overlayTimer = null;
let disconnectStream = null;
let soundEnabled = true;
let audioContext = null;
let audioUnlocked = false;
let hasBoundUnlockListeners = false;
let kachingTemplate = null;
let kachingBuffer = null;
let kachingBufferPromise = null;

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  initThemeToggle(dom.themeToggleBtn);
  bindEvents();
  setSoundButtonState(true);
  armSoundUnlockListeners();
  tryAutoEnableSound();
  initialize().catch((error) => {
    dom.displayConnection.textContent = 'Offline';
    dom.displayConnection.classList.remove('online');
    dom.displayConnection.classList.add('offline');
    dom.displayEvents.innerHTML = `<p class="mini-empty">${escapeHtml(error.message || 'Failed to load board.')}</p>`;
  });
});

function cacheDom() {
  dom.displayHeader = document.querySelector('#displayHeader');
  dom.displayClassName = document.querySelector('#displayClassName');
  dom.displaySeasonLine = document.querySelector('#displaySeasonLine');
  dom.displayConnection = document.querySelector('#displayConnection');
  dom.themeToggleBtn = document.querySelector('#themeToggleBtn');
  dom.enableSoundBtn = document.querySelector('#enableSoundBtn');
  dom.studentsSection = document.querySelector('#studentsSection');
  dom.activitySection = document.querySelector('#activitySection');
  dom.displayFooter = document.querySelector('#displayFooter');
  dom.displayStudents = document.querySelector('#displayStudents');
  dom.displayEvents = document.querySelector('#displayEvents');
  dom.eventOverlay = document.querySelector('#eventOverlay');
  dom.eventOverlayPanel = document.querySelector('#eventOverlayPanel');
  dom.eventOverlayEyebrow = document.querySelector('#eventOverlayEyebrow');
  dom.eventOverlayTitle = document.querySelector('#eventOverlayTitle');
  dom.eventOverlayParticipants = document.querySelector('#eventOverlayParticipants');
  dom.eventOverlayFromAvatar = document.querySelector('#eventOverlayFromAvatar');
  dom.eventOverlayFromName = document.querySelector('#eventOverlayFromName');
  dom.eventOverlayToAvatar = document.querySelector('#eventOverlayToAvatar');
  dom.eventOverlayToName = document.querySelector('#eventOverlayToName');
  dom.eventOverlayValue = document.querySelector('#eventOverlayValue');
  dom.eventOverlayDetail = document.querySelector('#eventOverlayDetail');
}

function bindEvents() {
  dom.enableSoundBtn.addEventListener('click', async () => {
    try {
      await enableSound();
      setSoundButtonState(true);
      playKachingSound();
    } catch {
      setSoundButtonState(false);
    }
  });
}

function setSoundButtonState(isEnabled) {
  dom.enableSoundBtn.textContent = isEnabled ? 'Sound Enabled' : 'Tap To Unlock Sound';
  dom.enableSoundBtn.disabled = false;
  dom.enableSoundBtn.classList.toggle('is-on', isEnabled);
}

function armSoundUnlockListeners() {
  if (hasBoundUnlockListeners) {
    return;
  }
  hasBoundUnlockListeners = true;
  const unlock = async () => {
    try {
      await enableSound();
      setSoundButtonState(true);
    } catch {
      setSoundButtonState(false);
    }
  };
  window.addEventListener('pointerdown', unlock, { passive: true, once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

async function tryAutoEnableSound() {
  try {
    await enableSound();
    setSoundButtonState(true);
  } catch {
    // Browser autoplay policies may require first interaction.
    setSoundButtonState(false);
  }
}

async function initialize() {
  const payload = await api('/api/state');
  classroom = payload.state;
  renderAll();

  disconnectStream = connectStateStream({
    onState: (payload) => {
      classroom = payload.state;
      reactToEvent(payload);
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

function reactToEvent(payload) {
  if (!payload) {
    return;
  }
  const overlayVariant = showCelebrationOverlay(payload);

  if (payload.affectedStudentIds?.length) {
    highlightStudent(payload.affectedStudentIds[0]);
  } else if (payload.event?.studentId && payload.event.studentId !== 'class') {
    highlightStudent(payload.event.studentId);
  }

  if (payload.highlightMode === 'confetti' || payload.highlightMode === 'badge') {
    celebrateStudent(payload.event?.studentId || payload.affectedStudentIds?.[0] || '');
  }

  playEventSound(payload, overlayVariant);
}

function showCelebrationOverlay(payload) {
  if (!dom.eventOverlay) {
    return '';
  }
  if (!displayViewSetting('showEventOverlay')) {
    return '';
  }
  const event = payload?.event;
  if (!event || event.studentId === 'class') {
    return '';
  }
  const eventType = payload?.eventType || event.type || '';
  const delta = Number(event.delta || 0);
  const students = classroom?.students ?? [];
  const studentName = students.find((student) => student.id === event.studentId)?.name || 'Student';
  const meta = event.meta || {};

  let variant = '';
  let title = '';
  let value = '';
  let detail = '';
  let eyebrow = 'Live Moment';

  if (eventType === 'points' && delta > 0) {
    variant = 'points';
    eyebrow = '💰 Point Awarded';
    title = `🎉 ${studentName} earned points`;
    value = `+${delta} ⭐`;
    detail = event.reason ? `📝 ${event.reason}` : 'Great effort';
  } else if (eventType === 'shoutout') {
    variant = 'shoutout';
    eyebrow = '📣 Shoutout Approved';
    title = `👏 ${studentName} got a shoutout`;
    value = `💬 ${shoutoutReason(event.reason)}`;
    detail = '';

    const fromStudentId = typeof meta.fromStudentId === 'string' ? meta.fromStudentId : '';
    const toStudentId = typeof meta.toStudentId === 'string' ? meta.toStudentId : event.studentId;
    const fromStudent = students.find((student) => student.id === fromStudentId) || { name: 'Sender', photo: '' };
    const toStudent = students.find((student) => student.id === toStudentId) || { name: studentName, photo: '' };
    dom.eventOverlayParticipants.classList.remove('hidden');
    dom.eventOverlayFromAvatar.innerHTML = avatarMarkup(fromStudent, 'large');
    dom.eventOverlayFromName.textContent = fromStudent.name || 'Sender';
    dom.eventOverlayToAvatar.innerHTML = avatarMarkup(toStudent, 'large');
    dom.eventOverlayToName.textContent = toStudent.name || 'Receiver';
  } else {
    return '';
  }

  if (variant !== 'shoutout') {
    dom.eventOverlayParticipants.classList.add('hidden');
    dom.eventOverlayFromAvatar.innerHTML = '';
    dom.eventOverlayToAvatar.innerHTML = '';
    dom.eventOverlayFromName.textContent = '';
    dom.eventOverlayToName.textContent = '';
  }

  dom.eventOverlay.classList.remove('hidden', 'points', 'shoutout', 'active');
  dom.eventOverlay.classList.add(variant, 'active');
  dom.eventOverlayEyebrow.textContent = eyebrow;
  dom.eventOverlayTitle.textContent = title;
  dom.eventOverlayValue.textContent = value;
  dom.eventOverlayDetail.textContent = detail;

  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => {
    dom.eventOverlay.classList.remove('active', 'points', 'shoutout');
    dom.eventOverlay.classList.add('hidden');
  }, OVERLAY_DURATION_MS);
  return variant;
}

function shoutoutReason(rawReason) {
  const reason = String(rawReason || '').trim();
  if (!reason) {
    return 'Great classmate recognition';
  }
  const match = reason.match(/^Shoutout\s+from\s+[^:]+:\s*(.+)$/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return reason;
}

function playEventSound(payload, overlayVariant) {
  const cue = payload?.soundCue || '';
  if (cue) {
    playCue(cue);
    return;
  }
  if (payload?.eventType === 'points' && (payload?.event?.delta || 0) > 0) {
    playCue('money');
    return;
  }
  if (payload?.eventType === 'shoutout' || overlayVariant === 'shoutout') {
    playCue('badge');
    return;
  }
  if (overlayVariant === 'points') {
    playCue('money');
  }
}

function highlightStudent(studentId) {
  if (!studentId) {
    return;
  }
  highlightedStudentId = studentId;
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    highlightedStudentId = '';
    renderStudents();
  }, 1900);
}

function celebrateStudent(studentId) {
  if (!studentId) {
    return;
  }
  celebratedStudentId = studentId;
  clearTimeout(celebrationTimer);
  celebrationTimer = setTimeout(() => {
    celebratedStudentId = '';
    renderStudents();
  }, 2200);
}

function sortedByPoints(students) {
  return [...students].sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    return a.name.localeCompare(b.name);
  });
}

function displayViewSetting(key) {
  const configured = classroom?.viewSettings?.display?.[key];
  if (typeof configured === 'boolean') {
    return configured;
  }
  return DISPLAY_VIEW_DEFAULTS[key] ?? true;
}

function applyDisplayVisibility() {
  const showHeader = displayViewSetting('showHeader');
  dom.displayHeader.classList.toggle('hidden', !showHeader);
  dom.displayConnection.classList.toggle('hidden', !showHeader || !displayViewSetting('showConnectionStatus'));
  dom.themeToggleBtn.classList.toggle('hidden', !showHeader || !displayViewSetting('showThemeToggle'));
  dom.enableSoundBtn.classList.toggle('hidden', !showHeader || !displayViewSetting('showSoundToggle'));
  dom.studentsSection.classList.toggle('hidden', !displayViewSetting('showClassPoints'));
  dom.activitySection.classList.toggle('hidden', !displayViewSetting('showRecentActivity'));
  dom.displayFooter.classList.toggle('hidden', !displayViewSetting('showFooterNav'));
  if (!displayViewSetting('showEventOverlay')) {
    clearTimeout(overlayTimer);
    dom.eventOverlay.classList.add('hidden');
    dom.eventOverlay.classList.remove('active', 'points', 'shoutout');
  }
}

function renderAll() {
  if (!classroom) {
    return;
  }
  dom.displayClassName.textContent = classroom.className || "Brooke's Classroom";
  dom.displaySeasonLine.textContent = 'Class points live board';
  applyDisplayVisibility();
  renderStudents();
  renderEvents();
}

function renderStudents() {
  const students = sortedByPoints(classroom.students ?? []);
  if (students.length === 0) {
    dom.displayStudents.innerHTML = '<p class="mini-empty">No students yet.</p>';
    return;
  }
  dom.displayStudents.innerHTML = students
    .map((student) => {
      const isHighlighted = student.id === highlightedStudentId;
      const isCelebrating = student.id === celebratedStudentId;
      const profileUrl = `/student?id=${encodeURIComponent(student.id)}`;
      return `
        <a class="display-student-link" href="${profileUrl}">
          <article class="display-student-card ${isHighlighted ? 'spotlight' : ''} ${isCelebrating ? 'celebrate' : ''}">
            ${avatarMarkup(student, 'medium')}
            <p class="display-student-name">${escapeHtml(student.name)}</p>
            <p class="display-student-points">${student.points} pts</p>
          </article>
        </a>
      `;
    })
    .join('');
}

function renderEvents() {
  const events = (classroom.events ?? []).slice(0, 24);
  const nameById = new Map((classroom.students ?? []).map((student) => [student.id, student.name]));
  if (events.length === 0) {
    dom.displayEvents.innerHTML = '<p class="mini-empty">No activity yet.</p>';
    return;
  }
  dom.displayEvents.innerHTML = events
    .map((event) => {
      const studentName = nameById.get(event.studentId) || (event.studentId === 'class' ? 'Class' : 'Unknown student');
      const deltaClass = event.delta >= 0 ? 'plus' : 'minus';
      return `
        <div class="event-row">
          <div>
            <p class="event-text">${escapeHtml(studentName)} | ${escapeHtml(event.reason)}</p>
            <p class="event-time">${escapeHtml(relativeTime(event.timestamp))} | ${escapeHtml(event.type || 'activity')}</p>
          </div>
          <strong class="event-delta ${deltaClass}">${formatDelta(event.delta || 0)}</strong>
        </div>
      `;
    })
    .join('');
}

function getAudioContext() {
  const AudioConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioConstructor) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioConstructor();
  }
  return audioContext;
}

async function enableSound() {
  const context = getAudioContext();
  if (!context) {
    throw new Error('Audio not supported.');
  }
  if (context.state !== 'running') {
    await context.resume();
  }
  audioUnlocked = context.state === 'running';
  soundEnabled = true;
  if (audioUnlocked) {
    loadKachingBuffer().catch(() => {});
  }
}

function loadKachingBuffer() {
  if (kachingBuffer) {
    return Promise.resolve(kachingBuffer);
  }
  if (kachingBufferPromise) {
    return kachingBufferPromise;
  }
  const context = getAudioContext();
  if (!context) {
    return Promise.reject(new Error('AudioContext unavailable'));
  }
  kachingBufferPromise = fetch('/kaching.mp3', { cache: 'force-cache' })
    .then((response) => {
      if (!response.ok) {
        throw new Error('Failed to load kaching audio');
      }
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
    .then((decoded) => {
      kachingBuffer = decoded;
      return decoded;
    })
    .finally(() => {
      kachingBufferPromise = null;
    });
  return kachingBufferPromise;
}

function playKachingBuffer() {
  const context = getAudioContext();
  if (!context || context.state !== 'running' || !kachingBuffer) {
    return false;
  }
  const source = context.createBufferSource();
  const gainNode = context.createGain();
  gainNode.gain.value = 0.95;
  source.buffer = kachingBuffer;
  source.connect(gainNode);
  gainNode.connect(context.destination);
  source.start();
  return true;
}

function playKachingElement() {
  if (!kachingTemplate) {
    kachingTemplate = new Audio('/kaching.mp3');
    kachingTemplate.preload = 'auto';
    kachingTemplate.volume = 0.95;
    try {
      kachingTemplate.load();
    } catch {}
  }
  const clip = new Audio('/kaching.mp3');
  clip.volume = kachingTemplate.volume;
  const playback = clip.play();
  if (playback && typeof playback.catch === 'function') {
    playback.catch(() => {
      setSoundButtonState(false);
      playToneSequence([1046.5, 1318.5, 1568], 'triangle', 0.09);
    });
  }
}

function playToneSequence(sequence, type = 'triangle', gain = 0.08) {
  if (!soundEnabled) {
    return;
  }
  const context = getAudioContext();
  if (!context || context.state !== 'running') {
    return;
  }
  const start = context.currentTime;
  sequence.forEach((frequency, index) => {
    const toneStart = start + index * 0.055;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, toneStart);
    gainNode.gain.setValueAtTime(0.0001, toneStart);
    gainNode.gain.exponentialRampToValueAtTime(gain, toneStart + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.15);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneStart + 0.16);
  });
}

function playKachingSound() {
  if (!soundEnabled) {
    return;
  }
  const context = getAudioContext();
  if (context && context.state === 'running') {
    if (playKachingBuffer()) {
      return;
    }
    loadKachingBuffer()
      .then(() => {
        if (!playKachingBuffer()) {
          playKachingElement();
        }
      })
      .catch(() => {
        playKachingElement();
      });
    return;
  }
  playKachingElement();
}

function playCue(cue) {
  const context = getAudioContext();
  if (context && context.state !== 'running') {
    context
      .resume()
      .then(() => {
        audioUnlocked = context.state === 'running';
        setSoundButtonState(audioUnlocked);
        if (audioUnlocked) {
          loadKachingBuffer().catch(() => {});
        }
      })
      .catch(() => {
        audioUnlocked = false;
        setSoundButtonState(false);
      });
  }
  if (cue === 'money') {
    playKachingSound();
    return;
  }
  if (cue === 'level_up') {
    playToneSequence([523.25, 659.25, 783.99, 1046.5], 'sawtooth', 0.085);
    return;
  }
  if (cue === 'badge') {
    playToneSequence([880, 1174.66, 1396.91], 'square', 0.07);
    return;
  }
  if (cue === 'soft_donk') {
    playToneSequence([220, 196], 'triangle', 0.05);
  }
}

window.addEventListener('beforeunload', () => {
  if (disconnectStream) {
    disconnectStream();
  }
});
