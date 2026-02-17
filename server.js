const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const PORT = Number.parseInt(process.env.PORT ?? '3100', 10);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');

const JSON_LIMIT_BYTES = 3_000_000;
const MAX_EVENTS = 240;
const MAX_SHOUTOUTS = 300;
const SSE_HEARTBEAT_MS = 20_000;
const VERIFIED_STREAK_THRESHOLD = 20;
const STUDENT_CODE_LENGTH = 5;
const STUDENT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg'
};

const DEFAULT_POSITIVE_SKILLS = [
  { id: 'pos_teamwork', label: 'Teamwork', points: 1, icon: 'TW' },
  { id: 'pos_prepared', label: 'Prepared', points: 1, icon: 'PR' },
  { id: 'pos_participation', label: 'Participation', points: 1, icon: 'PA' },
  { id: 'pos_focus', label: 'On Task', points: 1, icon: 'FT' },
  { id: 'pos_kindness', label: 'Kindness', points: 1, icon: 'KD' },
  { id: 'pos_leadership', label: 'Leadership', points: 2, icon: 'LD' }
];

const DEFAULT_NEGATIVE_SKILLS = [
  { id: 'neg_off_task', label: 'Off Task', points: -1, icon: 'OT' },
  { id: 'neg_disruption', label: 'Disruptive', points: -1, icon: 'DP' },
  { id: 'neg_late_work', label: 'Late Work', points: -1, icon: 'LW' },
  { id: 'neg_unprepared', label: 'Not Prepared', points: -1, icon: 'NP' },
  { id: 'neg_unsafe', label: 'Unsafe Choice', points: -2, icon: 'US' }
];

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function dayKeyToDate(dayKey) {
  const parsed = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  return parsed;
}

function addDays(dayKey, amount) {
  const base = dayKeyToDate(dayKey);
  if (!base) {
    return dayKey;
  }
  base.setUTCDate(base.getUTCDate() + amount);
  return todayKey(base);
}

function diffDays(fromDayKey, toDayKey) {
  const from = dayKeyToDate(fromDayKey);
  const to = dayKeyToDate(toDayKey);
  if (!from || !to) {
    return 0;
  }
  return Math.round((to.valueOf() - from.valueOf()) / 86_400_000);
}

function isSchoolDay(dayKey) {
  const date = dayKeyToDate(dayKey);
  if (!date) {
    return false;
  }
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function getWeekStart(dayKey, weekStartDay = 1) {
  const date = dayKeyToDate(dayKey);
  if (!date) {
    return dayKey;
  }
  const dayOfWeek = date.getUTCDay();
  const delta = (dayOfWeek - weekStartDay + 7) % 7;
  date.setUTCDate(date.getUTCDate() - delta);
  return todayKey(date);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLength);
}

function normalizeAccessCode(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const sanitized = value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, STUDENT_CODE_LENGTH);
  if (!new RegExp(`^[A-Z]{${STUDENT_CODE_LENGTH}}$`).test(sanitized)) {
    return '';
  }
  return sanitized;
}

function generateAccessCode(usedCodes = new Set()) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    let code = '';
    for (let index = 0; index < STUDENT_CODE_LENGTH; index += 1) {
      const randomIndex = crypto.randomInt(0, STUDENT_CODE_ALPHABET.length);
      code += STUDENT_CODE_ALPHABET[randomIndex];
    }
    if (!usedCodes.has(code)) {
      return code;
    }
  }
  return crypto.randomUUID().replace(/[^A-Z]/g, '').slice(0, STUDENT_CODE_LENGTH).padEnd(STUDENT_CODE_LENGTH, 'X');
}

function ensureUniqueAccessCodes(students) {
  const usedCodes = new Set();
  for (const student of students) {
    const candidate = normalizeAccessCode(student.accessCode);
    if (candidate && !usedCodes.has(candidate)) {
      student.accessCode = candidate;
      usedCodes.add(candidate);
      continue;
    }
    const generated = generateAccessCode(usedCodes);
    student.accessCode = generated;
    usedCodes.add(generated);
  }
}

function safeId(value, prefix) {
  if (typeof value === 'string' && /^[a-zA-Z0-9_-]{3,140}$/.test(value)) {
    return value;
  }
  return `${prefix}_${crypto.randomUUID()}`;
}

function safePhoto(value) {
  if (typeof value !== 'string') {
    return '';
  }
  if (!value.startsWith('data:image/')) {
    return '';
  }
  if (value.length > 2_500_000) {
    return '';
  }
  return value;
}

function safeModelPath(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim();
  if (!normalized.startsWith('/models/')) {
    return '';
  }
  if (!/^[a-zA-Z0-9/_\-\.]+\.glb$/.test(normalized)) {
    return '';
  }
  if (normalized.includes('..')) {
    return '';
  }
  return normalized;
}

function toInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeIcon(value, fallback = 'NA') {
  const icon = cleanText(value, 6);
  if (!icon) {
    return fallback;
  }
  return icon.toUpperCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function defaultRewardsTrack() {
  return [
    { id: 'rw_1', xpRequired: 60, title: 'Starter', badge: 'starter' },
    { id: 'rw_2', xpRequired: 180, title: 'Consistent', badge: 'consistent' },
    { id: 'rw_3', xpRequired: 360, title: 'Momentum', badge: 'momentum' },
    { id: 'rw_4', xpRequired: 540, title: 'All-Star', badge: 'all_star' }
  ];
}

function defaultGamification() {
  const start = todayKey();
  const lengthDays = 42;
  const end = addDays(start, lengthDays - 1);
  return {
    season: {
      id: `season_${start.replaceAll('-', '')}`,
      name: 'Season 1',
      startDate: start,
      endDate: end,
      lengthDays,
      isActive: true
    },
    xpRules: {
      xpPerPositivePoint: 10,
      xpPerNegativePoint: 0,
      levelThresholds: [0, 50, 120, 210, 320, 450, 600]
    },
    streakRules: {
      freezeDefaultPerSeason: 1,
      freezeStoreCost: 25,
      schoolDaysOnly: true
    },
    leaderboard: {
      defaultMode: 'top',
      currentMode: 'top',
      focusStudentId: '',
      weekStartDay: 1
    },
    rewardsTrack: defaultRewardsTrack()
  };
}

function defaultViewSettings() {
  return {
    display: {
      showHeader: true,
      showConnectionStatus: true,
      showThemeToggle: true,
      showSoundToggle: true,
      showClassPoints: true,
      showRecentActivity: true,
      showStoreItems: true,
      showLeaderboardTopPoints: true,
      showLeaderboardMovement: true,
      showLeaderboardStreak: true,
      showLeaderboardLevel: true,
      showFooterNav: true,
      showEventOverlay: true
    },
    student: {
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
    }
  };
}

function normalizeViewSettings(rawViewSettings) {
  const defaults = defaultViewSettings();
  const normalized = {
    display: {},
    student: {}
  };
  for (const scope of ['display', 'student']) {
    const input = rawViewSettings?.[scope];
    for (const [key, fallback] of Object.entries(defaults[scope])) {
      normalized[scope][key] = typeof input?.[key] === 'boolean' ? input[key] : fallback;
    }
  }
  return normalized;
}

function createDefaultStudent(name = '') {
  return {
    id: `stu_${crypto.randomUUID()}`,
    name,
    accessCode: generateAccessCode(),
    photo: '',
    avatarModel: '',
    points: 0,
    xpTotal: 0,
    seasonXp: 0,
    level: 1,
    streakCurrent: 0,
    streakBest: 0,
    streakLastActiveDate: '',
    streakFreezes: 1,
    badges: [],
    weeklyDelta: 0,
    verifiedStatus: false,
    createdAt: new Date().toISOString()
  };
}

function createDefaultState() {
  const gamification = defaultGamification();
  return {
    className: "Brooke's Classroom",
    viewSettings: defaultViewSettings(),
    students: [],
    skills: {
      positive: [...DEFAULT_POSITIVE_SKILLS],
      negative: [...DEFAULT_NEGATIVE_SKILLS]
    },
    storeItems: [
      {
        id: `item_${crypto.randomUUID()}`,
        name: 'Streak Freeze',
        type: 'streak_freeze',
        cost: gamification.streakRules.freezeStoreCost,
        stock: 999,
        freezeAmount: 1
      }
    ],
    events: [],
    shoutouts: [],
    seasonHistory: [],
    gamification,
    updatedAt: new Date().toISOString()
  };
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeSkill(rawSkill, type) {
  if (!rawSkill || typeof rawSkill !== 'object') {
    return null;
  }
  const label = cleanText(rawSkill.label, 36);
  if (!label) {
    return null;
  }
  let points = toInteger(rawSkill.points, type === 'positive' ? 1 : -1);
  points = clamp(points, -10, 10);
  if (type === 'positive' && points < 1) {
    points = 1;
  }
  if (type === 'negative' && points > -1) {
    points = -1;
  }
  return {
    id: safeId(rawSkill.id, type === 'positive' ? 'pos' : 'neg'),
    label,
    icon: normalizeIcon(rawSkill.icon, label.slice(0, 2)),
    points
  };
}

function normalizeStudent(rawStudent, defaults) {
  if (!rawStudent || typeof rawStudent !== 'object') {
    return null;
  }
  const name = cleanText(rawStudent.name, 48);
  if (!name) {
    return null;
  }

  const freezeDefault = defaults?.streakRules?.freezeDefaultPerSeason ?? 1;
  const base = createDefaultStudent(name);
  base.id = safeId(rawStudent.id, 'stu');
  base.accessCode = normalizeAccessCode(rawStudent.accessCode) || base.accessCode;
  base.photo = safePhoto(rawStudent.photo);
  base.avatarModel = safeModelPath(rawStudent.avatarModel);
  base.points = toInteger(rawStudent.points, 0);
  base.xpTotal = Math.max(0, toInteger(rawStudent.xpTotal, 0));
  base.seasonXp = Math.max(0, toInteger(rawStudent.seasonXp, base.xpTotal));
  base.level = Math.max(1, toInteger(rawStudent.level, 1));
  base.streakCurrent = Math.max(0, toInteger(rawStudent.streakCurrent, 0));
  base.streakBest = Math.max(base.streakCurrent, toInteger(rawStudent.streakBest, base.streakCurrent));
  base.streakLastActiveDate = cleanText(rawStudent.streakLastActiveDate, 20);
  base.streakFreezes = Math.max(0, toInteger(rawStudent.streakFreezes, freezeDefault));
  base.badges = Array.isArray(rawStudent.badges)
    ? rawStudent.badges.map((badge) => cleanText(String(badge), 80)).filter(Boolean)
    : [];
  base.weeklyDelta = toInteger(rawStudent.weeklyDelta, 0);
  base.verifiedStatus = Boolean(rawStudent.verifiedStatus || base.streakCurrent >= VERIFIED_STREAK_THRESHOLD);
  base.createdAt = typeof rawStudent.createdAt === 'string' ? rawStudent.createdAt : new Date().toISOString();

  return base;
}

function normalizeStoreItem(rawItem, freezeCost) {
  if (!rawItem || typeof rawItem !== 'object') {
    return null;
  }
  const name = cleanText(rawItem.name, 48);
  if (!name) {
    return null;
  }
  const type = rawItem.type === 'streak_freeze' ? 'streak_freeze' : 'standard';
  const cost = Math.max(1, toInteger(rawItem.cost, type === 'streak_freeze' ? freezeCost : 1));
  const stock = Math.max(0, toInteger(rawItem.stock, 0));
  const freezeAmount = Math.max(1, toInteger(rawItem.freezeAmount, 1));
  return {
    id: safeId(rawItem.id, 'item'),
    name,
    type,
    cost,
    stock,
    freezeAmount
  };
}

function normalizeEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }
  const type = cleanText(rawEvent.type || rawEvent.kind, 24) || 'points';
  return {
    id: safeId(rawEvent.id, 'evt'),
    studentId: cleanText(rawEvent.studentId, 120) || 'class',
    delta: toInteger(rawEvent.delta, 0),
    reason: cleanText(rawEvent.reason, 100) || 'Activity',
    type,
    kind: type,
    timestamp: typeof rawEvent.timestamp === 'string' ? rawEvent.timestamp : new Date().toISOString(),
    meta: rawEvent.meta && typeof rawEvent.meta === 'object' ? rawEvent.meta : {}
  };
}

function normalizeShoutout(rawShoutout) {
  if (!rawShoutout || typeof rawShoutout !== 'object') {
    return null;
  }
  const fromStudentId = cleanText(rawShoutout.fromStudentId, 120);
  const toStudentId = cleanText(rawShoutout.toStudentId, 120);
  const message = cleanText(rawShoutout.message, 240);
  if (!fromStudentId || !toStudentId || !message) {
    return null;
  }
  const status = ['pending', 'approved', 'archived'].includes(rawShoutout.status) ? rawShoutout.status : 'pending';
  const createdAt = typeof rawShoutout.createdAt === 'string' ? rawShoutout.createdAt : new Date().toISOString();
  return {
    id: safeId(rawShoutout.id, 'shout'),
    fromStudentId,
    toStudentId,
    message,
    status,
    createdAt,
    updatedAt: typeof rawShoutout.updatedAt === 'string' ? rawShoutout.updatedAt : createdAt,
    reviewedAt: typeof rawShoutout.reviewedAt === 'string' ? rawShoutout.reviewedAt : '',
    reviewedBy: cleanText(rawShoutout.reviewedBy, 40)
  };
}

function normalizeSeason(rawSeason) {
  const defaults = defaultGamification().season;
  const startDate = cleanText(rawSeason?.startDate, 20) || defaults.startDate;
  const lengthDays = Math.max(7, toInteger(rawSeason?.lengthDays, defaults.lengthDays));
  const endDate = cleanText(rawSeason?.endDate, 20) || addDays(startDate, lengthDays - 1);
  return {
    id: safeId(rawSeason?.id, 'season'),
    name: cleanText(rawSeason?.name, 48) || defaults.name,
    startDate,
    endDate,
    lengthDays,
    isActive: rawSeason?.isActive !== false
  };
}

function normalizeGamification(rawGamification) {
  const defaults = defaultGamification();
  const season = normalizeSeason(rawGamification?.season);
  const xpRules = {
    xpPerPositivePoint: Math.max(0, toInteger(rawGamification?.xpRules?.xpPerPositivePoint, defaults.xpRules.xpPerPositivePoint)),
    xpPerNegativePoint: Math.max(0, toInteger(rawGamification?.xpRules?.xpPerNegativePoint, defaults.xpRules.xpPerNegativePoint)),
    levelThresholds: Array.isArray(rawGamification?.xpRules?.levelThresholds)
      ? rawGamification.xpRules.levelThresholds
          .map((entry) => Math.max(0, toInteger(entry, 0)))
          .filter((entry, index, arr) => (index === 0 ? true : entry >= arr[index - 1]))
      : [...defaults.xpRules.levelThresholds]
  };
  if (xpRules.levelThresholds.length === 0 || xpRules.levelThresholds[0] !== 0) {
    xpRules.levelThresholds.unshift(0);
  }

  const streakRules = {
    freezeDefaultPerSeason: Math.max(0, toInteger(rawGamification?.streakRules?.freezeDefaultPerSeason, defaults.streakRules.freezeDefaultPerSeason)),
    freezeStoreCost: Math.max(1, toInteger(rawGamification?.streakRules?.freezeStoreCost, defaults.streakRules.freezeStoreCost)),
    schoolDaysOnly: rawGamification?.streakRules?.schoolDaysOnly !== false
  };

  const leaderboard = {
    defaultMode: ['top', 'relative', 'movement'].includes(rawGamification?.leaderboard?.defaultMode)
      ? rawGamification.leaderboard.defaultMode
      : defaults.leaderboard.defaultMode,
    currentMode: ['top', 'relative', 'movement'].includes(rawGamification?.leaderboard?.currentMode)
      ? rawGamification.leaderboard.currentMode
      : ['top', 'relative', 'movement'].includes(rawGamification?.leaderboard?.defaultMode)
      ? rawGamification.leaderboard.defaultMode
      : defaults.leaderboard.currentMode,
    focusStudentId: cleanText(rawGamification?.leaderboard?.focusStudentId, 120),
    weekStartDay: clamp(toInteger(rawGamification?.leaderboard?.weekStartDay, defaults.leaderboard.weekStartDay), 0, 6)
  };

  const rewardsTrack = Array.isArray(rawGamification?.rewardsTrack)
    ? rawGamification.rewardsTrack
        .map((reward, index) => {
          if (!reward || typeof reward !== 'object') {
            return null;
          }
          const xpRequired = Math.max(1, toInteger(reward.xpRequired, 1));
          const title = cleanText(reward.title, 40) || `Reward ${index + 1}`;
          const badge = cleanText(reward.badge, 40) || `reward_${index + 1}`;
          return {
            id: safeId(reward.id, 'rw'),
            xpRequired,
            title,
            badge
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.xpRequired - b.xpRequired)
    : defaultRewardsTrack();

  return {
    season,
    xpRules,
    streakRules,
    leaderboard,
    rewardsTrack: rewardsTrack.length > 0 ? rewardsTrack : defaultRewardsTrack()
  };
}

function levelForXp(totalXp, thresholds) {
  let level = 1;
  for (let index = 0; index < thresholds.length; index += 1) {
    if (totalXp >= thresholds[index]) {
      level = index + 1;
    }
  }
  return level;
}

function recomputeWeeklyDeltas(stateRef, referenceDayKey) {
  const weekStart = getWeekStart(referenceDayKey, stateRef.gamification.leaderboard.weekStartDay);
  const byStudent = new Map();
  for (const student of stateRef.students) {
    byStudent.set(student.id, 0);
  }
  for (const event of stateRef.events) {
    if (!event.studentId || !byStudent.has(event.studentId)) {
      continue;
    }
    const eventDay = cleanText(event.timestamp, 10);
    if (diffDays(weekStart, eventDay) < 0) {
      continue;
    }
    if (event.type === 'points' || event.type === 'redeem') {
      byStudent.set(event.studentId, (byStudent.get(event.studentId) || 0) + event.delta);
    }
  }
  for (const student of stateRef.students) {
    student.weeklyDelta = byStudent.get(student.id) || 0;
  }
}

function normalizeState(rawState) {
  const fallback = createDefaultState();
  if (!rawState || typeof rawState !== 'object') {
    return fallback;
  }
  const className = cleanText(rawState.className, 80) || fallback.className;
  const gamification = normalizeGamification(rawState.gamification);
  const viewSettings = normalizeViewSettings(rawState.viewSettings);

  const positiveSkillsRaw = rawState.skills && Array.isArray(rawState.skills.positive) ? rawState.skills.positive : fallback.skills.positive;
  const negativeSkillsRaw = rawState.skills && Array.isArray(rawState.skills.negative) ? rawState.skills.negative : fallback.skills.negative;

  const skills = {
    positive: positiveSkillsRaw.map((skill) => normalizeSkill(skill, 'positive')).filter(Boolean),
    negative: negativeSkillsRaw.map((skill) => normalizeSkill(skill, 'negative')).filter(Boolean)
  };
  if (skills.positive.length === 0) {
    skills.positive = [...DEFAULT_POSITIVE_SKILLS];
  }
  if (skills.negative.length === 0) {
    skills.negative = [...DEFAULT_NEGATIVE_SKILLS];
  }

  const students = Array.isArray(rawState.students)
    ? rawState.students.map((student) => normalizeStudent(student, gamification)).filter(Boolean)
    : [];
  ensureUniqueAccessCodes(students);

  for (const student of students) {
    student.level = levelForXp(student.xpTotal, gamification.xpRules.levelThresholds);
    student.verifiedStatus = student.streakCurrent >= VERIFIED_STREAK_THRESHOLD;
  }

  const storeItems = Array.isArray(rawState.storeItems)
    ? rawState.storeItems.map((item) => normalizeStoreItem(item, gamification.streakRules.freezeStoreCost)).filter(Boolean)
    : [];
  if (!storeItems.some((item) => item.type === 'streak_freeze')) {
    storeItems.push({
      id: `item_${crypto.randomUUID()}`,
      name: 'Streak Freeze',
      type: 'streak_freeze',
      cost: gamification.streakRules.freezeStoreCost,
      stock: 999,
      freezeAmount: 1
    });
  }

  const events = Array.isArray(rawState.events)
    ? rawState.events.map(normalizeEvent).filter(Boolean).slice(0, MAX_EVENTS)
    : [];

  const shoutouts = Array.isArray(rawState.shoutouts)
    ? rawState.shoutouts.map(normalizeShoutout).filter(Boolean).slice(0, MAX_SHOUTOUTS)
    : [];

  const seasonHistory = Array.isArray(rawState.seasonHistory)
    ? rawState.seasonHistory
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          return {
            seasonId: safeId(entry.seasonId || entry.id, 'season_hist'),
            name: cleanText(entry.name, 48) || 'Archived Season',
            closedAt: cleanText(entry.closedAt, 40) || new Date().toISOString(),
            snapshot: Array.isArray(entry.snapshot)
              ? entry.snapshot.map((row) => ({
                  studentId: cleanText(row.studentId, 120),
                  seasonXp: Math.max(0, toInteger(row.seasonXp, 0)),
                  level: Math.max(1, toInteger(row.level, 1))
                }))
              : []
          };
        })
        .filter(Boolean)
    : [];

  const normalized = {
    className,
    viewSettings,
    students,
    skills,
    storeItems,
    events,
    shoutouts,
    seasonHistory,
    gamification,
    updatedAt: typeof rawState.updatedAt === 'string' ? rawState.updatedAt : new Date().toISOString()
  };

  recomputeWeeklyDeltas(normalized, todayKey());
  return normalized;
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_PATH)) {
    const initial = createDefaultState();
    fs.writeFileSync(STATE_PATH, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
    return initial;
  }
  try {
    const content = fs.readFileSync(STATE_PATH, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(content);
    const normalized = normalizeState(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      fs.writeFileSync(STATE_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    }
    return normalized;
  } catch (error) {
    console.error('[state] failed to parse, resetting:', error.message);
    const fallback = createDefaultState();
    fs.writeFileSync(STATE_PATH, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
    return fallback;
  }
}

function cloneState() {
  return JSON.parse(JSON.stringify(state));
}

let state = loadState();
let saveQueue = Promise.resolve();
const clients = new Set();
const studentClients = new Set();

function queueSave() {
  state.updatedAt = new Date().toISOString();
  const snapshot = `${JSON.stringify(state, null, 2)}\n`;
  saveQueue = saveQueue
    .then(() => fsp.writeFile(STATE_PATH, snapshot, 'utf8'))
    .catch((error) => {
      console.error('[state] failed to save:', error.message);
    });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    let failed = false;

    req.on('data', (chunk) => {
      if (failed) {
        return;
      }
      received += chunk.length;
      if (received > JSON_LIMIT_BYTES) {
        failed = true;
        const error = new Error('Request body too large.');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (failed) {
        return;
      }
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const error = new Error('Invalid JSON payload.');
          error.statusCode = 400;
          reject(error);
          return;
        }
        resolve(parsed);
      } catch {
        const error = new Error('Invalid JSON payload.');
        error.statusCode = 400;
        reject(error);
      }
    });

    req.on('error', (error) => {
      if (!failed) {
        reject(error);
      }
    });
  });
}

function extractId(pathname, prefix) {
  return cleanText(pathname.slice(prefix.length), 120);
}

function findStudent(studentId) {
  return state.students.find((student) => student.id === studentId);
}

function findStudentByAccessCode(accessCode) {
  const normalized = normalizeAccessCode(accessCode);
  if (!normalized) {
    return null;
  }
  return state.students.find((student) => student.accessCode === normalized) || null;
}

function findStoreItem(itemId) {
  return state.storeItems.find((item) => item.id === itemId);
}

function findShoutout(shoutoutId) {
  return state.shoutouts.find((entry) => entry.id === shoutoutId);
}

function sortedByPoints(students) {
  return [...students].sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    return a.name.localeCompare(b.name);
  });
}

function sortedByMovement(students) {
  return [...students].sort((a, b) => {
    if (b.weeklyDelta !== a.weeklyDelta) {
      return b.weeklyDelta - a.weeklyDelta;
    }
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    return a.name.localeCompare(b.name);
  });
}

function serializeStudent(student) {
  return {
    id: student.id,
    name: student.name,
    photo: student.photo,
    avatarModel: student.avatarModel,
    points: student.points,
    xpTotal: student.xpTotal,
    seasonXp: student.seasonXp,
    level: student.level,
    streakCurrent: student.streakCurrent,
    streakBest: student.streakBest,
    streakLastActiveDate: student.streakLastActiveDate,
    streakFreezes: student.streakFreezes,
    badges: student.badges,
    weeklyDelta: student.weeklyDelta,
    verifiedStatus: student.verifiedStatus
  };
}

function serializeClassmate(student) {
  return {
    id: student.id,
    name: student.name,
    points: student.points,
    level: student.level,
    photo: student.photo,
    avatarModel: student.avatarModel
  };
}

function serializeShoutout(shoutout) {
  return {
    id: shoutout.id,
    fromStudentId: shoutout.fromStudentId,
    toStudentId: shoutout.toStudentId,
    message: shoutout.message,
    status: shoutout.status,
    createdAt: shoutout.createdAt,
    updatedAt: shoutout.updatedAt,
    reviewedAt: shoutout.reviewedAt,
    reviewedBy: shoutout.reviewedBy
  };
}

function buildStudentViewState(studentId) {
  const student = findStudent(studentId);
  if (!student) {
    return null;
  }
  const classmates = state.students.map(serializeClassmate);
  const ranked = sortedByPoints(state.students);
  const rankIndex = ranked.findIndex((entry) => entry.id === student.id);
  const rank = rankIndex === -1 ? 0 : rankIndex + 1;
  const events = state.events.filter((event) => event.studentId === student.id).slice(0, 30);
  const shoutouts = state.shoutouts
    .filter((entry) => entry.fromStudentId === student.id || entry.toStudentId === student.id)
    .slice(0, 30)
    .map(serializeShoutout);
  return {
    className: state.className,
    viewSettings: state.viewSettings,
    viewer: serializeStudent(student),
    classmates,
    rank,
    events,
    shoutouts,
    updatedAt: state.updatedAt
  };
}

function eventRelevantForStudent(event, studentId) {
  if (!event) {
    return false;
  }
  if (event.studentId === 'class' || event.studentId === studentId) {
    return true;
  }
  const fromStudentId = cleanText(event.meta?.fromStudentId, 120);
  const toStudentId = cleanText(event.meta?.toStudentId, 120);
  return fromStudentId === studentId || toStudentId === studentId;
}
function buildLeaderboard(mode, focusStudentId) {
  if (mode === 'movement') {
    return {
      mode,
      focusStudentId: '',
      students: sortedByMovement(state.students).slice(0, 12).map(serializeStudent)
    };
  }
  if (mode === 'relative') {
    const ranked = sortedByPoints(state.students);
    const index = ranked.findIndex((student) => student.id === focusStudentId);
    if (index === -1) {
      return {
        mode,
        focusStudentId: '',
        students: ranked.slice(0, 5).map(serializeStudent)
      };
    }
    const start = Math.max(0, index - 2);
    const end = Math.min(ranked.length, index + 3);
    return {
      mode,
      focusStudentId,
      students: ranked.slice(start, end).map(serializeStudent)
    };
  }
  return {
    mode: 'top',
    focusStudentId: '',
    students: sortedByPoints(state.students).slice(0, 12).map(serializeStudent)
  };
}

function pushEvent(event) {
  state.events.unshift(event);
  state.events = state.events.slice(0, MAX_EVENTS);
}

function createEvent({ studentId = 'class', delta = 0, reason, type, meta = {} }) {
  const event = {
    id: `evt_${crypto.randomUUID()}`,
    studentId,
    delta,
    reason: cleanText(reason, 100) || 'Activity',
    type,
    kind: type,
    timestamp: new Date().toISOString(),
    meta
  };
  pushEvent(event);
  return event;
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitState(reason, event = null, extra = {}) {
  const payload = {
    reason,
    timestamp: new Date().toISOString(),
    state: cloneState(),
    event,
    eventType: event?.type || extra.eventType || '',
    soundCue: extra.soundCue || event?.meta?.soundCue || '',
    highlightMode: extra.highlightMode || event?.meta?.highlightMode || 'none',
    affectedStudentIds: extra.affectedStudentIds || (event?.studentId && event.studentId !== 'class' ? [event.studentId] : []),
    leaderboardMode: state.gamification.leaderboard.currentMode
  };
  if (event && (event.type === 'points' || event.type === 'redeem')) {
    payload.pointEvent = event;
  }
  for (const client of [...clients]) {
    try {
      writeSse(client, 'state', payload);
    } catch {
      clients.delete(client);
      try {
        client.end();
      } catch {}
    }
  }
  emitStudentState(reason, event, extra);
}

function markVerified(student) {
  student.verifiedStatus = student.streakCurrent >= VERIFIED_STREAK_THRESHOLD;
}

function rewardsEarnedThisSeason(student) {
  const earned = [];
  for (const reward of state.gamification.rewardsTrack) {
    if (student.seasonXp >= reward.xpRequired && !student.badges.includes(reward.badge)) {
      student.badges.push(reward.badge);
      earned.push(reward);
    }
  }
  return earned;
}

function applyActivityStreak(student, dayKey) {
  const rules = state.gamification.streakRules;
  const shouldTrack = rules.schoolDaysOnly ? isSchoolDay(dayKey) : true;
  if (!shouldTrack) {
    return { changed: false, consumed: 0, reset: false };
  }
  if (student.streakLastActiveDate === dayKey) {
    return { changed: false, consumed: 0, reset: false };
  }

  let consumed = 0;
  let reset = false;
  if (student.streakLastActiveDate) {
    const gapDays = diffDays(student.streakLastActiveDate, dayKey);
    if (gapDays > 1) {
      let missing = 0;
      for (let offset = 1; offset < gapDays; offset += 1) {
        const intermediate = addDays(student.streakLastActiveDate, offset);
        if (!rules.schoolDaysOnly || isSchoolDay(intermediate)) {
          missing += 1;
        }
      }
      if (missing > 0) {
        consumed = Math.min(missing, student.streakFreezes);
        student.streakFreezes -= consumed;
        if (consumed < missing) {
          student.streakCurrent = 0;
          reset = true;
        }
      }
    }
  }
  student.streakCurrent += 1;
  student.streakBest = Math.max(student.streakBest, student.streakCurrent);
  student.streakLastActiveDate = dayKey;
  markVerified(student);
  return { changed: true, consumed, reset };
}

function emitStudentState(reason, event = null, extra = {}) {
  for (const clientEntry of [...studentClients]) {
    const studentState = buildStudentViewState(clientEntry.studentId);
    if (!studentState) {
      studentClients.delete(clientEntry);
      try {
        clientEntry.res.end();
      } catch {}
      continue;
    }
    const visibleEvent = eventRelevantForStudent(event, clientEntry.studentId) ? event : null;
    const payload = {
      reason,
      timestamp: new Date().toISOString(),
      state: studentState,
      event: visibleEvent,
      eventType: visibleEvent?.type || extra.eventType || '',
      soundCue: visibleEvent ? extra.soundCue || visibleEvent?.meta?.soundCue || '' : '',
      highlightMode: visibleEvent ? extra.highlightMode || visibleEvent?.meta?.highlightMode || 'none' : 'none',
      affectedStudentIds: extra.affectedStudentIds || (visibleEvent?.studentId ? [visibleEvent.studentId] : []),
      leaderboardMode: state.gamification.leaderboard.currentMode
    };
    try {
      writeSse(clientEntry.res, 'state', payload);
    } catch {
      studentClients.delete(clientEntry);
      try {
        clientEntry.res.end();
      } catch {}
    }
  }
}

function processMissedDayForStudent(student, dayKey) {
  const rules = state.gamification.streakRules;
  if (rules.schoolDaysOnly && !isSchoolDay(dayKey)) {
    return { changed: false, consumed: false, reset: false };
  }
  if (student.streakLastActiveDate === dayKey) {
    return { changed: false, consumed: false, reset: false };
  }
  if (student.streakCurrent <= 0) {
    return { changed: false, consumed: false, reset: false };
  }
  if (student.streakFreezes > 0) {
    student.streakFreezes -= 1;
    markVerified(student);
    return { changed: true, consumed: true, reset: false };
  }
  student.streakCurrent = 0;
  markVerified(student);
  return { changed: true, consumed: false, reset: true };
}

function applyXpAndProgression(student, delta) {
  const rules = state.gamification.xpRules;
  const xpGain = delta > 0 ? delta * rules.xpPerPositivePoint : Math.abs(delta) * rules.xpPerNegativePoint;
  const safeXpGain = Math.max(0, xpGain);
  const prevLevel = student.level;
  student.xpTotal += safeXpGain;
  student.seasonXp += safeXpGain;
  student.level = levelForXp(student.xpTotal, rules.levelThresholds);
  return {
    xpGain: safeXpGain,
    prevLevel,
    newLevel: student.level,
    leveledUp: student.level > prevLevel
  };
}

function rolloverSeason({ name, startDate, lengthDays }) {
  const seasonName = cleanText(name, 48) || `Season ${state.seasonHistory.length + 1}`;
  const start = cleanText(startDate, 20) || todayKey();
  const days = Math.max(7, toInteger(lengthDays, 42));
  const end = addDays(start, days - 1);

  if (state.gamification.season?.id) {
    state.seasonHistory.unshift({
      seasonId: state.gamification.season.id,
      name: state.gamification.season.name,
      closedAt: new Date().toISOString(),
      snapshot: state.students.map((student) => ({
        studentId: student.id,
        seasonXp: student.seasonXp,
        level: student.level
      }))
    });
    state.seasonHistory = state.seasonHistory.slice(0, 20);
  }

  state.gamification.season = {
    id: `season_${start.replaceAll('-', '')}_${crypto.randomUUID().slice(0, 6)}`,
    name: seasonName,
    startDate: start,
    endDate: end,
    lengthDays: days,
    isActive: true
  };

  for (const student of state.students) {
    student.seasonXp = 0;
    student.streakFreezes = state.gamification.streakRules.freezeDefaultPerSeason;
    student.weeklyDelta = 0;
  }
}

function closeSeason() {
  if (!state.gamification.season.isActive) {
    return false;
  }
  state.gamification.season.isActive = false;
  state.seasonHistory.unshift({
    seasonId: state.gamification.season.id,
    name: state.gamification.season.name,
    closedAt: new Date().toISOString(),
    snapshot: state.students.map((student) => ({
      studentId: student.id,
      seasonXp: student.seasonXp,
      level: student.level
    }))
  });
  state.seasonHistory = state.seasonHistory.slice(0, 20);
  for (const student of state.students) {
    student.seasonXp = 0;
    student.weeklyDelta = 0;
  }
  return true;
}

async function handleApi(req, res, pathname, requestUrl) {
  if (req.method === 'GET' && pathname === '/api/state') {
    sendJson(res, 200, { state: cloneState() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    clients.add(res);
    writeSse(res, 'state', {
      reason: 'initial',
      timestamp: new Date().toISOString(),
      state: cloneState(),
      leaderboardMode: state.gamification.leaderboard.currentMode,
      eventType: ''
    });
    req.on('close', () => {
      clients.delete(res);
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/student/state') {
    const code = normalizeAccessCode(requestUrl.searchParams.get('code') || '');
    if (!code) {
      sendJson(res, 400, { error: 'A valid 5-letter code is required.' });
      return;
    }
    const student = findStudentByAccessCode(code);
    if (!student) {
      sendJson(res, 404, { error: 'Access code not found.' });
      return;
    }
    const studentState = buildStudentViewState(student.id);
    sendJson(res, 200, { state: studentState });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/student/access') {
    const body = await parseBody(req);
    const code = normalizeAccessCode(body.code);
    if (!code) {
      sendJson(res, 400, { error: 'A valid 5-letter code is required.' });
      return;
    }
    const student = findStudentByAccessCode(code);
    if (!student) {
      sendJson(res, 404, { error: 'Access code not found.' });
      return;
    }
    sendJson(res, 200, {
      student: {
        id: student.id,
        name: student.name,
        accessCode: student.accessCode
      },
      profileUrl: `/student?code=${encodeURIComponent(student.accessCode)}`
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/student/events') {
    const code = normalizeAccessCode(requestUrl.searchParams.get('code') || '');
    if (!code) {
      sendJson(res, 400, { error: 'A valid 5-letter code is required.' });
      return;
    }
    const student = findStudentByAccessCode(code);
    if (!student) {
      sendJson(res, 404, { error: 'Access code not found.' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    const entry = { res, studentId: student.id };
    studentClients.add(entry);
    writeSse(res, 'state', {
      reason: 'initial',
      timestamp: new Date().toISOString(),
      state: buildStudentViewState(student.id),
      eventType: ''
    });
    req.on('close', () => {
      studentClients.delete(entry);
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/shoutouts') {
    const filterStatus = ['pending', 'approved', 'archived'].includes(requestUrl.searchParams.get('status'))
      ? requestUrl.searchParams.get('status')
      : '';
    const list = (state.shoutouts || [])
      .filter((entry) => (filterStatus ? entry.status === filterStatus : true))
      .map(serializeShoutout);
    sendJson(res, 200, { shoutouts: list });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shoutouts') {
    const body = await parseBody(req);
    const accessCode = normalizeAccessCode(body.accessCode);
    const toStudentId = cleanText(body.toStudentId, 120);
    const message = cleanText(body.message, 240);
    const fromStudent = findStudentByAccessCode(accessCode);
    if (!fromStudent) {
      sendJson(res, 400, { error: 'Valid student access code is required.' });
      return;
    }
    if (!toStudentId) {
      sendJson(res, 400, { error: 'toStudentId is required.' });
      return;
    }
    if (!message || message.length < 4) {
      sendJson(res, 400, { error: 'Shoutout reason must be at least 4 characters.' });
      return;
    }
    if (toStudentId === fromStudent.id) {
      sendJson(res, 400, { error: 'You cannot shout out yourself.' });
      return;
    }
    const toStudent = findStudent(toStudentId);
    if (!toStudent) {
      sendJson(res, 404, { error: 'Target student not found.' });
      return;
    }
    const shoutout = {
      id: `shout_${crypto.randomUUID()}`,
      fromStudentId: fromStudent.id,
      toStudentId: toStudent.id,
      message,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reviewedAt: '',
      reviewedBy: ''
    };
    state.shoutouts.unshift(shoutout);
    state.shoutouts = state.shoutouts.slice(0, MAX_SHOUTOUTS);
    queueSave();
    emitState('shoutout-submitted', null, {
      eventType: 'shoutout_submitted',
      affectedStudentIds: [fromStudent.id, toStudent.id]
    });
    sendJson(res, 201, { shoutout: serializeShoutout(shoutout) });
    return;
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/shoutouts/')) {
    const shoutoutId = extractId(pathname, '/api/shoutouts/');
    const shoutout = findShoutout(shoutoutId);
    if (!shoutout) {
      sendJson(res, 404, { error: 'Shoutout not found.' });
      return;
    }
    const body = await parseBody(req);
    const action = body.action === 'approve' || body.action === 'archive' ? body.action : '';
    if (!action) {
      sendJson(res, 400, { error: 'action must be approve or archive.' });
      return;
    }

    let event = null;
    if (action === 'approve') {
      shoutout.status = 'approved';
      shoutout.updatedAt = new Date().toISOString();
      shoutout.reviewedAt = new Date().toISOString();
      shoutout.reviewedBy = 'teacher';
      const fromStudent = findStudent(shoutout.fromStudentId);
      const fromName = fromStudent?.name || 'Classmate';
      event = createEvent({
        studentId: shoutout.toStudentId,
        delta: 0,
        reason: `Shoutout from ${fromName}: ${shoutout.message}`,
        type: 'shoutout',
        meta: {
          eventType: 'shoutout',
          fromStudentId: shoutout.fromStudentId,
          toStudentId: shoutout.toStudentId,
          soundCue: 'badge',
          highlightMode: 'badge'
        }
      });
    } else {
      shoutout.status = 'archived';
      shoutout.updatedAt = new Date().toISOString();
      shoutout.reviewedAt = new Date().toISOString();
      shoutout.reviewedBy = 'teacher';
    }

    queueSave();
    emitState('shoutout-updated', event, {
      eventType: 'shoutout',
      affectedStudentIds: [shoutout.fromStudentId, shoutout.toStudentId]
    });
    sendJson(res, 200, { shoutout: serializeShoutout(shoutout), event });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/shoutouts/')) {
    const shoutoutId = extractId(pathname, '/api/shoutouts/');
    const index = state.shoutouts.findIndex((entry) => entry.id === shoutoutId);
    if (index === -1) {
      sendJson(res, 404, { error: 'Shoutout not found.' });
      return;
    }
    const [removed] = state.shoutouts.splice(index, 1);
    queueSave();
    emitState('shoutout-deleted', null, {
      eventType: 'shoutout_deleted',
      affectedStudentIds: [removed.fromStudentId, removed.toStudentId]
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    const mode = ['top', 'relative', 'movement'].includes(requestUrl.searchParams.get('mode'))
      ? requestUrl.searchParams.get('mode')
      : state.gamification.leaderboard.currentMode;
    const focusStudentId = cleanText(requestUrl.searchParams.get('studentId'), 120) || state.gamification.leaderboard.focusStudentId;
    sendJson(res, 200, {
      leaderboard: buildLeaderboard(mode, focusStudentId),
      generatedAt: new Date().toISOString()
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/leaderboard/mode') {
    const body = await parseBody(req);
    const mode = ['top', 'relative', 'movement'].includes(body.mode) ? body.mode : '';
    if (!mode) {
      sendJson(res, 400, { error: 'mode must be top, relative, or movement.' });
      return;
    }
    const focusStudentId = cleanText(body.studentId, 120);
    state.gamification.leaderboard.currentMode = mode;
    state.gamification.leaderboard.focusStudentId = focusStudentId;
    queueSave();
    emitState('leaderboard-mode-updated', null, {
      eventType: 'leaderboard_mode',
      leaderboardMode: mode,
      affectedStudentIds: focusStudentId ? [focusStudentId] : []
    });
    sendJson(res, 200, {
      leaderboard: buildLeaderboard(mode, focusStudentId)
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/class') {
    const body = await parseBody(req);
    const className = cleanText(body.className, 80);
    if (!className) {
      sendJson(res, 400, { error: 'Class name is required.' });
      return;
    }
    state.className = className;
    queueSave();
    emitState('class-updated');
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/view-settings') {
    const body = await parseBody(req);
    const defaults = defaultViewSettings();
    state.viewSettings = normalizeViewSettings(state.viewSettings);

    if (body?.viewSettings && typeof body.viewSettings === 'object') {
      state.viewSettings = normalizeViewSettings(body.viewSettings);
      queueSave();
      emitState('view-settings-updated', null, { eventType: 'view_settings' });
      sendJson(res, 200, { viewSettings: state.viewSettings });
      return;
    }

    const scope = body?.scope === 'display' || body?.scope === 'student' ? body.scope : '';
    const key = cleanText(body?.key, 80);
    const enabled = body?.enabled;
    if (!scope || !key || typeof enabled !== 'boolean') {
      sendJson(res, 400, { error: 'scope, key, and boolean enabled are required.' });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(defaults[scope], key)) {
      sendJson(res, 400, { error: 'Unknown view setting key.' });
      return;
    }

    state.viewSettings[scope][key] = enabled;
    queueSave();
    emitState('view-settings-updated', null, { eventType: 'view_settings' });
    sendJson(res, 200, { viewSettings: state.viewSettings });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/students') {
    const body = await parseBody(req);
    const name = cleanText(body.name, 48);
    if (!name) {
      sendJson(res, 400, { error: 'Student name is required.' });
      return;
    }
    const student = createDefaultStudent(name);
    student.photo = safePhoto(body.photo);
    student.avatarModel = safeModelPath(body.avatarModel);
    student.streakFreezes = state.gamification.streakRules.freezeDefaultPerSeason;
    const existingCodes = new Set(state.students.map((entry) => normalizeAccessCode(entry.accessCode)).filter(Boolean));
    student.accessCode = generateAccessCode(existingCodes);
    state.students.push(student);
    queueSave();
    emitState('student-added');
    sendJson(res, 201, { student });
    return;
  }

  if (req.method === 'POST' && pathname.endsWith('/access-code/reset') && pathname.startsWith('/api/students/')) {
    const studentId = extractId(pathname.slice(0, -('/access-code/reset'.length)), '/api/students/');
    const student = findStudent(studentId);
    if (!student) {
      sendJson(res, 404, { error: 'Student not found.' });
      return;
    }
    const existingCodes = new Set(
      state.students
        .filter((entry) => entry.id !== student.id)
        .map((entry) => normalizeAccessCode(entry.accessCode))
        .filter(Boolean)
    );
    student.accessCode = generateAccessCode(existingCodes);
    queueSave();
    emitState('student-access-code-reset', null, {
      eventType: 'student_access_code',
      affectedStudentIds: [student.id]
    });
    sendJson(res, 200, {
      studentId: student.id,
      accessCode: student.accessCode,
      profileUrl: `/student?code=${encodeURIComponent(student.accessCode)}`
    });
    return;
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/students/')) {
    const studentId = extractId(pathname, '/api/students/');
    const student = findStudent(studentId);
    if (!student) {
      sendJson(res, 404, { error: 'Student not found.' });
      return;
    }
    const body = await parseBody(req);
    if (body.name !== undefined) {
      const name = cleanText(body.name, 48);
      if (!name) {
        sendJson(res, 400, { error: 'Student name cannot be empty.' });
        return;
      }
      student.name = name;
    }
    if (body.photo !== undefined) {
      student.photo = safePhoto(body.photo);
    }
    if (body.avatarModel !== undefined) {
      student.avatarModel = safeModelPath(body.avatarModel);
    }
    if (body.points !== undefined) {
      student.points = toInteger(body.points, student.points);
    }
    if (body.streakFreezes !== undefined) {
      student.streakFreezes = Math.max(0, toInteger(body.streakFreezes, student.streakFreezes));
    }
    if (body.accessCode !== undefined) {
      const candidate = normalizeAccessCode(body.accessCode);
      if (!candidate) {
        sendJson(res, 400, { error: 'accessCode must be exactly 5 letters.' });
        return;
      }
      const duplicate = state.students.find((entry) => entry.id !== student.id && entry.accessCode === candidate);
      if (duplicate) {
        sendJson(res, 400, { error: 'accessCode already in use.' });
        return;
      }
      student.accessCode = candidate;
    }
    queueSave();
    emitState('student-updated');
    sendJson(res, 200, { student });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/students/')) {
    const studentId = extractId(pathname, '/api/students/');
    const index = state.students.findIndex((student) => student.id === studentId);
    if (index === -1) {
      sendJson(res, 404, { error: 'Student not found.' });
      return;
    }
    state.students.splice(index, 1);
    state.shoutouts = state.shoutouts.filter((entry) => entry.fromStudentId !== studentId && entry.toStudentId !== studentId);
    queueSave();
    emitState('student-removed');
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname.endsWith('/streak/checkin') && pathname.startsWith('/api/students/')) {
    const studentId = extractId(pathname.slice(0, -('/streak/checkin'.length)), '/api/students/');
    const student = findStudent(studentId);
    if (!student) {
      sendJson(res, 404, { error: 'Student not found.' });
      return;
    }
    const body = await parseBody(req);
    const checkinDate = cleanText(body.date, 20) || todayKey();
    const streakResult = applyActivityStreak(student, checkinDate);
    const event = createEvent({
      studentId: student.id,
      delta: 0,
      reason: streakResult.changed ? 'Streak check-in' : 'Check-in already recorded',
      type: 'streak_update',
      meta: {
        eventType: 'streak_update',
        streakCurrent: student.streakCurrent,
        consumedFreezes: streakResult.consumed,
        reset: streakResult.reset,
        soundCue: streakResult.changed ? 'streak' : ''
      }
    });
    queueSave();
    emitState('streak-checkin', event, {
      eventType: 'streak_update',
      soundCue: streakResult.changed ? 'streak' : '',
      affectedStudentIds: [student.id]
    });
    sendJson(res, 200, { student, streakResult, event });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/day/close') {
    const body = await parseBody(req);
    const dayKey = cleanText(body.date, 20) || todayKey();
    const impacted = [];
    for (const student of state.students) {
      const result = processMissedDayForStudent(student, dayKey);
      if (result.changed) {
        impacted.push({ studentId: student.id, ...result });
        createEvent({
          studentId: student.id,
          delta: 0,
          reason: result.consumed ? 'Streak freeze consumed' : 'Streak reset',
          type: 'streak_update',
          meta: {
            eventType: 'streak_update',
            streakCurrent: student.streakCurrent,
            consumedFreezes: result.consumed ? 1 : 0,
            reset: result.reset,
            soundCue: result.reset ? 'alert' : ''
          }
        });
      }
    }
    queueSave();
    emitState('day-closed', null, {
      eventType: 'streak_update',
      affectedStudentIds: impacted.map((entry) => entry.studentId)
    });
    sendJson(res, 200, { dayKey, impacted });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/skills') {
    const body = await parseBody(req);
    const type = body.type === 'negative' ? 'negative' : body.type === 'positive' ? 'positive' : '';
    if (!type) {
      sendJson(res, 400, { error: 'Skill type must be positive or negative.' });
      return;
    }
    const label = cleanText(body.label, 36);
    if (!label) {
      sendJson(res, 400, { error: 'Skill label is required.' });
      return;
    }
    let points = toInteger(body.points, type === 'positive' ? 1 : -1);
    points = clamp(points, -10, 10);
    if (type === 'positive' && points < 1) {
      points = 1;
    }
    if (type === 'negative' && points > -1) {
      points = -1;
    }
    const skill = {
      id: `${type === 'positive' ? 'pos' : 'neg'}_${crypto.randomUUID()}`,
      label,
      icon: normalizeIcon(body.icon, label.slice(0, 2)),
      points
    };
    state.skills[type].push(skill);
    queueSave();
    emitState('skill-added');
    sendJson(res, 201, { skill });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/skills/')) {
    const skillId = extractId(pathname, '/api/skills/');
    const type = requestUrl.searchParams.get('type');
    if (type !== 'positive' && type !== 'negative') {
      sendJson(res, 400, { error: 'Skill type query param is required.' });
      return;
    }
    const list = state.skills[type];
    const index = list.findIndex((skill) => skill.id === skillId);
    if (index === -1) {
      sendJson(res, 404, { error: 'Skill not found.' });
      return;
    }
    list.splice(index, 1);
    queueSave();
    emitState('skill-removed');
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/points') {
    const body = await parseBody(req);
    const studentId = cleanText(body.studentId, 120);
    const delta = toInteger(body.delta, 0);
    const reason = cleanText(body.reason, 80) || 'Points updated';
    if (!studentId) {
      sendJson(res, 400, { error: 'studentId is required.' });
      return;
    }
    if (!Number.isInteger(delta) || delta === 0) {
      sendJson(res, 400, { error: 'delta must be a non-zero integer.' });
      return;
    }
    const student = findStudent(studentId);
    if (!student) {
      sendJson(res, 404, { error: 'Student not found.' });
      return;
    }

    student.points += delta;
    const progress = applyXpAndProgression(student, delta);
    const streakOutcome = applyActivityStreak(student, todayKey());
    const pointEvent = createEvent({
      studentId: student.id,
      delta,
      reason,
      type: 'points',
      meta: {
        eventType: 'points',
        xpGain: progress.xpGain,
        level: student.level,
        streakCurrent: student.streakCurrent,
        soundCue: delta > 0 ? 'money' : 'soft_donk',
        highlightMode: delta > 0 ? 'coin' : 'warning'
      }
    });

    const followUpEvents = [];
    if (progress.leveledUp) {
      followUpEvents.push(
        createEvent({
          studentId: student.id,
          delta: 0,
          reason: `Level ${student.level} reached`,
          type: 'level_up',
          meta: {
            eventType: 'level_up',
            fromLevel: progress.prevLevel,
            toLevel: progress.newLevel,
            soundCue: 'level_up',
            highlightMode: 'confetti'
          }
        })
      );
    }
    const rewards = rewardsEarnedThisSeason(student);
    for (const reward of rewards) {
      followUpEvents.push(
        createEvent({
          studentId: student.id,
          delta: 0,
          reason: `Unlocked: ${reward.title}`,
          type: 'badge_unlock',
          meta: {
            eventType: 'badge_unlock',
            badge: reward.badge,
            title: reward.title,
            soundCue: 'badge',
            highlightMode: 'badge'
          }
        })
      );
    }
    if (streakOutcome.changed) {
      followUpEvents.push(
        createEvent({
          studentId: student.id,
          delta: 0,
          reason: 'Streak updated',
          type: 'streak_update',
          meta: {
            eventType: 'streak_update',
            streakCurrent: student.streakCurrent,
            consumedFreezes: streakOutcome.consumed,
            reset: streakOutcome.reset
          }
        })
      );
    }

    recomputeWeeklyDeltas(state, todayKey());
    queueSave();
    emitState('points-updated', pointEvent, {
      eventType: 'points',
      soundCue: pointEvent.meta.soundCue,
      highlightMode: pointEvent.meta.highlightMode,
      affectedStudentIds: [student.id]
    });
    sendJson(res, 200, {
      pointEvent,
      progression: {
        xpGain: progress.xpGain,
        level: student.level,
        leveledUp: progress.leveledUp,
        streak: {
          current: student.streakCurrent,
          best: student.streakBest,
          freezes: student.streakFreezes
        },
        rewards
      },
      followUpEvents,
      student
    });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/store') {
    const body = await parseBody(req);
    const name = cleanText(body.name, 48);
    if (!name) {
      sendJson(res, 400, { error: 'Store item name is required.' });
      return;
    }
    const type = body.type === 'streak_freeze' ? 'streak_freeze' : 'standard';
    const item = {
      id: `item_${crypto.randomUUID()}`,
      name,
      type,
      cost: Math.max(1, toInteger(body.cost, type === 'streak_freeze' ? state.gamification.streakRules.freezeStoreCost : 1)),
      stock: Math.max(0, toInteger(body.stock, 1)),
      freezeAmount: Math.max(1, toInteger(body.freezeAmount, 1))
    };
    state.storeItems.push(item);
    queueSave();
    emitState('store-item-added');
    sendJson(res, 201, { item });
    return;
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/store/')) {
    const itemId = extractId(pathname, '/api/store/');
    const item = findStoreItem(itemId);
    if (!item) {
      sendJson(res, 404, { error: 'Store item not found.' });
      return;
    }
    const body = await parseBody(req);
    if (body.name !== undefined) {
      const name = cleanText(body.name, 48);
      if (!name) {
        sendJson(res, 400, { error: 'Store item name cannot be empty.' });
        return;
      }
      item.name = name;
    }
    if (body.cost !== undefined) {
      item.cost = Math.max(1, toInteger(body.cost, item.cost));
    }
    if (body.stock !== undefined) {
      item.stock = Math.max(0, toInteger(body.stock, item.stock));
    }
    if (body.type !== undefined) {
      item.type = body.type === 'streak_freeze' ? 'streak_freeze' : 'standard';
    }
    if (body.freezeAmount !== undefined) {
      item.freezeAmount = Math.max(1, toInteger(body.freezeAmount, item.freezeAmount));
    }
    queueSave();
    emitState('store-item-updated');
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/store/')) {
    const itemId = extractId(pathname, '/api/store/');
    const index = state.storeItems.findIndex((item) => item.id === itemId);
    if (index === -1) {
      sendJson(res, 404, { error: 'Store item not found.' });
      return;
    }
    state.storeItems.splice(index, 1);
    queueSave();
    emitState('store-item-removed');
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/redeem') {
    const body = await parseBody(req);
    const studentId = cleanText(body.studentId, 120);
    const itemId = cleanText(body.itemId, 120);
    if (!studentId || !itemId) {
      sendJson(res, 400, { error: 'studentId and itemId are required.' });
      return;
    }
    const student = findStudent(studentId);
    if (!student) {
      sendJson(res, 404, { error: 'Student not found.' });
      return;
    }
    const item = findStoreItem(itemId);
    if (!item) {
      sendJson(res, 404, { error: 'Store item not found.' });
      return;
    }
    if (item.stock < 1) {
      sendJson(res, 400, { error: 'That item is out of stock.' });
      return;
    }
    if (student.points < item.cost) {
      sendJson(res, 400, { error: 'Student does not have enough points.' });
      return;
    }
    student.points -= item.cost;
    item.stock -= 1;
    if (item.type === 'streak_freeze') {
      student.streakFreezes += item.freezeAmount;
    }
    const event = createEvent({
      studentId: student.id,
      delta: -item.cost,
      reason: `Redeemed ${item.name}`,
      type: 'redeem',
      meta: {
        eventType: 'redeem',
        itemType: item.type,
        freezeAmount: item.type === 'streak_freeze' ? item.freezeAmount : 0,
        soundCue: 'redeem',
        highlightMode: 'none'
      }
    });
    recomputeWeeklyDeltas(state, todayKey());
    queueSave();
    emitState('store-item-redeemed', event, {
      eventType: 'redeem',
      affectedStudentIds: [student.id]
    });
    sendJson(res, 200, { event, student, item });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/streak/freeze/use') {
    const body = await parseBody(req);
    const studentId = cleanText(body.studentId, 120);
    const student = findStudent(studentId);
    if (!student) {
      sendJson(res, 404, { error: 'Student not found.' });
      return;
    }
    if (student.streakFreezes < 1) {
      sendJson(res, 400, { error: 'No streak freezes available.' });
      return;
    }
    student.streakFreezes -= 1;
    const event = createEvent({
      studentId: student.id,
      delta: 0,
      reason: 'Streak freeze used',
      type: 'streak_update',
      meta: {
        eventType: 'streak_update',
        streakCurrent: student.streakCurrent,
        consumedFreezes: 1,
        soundCue: 'streak'
      }
    });
    queueSave();
    emitState('streak-freeze-used', event, {
      eventType: 'streak_update',
      affectedStudentIds: [student.id]
    });
    sendJson(res, 200, { student, event });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/season/start') {
    const body = await parseBody(req);
    rolloverSeason({
      name: body.name,
      startDate: body.startDate,
      lengthDays: body.lengthDays
    });
    const event = createEvent({
      studentId: 'class',
      delta: 0,
      reason: `Season started: ${state.gamification.season.name}`,
      type: 'season_transition',
      meta: {
        eventType: 'season_transition',
        seasonId: state.gamification.season.id,
        soundCue: 'season'
      }
    });
    queueSave();
    emitState('season-started', event, {
      eventType: 'season_transition'
    });
    sendJson(res, 200, { season: state.gamification.season, event });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/season/close') {
    const changed = closeSeason();
    if (!changed) {
      sendJson(res, 400, { error: 'Season is already closed.' });
      return;
    }
    const event = createEvent({
      studentId: 'class',
      delta: 0,
      reason: `Season closed: ${state.gamification.season.name}`,
      type: 'season_transition',
      meta: {
        eventType: 'season_transition',
        seasonId: state.gamification.season.id,
        soundCue: 'season'
      }
    });
    queueSave();
    emitState('season-closed', event, {
      eventType: 'season_transition'
    });
    sendJson(res, 200, { season: state.gamification.season, event });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reset') {
    state = createDefaultState();
    queueSave();
    emitState('class-reset');
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Route not found.' });
}

async function serveStatic(pathname, res) {
  const routeToFile = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/teacher': 'teacher.html',
    '/teacher.html': 'teacher.html',
    '/display': 'display.html',
    '/display.html': 'display.html',
    '/display-store': 'display-store.html',
    '/display-store.html': 'display-store.html',
    '/display-leaderboards': 'display-leaderboards.html',
    '/display-leaderboards.html': 'display-leaderboards.html',
    '/student': 'student.html',
    '/student.html': 'student.html'
  };
  const relativePath = routeToFile[pathname] ?? pathname.replace(/^\/+/, '');
  if (!relativePath) {
    sendText(res, 404, 'Not found');
    return;
  }
  const absolutePath = path.normalize(path.join(PUBLIC_DIR, relativePath));
  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  try {
    const file = await fsp.readFile(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=60'
    });
    res.end(file);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

const heartbeat = setInterval(() => {
  for (const client of [...clients]) {
    try {
      client.write(': heartbeat\n\n');
    } catch {
      clients.delete(client);
      try {
        client.end();
      } catch {}
    }
  }
  for (const entry of [...studentClients]) {
    try {
      entry.res.write(': heartbeat\n\n');
    } catch {
      studentClients.delete(entry);
      try {
        entry.res.end();
      } catch {}
    }
  }
}, SSE_HEARTBEAT_MS);
heartbeat.unref();

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, parsedUrl);
      return;
    }
    await serveStatic(pathname, res);
  } catch (error) {
    if (error.statusCode) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    console.error('[server] request failed:', error.message);
    sendJson(res, 500, { error: 'Internal server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`Brooke's Classroom is running on http://localhost:${PORT}`);
  console.log(`Teacher view: http://localhost:${PORT}/teacher`);
  console.log(`Display view: http://localhost:${PORT}/display`);
});

function shutdown(signal) {
  console.log(`[server] received ${signal}, shutting down...`);
  clearInterval(heartbeat);
  for (const client of clients) {
    try {
      client.end();
    } catch {}
  }
  for (const entry of studentClients) {
    try {
      entry.res.end();
    } catch {}
  }
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
