// ============================================
// Twitch Custom Badges — Native Twitch Chat Processing
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

  // Clear existing TCB badges to prevent duplicates on config update
  messageElement.querySelectorAll('.tcb-badge-img').forEach(b => b.remove());

  const userConfig = typeof cachedUsers !== 'undefined' ? cachedUsers[username] : null;
  if (!userConfig) return;

  const badges = typeof resolveBadgesForUser !== 'undefined' ? resolveBadgesForUser(userConfig) : [];
  badges.forEach((badge) => {
    const badgeImg = createBadgeImg(badge);
    if (badgeImg) {
      usernameElement.insertAdjacentElement('beforebegin', badgeImg);
    }
  });
}
