// Локально: пустая строка — запросы на тот же сервер (/api/plan).
// GitHub Pages: автоматически Render API.
(function () {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    window.TRAVEL_API_BASE = "";
    return;
  }
  if (host.endsWith("github.io")) {
    window.TRAVEL_API_BASE = "https://travel-ai-russia-api.onrender.com";
    return;
  }
  window.TRAVEL_API_BASE = "";
})();
