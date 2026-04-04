// ============================================
// TRA Twitch Ext — Native Twitch Chat Processing
// ============================================

function processNativeMessage(messageElement) {
  if (messageElement.dataset.tcbDone) return;

  const usernameElement = messageElement.querySelector('.chat-author__display-name');
  if (!usernameElement) return;

  const username = (
    usernameElement.getAttribute('data-a-user') ||
    usernameElement.textContent ||
    ''
  ).toLowerCase().trim();

  if (!username) return;

  messageElement.dataset.tcbDone = '1';

  // Clear existing TCB badge wrappers to prevent duplicates on config update
  messageElement.querySelectorAll('.tcb-badge-list').forEach(b => b.remove());

  const userConfig = typeof cachedUsers !== 'undefined' ? cachedUsers[username] : null;
  if (!userConfig) return;

  // Tooltip on username hover — shows preset name if active (reads cachedUsers fresh)
  if (!usernameElement.dataset.tcbTooltip) {
    usernameElement.dataset.tcbTooltip = '1';
    usernameElement.addEventListener('mouseenter', (e) => {
      const cfg = typeof cachedUsers !== 'undefined' ? cachedUsers[username] : null;
      if (cfg && cfg.name_preset_name) showTooltip(e, `Preset: ${cfg.name_preset_name}`);
    });
    usernameElement.addEventListener('mouseleave', hideTooltip);
  }

  const badges = typeof resolveBadgesForUser !== 'undefined' ? resolveBadgesForUser(userConfig) : [];
  if (badges.length > 0) {
    const wrapper = document.createElement('span');
    wrapper.className = 'tcb-badge-list';
    badges.forEach((badge) => {
      const badgeImg = createBadgeImg(badge);
      if (badgeImg) wrapper.appendChild(badgeImg);
    });
    if (wrapper.children.length > 0) {
      usernameElement.insertAdjacentElement('beforebegin', wrapper);
    }
  }
}
