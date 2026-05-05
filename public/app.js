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

function getApiBaseUrl() {
  const configured = (window.TRAVEL_API_BASE || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return "";
}

function formatRub(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  if (num === 0) return "Бесплатно";
  return `${num.toLocaleString("ru-RU")} ₽`;
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

  (plan.days || []).forEach((day) => {
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
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const rawText = await response.text();
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
      renderLowBudget(data);
      statusEl.textContent = "Маршрут не построен: бюджет слишком низкий.";
      return;
    }

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
