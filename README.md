# Tribute Alerts Twitch Extension

Браузерное расширение для сервиса [Tribute Alerts](https://tributealerts.nekittop4ik.space).

Отображает кастомные бейджи и цвета ников подписчиков Tribute прямо в чате Twitch — в нативном чате и в режиме 7TV.

---

## Установка

- [Chrome Web Store](https://chromewebstore.google.com/detail/fkfobecfmoiamoghcpnogchppmkenigk)

- [addons.mozilla.org]() *(пока нет)*.

---

## Как это работает

Расширение встраивается в страницы `twitch.tv`, читает текущий канал и Twitch-логин пользователя, затем:

1. Проверяет, настроен ли канал в системе Tribute Alerts
2. Загружает список подписчиков с их бейджами и цветами ников
3. Подключается к бэкенду по WebSocket и получает обновления в реальном времени
4. Вставляет бейджи и применяет цвета ников в нативный чат и в чат 7TV

**Привязка аккаунта:** нажмите кнопку в попапе расширения → откроется Telegram-бот → подтвердите привязку Twitch к Tribute.

---

## Структура

```
src/
├── config.js              # Конфигурация (URL бэкенда, имя бота)
├── content/
│   ├── core.js            # Ядро: кэш пользователей, бейджи, WebSocket
│   ├── observer.js        # MutationObserver — отслеживает новые сообщения
│   ├── twitch.js          # Обработка нативного чата Twitch
│   ├── seventv.js         # Обработка чата 7TV
│   ├── usercard.js        # Обработка карточек пользователей
│   └── styles.css         # Стили бейджей
└── popup/
    ├── popup.html         # UI попапа
    └── popup.js           # Логика попапа (привязка, статус, отвязка)
```

---

## Лицензия

MIT — подробнее в [LICENSE](LICENSE).
