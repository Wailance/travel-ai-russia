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

function getApiBaseUrl() {
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
  routeSummary.textContent = plan.summary || "Маршрут успешно сформирован.";

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
      const transferDetails = segment
        ? `${segment.distanceKm} км • ${segment.durationHours} ч • ${formatRub(segment.costEstimate)}`
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
      row.className = "item";
      row.innerHTML = `
        <div>${item.time || ""}</div>
        <div><strong>${item.place || ""}</strong><br>${item.comment || ""}${
          item.priceNote ? `<br><span class="price-note">${item.priceNote}</span>` : ""
        }</div>
        <div>${formatRub(item.cost)}</div>
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

function renderMap(logistics) {
  const points = logistics?.points || [];
  if (!points.length) {
    mapWrapEl.innerHTML = '<div class="map-note">Карта будет показана после построения маршрута.</div>';
    return;
  }

  const markerParam = points
    .map((p) => `${p.lon},${p.lat},pm2rdm`)
    .join("~");
  const center = points[Math.floor(points.length / 2)];
  const mapUrl = `https://static-maps.yandex.ru/1.x/?lang=ru_RU&ll=${center.lon},${center.lat}&z=4&l=map&size=600,300&pt=${encodeURIComponent(
    markerParam
  )}`;
  mapWrapEl.innerHTML = `
    <img src="${mapUrl}" alt="Карта маршрута" />
    <div class="map-note">Карта: Yandex Static Maps. Маркеры по городам маршрута.</div>
  `;
}

function renderLogistics(plan) {
  logisticsEl.innerHTML = "";
  const segments = plan.logistics?.segments || [];
  if (!segments.length) {
    logisticsEl.innerHTML = '<div class="map-note">Недостаточно данных для логистики.</div>';
    return;
  }
  segments.forEach((segment) => {
    const row = document.createElement("div");
    row.className = "log-row";
    row.innerHTML = `
      <div><strong>${segment.from}</strong> → <strong>${segment.to}</strong></div>
      <div>${segment.distanceKm} км</div>
      <div>${segment.durationHours} ч</div>
      <div>${formatRub(segment.costEstimate)}</div>
    `;
    logisticsEl.appendChild(row);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "Строим маршрут...";

  const payload = {
    days: Number(document.getElementById("days").value),
    startCity: document.getElementById("startCity").value.trim(),
    endCity: document.getElementById("endCity").value.trim(),
    budget: Number(document.getElementById("budget").value),
    needAccommodation: document.getElementById("needAccommodation").checked
  };

  try {
    const apiBase = getApiBaseUrl();
    const endpoint = apiBase ? `${apiBase}/api/plan` : "/api/plan";
    debugLog("public/app.js:submit", "Submitting plan request", {
      endpoint,
      days: payload.days,
      startCity: payload.startCity,
      endCity: payload.endCity,
      budget: payload.budget,
      needAccommodation: payload.needAccommodation
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
  } catch (error) {
    statusEl.textContent = error.message || "Не удалось построить маршрут.";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Построить маршрут";
  }
});
