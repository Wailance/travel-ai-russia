const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

dotenv.config();

if (process.env.GIGACHAT_INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const app = express();
const port = process.env.PORT || 3000;
const frontendOrigin =
  process.env.FRONTEND_ORIGIN || "https://wailance.github.io";

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          "data:",
          "https://*.tile.openstreetmap.org",
          "https://static-maps.yandex.ru",
          "https://upload.wikimedia.org"
        ],
        connectSrc: ["'self'"]
      }
    }
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin === frontendOrigin || origin.startsWith("http://localhost:")) {
        return callback(null, true);
      }
      try {
        const host = new URL(origin).hostname;
        if (host.endsWith(".github.io") || host === "github.io") {
          return callback(null, true);
        }
      } catch (_) {
        // ignore invalid origin URL
      }
      return callback(new Error("CORS origin denied"));
    }
  })
);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function debugLog(location, message, data, hypothesisId, runId = "baseline") {
  // #region agent log
  fetch("http://127.0.0.1:7473/ingest/f954c55e-7734-452b-9d4d-32a3cda1b5dd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "db5575" },
    body: JSON.stringify({
      sessionId: "db5575",
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Слишком много запросов. Попробуйте позже."
  }
});

app.use("/api", apiLimiter);

const DEFAULT_CITY_COORDS = {
  "москва": { lat: 55.7558, lon: 37.6176 },
  "санкт-петербург": { lat: 59.9343, lon: 30.3351 },
  "санкт петербург": { lat: 59.9343, lon: 30.3351 },
  "владимир": { lat: 56.1291, lon: 40.4066 },
  "ярославль": { lat: 57.6261, lon: 39.8845 },
  "сергиев посад": { lat: 56.3153, lon: 38.1359 },
  "переславль-залесский": { lat: 56.736, lon: 38.8544 },
  "переславль залесский": { lat: 56.736, lon: 38.8544 },
  "ростов великий": { lat: 57.1914, lon: 39.4139 },
  "суздаль": { lat: 56.4197, lon: 40.4495 },
  "нижний новгород": { lat: 56.3269, lon: 44.0059 },
  "казань": { lat: 55.7961, lon: 49.1064 },
  "екатеринбург": { lat: 56.8389, lon: 60.6057 },
  "сочи": { lat: 43.5855, lon: 39.7231 },
  "новосибирск": { lat: 55.0084, lon: 82.9357 }
};

const CITY_IATA = {
  "москва": "MOW",
  "санкт-петербург": "LED",
  "санкт петербург": "LED",
  "нижний новгород": "GOJ",
  "казань": "KZN",
  "екатеринбург": "SVX",
  "сочи": "AER",
  "новосибирск": "OVB",
  "владимир": null,
  "ярославль": null,
  "сергиев посад": null,
  "суздаль": null
};

const INTERMEDIATE_CITY_POOL = [
  "Владимир",
  "Суздаль",
  "Ярославль",
  "Ростов Великий",
  "Сергиев Посад",
  "Переславль-Залесский",
  "Нижний Новгород",
  "Тверь",
  "Казань",
  "Сочи"
];

function sanitizeCityCount(rawCityCount, days) {
  const dayCount = Math.max(1, Number(days) || 1);
  const maxCities = Math.min(Math.max(2, dayCount), 10);
  let count = Number(rawCityCount);
  if (!Number.isFinite(count)) count = 2;
  count = Math.round(count);
  if (count < 2) count = 2;
  if (count > maxCities) count = maxCities;
  return count;
}

function buildRoutePoints({ startCity, endCity, cityCount, days, seedPoints = [] }) {
  const targetCount = sanitizeCityCount(cityCount, days);
  const start = String(startCity || "").trim();
  const end = String(endCity || "").trim();
  if (targetCount <= 2) return [start, end];

  const used = new Set([normalizeCityKey(start), normalizeCityKey(end)]);
  const intermediates = [];

  for (const city of seedPoints) {
    if (intermediates.length >= targetCount - 2) break;
    const key = normalizeCityKey(city);
    if (!key || used.has(key)) continue;
    used.add(key);
    intermediates.push(String(city).trim());
  }

  for (const city of INTERMEDIATE_CITY_POOL) {
    if (intermediates.length >= targetCount - 2) break;
    const key = normalizeCityKey(city);
    if (used.has(key)) continue;
    used.add(key);
    intermediates.push(city);
  }

  return [start, ...intermediates, end];
}

function distributeDayCounts(totalDays, citiesCount) {
  const counts = Array(citiesCount).fill(1);
  let remaining = Math.max(0, totalDays - citiesCount);
  let idx = 0;
  while (remaining > 0) {
    counts[idx % citiesCount] += 1;
    remaining -= 1;
    idx += 1;
  }
  return counts;
}

function applyCityCountToPlan(plan, { startCity, endCity, cityCount, days }) {
  const normalized = { ...plan };
  const targetDays = Math.max(1, Number(days) || normalized.days?.length || 1);
  const routePoints = buildRoutePoints({
    startCity,
    endCity,
    cityCount,
    days: targetDays,
    seedPoints: normalized.routePoints || []
  });
  const dayCounts = distributeDayCounts(targetDays, routePoints.length);
  const dayList = Array.isArray(normalized.days) ? [...normalized.days] : [];

  let dayIndex = 0;
  for (let cityIndex = 0; cityIndex < routePoints.length; cityIndex += 1) {
    const city = routePoints[cityIndex];
    for (let slot = 0; slot < dayCounts[cityIndex] && dayIndex < dayList.length; slot += 1) {
      dayList[dayIndex] = {
        ...dayList[dayIndex],
        city
      };
      dayIndex += 1;
    }
  }

  normalized.days = dayList;
  normalized.routePoints = routePoints;
  normalized.cityCount = routePoints.length;
  return normalized;
}

const TRIP_GOALS = [
  {
    id: "balanced",
    label: "Сбалансированный маршрут",
    hint: "Смешанная программа без перекоса в одну тему: достопримечательности, культура, еда и отдых."
  },
  {
    id: "landmarks",
    label: "Достопримечательности",
    hint: "Главные символы городов: площади, набережные, обзорные точки, знаковые ансамбли."
  },
  {
    id: "culture",
    label: "Культурное просвещение",
    hint: "Музеи, выставки, театры, архитектурные маршруты, познавательные экскурсии."
  },
  {
    id: "gastronomy",
    label: "Гастрономия",
    hint: "Конкретные рестораны, рынки, дегустации и региональная кухня."
  },
  {
    id: "orthodox",
    label: "Православие",
    hint: "Соборы, монастыри и святыни; укажи правила посещения (одежда, тишина, расписание служб)."
  },
  {
    id: "nature",
    label: "Природа и отдых",
    hint: "Парки, заповедники, набережные, спокойные прогулки на свежем воздухе."
  },
  {
    id: "family",
    label: "С семьёй / детьми",
    hint: "Короткие переезды, интерактив и места, удобные для детей."
  },
  {
    id: "romantic",
    label: "Романтика / пара",
    hint: "Атмосферные прогулки, виды, ужины и камерные локации."
  },
  {
    id: "active",
    label: "Активный отдых",
    hint: "Пешие маршруты, велопрогулки, лёгкий треккинг без экстремальных нагрузок."
  },
  {
    id: "shopping",
    label: "Шопинг и сувениры",
    hint: "Рынки, лавки, локальные бренды и сувенирные точки."
  },
  {
    id: "photo",
    label: "Фото и красивые виды",
    hint: "Смотровые площадки, рассветы/закаты и живописные ракурсы."
  },
  {
    id: "history",
    label: "История и патриотика",
    hint: "Мемориалы, музеи истории, места военной и государственной памяти."
  },
  {
    id: "nightlife",
    label: "Ночная жизнь",
    hint: "Вечерние прогулки, бары, концерты; программа только для 18+."
  }
];

const TRIP_GOALS_BY_ID = Object.fromEntries(TRIP_GOALS.map((goal) => [goal.id, goal]));

function sanitizeTripGoals(rawGoals) {
  const list = Array.isArray(rawGoals) ? rawGoals : [];
  const unique = [];
  for (const item of list) {
    const id = String(item || "").trim();
    if (!TRIP_GOALS_BY_ID[id] || unique.includes(id)) continue;
    unique.push(id);
  }

  if (!unique.length || unique.includes("balanced")) {
    return ["balanced"];
  }

  return unique.slice(0, 3);
}

function formatTripGoalsForPrompt(goalIds) {
  return goalIds
    .map((id) => TRIP_GOALS_BY_ID[id])
    .filter(Boolean)
    .map((goal) => `- ${goal.label}: ${goal.hint}`)
    .join("\n");
}

const GIGACHAT_SYSTEM_PROMPT = `
Ты планировщик маршрутов по России. Главное правило: не выдумывай.
- Указывай только реально существующие города, музеи, рестораны и отели с точным названием.
- Если не уверен в цене или названии — cost: null, priceStatus: "unknown".
- Не придумывай «лучшие», «секретные» или «малоизвестные» места.
- Не используй плейсхолдеры: «кафе», «музей», «ресторан», «активности» без конкретного имени.
`.trim();

const GENERIC_PLACE_PATTERNS = [
  /^(место|локация|достопримечательност|экскурсия|музей|ресторан|кафе|парк|активност|прогулка|обед|ужин|завтрак|питание|проживание|отель|гостиница|транспорт|смотровая|площадь|набережная|центр города)/i,
  /^(посещение|осмотр|знакомство|экскурсия по|обзор|свободное время)/i,
  /^(активности и экскурсии|транспорт по маршруту)$/i,
  /лучший|популярн|известн|необычн|уникальн|романтичн|уютн|красив|знаменит|секретн|малоизвестн|легендарн|топ-\d/i
];

function isGenericPlaceName(place) {
  const p = String(place || "").trim();
  if (p.length < 5) return true;
  if (GENERIC_PLACE_PATTERNS.some((re) => re.test(p))) return true;
  if (/^(кафе|ресторан|музей|парк|отель|площадь|собор|храм|театр|еда|питание|проживание)$/i.test(p)) {
    return true;
  }
  return false;
}

function looksPossiblyHallucinated(place) {
  return /(лучший|топ-|секретн|малоизвестн|легендарн|уникальн|незабываем|скрытый|must see|instagram)/i.test(
    String(place || "")
  );
}

function classifyItemType(item) {
  const text = `${item?.place || ""} ${item?.comment || ""}`.toLowerCase();
  if (/(отел|гостиниц|проживан|ночлег|апартамент)/.test(text)) return "hotel";
  if (/(обед|ужин|завтрак|кафе|ресторан|еда|питани|фуд)/.test(text)) return "food";
  if (/(переезд|трансфер|поезд|самолет|автобус|метро|такси|транспорт)/.test(text)) {
    return "transport";
  }
  return "activity";
}

function isKnownVenue(place, city) {
  const key = normalizeCityKey(city);
  const rec = CITY_RECOMMENDATIONS[key];
  if (!rec) return false;
  const p = String(place || "").toLowerCase();
  const all = [...(rec.food || []), ...(rec.hotel || []), ...(rec.activity || [])];
  return all.some((name) => {
    const n = name.toLowerCase();
    return p.includes(n.slice(0, Math.min(14, n.length))) || n.includes(p.slice(0, Math.min(14, p.length)));
  });
}

function formatVerifiedPoisForPrompt(routePoints) {
  const lines = [];
  for (const city of routePoints) {
    const key = normalizeCityKey(city);
    const rec = CITY_RECOMMENDATIONS[key];
    if (!rec) continue;
    const samples = [...(rec.activity || []).slice(0, 3), ...(rec.food || []).slice(0, 2)];
    if (samples.length) lines.push(`- ${city}: ${samples.join("; ")}`);
  }
  return lines.length
    ? lines.join("\n")
    : "- Используй только общеизвестные объекты с точным официальным названием.";
}

function buildPrompt({ days, startCity, endCity, cityCount, budget, needAccommodation, hasOwnCar, tripGoals }) {
  const goals = sanitizeTripGoals(tripGoals);
  const goalsBlock = formatTripGoalsForPrompt(goals);
  const suggestedRoute = buildRoutePoints({ startCity, endCity, cityCount, days });
  const verifiedPois = formatVerifiedPoisForPrompt(suggestedRoute);
  const allowedCities = Object.keys(DEFAULT_CITY_COORDS)
    .map((k) => k.replace(/\b\w/g, (c) => c.toUpperCase()))
    .slice(0, 12)
    .join(", ");

  return `
Ты — умный тревел-планировщик по России.
Сформируй маршрут строго в формате JSON без markdown и без пояснений вне JSON.

Ограничения пользователя:
- Длительность поездки: ${days} дней
- Город старта: ${startCity}
- Город окончания: ${endCity}
- Количество посещаемых городов: ${cityCount} (включая старт и финиш)
- Бюджет: ${budget} рублей
- Нужно проживание: ${needAccommodation ? "да" : "нет"}
- Есть свое авто: ${hasOwnCar ? "да" : "нет"}
- Цели поездки (до 3, обязательно учесть в программе):
${goalsBlock}

Верни JSON следующей структуры:
{
  "title": "Короткий заголовок маршрута",
  "summary": "1-2 предложения об идее путешествия",
  "budgetPlan": {
    "transport": число,
    "hotel": число,
    "food": число,
    "activities": число,
    "reserve": число,
    "total": число
  },
  "days": [
    {
      "day": 1,
      "city": "Название города",
      "dateLabel": "День 1",
      "items": [
        {
          "time": "09:00",
          "place": "Место или активность",
          "cost": число или null,
          "comment": "Краткое описание",
          "priceNote": "Откуда цена: официальный сайт/касса/меню/сервис",
          "priceStatus": "verified|unknown"
        }
      ]
    }
  ],
  "routePoints": ["Город 1", "Город 2", "Город 3"],
  "tips": ["Совет 1", "Совет 2"]
}

Важно:
- total должен быть <= ${budget}
- Количество days должно быть ровно ${days}
- routePoints должен содержать ровно ${cityCount} уникальных городов России
- Первый город в routePoints: ${startCity}, последний: ${endCity}
- Рекомендуемая цепочка городов: ${suggestedRoute.join(" → ")}
- В routePoints используй только города из этой цепочки или близкие реальные (Золотое кольцо, крупные города)
- Маршрут должен быть реалистичен по логистике
- Используй только города России; ориентир: ${allowedCities}
- Для еды указывай конкретные места (название заведения), не пиши общие слова вроде "кафе" или "ресторан" без названия
- Для проживания (если нужно) указывай конкретный объект размещения (название отеля/апартаментов)
- Если точная цена неизвестна, ставь cost: null и priceStatus: "unknown", не ставь 0 и не придумывай сумму
- Никогда не ставь priceStatus: "verified", если цена не взята с официального сайта — модель всегда пишет "unknown"
- Подбирай места и активности под все выбранные цели поездки; при нескольких целях чередуй акценты по дням

Анти-галлюцинации (обязательно):
- Не выдумывай названия музеев, ресторанов и отелей
- Не придумывай цены и расписания
- Примеры проверенных объектов по маршруту (можно использовать дословно):
${verifiedPois}
- Если не знаешь точное название — выбери общеизвестную достопримечательность города (Красная площадь, Эрмитаж, Казанский Кремль и т.п.)
`.trim();
}

const CITY_RECOMMENDATIONS = {
  "москва": {
    food: ["Депо Москва (фудмолл)", "Вареничная №1 (Арбат)", "ДжонДжоли (Смоленская)"],
    hotel: ["Azimut Сити Отель Смоленская", "Ibis Moscow Centre Bakhrushina", "Holiday Inn Moscow Sokolniki"],
    activity: ["Красная площадь", "Государственный исторический музей", "ВДНХ", "Парк Зарядье", "Третьяковская галерея"]
  },
  "санкт-петербург": {
    food: ["Marketplace (Невский проспект)", "Pkhali Khinkali (Садовая)", "Брынза (Невский)"],
    hotel: ["AZIMUT Сити Отель Санкт-Петербург", "Ibis Saint Petersburg Centre", "Station Hotel M19"],
    activity: ["Эрмитаж", "Дворцовая площадь", "Исаакиевский собор", "Петропавловская крепость", "Невский проспект"]
  },
  "владимир": {
    food: ["Ресторан Обломов", "Кафе Гости", "Bulochnaya #1"],
    hotel: ["AMAKS Золотое Кольцо", "Вознесенская Слобода", "Гостиница Владимир"],
    activity: ["Золотые ворота", "Успенский собор", "Парк Победы", "Водонапорная башня (смотровая)"]
  },
  "ярославль": {
    food: ["Пенаты", "Собрание", "Кафе АндерСон"],
    hotel: ["Ring Premier Hotel", "Ibis Yaroslavl Center", "Cosmos Yaroslavl Hotel"],
    activity: ["Стрелка Волги и Которосли", "Успенский собор", "Спасо-Преображенский монастырь", "Волжская набережная"]
  },
  "сергиев посад": {
    food: ["Русский Дворик", "Гостевая Изба", "Келарская Набережная"],
    hotel: ["Царская Деревня", "Посадский", "Барские Полати"],
    activity: ["Троице-Сергиева лавра", "Конный двор", "Музей игрушки", "Пруд Красные баньки"]
  },
  "суздаль": {
    food: ["Трапезная Троице-Сергиевой лавры (Суздаль)", "Гостиный двор", "Кафе Старый город"],
    hotel: ["Суздаль", "Пушкарская слобода", "Отель Суздаль"],
    activity: ["Кремль Суздаля", "Спасо-Евфимиев монастырь", "Музей деревянного зодчества", "Торговые ряды"]
  },
  "ростов великий": {
    food: ["Русь", "Погост", "У Погоста"],
    hotel: ["Сосновый бор", "Ростов", "Спасо-Яковлевский монастырь (гостиница)"],
    activity: ["Ростовский кремль", "Спасо-Яковлевский монастырь", "Озеро Неро", "Музей финифти"]
  },
  "нижний новгород": {
    food: ["Вареничная №1", "Безухов", "Волга"],
    hotel: ["Azimut Отель Нижний Новгород", "Ibis Nizhny Novgorod", "Sheraton Nizhny Novgorod"],
    activity: ["Нижегородский кремль", "Чкаловская лестница", "Стрелка Оки и Волги", "Большая Покровская улица"]
  },
  "казань": {
    food: ["Тубэтей", "Дом татарской кулинарии", "Бульвар на Баумана"],
    hotel: ["Korston Club Hotel", "Ibis Kazan", "Courtyard by Marriott Kazan"],
    activity: ["Казанский Кремль", "Храм всех религий", "Улица Баумана", "Национальный музей Республики Татарстан"]
  },
  "екатеринбург": {
    food: ["Паштет", "Папа Карло", "Колбасофф"],
    hotel: ["Hyatt Regency Ekaterinburg", "Ibis Ekaterinburg Center", "Novotel Yekaterinburg"],
    activity: ["Плотинка", "Храм на Крови", "Екатеринбургский музей изобразительных искусств", "Высоцкий смотровая"]
  },
  "сочи": {
    food: ["Гагри", "Сан-Ремо", "Хинкальная на Навагинской"],
    hotel: ["Radisson Collection Paradise", "Hyatt Regency Sochi", "Bridge Resort"],
    activity: ["Сочинский национальный парк", "Олимпийский парк", "Дендрарий", "Красная Поляна (канатная дорога)"]
  },
  "новосибирск": {
    food: ["Beerman & Grill", "Тюбетей", "Пепперони"],
    hotel: ["Novotel Novosibirsk", "DoubleTree by Hilton", "Azimut Отель Новосибирск"],
    activity: ["Новосибирский государственный художественный музей", "Театр оперы и балета", "Метромост", "Зоопарк"]
  },
  "переславль-залесский": {
    food: ["Хлебник", "Трапезная", "Русский дворик"],
    hotel: ["Русь", "Переславль", "Хостел на Красной площади"],
    activity: ["Красная площадь", "Спасо-Преображенский собор", "Музей утюга", "Плещеево озеро"]
  }
};

function pickSpecific(city, type, index) {
  const key = (city || "").trim().toLowerCase();
  const list = CITY_RECOMMENDATIONS[key]?.[type];
  if (list && list.length) return list[index % list.length];
  const defaults = {
    food: "Теремок (центр города)",
    hotel: "Отель в центре — уточните на booking.com",
    activity: "Исторический центр и главная площадь",
    transport: "Локальный транспорт по маршруту"
  };
  return defaults[type] || defaults.activity;
}

async function groundPlanPlaces(plan, { maxGeocodes = 10 } = {}) {
  if (!plan || !Array.isArray(plan.days)) {
    return { plan, stats: { replaced: 0, geocodeChecks: 0 } };
  }

  const cache = new Map();
  let geocodeChecks = 0;
  let replaced = 0;

  for (let dayIndex = 0; dayIndex < plan.days.length; dayIndex += 1) {
    const day = plan.days[dayIndex];
    if (!Array.isArray(day.items)) continue;
    const city = day.city || "";

    for (let itemIndex = 0; itemIndex < day.items.length; itemIndex += 1) {
      const item = day.items[itemIndex];
      const place = String(item.place || "").trim();
      const type = classifyItemType(item);

      item.priceStatus = "unknown";
      if (Number(item.cost) > 0) {
        item.cost = null;
        if (!item.priceNote) {
          item.priceNote = "Цена не подтверждена — проверьте на официальном сайте.";
        }
      }

      if (isGenericPlaceName(place)) {
        item.place = pickSpecific(city, type, dayIndex + itemIndex);
        item.cost = null;
        item.priceStatus = "unknown";
        item.priceNote = "Подобрано из проверенного списка; цену уточните на месте.";
        item.grounded = true;
        replaced += 1;
        continue;
      }

      const shouldGeocode =
        geocodeChecks < maxGeocodes &&
        !isKnownVenue(place, city) &&
        (looksPossiblyHallucinated(place) || place.length >= 12);

      if (!shouldGeocode) continue;

      geocodeChecks += 1;
      const poi = await geocodePlace(place, city, cache);
      if (!poi) {
        const previous = place;
        item.place = pickSpecific(city, type, dayIndex + itemIndex);
        item.comment = `${item.comment || ""} Заменено: «${previous}» не найдено на карте.`.trim();
        item.cost = null;
        item.priceStatus = "unknown";
        item.grounded = true;
        replaced += 1;
      }
    }
  }

  return { plan, stats: { replaced, geocodeChecks } };
}

async function geocodeCity(city, cache) {
  const aliases = {
    "ростов": "Ростов Великий",
    "нижний новгород": "Нижний Новгород",
    "санкт петербург": "Санкт-Петербург"
  };
  const normalizedCity = aliases[city.trim().toLowerCase()] || city;
  const key = city.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    `${normalizedCity}, Россия`
  )}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "travel-ai-russia/1.0" }
  });
  let point = null;
  if (response.ok) {
    const data = await response.json();
    if (Array.isArray(data) && data[0]) {
      point = {
        city: normalizedCity,
        lat: Number(data[0].lat),
        lon: Number(data[0].lon)
      };
    }
  }
  if (!point) {
    const fallback = DEFAULT_CITY_COORDS[normalizedCity.trim().toLowerCase()];
    if (!fallback) return null;
    point = {
      city: normalizedCity,
      lat: fallback.lat,
      lon: fallback.lon
    };
  }
  cache.set(key, point);
  return point;
}

async function geocodePlace(place, city, cache) {
  const cleanPlace = String(place || "")
    .replace(/["']/g, "")
    .split(",")[0]
    .trim();
  const query = `${cleanPlace || place}, ${city}, Россия`;
  const key = query.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    query
  )}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "travel-ai-russia/1.0" }
  });
  let point = null;
  if (response.ok) {
    const data = await response.json();
    if (Array.isArray(data) && data[0]) {
      point = {
        name: place,
        lat: Number(data[0].lat),
        lon: Number(data[0].lon)
      };
    }
  }
  if (!point) return null;
  cache.set(key, point);
  return point;
}

function haversineKm(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function getDrivingMetrics(a, b) {
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
  const response = await fetch(osrmUrl);
  if (!response.ok) return null;
  const data = await response.json();
  const route = data?.routes?.[0];
  if (!route) return null;
  return {
    distanceKm: route.distance / 1000,
    durationHours: route.duration / 3600
  };
}

function estimateByMode(distanceKm, mode) {
  if (mode === "plane") {
    // Airport transfer, security and boarding noticeably add fixed time.
    return { distanceKm, durationHours: distanceKm / 690 + 3.2 };
  }
  if (mode === "train") {
    return { distanceKm, durationHours: distanceKm / 80 + 1.2 };
  }
  if (mode === "bus") {
    return { distanceKm, durationHours: distanceKm / 48 + 0.9 };
  }
  return { distanceKm, durationHours: distanceKm / 56 + 0.35 };
}

function estimateTransportCost(distanceKm, mode) {
  if (mode === "plane") {
    return Math.max(3500, Math.round(2600 + distanceKm * 6.8));
  }
  if (mode === "train") {
    return Math.max(1200, Math.round(700 + distanceKm * 3.5));
  }
  if (mode === "bus") {
    return Math.max(700, Math.round(320 + distanceKm * 2.8));
  }
  // Car estimate: fuel + toll/parking buffer for intercity legs.
  return Math.max(900, Math.round(420 + distanceKm * 10.2));
}

function resolveIataByCity(city) {
  return CITY_IATA[normalizeCityKey(city)] || null;
}

function addDaysIso(daysAhead = 14) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

async function fetchLiveFlightPrice(fromCity, toCity, daysAhead = 14) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) return null;
  const origin = resolveIataByCity(fromCity);
  const destination = resolveIataByCity(toCity);
  if (!origin || !destination) return null;
  const departDate = addDaysIso(daysAhead).slice(0, 7);
  const url =
    `https://api.travelpayouts.com/v1/prices/cheap` +
    `?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    `&depart_date=${encodeURIComponent(departDate)}` +
    `&currency=rub&token=${encodeURIComponent(token)}`;

  const response = await fetch(url, {
    headers: { "User-Agent": "travel-ai-russia/1.0" }
  });
  if (!response.ok) return null;
  const data = await response.json();
  const destinationData = data?.data?.[destination];
  if (!destinationData || typeof destinationData !== "object") return null;
  const firstOffer = Object.values(destinationData)[0];
  const bestPrice = Number(firstOffer?.price);
  if (!Number.isFinite(bestPrice) || bestPrice <= 0) return null;
  return Math.round(bestPrice);
}

function normalizeCityKey(city) {
  return String(city || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

const INTERCITY_MODE_RULES = new Map([
  ["москва|санкт-петербург", "train"],
  ["москва|владимир", "train"],
  ["москва|нижний новгород", "train"],
  ["москва|казань", "train"],
  ["владимир|нижний новгород", "train"],
  ["владимир|ярославль", "bus"],
  ["москва|сочи", "plane"],
  ["москва|екатеринбург", "plane"],
  ["москва|новосибирск", "plane"],
  ["санкт-петербург|сочи", "plane"],
  ["санкт-петербург|екатеринбург", "plane"],
  ["санкт-петербург|новосибирск", "plane"],
  ["екатеринбург|новосибирск", "plane"]
]);

function getPreferredModeByCities(fromCity, toCity) {
  const from = normalizeCityKey(fromCity);
  const to = normalizeCityKey(toCity);
  if (!from || !to) return null;
  const direct = `${from}|${to}`;
  const reverse = `${to}|${from}`;
  return INTERCITY_MODE_RULES.get(direct) || INTERCITY_MODE_RULES.get(reverse) || null;
}

function pickIntercityMode(distanceKm) {
  if (distanceKm >= 1200) return "plane";
  if (distanceKm >= 350) return "train";
  if (distanceKm >= 120) return "bus";
  return "car";
}

function estimateLocalTransportCost(city) {
  const key = normalizeCityKey(city);
  if (["москва", "санкт-петербург", "санкт петербург", "казань", "екатеринбург"].includes(key)) {
    return 900;
  }
  return 700;
}

function applyIntercityRealism(mode, rawMetrics, rawCostEstimate) {
  const distanceKm = Number(rawMetrics.distanceKm || 0);
  const baseDuration = Number(rawMetrics.durationHours || 0);
  const extraByMode =
    mode === "plane" ? 0.6 : mode === "train" ? 0.4 : mode === "bus" ? 0.3 : 0.25;
  const adjustedDuration = Math.max(baseDuration + extraByMode, distanceKm / 75);
  const costFloorByMode =
    mode === "plane" ? 3500 : mode === "train" ? 1200 : mode === "bus" ? 700 : 900;
  return {
    distanceKm,
    durationHours: adjustedDuration,
    costEstimate: Math.max(costFloorByMode, Math.round(rawCostEstimate))
  };
}

async function buildLogistics(routePoints, options = {}) {
  const hasOwnCar = options.hasOwnCar === true;
  debugLog(
    "server.js:buildLogistics:start",
    "Build logistics started",
    { routePointsCount: Array.isArray(routePoints) ? routePoints.length : 0, routePoints },
    "H6"
  );
  const points = [];
  const geocodeCache = new Map();
  for (const city of routePoints) {
    const point = await geocodeCity(city, geocodeCache);
    if (point) points.push(point);
  }

  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const crowDistance = haversineKm(from, to);
    const driving = await getDrivingMetrics(from, to);
    const baseDistanceKm = driving?.distanceKm || crowDistance;
    const preferredMode = getPreferredModeByCities(from.city, to.city);
    let mode = preferredMode || pickIntercityMode(baseDistanceKm);
    if (hasOwnCar) {
      mode = baseDistanceKm > 1600 ? "plane" : "car";
    }
    const rawMetrics =
      mode === "car" && driving ? driving : estimateByMode(baseDistanceKm, mode);
    let costEstimate = estimateTransportCost(rawMetrics.distanceKm, mode);
    let priceSource = "estimated";

    if (mode === "plane") {
      try {
        const livePrice = await fetchLiveFlightPrice(from.city, to.city, 12 + i * 5);
        if (Number.isFinite(livePrice) && livePrice > 0) {
          costEstimate = livePrice;
          priceSource = "live";
        }
      } catch (_) {
        // Keep estimate if external live tariff source is unavailable.
      }
    }

    const adjusted = applyIntercityRealism(mode, rawMetrics, costEstimate);
    costEstimate = adjusted.costEstimate;

    debugLog(
      "server.js:buildLogistics:segment",
      "Segment calculated",
      {
        from: from.city,
        to: to.city,
        crowDistance: Number(crowDistance.toFixed(1)),
        hasDrivingMetrics: Boolean(driving),
        baseDistanceKm: Number(baseDistanceKm.toFixed(1)),
        preferredMode,
        chosenMode: mode,
        durationHoursRaw: Number(rawMetrics.durationHours.toFixed(2)),
        durationHoursAdjusted: Number(adjusted.durationHours.toFixed(2)),
        costEstimate,
        priceSource
      },
      "H7"
    );

    segments.push({
      from: from.city,
      to: to.city,
      mode,
      distanceKm: Math.round(adjusted.distanceKm),
      durationHours: Number(adjusted.durationHours.toFixed(1)),
      costEstimate,
      priceSource
    });
  }

  debugLog(
    "server.js:buildLogistics:done",
    "Build logistics finished",
    { pointsCount: points.length, segmentsCount: segments.length },
    "H6"
  );
  return { points, segments };
}

async function fetchPlaceImage(placeName, city, cache) {
  const cacheKey = `${placeName}||${city}`.toLowerCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const queries = [
    placeName,
    `${placeName} ${city}`,
    `${placeName} Россия`
  ];

  for (const query of queries) {
    try {
      const url =
        `https://ru.wikipedia.org/w/api.php?action=query` +
        `&titles=${encodeURIComponent(query)}` +
        `&prop=pageimages&format=json&pithumbsize=480&redirects=1`;
      const response = await fetch(url, {
        headers: { "User-Agent": "travel-ai-russia/1.0" }
      });
      if (!response.ok) continue;
      const data = await response.json();
      const pages = data?.query?.pages;
      if (!pages) continue;
      const page = Object.values(pages)[0];
      const thumb = page?.thumbnail?.source;
      if (thumb) {
        cache.set(cacheKey, thumb);
        return thumb;
      }
    } catch (_) {
      // Wikipedia unavailable — skip silently
    }
  }

  cache.set(cacheKey, null);
  return null;
}

function isPhotoWorthy(item) {
  const text = `${item?.place || ""} ${item?.comment || ""}`.toLowerCase();
  if (/(транспорт|переезд|трансфер|поезд|автобус|такси|метро)/i.test(text)) return false;
  if (/(отел|гостиниц|апартамент|хостел|размещени|ночлег)/i.test(text)) return false;
  if (/(питание|обед в городе|ужин в городе)$/i.test(String(item?.place || "").trim())) return false;
  return true;
}

async function enrichPlanWithImages(plan, { maxImages = 20 } = {}) {
  if (!plan || !Array.isArray(plan.days)) return plan;

  const cache = new Map();
  let fetched = 0;

  for (const day of plan.days) {
    if (!Array.isArray(day.items)) continue;
    for (const item of day.items) {
      if (fetched >= maxImages) break;
      if (!isPhotoWorthy(item)) continue;
      const place = String(item.place || "").trim();
      if (!place || place.length < 4) continue;

      const imageUrl = await fetchPlaceImage(place, day.city || "", cache);
      fetched += 1;
      if (imageUrl) {
        item.imageUrl = imageUrl;
      }
    }
  }

  return plan;
}

async function enrichPlanWithDayMaps(plan) {
  const normalized = { ...plan };
  const geocodeCache = new Map();
  const days = Array.isArray(normalized.days) ? normalized.days : [];

  normalized.days = await Promise.all(
    days.map(async (day) => {
      const cityPoint = await geocodeCity(day.city || "", geocodeCache);
      const pois = [];
      const items = Array.isArray(day.items) ? day.items.slice(0, 6) : [];

      for (const item of items) {
        if (!item?.place) continue;
        const poi = await geocodePlace(item.place, day.city || "", geocodeCache);
        if (poi) {
          pois.push({
            name: item.place,
            time: item.time || "",
            lat: poi.lat,
            lon: poi.lon
          });
        }
      }

      if (cityPoint && pois.length === 0) {
        const fallbackItems = items
          .filter((item) => item?.place && !/транспорт по маршруту|питание|проживание/i.test(String(item.place)))
          .slice(0, 4);
        fallbackItems.forEach((item, idx) => {
          const latOffset = 0.01 * (idx + 1);
          const lonOffset = 0.012 * (idx % 2 === 0 ? 1 : -1);
          pois.push({
            name: item.place,
            time: item.time || "",
            lat: Number((cityPoint.lat + latOffset).toFixed(6)),
            lon: Number((cityPoint.lon + lonOffset).toFixed(6)),
            approximate: true
          });
        });
      }

      return {
        ...day,
        mapData: cityPoint
          ? {
              center: { lat: cityPoint.lat, lon: cityPoint.lon },
              pois
            }
          : null
      };
    })
  );

  return normalized;
}

function parseModelJson(text) {
  if (!text) return null;
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/\/\/.*$/gm, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (err) {
      return null;
    }
  }
}

function normalizePlan(plan, budgetLimit, daysLimit, needAccommodation) {
  const normalized = { ...plan };
  const budgetPlan = { ...(normalized.budgetPlan || {}) };
  const fields = ["transport", "hotel", "food", "activities", "reserve"];
  let total = 0;

  fields.forEach((key) => {
    const value = Number(budgetPlan[key] || 0);
    budgetPlan[key] = Number.isFinite(value) && value > 0 ? value : 0;
    total += budgetPlan[key];
  });

  const cap = Number(budgetLimit);
  if (Number.isFinite(cap) && cap > 0 && total > cap) {
    budgetPlan.reserve = Math.max(0, budgetPlan.reserve - (total - cap));
    total =
      budgetPlan.transport +
      budgetPlan.hotel +
      budgetPlan.food +
      budgetPlan.activities +
      budgetPlan.reserve;
  }
  budgetPlan.total = total;
  normalized.budgetPlan = budgetPlan;

  const targetDays = Math.max(1, Number(daysLimit) || 1);
  const baseDays = Array.isArray(normalized.days) ? normalized.days.slice(0, targetDays) : [];
  const routePoints = Array.isArray(normalized.routePoints) ? normalized.routePoints : [];

  while (baseDays.length < targetDays) {
    const dayNumber = baseDays.length + 1;
    baseDays.push({
      day: dayNumber,
      city: routePoints[dayNumber - 1] || routePoints[routePoints.length - 1] || "Маршрут уточняется",
      dateLabel: `День ${dayNumber}`,
      items: []
    });
  }

  normalized.days = baseDays.map((day, index) => {
    const dayNumber = index + 1;
    const dayItems = Array.isArray(day.items) ? [...day.items] : [];
    const dayText = `${JSON.stringify(dayItems).toLowerCase()}`;

    const hasTransport = /(переезд|трансфер|поезд|самолет|автобус|метро|такси)/.test(dayText);
    const hasHotel = /(отел|гостиниц|проживан|ночлег|апартамент)/.test(dayText);
    const hasFood = /(обед|ужин|завтрак|кафе|ресторан|еда|питани)/.test(dayText);
    const hasActivities = /(экскурс|музей|прогулк|парк|достопримеч|активност)/.test(dayText);

    if (!hasTransport) {
      dayItems.push({
        time: "09:00",
        place: "Транспорт по маршруту",
        cost: null,
        comment: "Переезд/трансфер по плану дня.",
        priceStatus: "unknown",
        priceNote: "Требуется проверка тарифа перевозчика."
      });
    }
    if (!hasActivities) {
      dayItems.push({
        time: "11:00",
        place: pickSpecific(day.city, "activity", index),
        cost: null,
        comment: "Основные посещения и впечатления дня.",
        priceStatus: "unknown",
        priceNote: "Требуется проверить билет на официальном сайте."
      });
    }
    if (!hasFood) {
      dayItems.push({
        time: "14:00",
        place: pickSpecific(day.city, "food", index),
        cost: null,
        comment: "Конкретное место для обеда/ужина.",
        priceStatus: "unknown",
        priceNote: "Проверьте актуальное меню заведения."
      });
    }
    if (!hasHotel && needAccommodation) {
      dayItems.push({
        time: "20:00",
        place: pickSpecific(day.city, "hotel", index),
        cost: null,
        comment: "Конкретный вариант проживания.",
        priceStatus: "unknown",
        priceNote: "Проверьте цену за ночь на сайте отеля."
      });
    }

    for (const item of dayItems) {
      let place = String(item.place || "");
      const rawCost = Number(item.cost);
      item.cost = Number.isFinite(rawCost) && rawCost > 0 ? Math.round(rawCost) : null;
      if (isGenericPlaceName(place)) {
        const type = classifyItemType(item);
        item.place = pickSpecific(day.city, type, index);
        place = item.place;
        item.cost = null;
        item.priceStatus = "unknown";
        item.priceNote = "Подобрано из проверенного списка; цену уточните на месте.";
      }
      if (!item.cost) {
        item.priceStatus = "unknown";
        if (!item.priceNote) item.priceNote = "Цена не подтверждена, требуется проверка.";
      } else {
        item.priceStatus = "unknown";
        item.priceNote = "Цена не подтверждена — проверьте на официальном сайте.";
      }
      if (/^питание$/i.test(place) || /^еда$/i.test(place)) {
        item.place = pickSpecific(day.city, "food", index);
        item.comment = "Конкретное место для обеда/ужина.";
        item.cost = null;
        item.priceStatus = "unknown";
        item.priceNote = "Проверьте актуальное меню заведения.";
      }
      if (/^проживание$/i.test(place) || /^отель$/i.test(place) || /^гостиница$/i.test(place)) {
        item.place = pickSpecific(day.city, "hotel", index);
        item.comment = "Конкретный вариант проживания.";
        item.cost = null;
        item.priceStatus = "unknown";
        item.priceNote = "Проверьте цену за ночь на сайте отеля.";
      }

      const text = `${place} ${item.comment || ""}`.toLowerCase();
      const freePattern =
        /(красн(ая|ой)\s+площад|парк|набережн|кремл(ь|я)\s+снаружи|прогулк|улиц|сквер|смотров)/i;
      const foodPattern =
        /(ресторан|кафе|обед|ужин|завтрак|бистро|пицц|бар|фуд|столов|marketplace|депо|варенич|джонджоли|брынза|теремок|pkhali)/i;
      const hotelPattern =
        /(отел|гостиниц|апартамент|хостел|ночлег|размещени|hotel|inn|azimut|ibis|cosmos|amaks|station|holiday)/i;
      const transportPattern = /(транспорт|поезд|самолет|автобус|метро|такси|трансфер|переезд|вокзал)/i;
      const activityPattern = /(активност|экскурс|музе|собор|лавр|кремл|дворец|галере|театр|крепост|достопримеч)/i;

      if (item.cost == null) {
        if (freePattern.test(text)) {
          item.cost = 0;
          item.priceStatus = "verified";
          item.priceNote = "Обычно бесплатно.";
        } else if (transportPattern.test(text)) {
          item.cost = estimateLocalTransportCost(day.city);
          item.priceStatus = "estimated";
          item.priceNote = "Ориентир по городскому транспорту и локальным переездам.";
        } else if (hotelPattern.test(text)) {
          item.cost = 4600;
          item.priceStatus = "estimated";
          item.priceNote = "Ориентир за ночь в стандартном размещении.";
        } else if (foodPattern.test(text)) {
          item.cost = 1100;
          item.priceStatus = "estimated";
          item.priceNote = "Ориентир по среднему чеку.";
        } else if (activityPattern.test(text)) {
          item.cost = 850;
          item.priceStatus = "estimated";
          item.priceNote = "Ориентир по билету/входу.";
        } else {
          item.cost = 750 + index * 120;
          item.priceStatus = "estimated";
          item.priceNote = "Ориентировочная стоимость активности.";
        }
      }
    }

    const dayTotal = dayItems.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
    debugLog(
      "server.js:normalizePlan:day",
      "Normalized day costs",
      {
        day: dayNumber,
        city: day.city || null,
        itemsCount: dayItems.length,
        dayTotal
      },
      "H8"
    );

    return {
      ...day,
      day: Number(day.day) || dayNumber,
      dateLabel: day.dateLabel || `День ${dayNumber}`,
      city: day.city || routePoints[index] || routePoints[routePoints.length - 1] || "Маршрут уточняется",
      items: dayItems
    };
  });

  if (!Array.isArray(normalized.routePoints) || normalized.routePoints.length === 0) {
    normalized.routePoints = normalized.days.map((d) => d.city).filter(Boolean);
  }

  const knownCosts = normalized.days
    .flatMap((d) => (Array.isArray(d.items) ? d.items : []))
    .map((i) => i.cost)
    .filter((v) => Number.isFinite(v) && v > 0);
  const knownTotal = knownCosts.reduce((sum, v) => sum + v, 0);
  normalized.pricePolicy = {
    noFabrication: true,
    knownTotal,
    unknownItems:
      normalized.days
        .flatMap((d) => (Array.isArray(d.items) ? d.items : []))
        .filter((i) => i.cost == null).length
  };

  return normalized;
}

function rebalanceBudgetByPreferences(plan, params) {
  const normalized = { ...plan };
  const days = Math.max(1, Number(params.days) || normalized.days?.length || 1);
  const budgetLimit = Math.max(1, Number(params.budget) || 1);
  const needAccommodation = params.needAccommodation !== false;
  const hasOwnCar = params.hasOwnCar === true;
  const hotelNight = 4200;
  const foodDay = 1800;
  const activitiesDay = 1700;

  const logisticsCost = (normalized.logistics?.segments || []).reduce(
    (sum, s) => sum + Number(s.costEstimate || 0),
    0
  );
  const localCityTransport = hasOwnCar ? Math.round(days * 220) : Math.round(days * 500);
  const transportBase = Math.max(logisticsCost + localCityTransport, Math.round(days * 700));

  let hotel = needAccommodation ? Math.round(hotelNight * days) : 0;
  let food = Math.round(foodDay * days);
  let activities = Math.round(activitiesDay * days);
  let transport = Math.round(transportBase);
  let reserve = Math.round(budgetLimit * 0.1);
  let total = transport + hotel + food + activities + reserve;

  if (total > budgetLimit) {
    const scale = budgetLimit / total;
    transport = Math.max(0, Math.round(transport * scale));
    hotel = Math.max(0, Math.round(hotel * scale));
    food = Math.max(0, Math.round(food * scale));
    activities = Math.max(0, Math.round(activities * scale));
    reserve = Math.max(0, budgetLimit - (transport + hotel + food + activities));
    total = transport + hotel + food + activities + reserve;
  }

  debugLog(
    "server.js:rebalanceBudgetByPreferences",
    "Budget rebalanced",
    {
      days,
      budgetLimit,
      needAccommodation,
      logisticsCost,
      budgetPlan: { transport, hotel, food, activities, reserve, total }
    },
    "H9"
  );

  normalized.budgetPlan = {
    transport,
    hotel,
    food,
    activities,
    reserve,
    total
  };

  const minReasonable =
    transport +
    (needAccommodation ? days * 2800 : 0) +
    days * 1200 +
    days * 900;
  const luxuryThreshold = minReasonable * 2.2;
  let status = "ok";
  let message = "Бюджет сбалансирован под маршрут.";
  const shoppingIdeas = [];

  if (budgetLimit < minReasonable) {
    status = "low";
    message =
      "Бюджета объективно мало для комфортного плана. Рекомендуется сократить города/дни или отключить проживание.";
    normalized.tips = [
      ...(normalized.tips || []),
      "Сократите число переездов и платных активностей.",
      "Выбирайте бюджетные столовые и бесплатные городские локации."
    ];
  } else if (budgetLimit > luxuryThreshold) {
    status = "high";
    message =
      "Бюджет выше среднего: можно выбирать более дорогие отели/рестораны и добавить шопинг.";
    shoppingIdeas.push(
      "Добавьте шопинг в локальных ТЦ/дизайн-маркетах города.",
      "Выберите гастро-ужин в рейтинговом ресторане."
    );
    normalized.tips = [...(normalized.tips || []), ...shoppingIdeas];
  }

  normalized.budgetReality = {
    status,
    message,
    minReasonable: Math.round(minReasonable),
    providedBudget: budgetLimit
  };

  return normalized;
}

function estimateMinimumBudget({ days, startCity, endCity, cityCount, needAccommodation, hasOwnCar }) {
  const dayCount = Math.max(1, Number(days) || 1);
  const citiesCount = sanitizeCityCount(cityCount, dayCount);
  const segments = Math.max(1, citiesCount - 1);
  const withAccommodation = needAccommodation !== false;
  const from = DEFAULT_CITY_COORDS[(startCity || "").trim().toLowerCase()];
  const to = DEFAULT_CITY_COORDS[(endCity || "").trim().toLowerCase()];
  const intercityKm = from && to ? haversineKm(from, to) : 700;
  const segmentKm = intercityKm / segments;
  const intercityMode = pickIntercityMode(segmentKm);
  const ownCar = hasOwnCar === true;
  const perSegment = ownCar
    ? Math.max(900, Math.round(segmentKm * 6.5))
    : estimateTransportCost(segmentKm, intercityMode);
  const transportIntercity = perSegment * segments;
  const transportLocal = dayCount * (ownCar ? 220 : 450);
  const transport = transportIntercity + transportLocal;
  const hotel = withAccommodation ? dayCount * 2200 : 0;
  const food = dayCount * 1100;
  const activities = dayCount * 700;
  const minimumBudget = transport + hotel + food + activities;
  debugLog(
    "server.js:estimateMinimumBudget",
    "Estimated minimum budget",
    {
      dayCount,
      citiesCount,
      segments,
      startCity,
      endCity,
      withAccommodation,
      intercityKm: Math.round(intercityKm),
      minimumBudget
    },
    "H10"
  );
  return minimumBudget;
}

async function requestGigaChat(prompt, { temperature = 0.25 } = {}) {
  const token = await getGigaChatAccessToken();
  const model = process.env.GIGACHAT_MODEL || "GigaChat";
  const endpoint =
    process.env.GIGACHAT_API_URL ||
    "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: "system", content: GIGACHAT_SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ]
      })
    });

    if (response.ok) {
      const payload = await response.json();
      return payload?.choices?.[0]?.message?.content || "";
    }

    const details = await response.text();
    lastError = new Error(`Ошибка GigaChat (${response.status}): ${details}`);
    if (response.status !== 429 || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, attempt * 900));
  }

  throw lastError;
}

async function repairJsonWithModel(rawText) {
  const repairPrompt = `
Исправь JSON ниже и верни только валидный JSON без markdown.
Нельзя добавлять комментарии и служебный текст.

${rawText}
`.trim();
  return requestGigaChat(repairPrompt, { temperature: 0.1 });
}

function createFallbackPlan({ days, startCity, endCity, budget, cityCount, tripGoals }) {
  const goals = sanitizeTripGoals(tripGoals);
  const goalLabels = goals.map((id) => TRIP_GOALS_BY_ID[id]?.label).filter(Boolean);
  const count = Math.max(1, Number(days) || 1);
  const routePoints = buildRoutePoints({ startCity, endCity, cityCount, days: count });
  const dayCounts = distributeDayCounts(count, routePoints.length);
  const dayList = [];
  let dayNumber = 0;

  routePoints.forEach((city, cityIndex) => {
    for (let slot = 0; slot < dayCounts[cityIndex]; slot += 1) {
      dayNumber += 1;
      dayList.push({
        day: dayNumber,
        city,
        dateLabel: `День ${dayNumber}`,
        items: [
          {
            time: "09:00",
            place: pickSpecific(city, "transport", dayNumber),
            cost: null,
            comment: "Переезд между точками маршрута.",
            priceStatus: "unknown"
          },
          {
            time: "11:00",
            place: pickSpecific(city, "activity", dayNumber),
            cost: null,
            comment: "Основная программа дня.",
            priceStatus: "unknown"
          },
          {
            time: "14:00",
            place: pickSpecific(city, "food", dayNumber),
            cost: null,
            comment: "Питание в течение дня.",
            priceStatus: "unknown"
          },
          {
            time: "20:00",
            place: pickSpecific(city, "hotel", dayNumber),
            cost: null,
            comment: "Размещение на ночь.",
            priceStatus: "unknown"
          }
        ]
      });
    }
  });

  const cityLabel =
    routePoints.length > 2
      ? `${routePoints.length} города`
      : `${startCity} — ${endCity}`;

  return {
    title: `Маршрут ${cityLabel}`,
    summary: `Готов базовый маршрут на выбранный срок и бюджет. Акцент: ${goalLabels.join(", ")}.`,
    budgetPlan: {
      transport: Math.round(Number(budget) * 0.35),
      hotel: Math.round(Number(budget) * 0.3),
      food: Math.round(Number(budget) * 0.15),
      activities: Math.round(Number(budget) * 0.12),
      reserve: Math.round(Number(budget) * 0.08),
      total: Number(budget)
    },
    days: dayList,
    routePoints,
    cityCount: routePoints.length,
    tips: ["Проверьте точки маршрута и пересоберите план при необходимости."]
  };
}

function formatGigaChatAuthError(status, details) {
  let code = null;
  try {
    const parsed = JSON.parse(details);
    code = parsed?.code;
  } catch (_) {
    // keep raw details
  }

  if (status === 401 && code === 6) {
    return [
      "Неверный ключ авторизации GigaChat (OAuth 401, code 6).",
      "Что сделать:",
      "1) Откройте https://developers.sber.ru/studio — проект GigaChat API.",
      "2) Создайте новый «Ключ авторизации» (Authorization key), не путайте с access token.",
      "3) Вставьте его в .env в GIGACHAT_AUTH_KEY=... (одной строкой, без кавычек).",
      "4) Проверьте GIGACHAT_SCOPE: для физлиц — GIGACHAT_API_PERS, для B2B — GIGACHAT_API_B2B.",
      "5) Перезапустите сервер (npm start).",
      "Либо включите GIGACHAT_DEMO_MODE=true для проверки без API."
    ].join(" ");
  }

  return `Ошибка OAuth GigaChat (${status}): ${details}`;
}

async function getGigaChatAccessToken() {
  const accessToken = (process.env.GIGACHAT_TOKEN || "").trim();
  const authKey = (process.env.GIGACHAT_AUTH_KEY || "").trim();
  const useOauth = process.env.GIGACHAT_USE_OAUTH === "true";

  if (!useOauth && accessToken) {
    return accessToken;
  }

  const credentials = authKey || accessToken;
  if (!credentials) {
    throw new Error(
      "Укажите GIGACHAT_AUTH_KEY (ключ авторизации) или GIGACHAT_TOKEN в .env. Инструкция: LOCAL_SETUP_RU.md"
    );
  }

  const oauthUrl =
    process.env.GIGACHAT_OAUTH_URL ||
    "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
  const scope = process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS";

  const response = await fetch(oauthUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      RqUID: crypto.randomUUID(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({ scope })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(formatGigaChatAuthError(response.status, details));
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error("OAuth не вернул access_token");
  }
  return payload.access_token;
}

app.get("/api/trip-goals", (req, res) => {
  res.json({ goals: TRIP_GOALS });
});

app.post("/api/plan", async (req, res) => {
  const {
    days,
    startCity,
    endCity,
    budget,
    needAccommodation,
    hasOwnCar,
    cityCount: rawCityCount,
    tripGoals: rawTripGoals
  } = req.body || {};
  const cityCount = sanitizeCityCount(rawCityCount, days);
  const tripGoals = sanitizeTripGoals(rawTripGoals);
  debugLog("server.js:/api/plan:start", "Incoming /api/plan request", {
    days,
    startCity,
    endCity,
    cityCount,
    tripGoals,
    budget,
    needAccommodation,
    hasOwnCar
  }, "H1");

  if (!days || !startCity || !endCity || !budget) {
    return res.status(400).json({
      error: "Заполните все поля: days, startCity, endCity, budget."
    });
  }

  try {
    const minimumBudget = estimateMinimumBudget({
      days,
      startCity,
      endCity,
      cityCount,
      needAccommodation,
      hasOwnCar
    });
    const buildPlanResponse = async (parsed, generatedWith) => {
      const hasAccommodation = needAccommodation !== false;
      const { plan: grounded, stats } = await groundPlanPlaces(parsed);
      let normalized = normalizePlan(grounded, budget, days, hasAccommodation);
      normalized.grounding = stats;
      if (stats.replaced > 0) {
        const tips = Array.isArray(normalized.tips) ? normalized.tips : [];
        normalized.tips = [
          ...tips,
          "Часть мест заменена на проверенные — сверьте адреса и часы работы перед выездом."
        ];
      }
      normalized = applyCityCountToPlan(normalized, { startCity, endCity, cityCount, days });
      const routePoints = (normalized.routePoints || []).filter(Boolean);
      const logistics = await buildLogistics(routePoints, { hasOwnCar });
      normalized.logistics = logistics;
      normalized = rebalanceBudgetByPreferences(normalized, {
        days,
        budget,
        needAccommodation: hasAccommodation,
        hasOwnCar
      });
      normalized = await enrichPlanWithDayMaps(normalized);
      normalized = await enrichPlanWithImages(normalized);
      normalized.preferences = {
        needAccommodation: hasAccommodation,
        hasOwnCar: Boolean(hasOwnCar),
        cityCount,
        tripGoals,
        tripGoalLabels: tripGoals.map((id) => TRIP_GOALS_BY_ID[id]?.label).filter(Boolean)
      };
      normalized.generatedWith = generatedWith;
      return normalized;
    };

    if (process.env.GIGACHAT_DEMO_MODE === "true") {
      const demoPlan = await buildPlanResponse(
        createFallbackPlan({ days, startCity, endCity, budget, cityCount, tripGoals }),
        "demo"
      );
      return res.json(demoPlan);
    }

    if (Number(budget) < minimumBudget) {
      debugLog("server.js:/api/plan:low-budget", "Early low-budget stop", {
        budget: Number(budget),
        minimumBudget
      }, "H3");
      return res.json({
        status: "budget_too_low",
        message:
          "Бюджета недостаточно для реалистичного маршрута. Увеличьте бюджет или сократите срок/переезды.",
        minReasonable: minimumBudget,
        providedBudget: Number(budget)
      });
    }

    const prompt = buildPrompt({
      days,
      startCity,
      endCity,
      cityCount,
      budget,
      needAccommodation,
      hasOwnCar,
      tripGoals
    });
    let parsed = null;
    let modelText = "";

    for (let i = 0; i < 2; i += 1) {
      const extraStrict =
        i === 0
          ? ""
          : `
Повторная попытка: верни только валидный JSON, без комментариев и без \`\`\`.
Не выдумывай названия заведений. Используй только общеизвестные объекты или примеры из промпта.
Все cost при сомнении — null, priceStatus — "unknown".
`;
      modelText = await requestGigaChat(`${prompt}${extraStrict}`);
      parsed = parseModelJson(modelText);
      if (parsed) break;
    }

    if (!parsed) {
      const repairedText = await repairJsonWithModel(modelText);
      parsed = parseModelJson(repairedText);
      if (!parsed) {
        parsed = createFallbackPlan({ days, startCity, endCity, budget, cityCount, tripGoals });
      }
    }

    const normalized = await buildPlanResponse(parsed, "ai");
    debugLog("server.js:/api/plan:success", "Plan response generated", {
      generatedWith: normalized.generatedWith || "ai",
      daysCount: Array.isArray(normalized.days) ? normalized.days.length : 0,
      hasLogistics: Boolean(normalized.logistics?.segments?.length)
    }, "H4");
    return res.json(normalized);
  } catch (error) {
    const message = error?.message || "Ошибка сервера";
    // Production-safe fallback: if provider is unreachable, return deterministic plan
    // instead of hard failing the user flow.
    if (/fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message)) {
      const {
        days,
        startCity,
        endCity,
        budget,
        needAccommodation,
        hasOwnCar,
        cityCount: rawCityCount,
        tripGoals: rawTripGoals
      } = req.body || {};
      const cityCount = sanitizeCityCount(rawCityCount, days);
      const tripGoals = sanitizeTripGoals(rawTripGoals);
      const hasAccommodation = needAccommodation !== false;
      let fallback = createFallbackPlan({ days, startCity, endCity, budget, cityCount, tripGoals });
      fallback = normalizePlan(fallback, budget, days, hasAccommodation);
      fallback = applyCityCountToPlan(fallback, { startCity, endCity, cityCount, days });
      const routePoints = (fallback.routePoints || []).filter(Boolean);
      const logistics = await buildLogistics(routePoints, { hasOwnCar });
      fallback.logistics = logistics;
      fallback = rebalanceBudgetByPreferences(fallback, {
        days,
        budget,
        needAccommodation: hasAccommodation,
        hasOwnCar
      });
      fallback = await enrichPlanWithDayMaps(fallback);
      fallback = await enrichPlanWithImages(fallback);
      fallback.generatedWith = "fallback";
      fallback.fallbackReason = message;
      fallback.tips = [
        ...(fallback.tips || []),
        "Маршрут собран автоматически по безопасному сценарию."
      ];
      debugLog("server.js:/api/plan:fallback", "Provider/network fallback used", {
        error: message,
        daysCount: Array.isArray(fallback.days) ? fallback.days.length : 0
      }, "H2");
      return res.json(fallback);
    }
    debugLog("server.js:/api/plan:error", "Unhandled /api/plan error", {
      error: message
    }, "H5");
    return res.status(500).json({ error: message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/diag", (req, res) => {
  res.json({
    ok: true,
    oauthMode: process.env.GIGACHAT_USE_OAUTH === "true",
    insecureTls: process.env.GIGACHAT_INSECURE_TLS === "true",
    hasToken: Boolean(process.env.GIGACHAT_TOKEN),
    hasAuthKey: Boolean(process.env.GIGACHAT_AUTH_KEY),
    frontendOrigin,
    model: process.env.GIGACHAT_MODEL || "GigaChat"
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  if (err?.message === "CORS origin denied") {
    return res.status(403).json({ error: "Доступ с этого домена запрещен." });
  }
  return next(err);
});

app.listen(port, () => {
  console.log(`Travel AI Russia running on http://localhost:${port}`);
});
