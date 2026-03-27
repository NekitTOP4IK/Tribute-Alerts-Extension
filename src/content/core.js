// ============================================
// Twitch Custom Badges — Content Script (Core)
// ============================================

var cachedUsers = {};          // { login: { is_subscriber, channel_badge_tier_id, service_badge_ids, name_color, name_gradient, ... } }
var channelBadgeTiers = {};    // { <id>: { url, title } }
var serviceBadges = {};        // { 'svc_<id>': { url, title } }

// =========================================================================
// Tooltip
// =========================================================================

const tcbTooltip = document.createElement('div');
tcbTooltip.id = 'tcb-custom-tooltip';
tcbTooltip.style.cssText = `
  position: fixed;
  background: #18181b;
  color: #efeff1;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 14px;
  font-family: Inter, Roboto, sans-serif;
  pointer-events: none;
  z-index: 999999;
  display: none;
  border: 1px solid #303032;
  box-shadow: 0 4px 8px rgba(0,0,0,0.4);
  white-space: nowrap;
`;

function showTooltip(e, text) {
  if (!text) return;
  if (!tcbTooltip.parentNode && document.body) document.body.appendChild(tcbTooltip);
  tcbTooltip.textContent = text;
  tcbTooltip.style.display = 'block';
  const rect = e.target.getBoundingClientRect();
  tcbTooltip.style.left = Math.max(0, rect.left + (rect.width / 2) - (tcbTooltip.offsetWidth / 2)) + 'px';
  tcbTooltip.style.top = Math.max(0, rect.top - tcbTooltip.offsetHeight - 6) + 'px';
}

function hideTooltip() {
  tcbTooltip.style.display = 'none';
}

// =========================================================================
// Dynamic styles (nick colors / gradients)
// =========================================================================

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
    const nativeSel = `.chat-line__message [data-a-user="${safeName}"]`;
    const stvSel    = `[data-tcb-user="${safeName}"]`;
    const stvNameSel = `[data-tcb-user="${safeName}"] .seventv-chat-user-username`;

    if (config.name_gradient) {
      css += `
        ${nativeSel} {
          background: ${config.name_gradient} !important;
          background-clip: text !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
          color: transparent !important;
        }
        ${stvNameSel}:not(:has(span[style*="background"])) {
          background: ${config.name_gradient} !important;
          background-clip: text !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
          color: transparent !important;
        }
      `;
    } else if (config.name_color) {
      css += `
        ${nativeSel} { color: ${config.name_color} !important; }
        ${stvSel}:not(:has(.seventv-chat-user-username span[style*="background"])) {
          color: ${config.name_color} !important;
        }
      `;
    }
  }

  styleEl.textContent = css;
}

// =========================================================================
// Badge resolution
// =========================================================================

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

// =========================================================================
// Socket & fetch
// =========================================================================

let currentChannelName = null;
let socket = null;

async function fetchBadges(channelName, retryCount = 0) {
  try {
    const response = await fetch(`${CONFIG.BACKEND_URL}/api/v1/badges/${channelName}/all`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data.success) {
      if (retryCount < 3) setTimeout(() => fetchBadges(channelName, retryCount + 1), 5000);
      return;
    }

    channelBadgeTiers = data.channel_badge_tiers || {};
    serviceBadges     = data.service_badges      || {};
    cachedUsers       = data.users               || {};

    updateDynamicStyles();
    refreshChat();

  } catch (err) {
    if (retryCount < 3) setTimeout(() => fetchBadges(channelName, retryCount + 1), 5000);
  }
}

function initSocket(channelName) {
  if (socket) socket.disconnect();

  if (typeof io === 'undefined') return;

  socket = io(CONFIG.BACKEND_URL, { transports: ['websocket', 'polling'] });

  let _socketEverConnected = false;

  socket.on('connect', () => {
    socket.emit('join_channel', { channel_name: channelName });
    if (_socketEverConnected) fetchBadges(channelName);
    _socketEverConnected = true;
  });

  socket.on('badge_update', (msg) => {
    if (!msg) return;

    if (msg.type === 'channel_refresh') {
      fetchBadges(channelName);
      return;
    }

    if (msg.type === 'user_update' && msg.data) {
      const { twitch_username, channel_badge_tiers: cbt, service_badges: sb, ...userFields } = msg.data;
      if (!twitch_username) return;

      // Normalize URLs: background thread on backend may produce relative /cdn/... paths
      const base = CONFIG.BACKEND_URL.replace(/\/$/, '');
      function absUrl(url) {
        if (!url) return url;
        return url.startsWith('/') ? base + url : url;
      }

      // Update top-level badge definitions only when provided (never clear on user_update)
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

  document.querySelectorAll(`.chat-line__message`).forEach(el => {
    const userEl = el.querySelector(`.chat-author__display-name[data-a-user="${safe}"]`);
    if (userEl) {
      delete el.dataset.tcbDone;
      if (typeof processNativeMessage !== 'undefined') processNativeMessage(el);
    }
  });
}

// =========================================================================
// Channel / login detection
// =========================================================================

function extractChannelName() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  // dashboard.twitch.tv/u/<channel>/...
  if (window.location.hostname === 'dashboard.twitch.tv') {
    return (parts[0] === 'u' && parts[1]) ? parts[1].toLowerCase() : null;
  }

  const exclude = ['directory', 'messages', 'videos', 'settings', 'subscriptions', 'drops', 'wallet', 'inventory'];
  const first = parts[0].toLowerCase();
  if (first === 'moderator' || first === 'popout') {
    let idx = 1;
    if (parts[idx] && parts[idx].toLowerCase() === 'u') idx++;
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

async function loadConfig(callback, retryCount = 0) {
  const channelName = extractChannelName();
  currentChannelName = channelName;

  if (channelName) {
    const login = getTwitchLogin();
    if (!login) {
      if (callback) callback();
      return;
    }

    try {
      const authRes = await fetch(`${CONFIG.BACKEND_URL}/api/v1/badges/${channelName}/status/${login}`);
      if (!authRes.ok) throw new Error(`Status ${authRes.status}`);
      const authData = await authRes.json();

      if (authData.success) {
        fetchBadges(channelName);
        initSocket(channelName);
      }
    } catch {
      if (retryCount < 3) {
        setTimeout(() => loadConfig(callback, retryCount + 1), 5000);
        return;
      }
    }
  }
  if (callback) callback();
}

// SPA navigation
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    const newChannel = extractChannelName();
    if (newChannel && newChannel !== currentChannelName) {
      currentChannelName = newChannel;
      cachedUsers = {};
      channelBadgeTiers = {};
      serviceBadges = {};
      updateDynamicStyles();
      fetchBadges(newChannel);
      initSocket(newChannel);
    }
  }
}).observe(document, { subtree: true, childList: true });

// =========================================================================
// Badge element factory
// =========================================================================

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

// =========================================================================
// Popup messaging
// =========================================================================

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'GET_LOGIN') {
      sendResponse({ login: getTwitchLogin(), channel: currentChannelName });
    }
  });
}
