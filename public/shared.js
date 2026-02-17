const RECONNECT_DELAY_MS = 1500;
const THEME_STORAGE_KEY = 'brooke_theme';

export async function api(path, options = {}) {
  const config = {
    method: options.method ?? 'GET',
    headers: {}
  };

  if (options.body !== undefined) {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, config);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }
  return payload;
}

export function escapeHtml(text) {
  const value = String(text ?? '');
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatDelta(points) {
  if (points > 0) {
    return `+${points}`;
  }
  return `${points}`;
}

export function initials(name) {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function safePhoto(photo) {
  if (typeof photo !== 'string') {
    return '';
  }
  if (!photo.startsWith('data:image/')) {
    return '';
  }
  return photo;
}

export function avatarMarkup(student, size = 'medium') {
  const className = `avatar avatar-${size}`;
  const photo = safePhoto(student?.photo);
  if (photo) {
    return `<span class="${className}"><img src="${photo}" alt="${escapeHtml(student?.name ?? 'Student')}" loading="lazy"></span>`;
  }
  return `<span class="${className} avatar-fallback">${escapeHtml(initials(student?.name ?? ''))}</span>`;
}

export function relativeTime(isoString) {
  const timestamp = Date.parse(isoString);
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  const deltaMs = Date.now() - timestamp;
  const deltaSeconds = Math.round(deltaMs / 1000);
  if (deltaSeconds < 60) {
    return `${Math.max(1, deltaSeconds)}s ago`;
  }
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

export function connectStateStream({ onState, onOpen, onError }) {
  let source = null;
  let retryHandle = null;
  let stopped = false;

  const open = () => {
    if (stopped) {
      return;
    }
    source = new EventSource('/api/events');
    source.addEventListener('state', (event) => {
      try {
        const payload = JSON.parse(event.data);
        onState?.(payload);
      } catch (error) {
        console.error('Failed to parse stream payload:', error);
      }
    });
    source.onopen = () => {
      onOpen?.();
    };
    source.onerror = () => {
      onError?.();
      if (source) {
        source.close();
      }
      clearTimeout(retryHandle);
      retryHandle = setTimeout(open, RECONNECT_DELAY_MS);
    };
  };

  open();

  return () => {
    stopped = true;
    clearTimeout(retryHandle);
    if (source) {
      source.close();
    }
  };
}

function systemTheme() {
  if (!window.matchMedia) {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function normalizeTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
}

function parseTheme(theme) {
  return theme === 'light' || theme === 'dark' ? theme : '';
}

function readStoredTheme() {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return '';
  }
}

function writeStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
  } catch {}
}

export function applyTheme(theme) {
  const normalized = normalizeTheme(theme);
  document.documentElement.setAttribute('data-theme', normalized);
  return normalized;
}

export function initializeTheme() {
  const attrTheme = parseTheme(document.documentElement.getAttribute('data-theme'));
  const stored = readStoredTheme();
  const next = stored || attrTheme || systemTheme();
  return applyTheme(next);
}

export function initThemeToggle(button) {
  if (!button) {
    initializeTheme();
    return;
  }

  const updateLabel = (theme) => {
    button.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  };

  let activeTheme = initializeTheme();
  updateLabel(activeTheme);

  button.addEventListener('click', () => {
    activeTheme = activeTheme === 'dark' ? 'light' : 'dark';
    activeTheme = applyTheme(activeTheme);
    writeStoredTheme(activeTheme);
    updateLabel(activeTheme);
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be loaded.'));
    image.src = source;
  });
}

export async function toDataUrl(file, maxSide = 480) {
  const rawDataUrl = await readAsDataUrl(file);
  if (!file.type.startsWith('image/')) {
    return '';
  }

  try {
    const image = await loadImage(rawDataUrl);
    const largestSide = Math.max(image.width, image.height);
    if (largestSide <= maxSide) {
      return rawDataUrl;
    }
    const scale = maxSide / largestSide;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      return rawDataUrl;
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    return rawDataUrl;
  }
}
