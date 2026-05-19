// ─── Configuration ────────────────────────────────────────────────────────────
const PROXY_URL = "https://intentions-proxy.j-maidanatz.workers.dev";

const NOTIFY_HOUR = 6;
const NOTIFY_MINUTE = 45;
const CACHE_KEY = "intention_cache";

// ─── Helpers date ─────────────────────────────────────────────────────────────
function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatDateFull() {
  return new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}

function msUntilNext645() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(NOTIFY_HOUR, NOTIFY_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function formatCountdown(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return `${String(h).padStart(2,"0")}h${String(m).padStart(2,"0")}m${String(sc).padStart(2,"0")}s`;
}

// ─── Cache local ──────────────────────────────────────────────────────────────
function saveCache(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ date: todayISO(), data }));
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { date, data } = JSON.parse(raw);
    if (date === todayISO()) return data;
    return null;
  } catch { return null; }
}

// ─── Appel Worker ─────────────────────────────────────────────────────────────
async function fetchIntentionsDuJour() {
  const response = await fetch(PROXY_URL, { method: "GET" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

// ─── Rendu des cartes ─────────────────────────────────────────────────────────
function renderCards(result) {
  const container = document.getElementById("card-container");

  if (!result) {
    container.innerHTML = `
      <div class="card loading fade-in">
        <div class="spinner"></div>
        <p class="loading-text">Consultation de Notion...</p>
      </div>`;
    return;
  }

  if (result._error) {
    container.innerHTML = `
      <div class="card error-card fade-in">
        <span class="error-icon">&#9888;</span>
        <p class="error-text">${result._error}</p>
      </div>`;
    return;
  }

  if (!result.found || !result.intentions?.length) {
    container.innerHTML = `
      <div class="card fade-in">
        <span class="empty-icon">&#128357;</span>
        <p class="empty-text">Aucune intention enregistrée pour aujourd'hui.</p>
        ${result.error ? `<p class="warning-text">${result.error}</p>` : ""}
      </div>`;
    return;
  }

  container.innerHTML = result.intentions.map((intention, i) => {
    const dateLine = intention.multiJours && intention.dateFin
      ? `${formatDate(intention.dateDebut)} — ${formatDate(intention.dateFin)}`
      : formatDate(intention.dateDebut);

    return `
      <div class="card fade-in" style="animation-delay: ${i * 0.08}s">
        ${result.intentions.length > 1 ? `<div class="intention-index">${i + 1} / ${result.intentions.length}</div>` : ""}
        <h2 class="intention-nom">${intention.nom}</h2>
        ${intention.demandeur ? `
          <span class="demandeur-label">Demandé par</span>
          <span class="demandeur-nom">${intention.demandeur}</span>` : ""}
        ${intention.description ? `<p class="description">${intention.description}</p>` : ""}
        <div class="date-badge">
          <span>&#128197;</span><span>${dateLine}</span>
        </div>
        ${intention.multiJours ? `<div class="multi-tag">Intention sur plusieurs jours</div>` : ""}
      </div>`;
  }).join("");
}

// ─── Rendu des notifications ──────────────────────────────────────────────────
function renderNotif() {
  const container = document.getElementById("notif-container");
  const perm = "Notification" in window ? Notification.permission : "unsupported";

  if (perm === "unsupported") {
    container.innerHTML = `<p class="notif-info">Les notifications ne sont pas prises en charge dans ce navigateur.</p>`;
    return;
  }

  if (perm === "default") {
    container.innerHTML = `
      <p class="notif-info">Autorisez les notifications pour recevoir l'intention chaque matin à 6h45.</p>
      <button class="btn btn-primary" id="btn-notif">&#128276; Activer les notifications</button>`;
    document.getElementById("btn-notif").addEventListener("click", requestNotif);
    return;
  }

  if (perm === "denied") {
    container.innerHTML = `<p class="notif-info">Notifications bloquées. Autorisez-les dans les réglages du navigateur, puis rechargez.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="notif-granted">
      <div class="status-pill"><span class="dot"></span><span>Notifications actives</span></div>
      <p class="countdown-label">Prochain rappel dans</p>
      <p class="countdown" id="countdown">${formatCountdown(msUntilNext645())}</p>
      <button class="btn" id="btn-test">Tester la notification</button>
    </div>`;

  document.getElementById("btn-test").addEventListener("click", () => {
    const cached = loadCache();
    if (cached) triggerNotification(cached);
  });

  setInterval(() => {
    const el = document.getElementById("countdown");
    if (el) el.textContent = formatCountdown(msUntilNext645());
  }, 1000);
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function requestNotif() {
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    await registerServiceWorker();
    await scheduleNotification();
  }
  renderNotif();
}

function triggerNotification(result) {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
    if (Notification.permission === "granted") {
      const body = buildNotifBody(result);
      new Notification("Intention(s) de Messe du jour", { body, tag: "intention" });
    }
    return;
  }
  navigator.serviceWorker.controller.postMessage({ type: "SHOW_NOTIFICATION", result });
}

function buildNotifBody(result) {
  if (!result?.found || !result.intentions?.length) {
    return "Aucune intention enregistrée pour aujourd'hui.";
  }
  return result.intentions
    .map((i, idx) => result.intentions.length > 1
      ? `${idx + 1}. ${i.nom}${i.demandeur ? " (" + i.demandeur + ")" : ""}`
      : `${i.nom}${i.demandeur ? "\nDemandé par " + i.demandeur : ""}`)
    .join("\n");
}

async function scheduleNotification() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  if (reg.active) {
    reg.active.postMessage({
      type: "SCHEDULE",
      hour: NOTIFY_HOUR,
      minute: NOTIFY_MINUTE,
      proxyUrl: PROXY_URL,
    });
  }
}

// ─── Service Worker ───────────────────────────────────────────────────────────
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js", { scope: "/intentions-messe/" });
    console.log("SW enregistré :", reg.scope);
  } catch (e) {
    console.warn("Erreur SW :", e);
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "INTENTION_UPDATE") {
      saveCache(e.data.result);
      renderCards(e.data.result);
    }
  });
}

// ─── Install PWA ──────────────────────────────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const banner = document.getElementById("install-banner");
  if (banner) banner.style.display = "block";
});

document.addEventListener("click", async (e) => {
  if (e.target.id === "btn-install" && deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === "accepted") document.getElementById("install-banner").style.display = "none";
    deferredInstallPrompt = null;
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  document.getElementById("date-label").textContent = formatDateFull();
  document.getElementById("btn-refresh").addEventListener("click", loadIntentions);
  renderNotif();
  if ("serviceWorker" in navigator && Notification.permission === "granted") {
    await registerServiceWorker();
    await scheduleNotification();
  }
  await loadIntentions();
  initCal();
}

async function loadIntentions() {
  const btn = document.getElementById("btn-refresh");
  if (btn) btn.disabled = true;
  const cached = loadCache();
  if (cached) renderCards(cached); else renderCards(null);
  try {
    const result = await fetchIntentionsDuJour();
    saveCache(result);
    renderCards(result);

  } catch (e) {
    if (cached) renderCards(cached);
    else renderCards({ _error: e.message || "Erreur de connexion" });
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", init);

// ═══════════════════════════════════════════════════════
// ── Calendrier mensuel ──
// ═══════════════════════════════════════════════════════

const MONTHS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DAYS_FR   = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];

// État du calendrier
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based
// Cache calendrier persistant en localStorage
const CAL_CACHE_PREFIX = "cal_cache_";

function calSaveCache(key, data) {
  try { localStorage.setItem(CAL_CACHE_PREFIX + key, JSON.stringify(data)); } catch(e) {}
}

function calLoadCache(key) {
  try {
    const raw = localStorage.getItem(CAL_CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function calClearCache(key) {
  try { localStorage.removeItem(CAL_CACHE_PREFIX + key); } catch(e) {}
}

function calMonthKey(y, m) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

function calMonthLabel(y, m) {
  return `${MONTHS_FR[m]} ${y}`;
}

// Fenêtre autorisée : mois courant jusqu'à +5
function calMinMonth() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() };
}
function calMaxMonth() {
  const now = new Date();
  let m = now.getMonth() + 5;
  let y = now.getFullYear() + Math.floor(m / 12);
  m = m % 12;
  return { y, m };
}
function calCanGoPrev(y, m) {
  const min = calMinMonth();
  return y > min.y || (y === min.y && m > min.m);
}
function calCanGoNext(y, m) {
  const max = calMaxMonth();
  return y < max.y || (y === max.y && m < max.m);
}

async function fetchMonth(y, m, forceReload = false) {
  const key = calMonthKey(y, m);
  if (!forceReload) {
    const cached = calLoadCache(key);
    if (cached) return cached;
  }
  const res = await fetch(`${PROXY_URL}?month=${key}`, { method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  calSaveCache(key, data);
  return data;
}

function renderCal(y, m, data) {
  const today = todayISO();
  const list = document.getElementById("cal-list");

  // Toujours afficher le nom du mois et mettre à jour les boutons
  document.getElementById("cal-month-label").textContent = calMonthLabel(y, m);
  document.getElementById("cal-prev").disabled = !calCanGoPrev(y, m);
  document.getElementById("cal-next").disabled = !calCanGoNext(y, m);

  if (!data) {
    list.innerHTML = `<div class="cal-loading"><div class="spinner"></div><p class="loading-text">Chargement...</p></div>`;
    return;
  }

  const key = calMonthKey(y, m);
  const byDay = data.byDay || {};
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  let html = "";
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${key}-${String(d).padStart(2, "0")}`;
    const dateObj = new Date(dateStr + "T00:00:00");
    const dow = dateObj.getDay(); // 0=dim

    // Séparateur entre chaque jour (sauf avant le 1er)
    if (d > 1) {
      html += `<div class="cal-day-sep"></div>`;
    }

    const isToday = dateStr === today;
    const intentions = byDay[dateStr] || [];
    const dayLabel = `${DAYS_FR[dow]} ${d}`;

    html += `<div class="cal-day${isToday ? " today" : ""}">`;
    html += `<span class="cal-day-num"><span class="cal-day-name">${DAYS_FR[dow]}</span> ${d}</span>`;
    html += `<div class="cal-day-content">`;

    if (intentions.length === 0) {
      html += `<span class="cal-empty-day">—</span>`;
    } else {
      intentions.forEach(i => {
        const nom = i.nom.replace(/\s*♦\s*$/, "");
        const fixeMark = i.fixe ? `<span class="fixe-mark">♦</span>` : "";
        html += `<div class="cal-entry">`;
        html += `<div class="cal-intention">${nom}${fixeMark}</div>`;
        if (i.demandeur) {
          html += `<div class="cal-demandeur">${i.demandeur}</div>`;
        }
        html += `</div>`;
      });
    }

    html += `</div></div>`;
  }

  list.innerHTML = html;

  // Scroll vers aujourd'hui si on est sur le mois courant
  const now = new Date();
  if (y === now.getFullYear() && m === now.getMonth()) {
    const todayEl = list.querySelector(".cal-day.today");
    if (todayEl) setTimeout(() => todayEl.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
  }
}

async function loadCal(y, m, forceReload = false) {
  // Si pas de forceReload, afficher le cache immédiatement pendant le chargement
  if (!forceReload) {
    const cached = calLoadCache(calMonthKey(y, m));
    if (cached) {
      renderCal(y, m, cached);
    } else {
      renderCal(y, m, null); // spinner seulement si pas de cache
    }
  } else {
    renderCal(y, m, null); // spinner sur forceReload
  }
  try {
    const data = await fetchMonth(y, m, forceReload);
    renderCal(y, m, data);
  } catch (e) {
    document.getElementById("cal-list").innerHTML = `<p class="notif-info">Erreur : ${e.message}</p>`;
  }
}

function initCal() {
  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();

  document.getElementById("cal-refresh").addEventListener("click", async () => {
    const btn = document.getElementById("cal-refresh");
    btn.classList.add("spinning");
    btn.disabled = true;
    await loadCal(calYear, calMonth, true);
    btn.classList.remove("spinning");
    btn.disabled = false;
  });

  document.getElementById("cal-prev").addEventListener("click", () => {
    if (!calCanGoPrev(calYear, calMonth)) return;
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    loadCal(calYear, calMonth);
  });

  document.getElementById("cal-next").addEventListener("click", () => {
    if (!calCanGoNext(calYear, calMonth)) return;
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    loadCal(calYear, calMonth);
  });

  loadCal(calYear, calMonth);
}
