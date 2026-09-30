# Выпуск iOS-приложения (App Store)

Приложение для iOS — это оболочка Capacitor (`ios/`), которая открывает продакшен-сайт
(`server.url` в `capacitor.config.ts`). Серверные функции и авторизация остаются на Vercel,
поэтому каждое обновление сайта сразу попадает в приложение без новой сборки.
Новая сборка нужна, только когда меняется `ios/`, `capacitor.config.ts` или версии `@capacitor/*`.

## Что нужно

- Mac с Xcode 16 или новее и выбранным Apple ID (Xcode → Settings → Accounts).
- Активный аккаунт Apple Developer Program.
- Приложение в App Store Connect с Bundle ID из `capacitor.config.ts` (`com.yelzhastem.memora`).
  Если Bundle ID другой, поменяйте `appId` и `PRODUCT_BUNDLE_IDENTIFIER` в Xcode.

## Сборка

```bash
git pull
npm install
npm run ios:sync      # копирует конфиг и плагины в ios/
npm run ios:open      # открывает проект в Xcode
```

В Xcode:

1. Слева выбрать проект **App** → таргет **App** → вкладка **Signing & Capabilities**.
   Включить *Automatically manage signing* и выбрать свою команду (Team).
2. Во вкладке **General** проверить *Version* (1.0) и *Build* (1). Для каждой новой загрузки
   Build увеличивать на 1.
3. Проверить на симуляторе iPhone (кнопка ▶︎): вход, учёба, настройки, «Daily reminder».
4. Сверху выбрать устройство **Any iOS Device (arm64)** → меню **Product → Archive**.
5. В открывшемся Organizer: **Distribute App → App Store Connect → Upload**.
6. Через 10–30 минут сборка появится в App Store Connect → TestFlight. Её можно поставить себе
   через TestFlight, затем выбрать в карточке версии для ревью.

## Карточка в App Store Connect

- Privacy Policy URL: `https://<домен>/privacy`
- Support URL: `https://<домен>/support`
- Категория: Education.
- Возрастной рейтинг: 18+. В анкете App Information → Age Ratings ответьте на вопросы честно,
  затем выберите *Override to Higher Age Rating* → 18+. В Terms минимальный возраст 18 лет
  (этого требуют условия Gemini API), а Apple требует, чтобы рейтинг был не ниже возраста из Terms.
- Скриншоты iPhone 6.9" (1320×2868) обязательны; 6.5" (1284×2778) желательно.
- App Review → Sign-in required: логин и пароль демо-аккаунта с подтверждённым email и парой колод.
- Notes for Review (пример): «Memora is a flashcard app. Users can publish decks to a community;
  every deck and creator page has Report and Block. Reports are reviewed within 24 hours in the
  in-app moderation queue. Account deletion: Profile → Delete account.»
- App Privacy: Contact Info (email), User Content (колоды, фото), Identifiers (User ID),
  Usage Data (прогресс учёбы). Всё «Linked to user», «Not used for tracking».

## Если поменялся домен

Поменять `PRODUCTION_URL` в `capacitor.config.ts` и адрес в `ios-shell/index.html` и
`ios-shell/offline.html`, затем `npm run ios:sync` и новая сборка.
