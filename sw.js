// ─── Service Worker — Intentions de Messe ─────────────────────────────────────
const CACHE_NAME = "intentions-v4";
const ASSETS = [
  "/intentions-messe/",
  "/intentions-messe/index.html",
  "/intentions-messe/app.js",
  "/intentions-messe/manifest.json"
];

let scheduleConfig = null;
let alarmTimer = null;

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

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("workers.dev")) return;
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});

self.addEventListener("message", (e) => {
  if (e.data.type === "SCHEDULE") {
    scheduleConfig = {
      hour: e.data.hour,
      minute: e.data.minute,
      proxyUrl: e.data.proxyUrl,
    };
    armNextAlarm();
  }
  if (e.data.type === "SHOW_NOTIFICATION") {
    showNotification(e.data.result);
  }
});

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
    const res = await fetch(scheduleConfig.proxyUrl, { method: "GET" });
    const result = await res.json();
    showNotification(result);
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: "INTENTION_UPDATE", result }));
  } catch (e) {
    showNotification({ found: false, error: e.message });
  }
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

function showNotification(result) {
  const count = result?.intentions?.length || 0;
  const title = count > 1
    ? `✠ ${count} intentions de Messe aujourd'hui`
    : "✠ Intention de Messe du jour";

  self.registration.showNotification(title, {
    body: buildNotifBody(result),
    icon: "/intentions-messe/icon-192.png",
    badge: "/intentions-messe/icon-96.png",
    tag: "intention-messe",
    renotify: true,
    data: { url: "/intentions-messe/" },
  });
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then(clients => {
      const existing = clients.find(c => c.url.includes("/intentions-messe/"));
      if (existing) return existing.focus();
      return self.clients.openWindow("/intentions-messe/");
    })
  );
});

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "intention-messe-daily") {
    e.waitUntil((async () => {
      if (!scheduleConfig) return;
      const now = new Date();
      const targetMin = scheduleConfig.hour * 60 + scheduleConfig.minute;
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (Math.abs(nowMin - targetMin) <= 15) await fireAlarm();
    })());
  }
});
