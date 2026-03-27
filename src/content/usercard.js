// ============================================
// Twitch Custom Badges — User Card Processing (Native + 7TV)
// ============================================

function processUserCard(cardEl) {
  if (cardEl.dataset.tcbDone) return;
  
  // Try to find username element by known classes first
  const specificNameEl = cardEl.querySelector('.seventv-chat-user-username, .seventv-user-card-username, .tw-title, [data-a-target="user-card-header-username"], .viewer-card-header__display-name');

  // Fallback: scan generic elements for a valid username-shaped text node
  const nameEls = Array.from(cardEl.querySelectorAll('span, h4, h2, h3, div')).filter(el => {
    return el.textContent && /^[a-zA-Z0-9_]{3,25}$/.test(el.textContent.trim());
  });
  
  let rawText = '';
  let targetNameEl = null;

  if (specificNameEl) {
    rawText = specificNameEl.textContent.trim();
    targetNameEl = specificNameEl;
  } else if (nameEls.length > 0) {
    rawText = nameEls[0].textContent.trim();
    targetNameEl = nameEls[0];
  } else {
    const match = cardEl.textContent.match(/([a-zA-Z0-9_]{3,25})/);
    if (match) rawText = match[1];
  }

  if (!rawText) return;

  const intlMatch = rawText.match(/\((\w+)\)\s*$/); // "DisplayName (login)"
  const username = (intlMatch ? intlMatch[1] : rawText).toLowerCase().trim();

  const config = typeof cachedUsers !== 'undefined' ? cachedUsers[username] : null;
  if (!config) return;

  cardEl.dataset.tcbDone = '1';

  const badges = typeof resolveBadgesForUser !== 'undefined' ? resolveBadgesForUser(config) : [];
  if (badges.length > 0) {
    const sevTVBadgeContainer = cardEl.querySelector('.seventv-user-card-badges');

    if (sevTVBadgeContainer) {
      sevTVBadgeContainer.querySelectorAll('.tcb-badge-img').forEach(b => b.remove());
      badges.forEach(badge => {
        const img = createBadgeImg(badge);
        if (img) {
          img.style.width = '20px';
          img.style.height = '20px';
          img.style.verticalAlign = 'middle';
          sevTVBadgeContainer.appendChild(img);
        }
      });
    } else if (targetNameEl) {
      let badgeContainer = cardEl.querySelector('.tcb-usercard-badges');
      if (!badgeContainer) {
        badgeContainer = document.createElement('span');
        badgeContainer.className = 'tcb-usercard-badges';
        badgeContainer.style.cssText = 'display: inline-flex; gap: 4px; margin-right: 6px; align-items: center; vertical-align: middle;';
        targetNameEl.insertAdjacentElement('beforebegin', badgeContainer);
      }
      badgeContainer.innerHTML = '';
      badges.forEach(badge => {
        const img = createBadgeImg(badge);
        if (img) badgeContainer.appendChild(img);
      });
    }
  }

  if (targetNameEl) {
    if (config.name_gradient) {
      targetNameEl.style.setProperty('background', config.name_gradient, 'important');
      targetNameEl.style.setProperty('-webkit-background-clip', 'text', 'important');
      targetNameEl.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
      targetNameEl.style.setProperty('color', 'transparent', 'important');
    } else if (config.name_color) {
      targetNameEl.style.setProperty('color', config.name_color, 'important');
    }
  }
}
