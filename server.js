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
    crossOriginResourcePolicy: false
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin === frontendOrigin || origin.startsWith("http://localhost:")) {
        return callback(null, true);
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

function buildPrompt({ days, startCity, endCity, budget, needAccommodation }) {
  return `
Ты — умный тревел-планировщик по России.
Сформируй маршрут строго в формате JSON без markdown и без пояснений вне JSON.

Ограничения пользователя:
- Длительность поездки: ${days} дней
- Город старта: ${startCity}
- Город окончания: ${endCity}
- Бюджет: ${budget} рублей
- Нужно проживание: ${needAccommodation ? "да" : "нет"}

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
- Маршрут должен быть реалистичен по логистике
- Используй только города России
- Для еды указывай конкретные места (название заведения), не пиши общие слова вроде "кафе" или "ресторан" без названия
- Для проживания (если нужно) указывай конкретный объект размещения (название отеля/апартаментов)
- Если точная цена неизвестна, ставь cost: null и priceStatus: "unknown", не ставь 0 и не придумывай сумму
`.trim();
}

const CITY_RECOMMENDATIONS = {
  "москва": {
    food: ["Депо Москва (фудмолл)", "Вареничная №1 (Арбат)", "ДжонДжоли (Смоленская)"],
    hotel: ["Azimut Сити Отель Смоленская", "Ibis Moscow Centre Bakhrushina", "Holiday Inn Moscow Sokolniki"]
  },
  "санкт-петербург": {
    food: ["Marketplace (Невский проспект)", "Pkhali Khinkali (Садовая)", "Брынза (Невский)"],
    hotel: ["AZIMUT Сити Отель Санкт-Петербург", "Ibis Saint Petersburg Centre", "Station Hotel M19"]
  },
  "владимир": {
    food: ["Ресторан Обломов", "Кафе Гости", "Bulochnaya #1"],
    hotel: ["AMAKS Золотое Кольцо", "Вознесенская Слобода", "Гостиница Владимир"]
  },
  "ярославль": {
    food: ["Пенаты", "Собрание", "Кафе АндерСон"],
    hotel: ["Ring Premier Hotel", "Ibis Yaroslavl Center", "Cosmos Yaroslavl Hotel"]
  },
  "сергиев посад": {
    food: ["Русский Дворик", "Гостевая Изба", "Келарская Набережная"],
    hotel: ["Царская Деревня", "Посадский", "Барские Полати"]
  }
};

function pickSpecific(city, type, index) {
  const key = (city || "").trim().toLowerCase();
  const list = CITY_RECOMMENDATIONS[key]?.[type];
  if (list && list.length) return list[index % list.length];
  if (type === "food") return "Теремок (центр города)";
  return "Отель Центральный";
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
    return { distanceKm, durationHours: distanceKm / 650 + 1.8 };
  }
  if (mode === "train") {
    return { distanceKm, durationHours: distanceKm / 90 + 0.6 };
  }
  return { distanceKm, durationHours: distanceKm / 65 };
}

function estimateTransportCost(distanceKm, mode) {
  if (mode === "plane") return Math.round(distanceKm * 8.2);
  if (mode === "train") return Math.round(distanceKm * 3.2);
  return Math.round(distanceKm * 2.6);
}

async function buildLogistics(routePoints) {
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
    const metrics = driving || estimateByMode(baseDistanceKm, "train");

    segments.push({
      from: from.city,
      to: to.city,
      mode: driving ? "car" : "train",
      distanceKm: Math.round(metrics.distanceKm),
      durationHours: Number(metrics.durationHours.toFixed(1)),
      costEstimate: estimateTransportCost(metrics.distanceKm, "train")
    });
  }

  return { points, segments };
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
        place: "Активности и экскурсии",
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
      const place = String(item.place || "");
      const rawCost = Number(item.cost);
      item.cost = Number.isFinite(rawCost) && rawCost > 0 ? Math.round(rawCost) : null;
      if (!item.cost) {
        item.priceStatus = "unknown";
        if (!item.priceNote) item.priceNote = "Цена не подтверждена, требуется проверка.";
      } else {
        item.priceStatus = item.priceStatus === "verified" ? "verified" : "unknown";
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
          item.cost = 1400;
          item.priceStatus = "estimated";
          item.priceNote = "Ориентир по среднему тарифу переезда.";
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
  const hotelNight = 4200;
  const foodDay = 1800;
  const activitiesDay = 1700;

  const logisticsCost = (normalized.logistics?.segments || []).reduce(
    (sum, s) => sum + Number(s.costEstimate || 0),
    0
  );
  const transportBase = Math.max(logisticsCost, 9000);

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

function estimateMinimumBudget({ days, startCity, endCity, needAccommodation }) {
  const dayCount = Math.max(1, Number(days) || 1);
  const withAccommodation = needAccommodation !== false;
  const from = DEFAULT_CITY_COORDS[(startCity || "").trim().toLowerCase()];
  const to = DEFAULT_CITY_COORDS[(endCity || "").trim().toLowerCase()];
  const intercityKm = from && to ? haversineKm(from, to) : 700;
  const transport = Math.max(4500, Math.round(intercityKm * 3.2));
  const hotel = withAccommodation ? dayCount * 2200 : 0;
  const food = dayCount * 1100;
  const activities = dayCount * 700;
  return transport + hotel + food + activities;
}

async function requestGigaChat(prompt) {
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
        temperature: 0.6,
        messages: [{ role: "user", content: prompt }]
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
  return requestGigaChat(repairPrompt);
}

function createFallbackPlan({ days, startCity, endCity, budget }) {
  const count = Math.max(1, Number(days) || 1);
  const dayList = Array.from({ length: count }, (_, idx) => {
    const day = idx + 1;
    const city = day === 1 ? startCity : day === count ? endCity : startCity;
    return {
      day,
      city,
      dateLabel: `День ${day}`,
      items: [
        { time: "09:00", place: "Транспорт по маршруту", cost: 0, comment: "Переезд между точками маршрута." },
        { time: "11:00", place: "Активности и экскурсии", cost: 0, comment: "Основная программа дня." },
        { time: "14:00", place: "Питание", cost: 0, comment: "Питание в течение дня." },
        { time: "20:00", place: "Проживание", cost: 0, comment: "Размещение на ночь." }
      ]
    };
  });

  return {
    title: `Маршрут ${startCity} — ${endCity}`,
    summary:
      "Готов базовый маршрут на выбранный срок и бюджет: порядок дней, переезды, питание, активности и проживание.",
    budgetPlan: {
      transport: Math.round(Number(budget) * 0.35),
      hotel: Math.round(Number(budget) * 0.3),
      food: Math.round(Number(budget) * 0.15),
      activities: Math.round(Number(budget) * 0.12),
      reserve: Math.round(Number(budget) * 0.08),
      total: Number(budget)
    },
    days: dayList,
    routePoints: [startCity, endCity],
    tips: ["Проверьте точки маршрута и пересоберите план при необходимости."]
  };
}

async function getGigaChatAccessToken() {
  const accessToken = process.env.GIGACHAT_TOKEN;
  const authKey = process.env.GIGACHAT_AUTH_KEY;
  const useOauth = process.env.GIGACHAT_USE_OAUTH === "true";

  if (accessToken && !authKey && !useOauth) {
    return accessToken;
  }

  const credentials = authKey || accessToken;
  if (!credentials) {
    throw new Error("Укажите GIGACHAT_AUTH_KEY или GIGACHAT_TOKEN в .env");
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
    throw new Error(`Ошибка OAuth GigaChat (${response.status}): ${details}`);
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error("OAuth не вернул access_token");
  }
  return payload.access_token;
}

app.post("/api/plan", async (req, res) => {
  const { days, startCity, endCity, budget, needAccommodation } = req.body || {};
  debugLog("server.js:/api/plan:start", "Incoming /api/plan request", {
    days,
    startCity,
    endCity,
    budget,
    needAccommodation
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
      needAccommodation
    });
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
      budget,
      needAccommodation
    });
    let parsed = null;
    let modelText = "";

    for (let i = 0; i < 2; i += 1) {
      const extraStrict =
        i === 0
          ? ""
          : "\nПовторная попытка: верни только валидный JSON, без комментариев и без ```.";
      modelText = await requestGigaChat(`${prompt}${extraStrict}`);
      parsed = parseModelJson(modelText);
      if (parsed) break;
    }

    if (!parsed) {
      const repairedText = await repairJsonWithModel(modelText);
      parsed = parseModelJson(repairedText);
      if (!parsed) {
        parsed = createFallbackPlan({ days, startCity, endCity, budget });
      }
    }

    const hasAccommodation = needAccommodation !== false;
    let normalized = normalizePlan(parsed, budget, days, hasAccommodation);
    const routePoints = (normalized.routePoints || []).filter(Boolean);
    const logistics = await buildLogistics(routePoints);
    normalized.logistics = logistics;
    normalized = rebalanceBudgetByPreferences(normalized, {
      days,
      budget,
      needAccommodation: hasAccommodation
    });
    normalized = await enrichPlanWithDayMaps(normalized);
    normalized.preferences = {
      needAccommodation: hasAccommodation
    };
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
      const { days, startCity, endCity, budget, needAccommodation } = req.body || {};
      const hasAccommodation = needAccommodation !== false;
      let fallback = createFallbackPlan({ days, startCity, endCity, budget });
      fallback = normalizePlan(fallback, budget, days, hasAccommodation);
      const routePoints = (fallback.routePoints || []).filter(Boolean);
      const logistics = await buildLogistics(routePoints);
      fallback.logistics = logistics;
      fallback = rebalanceBudgetByPreferences(fallback, {
        days,
        budget,
        needAccommodation: hasAccommodation
      });
      fallback = await enrichPlanWithDayMaps(fallback);
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
