# Travel AI Russia (MVP)

MVP-сайт: ввод параметров поездки и генерация маршрута по России через GigaChat API.

## Что умеет

- Принимает: срок, город старта, город окончания, бюджет.
- Отправляет запрос в GigaChat.
- Возвращает готовый маршрут: путь, расписание по дням, бюджет, советы.
- Показывает результат в стиле travel-лендинга (как в вашем примере).

## Быстрый старт

1. Установите зависимости:

```bash
npm install
```

2. Создайте `.env`:

```bash
cp .env.example .env
```

3. Вставьте ваш токен в `GIGACHAT_TOKEN`.

4. Запустите:

```bash
npm run dev
```

5. Откройте [http://localhost:3000](http://localhost:3000).

## Примечание по GigaChat

Если API возвращает формат, отличный от JSON, сервер пытается извлечь JSON автоматически.  
Для production лучше добавить:

- валидацию схемы (например, через `zod`);
- retry/backoff;
- кэширование и логирование запросов.

## Отдельный фронт и бэкенд

Можно разделить деплой:

- фронт (статический) на GitHub Pages;
- бэкенд (`server.js`) на Render/Railway.

### Фронт на GitHub Pages

1. В корне уже есть `index.html` (использует файлы из `public`).
2. В репозитории включите GitHub Pages (`Settings` -> `Pages` -> `Deploy from branch`, branch `main`, folder `/root`).
3. Опционально в `public/config.js` задайте адрес API:

```js
window.TRAVEL_API_BASE = "https://your-backend.example.com";
```

### Бэкенд отдельно

1. Разверните проект как Node.js сервис.
2. Передайте переменные окружения из `.env`.
3. Убедитесь, что публичный URL бэкенда доступен по `https://.../api/plan`.

## Безопасный деплой (рекомендуется)

### 1) Бэкенд на Render/Railway

- Репозиторий можно оставить публичным: ключ хранится только в env-переменных хостинга.
- Добавьте env в хостинг:
  - `GIGACHAT_TOKEN` или `GIGACHAT_AUTH_KEY`
  - `GIGACHAT_USE_OAUTH=true`
  - `FRONTEND_ORIGIN=https://wailance.github.io`
  - `GIGACHAT_INSECURE_TLS=false` (для production)

### 2) Фронт на GitHub Pages

- В `public/config.js` укажите URL вашего backend:

```js
window.TRAVEL_API_BASE = "https://your-backend.onrender.com";
```

### Что уже защищено в коде

- `.env` игнорируется git и не публикуется.
- CORS разрешает только `FRONTEND_ORIGIN` и `localhost`.
- Rate limit на API: 30 запросов за 15 минут с IP.

### Быстрый старт на Render (Blueprint)

1. Откройте [Render Dashboard](https://dashboard.render.com/).
2. `New` -> `Blueprint`.
3. Подключите репозиторий `Wailance/travel-ai-russia`.
4. Выберите ветку `split-frontend-backend`.
5. Render прочитает `render.yaml` и создаст сервис `travel-ai-russia-api`.
6. В `Environment` заполните один из секретов:
   - `GIGACHAT_TOKEN`, или
   - `GIGACHAT_AUTH_KEY`.
7. Дождитесь статуса `Live` и скопируйте URL сервиса.
8. В `public/config.js` укажите:

```js
window.TRAVEL_API_BASE = "https://<your-render-service>.onrender.com";
```

9. Закоммитьте `public/config.js` в ветку `split-frontend-backend`, чтобы GitHub Pages начал ходить в backend.
