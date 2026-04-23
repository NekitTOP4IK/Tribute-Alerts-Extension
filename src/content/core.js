var cachedUsers = {};
var channelBadgeTiers = {};
var serviceBadges = {};

const tcbTooltip = document.createElement('div');
tcbTooltip.id = 'tcb-custom-tooltip';

function showTooltip(e, text) {
  if (!text) return;
  if (!tcbTooltip.parentNode && document.body) document.body.appendChild(tcbTooltip);
  tcbTooltip.textContent = text;
  tcbTooltip.style.display = 'block';
  const rect = e.target.getBoundingClientRect();
  const tw = tcbTooltip.offsetWidth;
  const th = tcbTooltip.offsetHeight;
  const left = Math.max(4, Math.min(window.innerWidth - tw - 4, rect.left + rect.width / 2 - tw / 2));
  const top  = Math.max(4, rect.top - th - 7);
  tcbTooltip.style.left = left + 'px';
  tcbTooltip.style.top  = top + 'px';
}

function hideTooltip() {
  tcbTooltip.style.display = 'none';
}

// Builds CSS string from v1 fields for backwards compat with pre-api_version-3 entries.
function _buildNameCssCompat(config) {
  if (config.name_gradient) {
    return `background: ${config.name_gradient}; -webkit-background-clip: text; -webkit-text-fill-color: transparent;`;
  }
  if (config.name_color) {
    return `color: ${config.name_color};`;
  }
  return null;
}

let _styleRafPending = false;
function updateDynamicStyles() {
  if (_styleRafPending) return;
  _styleRafPending = true;
  requestAnimationFrame(() => {
    _styleRafPending = false;
    _doUpdateDynamicStyles();
  });
}

function _doUpdateDynamicStyles() {
  let styleEl = document.getElementById('tcb-dynamic-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'tcb-dynamic-styles';
    document.head.appendChild(styleEl);
  }

  let css = `
    .tcb-badge-img {
      cursor: pointer;
      pointer-events: auto !important;
    }
  `;

  for (const [username, config] of Object.entries(cachedUsers)) {
    const safeName = username.replace(/(["\\])/g, '\\$1');
    // Exclude 7TV messages: native element still exists in DOM but composited under 7TV's layer.
    const nativeSel  = `.chat-line__message:not(:has(.seventv-chat-user)) [data-tcb-user="${safeName}"].chat-author__display-name:not([data-tcb-paint])`;
    // Skip when 7TV paint sets inline background — paint takes priority over TRA gradient.
    const stvNameSel = `[data-tcb-user="${safeName}"] .seventv-chat-user-username:not([style*="background"])`;

    const nameCss = config.name_css || _buildNameCssCompat(config);
    if (!nameCss) continue;

    const important = nameCss.split(';').filter(Boolean).map(d => d.trim() + ' !important').join('; ') + ';';

    // Strip filter from the 7TV rule — filter on a parent bleeds into .seventv-paint children.
    // Apply it separately, scoped to elements without an active paint.
    const importantNoFilter = nameCss.split(';').filter(Boolean)
      .filter(d => !d.trim().toLowerCase().startsWith('filter'))
      .map(d => d.trim() + ' !important').join('; ') + ';';

    const filterDecls = nameCss.split(';').filter(Boolean)
      .filter(d => d.trim().toLowerCase().startsWith('filter'))
      .map(d => d.trim() + ' !important').join('; ');

    css += `${nativeSel} { ${important} }\n`;
    css += `${stvNameSel} { ${importantNoFilter} }\n`;

    if (filterDecls) {
      const stvNoPaint = `[data-tcb-user="${safeName}"] .seventv-chat-user-username:not([style*="background"]):not(:has(.seventv-paint))`;
      css += `${stvNoPaint} { ${filterDecls}; }\n`;
    }
  }

  styleEl.textContent = css;
}

function resolveBadgesForUser(userEntry) {
  const badges = [];

  for (const id of (userEntry.service_badge_ids || [])) {
    const b = serviceBadges[id];
    if (b) badges.push(b);
  }

  if (userEntry.channel_badge_tier_id != null) {
    const tier = channelBadgeTiers[userEntry.channel_badge_tier_id];
    if (tier) badges.push(tier);
  }

  return badges;
}

let currentChannelName = null;
let socket = null;

let _initialFetchSucceeded = false;
let _lastFetchTime = 0;
const _badgeEtags = {};

async function fetchBadges(channelName, retryCount = 0) {
  try {
    const headers = {};
    if (_badgeEtags[channelName]) headers['If-None-Match'] = _badgeEtags[channelName];

    const response = await fetch(`${CONFIG.BACKEND_URL}/api/v2/badges/${channelName}/all`, { headers });

    if (response.status === 304) {
      _initialFetchSucceeded = true;
      _lastFetchTime = Date.now();
      refreshChat();
      return;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const etag = response.headers.get('ETag');
    if (etag) _badgeEtags[channelName] = etag;

    const data = await response.json();
    if (!data.success) {
      const delay = Math.min(5000 * Math.pow(2, retryCount), 60000);
      setTimeout(() => fetchBadges(channelName, retryCount + 1), delay);
      return;
    }

    channelBadgeTiers = data.channel_badge_tiers || {};
    serviceBadges     = data.service_badges      || {};
    cachedUsers       = data.users               || {};

    _initialFetchSucceeded = true;
    _lastFetchTime = Date.now();
    updateDynamicStyles();
    refreshChat();

  } catch (err) {
    const delay = Math.min(5000 * Math.pow(2, retryCount), 60000);
    setTimeout(() => fetchBadges(channelName, retryCount + 1), delay);
  }
}

function initSocket(channelName) {
  if (socket) socket.disconnect();

  if (typeof io === 'undefined') return;

  socket = io(CONFIG.BACKEND_URL, {
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.7,
  });

  let _socketEverConnected = false;

  socket.on('connect', () => {
    socket.emit('join_channel', { channel_name: channelName });
    if (_socketEverConnected || !_initialFetchSucceeded) fetchBadges(channelName);
    _socketEverConnected = true;
  });

  socket.on('badge_update', (msg) => {
    if (!msg) return;

    if (msg.type === 'channel_refresh') {
      setTimeout(() => fetchBadges(channelName), Math.random() * 5000);
      return;
    }

    if (msg.type === 'user_update' && msg.data) {
      const { twitch_username, channel_badge_tiers: cbt, service_badges: sb, ...userFields } = msg.data;
      if (!twitch_username) return;

      const base = CONFIG.BACKEND_URL.replace(/\/$/, '');
      function absUrl(url) {
        if (!url) return url;
        return url.startsWith('/') ? base + url : url;
      }

      if (cbt) {
        const normalized = {};
        for (const [id, tier] of Object.entries(cbt)) {
          normalized[id] = { ...tier, url: absUrl(tier.url) };
        }
        Object.assign(channelBadgeTiers, normalized);
      }
      if (sb) {
        const normalized = {};
        for (const [id, badge] of Object.entries(sb)) {
          normalized[id] = { ...badge, url: absUrl(badge.url) };
        }
        Object.assign(serviceBadges, normalized);
      }

      cachedUsers[twitch_username] = { ...(cachedUsers[twitch_username] || {}), ...userFields };

      updateDynamicStyles();
      refreshUserInChat(twitch_username);
    }
  });
}

function refreshChat() {
  document.querySelectorAll('.seventv-message, .seventv-user-message').forEach((el) => {
    delete el.dataset.tcbDone;
    if (typeof processSevenTVMessage !== 'undefined') processSevenTVMessage(el);
  });
  document.querySelectorAll('.chat-line__message').forEach((el) => {
    delete el.dataset.tcbDone;
    if (typeof processNativeMessage !== 'undefined') processNativeMessage(el);
  });
}

function refreshUserInChat(username) {
  const safe = username.replace(/(["\\])/g, '\\$1');

  document.querySelectorAll(`[data-tcb-user="${safe}"]`).forEach(userBlock => {
    const msg = userBlock.closest('.seventv-message, .seventv-user-message');
    if (msg) {
      delete msg.dataset.tcbDone;
      if (typeof processSevenTVMessage !== 'undefined') processSevenTVMessage(msg);
    }
  });

  document.querySelectorAll('.chat-line__message').forEach(el => {
    const userEl = el.querySelector(`.chat-author__display-name[data-tcb-user="${safe}"]`);
    if (userEl) {
      delete el.dataset.tcbDone;
      if (typeof processNativeMessage !== 'undefined') processNativeMessage(el);
    }
  });
}

function extractChannelName() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  // dashboard.twitch.tv/u/<channel>/... and /popout/u/<channel>/...
  if (window.location.hostname === 'dashboard.twitch.tv') {
    let idx = 0;
    if (parts[idx] && parts[idx].toLowerCase() === 'popout') idx++;
    return (parts[idx] === 'u' && parts[idx + 1]) ? parts[idx + 1].toLowerCase() : null;
  }

  const exclude = ['directory', 'messages', 'videos', 'settings', 'subscriptions', 'drops', 'wallet', 'inventory', 'auth', 'authorize', 'oauth', 'login', 'signup', 'passport', 'embed', 'bits', 'turbo', 'prime', 'store', 'payments', 'checkout', 'search', 'following', 'friends', 'notifications', 'support', 'jobs', 'about', 'p', 'help', 'downloads', 'broadcast'];
  const first = parts[0].toLowerCase();
  if (first === 'moderator' || first === 'popout') {
    let idx = 1;
    if (parts[idx] && (parts[idx].toLowerCase() === 'u' || parts[idx].toLowerCase() === 'moderator')) idx++;
    return parts[idx] ? parts[idx].toLowerCase() : null;
  }
  return exclude.includes(first) ? null : first;
}

function getTwitchLogin() {
  const cookieMatch = document.cookie.match(/(?:^|;\s*)login=([^;]*)/);
  if (cookieMatch && cookieMatch[1]) return decodeURIComponent(cookieMatch[1]);

  try {
    for (const key of ['login', 'twilight-user', 'twitch-user']) {
      const val = localStorage.getItem(key);
      if (!val) continue;
      try {
        const parsed = JSON.parse(val);
        const found = parsed?.login || parsed?.user?.login || parsed?.data?.login;
        if (found) return String(found);
      } catch {
        if (/^[a-z0-9_]{3,25}$/i.test(val)) return val.toLowerCase();
      }
    }
  } catch {}
  return null;
}

async function loadConfig(callback) {
  const channelName = extractChannelName();
  currentChannelName = channelName;

  if (channelName) {
    fetchBadges(channelName);
    initSocket(channelName);
  }
  if (callback) callback();
}

let lastUrl = location.href;

function _checkUrlChange() {
  const url = location.href;
  if (url === lastUrl) return;
  lastUrl = url;
  const newChannel = extractChannelName();
  if (newChannel && newChannel !== currentChannelName) {
    currentChannelName = newChannel;
    _initialFetchSucceeded = false;
    _lastFetchTime = 0;
    cachedUsers = {};
    channelBadgeTiers = {};
    serviceBadges = {};
    updateDynamicStyles();
    fetchBadges(newChannel);
    initSocket(newChannel);
  }
}

const _origPushState = history.pushState.bind(history);
history.pushState = (...args) => { _origPushState(...args); _checkUrlChange(); };
const _origReplaceState = history.replaceState.bind(history);
history.replaceState = (...args) => { _origReplaceState(...args); _checkUrlChange(); };
window.addEventListener('popstate', _checkUrlChange);

const _STALE_THRESHOLD = 5 * 60 * 1000;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentChannelName && Date.now() - _lastFetchTime > _STALE_THRESHOLD) {
    fetchBadges(currentChannelName);
  }
});

function createBadgeImg(badge) {
  if (!badge || !badge.url) return null;
  const img = document.createElement('img');
  img.src = badge.url;
  img.className = 'tcb-badge-img';
  img.alt = badge.title || 'Badge';
  img.addEventListener('mouseenter', (e) => showTooltip(e, badge.title));
  img.addEventListener('mouseleave', hideTooltip);
  img.addEventListener('wheel', hideTooltip);
  img.onerror = () => { img.style.display = 'none'; };
  return img;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'GET_LOGIN') {
      sendResponse({ login: getTwitchLogin(), channel: currentChannelName });
    }
  });
}
