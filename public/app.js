let loadingInterval = null;
let loadingStart = 0;

function startLoadingBar() {
  const bar = document.getElementById("loadingBar");
  const fill = document.getElementById("loadingBarFill");
  const text = document.getElementById("loadingBarText");
  if (!bar || !fill || !text) return;
  bar.classList.add("active");
  fill.style.width = "0%";
  loadingStart = Date.now();
  const messages = [
    "Подбираем города и маршрут...",
    "Генерируем расписание...",
    "Рассчитываем логистику...",
    "Подбираем фотографии...",
    "Балансируем бюджет...",
    "Финальные штрихи..."
  ];
  let step = 0;
  text.textContent = messages[0];
  loadingInterval = setInterval(() => {
    const elapsed = (Date.now() - loadingStart) / 1000;
    const progress = Math.min(92, elapsed * 2.8);
    fill.style.width = `${progress}%`;
    const newStep = Math.min(Math.floor(elapsed / 5), messages.length - 1);
    if (newStep !== step) {
      step = newStep;
      text.textContent = messages[step];
    }
  }, 300);
}

function stopLoadingBar() {
  clearInterval(loadingInterval);
  const bar = document.getElementById("loadingBar");
  const fill = document.getElementById("loadingBarFill");
  if (fill) fill.style.width = "100%";
  setTimeout(() => {
    if (bar) bar.classList.remove("active");
    if (fill) fill.style.width = "0%";
  }, 400);
}

const form = document.getElementById("plannerForm");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("submitBtn");
const resultEl = document.getElementById("result");
const lowBudgetBlock = document.getElementById("lowBudgetBlock");
const lowBudgetText = document.getElementById("lowBudgetText");

const routeTitle = document.getElementById("routeTitle");
const routeSummary = document.getElementById("routeSummary");
const routePointsEl = document.getElementById("routePoints");
const scheduleEl = document.getElementById("schedule");
const budgetEl = document.getElementById("budgetPlan");
const budgetRealityEl = document.getElementById("budgetReality");
const tipsEl = document.getElementById("tips");
const mapWrapEl = document.getElementById("mapWrap");
const logisticsEl = document.getElementById("logistics");
const chartsEl = document.getElementById("charts");
const daysInput = document.getElementById("days");
const cityCountInput = document.getElementById("cityCount");
let routeMapInstance = null;
const MAX_TRIP_GOALS = 3;
const tripGoalsRoot = document.getElementById("tripGoals");
const tripGoalsHint = document.getElementById("tripGoalsHint");

function getTripGoalInputs() {
  if (!tripGoalsRoot) return [];
  return Array.from(tripGoalsRoot.querySelectorAll('input[name="tripGoal"]'));
}

function getSelectedTripGoals() {
  return getTripGoalInputs()
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function updateTripGoalsUi() {
  const inputs = getTripGoalInputs();
  if (!inputs.length) return;

  const selected = getSelectedTripGoals();
  const hasBalanced = selected.includes("balanced");
  const nonBalanced = selected.filter((id) => id !== "balanced");
  const atLimit = !hasBalanced && nonBalanced.length >= MAX_TRIP_GOALS;

  inputs.forEach((input) => {
    const isBalanced = input.value === "balanced";
    if (hasBalanced) {
      if (isBalanced) {
        input.disabled = false;
      } else {
        input.checked = false;
        input.disabled = true;
      }
      return;
    }

    if (isBalanced) {
      input.disabled = nonBalanced.length > 0;
      return;
    }

    input.disabled = !input.checked && atLimit;
  });

  if (tripGoalsHint) {
    if (hasBalanced) {
      tripGoalsHint.textContent = "Выбран сбалансированный маршрут";
      tripGoalsHint.classList.remove("is-limit");
    } else if (selected.length === 0) {
      tripGoalsHint.textContent = "Выберите хотя бы одну цель";
      tripGoalsHint.classList.remove("is-limit");
    } else {
      tripGoalsHint.textContent = `Выбрано целей: ${selected.length} из ${MAX_TRIP_GOALS}`;
      tripGoalsHint.classList.toggle("is-limit", atLimit);
    }
  }
}

function initTripGoals() {
  const inputs = getTripGoalInputs();
  if (!inputs.length) return;

  inputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.value === "balanced" && input.checked) {
        inputs.forEach((other) => {
          if (other !== input) other.checked = false;
        });
      } else if (input.checked) {
        const balanced = inputs.find((el) => el.value === "balanced");
        if (balanced) balanced.checked = false;
        const selected = getSelectedTripGoals().filter((id) => id !== "balanced");
        if (selected.length > MAX_TRIP_GOALS) {
          input.checked = false;
        }
      }
      updateTripGoalsUi();
    });
  });

  updateTripGoalsUi();
}

initTripGoals();

function getMaxCityCount(days) {
  const dayCount = Math.max(1, Number(days) || 1);
  return Math.min(Math.max(2, dayCount), 10);
}

function syncCityCountLimits() {
  if (!daysInput || !cityCountInput) return;
  const maxCities = getMaxCityCount(daysInput.value);
  cityCountInput.max = String(maxCities);
  if (Number(cityCountInput.value) > maxCities) cityCountInput.value = String(maxCities);
  if (Number(cityCountInput.value) < 2) cityCountInput.value = "2";
}

if (daysInput && cityCountInput) {
  syncCityCountLimits();
  daysInput.addEventListener("input", syncCityCountLimits);
  daysInput.addEventListener("change", syncCityCountLimits);
}

function getApiBaseUrl() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "";
  }
  const configured = (window.TRAVEL_API_BASE || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return "";
}

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

function formatRub(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  if (num === 0) return "Бесплатно";
  return `${num.toLocaleString("ru-RU")} ₽`;
}

function normalizeCityName(city) {
  return String(city || "").trim().toLowerCase();
}

function findSegmentBetweenCities(segments, fromCity, toCity) {
  const fromNorm = normalizeCityName(fromCity);
  const toNorm = normalizeCityName(toCity);
  return (segments || []).find(
    (segment) =>
      normalizeCityName(segment.from) === fromNorm && normalizeCityName(segment.to) === toNorm
  );
}

function getTransportIcon(mode) {
  const value = String(mode || "").toLowerCase();
  if (value.includes("plane") || value.includes("flight")) return "✈️";
  if (value.includes("train")) return "🚆";
  if (value.includes("bus")) return "🚌";
  return "🚗";
}

function getTransportLabel(mode) {
  const value = String(mode || "").toLowerCase();
  if (value.includes("plane") || value.includes("flight")) return "самолет";
  if (value.includes("train")) return "поезд";
  if (value.includes("bus")) return "автобус";
  return "авто";
}

function getDayTotal(day) {
  return (day.items || []).reduce((sum, item) => {
    const cost = Number(item.cost);
    return Number.isFinite(cost) ? sum + cost : sum;
  }, 0);
}

function renderCharts(plan) {
  if (!chartsEl) return;
  const budget = plan.budgetPlan || {};
  const total = Number(budget.total) || 0;
  const budgetParts = [
    { label: "Транспорт", value: Number(budget.transport) || 0, color: "#7ac0ff" },
    { label: "Проживание", value: Number(budget.hotel) || 0, color: "#8de1b8" },
    { label: "Питание", value: Number(budget.food) || 0, color: "#ffd27a" },
    { label: "Активности", value: Number(budget.activities) || 0, color: "#f5a9ff" },
    { label: "Резерв", value: Number(budget.reserve) || 0, color: "#b3bafc" }
  ];

  const budgetMarkup = budgetParts
    .map((part) => {
      const percent = total > 0 ? Math.round((part.value / total) * 100) : 0;
      return `
        <div class="chart-row">
          <div class="chart-label">${part.label}</div>
          <div class="chart-bar"><span style="width:${percent}%; background:${part.color};"></span></div>
          <div class="chart-value">${formatRub(part.value)} (${percent}%)</div>
        </div>
      `;
    })
    .join("");

  const dayTotals = (plan.days || []).map((day) => ({
    label: day.dateLabel || `День ${day.day}`,
    city: day.city || "",
    value: getDayTotal(day)
  }));
  const maxDayTotal = Math.max(...dayTotals.map((d) => d.value), 1);
  const daysMarkup = dayTotals
    .map(
      (day) => `
        <div class="chart-day">
          <div class="chart-day-header">${day.label} — ${day.city}</div>
          <div class="chart-day-bar"><span style="width:${Math.max(8, Math.round((day.value / maxDayTotal) * 100))}%;"></span></div>
          <div class="chart-day-value">${formatRub(day.value)}</div>
        </div>
      `
    )
    .join("");

  chartsEl.innerHTML = `
    <div class="chart-block">
      <h4>Распределение бюджета</h4>
      ${budgetMarkup}
    </div>
    <div class="chart-block">
      <h4>Расходы по дням</h4>
      ${daysMarkup}
    </div>
  `;
}

function renderPlan(plan) {
  lowBudgetBlock.classList.add("hidden");
  resultEl.classList.remove("hidden");
  routeTitle.textContent = plan.title || "Ваш маршрут";
  const goalLabels = plan.preferences?.tripGoalLabels || [];
  const goalsLine = goalLabels.length ? ` Цели: ${goalLabels.join(", ")}.` : "";
  routeSummary.textContent = `${plan.summary || "Маршрут успешно сформирован."}${goalsLine}`;

  routePointsEl.innerHTML = "";
  const points = plan.routePoints || [];
  const adaptiveHeight = Math.max(260, points.length * 78);
  routePointsEl.style.minHeight = `${adaptiveHeight}px`;
  points.forEach((point) => {
    const div = document.createElement("div");
    div.className = "route-point";
    div.textContent = point;
    routePointsEl.appendChild(div);
  });

  renderMap(plan.logistics);

  scheduleEl.innerHTML = "";
  const logisticsSegments = plan.logistics?.segments || [];
  let previousDay = null;

  (plan.days || []).forEach((day) => {
    if (previousDay && normalizeCityName(previousDay.city) !== normalizeCityName(day.city)) {
      const transfer = document.createElement("div");
      transfer.className = "day-transfer";
      const segment = findSegmentBetweenCities(logisticsSegments, previousDay.city, day.city);
      const icon = getTransportIcon(segment?.mode);
      const modeLabel = getTransportLabel(segment?.mode);
      const sourceLabel = segment?.priceSource === "live" ? "лайв-тариф" : "оценка";
      const transferDetails = segment
        ? `${modeLabel} • ${segment.distanceKm} км • ${segment.durationHours} ч • ${formatRub(
            segment.costEstimate
          )} • ${sourceLabel}`
        : "Переезд между городами запланирован";
      transfer.innerHTML = `
        <div class="day-transfer-title">Маршрут между днями</div>
        <div class="day-transfer-main"><span class="transfer-icon">${icon}</span> <strong>${previousDay.city}</strong> → <strong>${day.city}</strong></div>
        <div class="day-transfer-meta">${transferDetails}</div>
      `;
      scheduleEl.appendChild(transfer);
    }

    const dayBlock = document.createElement("div");
    dayBlock.className = "day";

    const title = document.createElement("h4");
    title.textContent = `${day.dateLabel || `День ${day.day}`} — ${day.city}`;
    dayBlock.appendChild(title);

    (day.items || []).forEach((item) => {
      const row = document.createElement("div");
      row.className = item.imageUrl ? "item item-with-photo" : "item";
      const photoHtml = item.imageUrl
        ? `<div class="item-photo-wrap"><img class="item-photo" src="${item.imageUrl}" alt="${item.place || ""}" loading="lazy" /></div>`
        : "";
      const verifiedBadge = item.verified
        ? '<span class="badge-verified" title="Место проверено">&#10003; проверено</span>'
        : '<span class="badge-unverified" title="Рекомендуем проверить актуальность">&#9888; проверьте</span>';
      row.innerHTML = `
        <div class="item-time">${item.time || ""}</div>
        <div class="item-details">
          ${photoHtml}
          <div class="item-text">
            <strong>${item.place || ""}</strong> ${verifiedBadge}<br>${item.comment || ""}${
              item.priceNote ? `<br><span class="price-note">${item.priceNote}</span>` : ""
            }
          </div>
        </div>
        <div class="item-cost">${formatRub(item.cost)}</div>
      `;
      dayBlock.appendChild(row);
    });

    scheduleEl.appendChild(dayBlock);
    previousDay = day;
  });

  const budget = plan.budgetPlan || {};
  const budgetReality = plan.budgetReality || null;
  budgetRealityEl.textContent = budgetReality ? budgetReality.message : "";
  budgetRealityEl.className = `budget-reality ${budgetReality?.status || "ok"}`;
  budgetEl.innerHTML = `
    <div class="budget-row"><span>Транспорт</span><strong>${formatRub(budget.transport)}</strong></div>
    <div class="budget-row"><span>Проживание</span><strong>${formatRub(budget.hotel)}</strong></div>
    <div class="budget-row"><span>Питание</span><strong>${formatRub(budget.food)}</strong></div>
    <div class="budget-row"><span>Активности</span><strong>${formatRub(budget.activities)}</strong></div>
    <div class="budget-row"><span>Резерв</span><strong>${formatRub(budget.reserve)}</strong></div>
    <div class="budget-row"><span>Итого</span><strong>${formatRub(budget.total)}</strong></div>
  `;

  tipsEl.innerHTML = "";
  (plan.tips || []).forEach((tip) => {
    const li = document.createElement("li");
    li.textContent = tip;
    tipsEl.appendChild(li);
  });
  renderCharts(plan);

}

function renderLowBudget(data) {
  destroyRouteMap();
  resultEl.classList.remove("hidden");
  lowBudgetBlock.classList.remove("hidden");
  lowBudgetText.textContent = `${data.message} Минимально нужно: ${formatRub(
    data.minReasonable
  )}. Указано: ${formatRub(data.providedBudget)}.`;
  routeTitle.textContent = "";
  routeSummary.textContent = "";
  routePointsEl.innerHTML = "";
  scheduleEl.innerHTML = "";
  logisticsEl.innerHTML = "";
  budgetEl.innerHTML = "";
  budgetRealityEl.textContent = "";
  tipsEl.innerHTML = "";
  if (chartsEl) chartsEl.innerHTML = "";
}

function destroyRouteMap() {
  if (routeMapInstance) {
    routeMapInstance.remove();
    routeMapInstance = null;
  }
}

function renderMap(logistics) {
  destroyRouteMap();
  const points = (logistics?.points || []).filter(
    (p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))
  );
  if (!points.length) {
    mapWrapEl.innerHTML = '<div class="map-note">Карта будет показана после построения маршрута.</div>';
    return;
  }

  if (typeof window.L === "undefined") {
    mapWrapEl.innerHTML =
      '<div class="map-note">Не удалось загрузить модуль карты. Проверьте интернет и обновите страницу.</div>';
    return;
  }

  mapWrapEl.innerHTML =
    '<div id="routeMap" class="route-map"></div><div class="map-note">Карта маршрута. Маркеры — города поездки.</div>';

  const latLngs = points.map((p) => [Number(p.lat), Number(p.lon)]);

  requestAnimationFrame(() => {
    const mapEl = document.getElementById("routeMap");
    if (!mapEl) return;

    routeMapInstance = window.L.map(mapEl, {
      scrollWheelZoom: false,
      attributionControl: true
    });

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(routeMapInstance);

    latLngs.forEach((latLng, index) => {
      const label = points[index]?.city || `Точка ${index + 1}`;
      window.L.marker(latLng).addTo(routeMapInstance).bindPopup(label);
    });

    if (latLngs.length > 1) {
      window.L.polyline(latLngs, {
        color: "#3db0ff",
        weight: 3,
        opacity: 0.85
      }).addTo(routeMapInstance);
    }

    routeMapInstance.fitBounds(window.L.latLngBounds(latLngs), { padding: [28, 28] });
    setTimeout(() => routeMapInstance?.invalidateSize(), 0);
  });
}

function renderLogistics(plan) {
  logisticsEl.innerHTML = "";
  const segments = plan.logistics?.segments || [];
  if (!segments.length) {
    logisticsEl.innerHTML = '<div class="map-note">Недостаточно данных для логистики.</div>';
    return;
  }
  segments.forEach((segment) => {
    const sourceText =
      segment.priceSource === "live" ? "лайв-тариф" : "оценка";
    const modeText = getTransportLabel(segment.mode);
    const row = document.createElement("div");
    row.className = "log-row";
    row.innerHTML = `
      <div><strong>${segment.from}</strong> → <strong>${segment.to}</strong></div>
      <div>${modeText}<br><span class="price-note">${segment.distanceKm} км</span></div>
      <div>${segment.durationHours} ч</div>
      <div>${formatRub(segment.costEstimate)}<br><span class="price-note">${sourceText}</span></div>
    `;
    logisticsEl.appendChild(row);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";
  statusEl.classList.remove("error");
  submitBtn.disabled = true;
  submitBtn.textContent = "Строим маршрут...";
  startLoadingBar();

  syncCityCountLimits();
  updateTripGoalsUi();
  const tripGoals = getSelectedTripGoals();
  if (!tripGoals.length) {
    statusEl.textContent = "Выберите хотя бы одну цель поездки.";
    submitBtn.disabled = false;
    submitBtn.textContent = "Построить маршрут";
    return;
  }

  const payload = {
    days: Number(document.getElementById("days").value),
    startCity: document.getElementById("startCity").value.trim(),
    endCity: document.getElementById("endCity").value.trim(),
    cityCount: Number(document.getElementById("cityCount").value),
    budget: Number(document.getElementById("budget").value),
    needAccommodation: document.getElementById("needAccommodation").checked,
    hasOwnCar: document.getElementById("hasOwnCar").checked,
    tripGoals
  };

  try {
    const apiBase = getApiBaseUrl();
    const endpoint = apiBase ? `${apiBase}/api/plan` : "/api/plan";
    debugLog("public/app.js:submit", "Submitting plan request", {
      endpoint,
      days: payload.days,
      startCity: payload.startCity,
      endCity: payload.endCity,
      cityCount: payload.cityCount,
      tripGoals: payload.tripGoals,
      budget: payload.budget,
      needAccommodation: payload.needAccommodation,
      hasOwnCar: payload.hasOwnCar
    }, "H1");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const rawText = await response.text();
    debugLog("public/app.js:response", "Received response", {
      status: response.status,
      ok: response.ok,
      preview: rawText.slice(0, 180)
    }, "H2");
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      data = { error: rawText || "Сервер вернул не-JSON ответ." };
    }

    if (!response.ok) {
      throw new Error(data.error || "Ошибка при генерации маршрута");
    }

    if (data.status === "budget_too_low") {
      debugLog("public/app.js:budget_too_low", "Low budget branch", {
        providedBudget: data.providedBudget,
        minReasonable: data.minReasonable
      }, "H3");
      renderLowBudget(data);
      statusEl.textContent = "Маршрут не построен: бюджет слишком низкий.";
      return;
    }

    debugLog("public/app.js:render", "Rendering plan", {
      generatedWith: data.generatedWith || "ai",
      days: Array.isArray(data.days) ? data.days.length : 0,
      hasLogistics: Boolean(data.logistics?.segments?.length)
    }, "H4");
    renderPlan(data);
    renderLogistics(data);
    statusEl.textContent = "Маршрут готов.";
    const resultNav = document.getElementById("resultNav");
    if (resultNav) resultNav.classList.remove("hidden");
    setTimeout(() => {
      document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
  } catch (error) {
    statusEl.textContent = error.message || "Не удалось построить маршрут.";
    statusEl.classList.add("error");
  } finally {
    stopLoadingBar();
    submitBtn.disabled = false;
    submitBtn.textContent = "Построить маршрут";
  }
});
