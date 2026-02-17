import { api, connectStateStream, escapeHtml, initThemeToggle } from './shared.js';

const dom = {};
const DISPLAY_VIEW_DEFAULTS = {
  showHeader: true,
  showConnectionStatus: true,
  showThemeToggle: true,
  showStoreItems: true,
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
    dom.storeOnlyFeed.innerHTML = `<p class="mini-empty">${escapeHtml(error.message || 'Failed to load store view.')}</p>`;
  });
});

function cacheDom() {
  dom.displayHeader = document.querySelector('#displayHeader');
  dom.displayClassName = document.querySelector('#displayClassName');
  dom.displayStoreLine = document.querySelector('#displayStoreLine');
  dom.displayConnection = document.querySelector('#displayConnection');
  dom.themeToggleBtn = document.querySelector('#themeToggleBtn');
  dom.storeItemsSection = document.querySelector('#storeItemsSection');
  dom.displayFooter = document.querySelector('#displayFooter');
  dom.storeOnlyFeed = document.querySelector('#storeOnlyFeed');
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
  dom.storeItemsSection.classList.toggle('hidden', !displayViewSetting('showStoreItems'));
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
  dom.displayStoreLine.textContent = 'Store only view';
  applyVisibility();
  renderStore();
}

function renderStore() {
  const items = [...(classroom.storeItems ?? [])]
    .sort((a, b) => {
      if (a.stock === 0 && b.stock > 0) {
        return 1;
      }
      if (a.stock > 0 && b.stock === 0) {
        return -1;
      }
      if (a.cost !== b.cost) {
        return a.cost - b.cost;
      }
      return a.name.localeCompare(b.name);
    });

  if (items.length === 0) {
    dom.storeOnlyFeed.innerHTML = '<p class="mini-empty">No store items yet.</p>';
    return;
  }

  dom.storeOnlyFeed.innerHTML = items
    .map((item) => {
      const inStock = item.stock > 0;
      const stockText = item.stock >= 999 ? 'In stock' : inStock ? `${item.stock} left` : 'Out of stock';
      const typeText = item.type === 'streak_freeze' ? 'Streak Freeze' : 'Standard';
      return `
        <div class="event-row">
          <div>
            <p class="event-text">${escapeHtml(item.name)}</p>
            <p class="event-time">${escapeHtml(typeText)} | ${escapeHtml(stockText)}</p>
          </div>
          <strong class="event-delta ${inStock ? 'plus' : 'minus'}">${item.cost} pts</strong>
        </div>
      `;
    })
    .join('');
}

window.addEventListener('beforeunload', () => {
  if (disconnectStream) {
    disconnectStream();
  }
});
