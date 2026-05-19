// ─── Service Worker — Intentions de Messe ─────────────────────────────────────
const CACHE_NAME = "intentions-v1";
const ASSETS = ["/", "/index.html", "/app.js", "/manifest.json"];

let scheduleConfig = null; // { hour, minute, notionDbId, proxyUrl }
let alarmTimer = null;

// ─── Installation & cache ─────────────────────────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch (offline) ──────────────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("workers.dev") || e.request.url.includes("anthropic.com")) return;
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});

// ─── Messages depuis app.js ───────────────────────────────────────────────────
self.addEventListener("message", (e) => {
  const { type } = e.data;
  if (type === "SCHEDULE") {
    scheduleConfig = {
      hour: e.data.hour,
      minute: e.data.minute,
      notionDbId: e.data.notionDbId,
      proxyUrl: e.data.proxyUrl,
    };
    armNextAlarm();
  }
  if (type === "SHOW_NOTIFICATION") {
    showNotification(e.data.intention);
  }
});

// ─── Alarme ───────────────────────────────────────────────────────────────────
function msUntilNext(hour, minute) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function armNextAlarm() {
  if (!scheduleConfig) return;
  if (alarmTimer) clearTimeout(alarmTimer);
  const ms = msUntilNext(scheduleConfig.hour, scheduleConfig.minute);
  alarmTimer = setTimeout(async () => {
    await fireAlarm();
    armNextAlarm();
  }, ms);
}

async function fireAlarm() {
  try {
    const intention = await queryNotion(scheduleConfig.notionDbId, scheduleConfig.proxyUrl);
    showNotification(intention);
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: "INTENTION_UPDATE", intention }));
  } catch (e) {
    showNotification({ found: false, error: e.message });
  }
}

// ─── Query Notion via proxy Cloudflare ───────────────────────────────────────
async function queryNotion(dbId, proxyUrl) {
  const today = new Date().toISOString().split("T")[0];

  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      mcp_servers: [{ type: "url", url: "https://mcp.notion.com/mcp", name: "notion-mcp" }],
      messages: [{
        role: "user",
        content: `Interroge la base de données Notion "Intentions de Messes" (ID: ${dbId}).
Aujourd'hui : ${today}
Retourne UNIQUEMENT un JSON sans markdown :
Si trouvée : {"found":true,"nom":"...","demandeur":"...","description":"...","multiJours":false}
Sinon : {"found":false}`
      }]
    })
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ─── Affichage notification ───────────────────────────────────────────────────
function showNotification(intention) {
  const title = "✠ Intention de Messe du jour";
  let body = intention.found
    ? intention.nom + (intention.demandeur ? "\nDemandé par " + intention.demandeur : "")
    : "Aucune intention enregistrée pour aujourd'hui.";

  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-96.png",
    tag: "intention-messe",
    renotify: true,
    data: { url: "/" },
  });
}

// ─── Clic sur la notification ────────────────────────────────────────────────
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    })
  );
});

// ─── Periodic Background Sync (filet de sécurité) ────────────────────────────
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "intention-messe-daily") {
    e.waitUntil(checkAndNotifyIfMorning());
  }
});

async function checkAndNotifyIfMorning() {
  if (!scheduleConfig) return;
  const now = new Date();
  const targetMin = scheduleConfig.hour * 60 + scheduleConfig.minute;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (Math.abs(nowMin - targetMin) <= 15) await fireAlarm();
}
