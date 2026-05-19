// ─── Configuration ────────────────────────────────────────────────────────────
const NOTION_DB_ID = "2d183ba074148018ae4dfee6db4c950d";

// ← Remplacer par l'URL de votre Cloudflare Worker après déploiement
// Exemple : "https://intentions-proxy.votre-compte.workers.dev"
const PROXY_URL = "intentions-proxy.j-maidanatz.workers.dev";

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

// ─── Appel API via proxy Cloudflare ──────────────────────────────────────────
async function fetchIntentionDuJour() {
  const today = todayISO();

  const response = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      mcp_servers: [{ type: "url", url: "https://mcp.notion.com/mcp", name: "notion-mcp" }],
      messages: [{
        role: "user",
        content: `Interroge la base de données Notion "Intentions de Messes" (ID: ${NOTION_DB_ID}).

La date d'aujourd'hui est : ${today}

Trouve l'intention valable aujourd'hui. Une intention couvre un jour ou une période : elle est valable si (date:Date:start) <= ${today} ET (date:Date:end) >= ${today}, OU si date:Date:end est nulle et date:Date:start = ${today}.

Retourne UNIQUEMENT un objet JSON valide sans markdown ni backticks :
Si trouvée : {"found":true,"nom":"...","demandeur":"... ou null","description":"... ou null","dateDebut":"YYYY-MM-DD","dateFin":"YYYY-MM-DD ou null","multiJours":true/false}
Si non trouvée : {"found":false}
Si erreur : {"found":false,"error":"description"}`
      }]
    })
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();

  const text = data.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");

  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Rendu de la carte intention ──────────────────────────────────────────────
function renderCard(intention) {
  const container = document.getElementById("card-container");

  if (!intention) {
    container.innerHTML = `
      <div class="card loading fade-in">
        <div class="spinner"></div>
        <p class="loading-text">Consultation de Notion...</p>
      </div>`;
    return;
  }

  if (intention._error) {
    container.innerHTML = `
      <div class="card error-card fade-in">
        <span class="error-icon">&#9888;</span>
        <p class="error-text">${intention._error}</p>
      </div>`;
    return;
  }

  if (!intention.found) {
    container.innerHTML = `
      <div class="card fade-in">
        <span class="empty-icon">&#128357;</span>
        <p class="empty-text">Aucune intention enregistrée pour aujourd'hui.</p>
        ${intention.error ? `<p class="warning-text">${intention.error}</p>` : ""}
      </div>`;
    return;
  }

  const dateLine = intention.multiJours && intention.dateFin
    ? `${formatDate(intention.dateDebut)} — ${formatDate(intention.dateFin)}`
    : formatDate(intention.dateDebut);

  container.innerHTML = `
    <div class="card fade-in">
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

function triggerNotification(intention) {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
    if (Notification.permission === "granted") {
      const body = intention.found
        ? `${intention.nom}${intention.demandeur ? "\nDemandé par " + intention.demandeur : ""}`
        : "Aucune intention enregistrée pour aujourd'hui.";
      new Notification("✠ Intention de Messe du jour", { body, tag: "intention" });
    }
    return;
  }
  navigator.serviceWorker.controller.postMessage({ type: "SHOW_NOTIFICATION", intention });
}

async function scheduleNotification() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  if (reg.active) {
    reg.active.postMessage({
      type: "SCHEDULE",
      hour: NOTIFY_HOUR,
      minute: NOTIFY_MINUTE,
      notionDbId: NOTION_DB_ID,
      proxyUrl: PROXY_URL,
    });
  }
}

// ─── Service Worker ───────────────────────────────────────────────────────────
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js", { scope: "/" });
    console.log("SW enregistré :", reg.scope);
  } catch (e) {
    console.warn("Erreur SW :", e);
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "INTENTION_UPDATE") {
      saveCache(e.data.intention);
      renderCard(e.data.intention);
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
  document.getElementById("btn-refresh").addEventListener("click", loadIntention);
  renderNotif();
  if ("serviceWorker" in navigator && Notification.permission === "granted") {
    await registerServiceWorker();
    await scheduleNotification();
  }
  await loadIntention();
}

async function loadIntention() {
  const btn = document.getElementById("btn-refresh");
  if (btn) btn.disabled = true;
  const cached = loadCache();
  if (cached) renderCard(cached); else renderCard(null);
  try {
    const intention = await fetchIntentionDuJour();
    saveCache(intention);
    renderCard(intention);
  } catch (e) {
    if (cached) renderCard(cached);
    else renderCard({ _error: e.message || "Erreur de connexion" });
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", init);
