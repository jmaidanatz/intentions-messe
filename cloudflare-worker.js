/**
 * Cloudflare Worker — Proxy Notion pour PWA Intentions de Messe
 *
 * Variables d'environnement :
 *   NOTION_TOKEN    → secret_...   (Secret)
 *   ALLOWED_ORIGIN  → https://jmaidanatz.github.io  (Text)
 *   NOTION_DB_ID    → 2d183ba074148018ae4dfee6db4c950d  (Text)
 *
 * Routes :
 *   GET /          → intention du jour
 *   GET /?month=YYYY-MM → toutes les intentions du mois
 */

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGIN || "";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (allowed && allowed !== "*" && !origin.startsWith(allowed)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!NOTION_TOKEN) {
    return new Response("Notion token not configured", { status: 500 });
  }

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month"); // "YYYY-MM" ou null

  const today = getParisTodayISO();

  // Récupérer toutes les entrées sans filtre
  let allResults = [];
  let cursor = undefined;
  do {
    const body = {
      sorts: [{ property: "Date", direction: "ascending" }],
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const notionRes = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!notionRes.ok) {
      const err = await notionRes.text();
      return new Response(
        JSON.stringify({ found: false, error: `Notion ${notionRes.status}: ${err}` }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const data = await notionRes.json();
    allResults = allResults.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  let responseBody;

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    // Mode mois : retourner toutes les intentions du mois groupées par jour
    responseBody = extractMonth(allResults, monthParam);
  } else {
    // Mode jour : intention du jour
    const intentions = extractIntentions(allResults, today);
    responseBody = { found: intentions.length > 0, intentions };
  }

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

// ── Extraction du jour ────────────────────────────────────────────────────────

function extractIntentions(results, today) {
  const found = [];
  for (const page of results) {
    const props = page.properties;
    const dateObj = props.Date?.date;
    if (!dateObj) continue;
    const dateStart = dateObj.start ? dateObj.start.substring(0, 10) : null;
    const dateEnd   = dateObj.end   ? dateObj.end.substring(0, 10)   : null;
    if (!dateStart) continue;
    const covers =
      (!dateEnd && dateStart === today) ||
      (dateEnd && dateStart <= today && dateEnd >= today);
    if (!covers) continue;
    found.push(buildEntry(props, dateStart, dateEnd));
  }
  return found;
}

// ── Extraction du mois ────────────────────────────────────────────────────────

function extractMonth(results, monthParam) {
  const [y, m] = monthParam.split("-").map(Number);
  const firstDay = `${monthParam}-01`;
  const lastDay  = `${monthParam}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

  const byDay = {};

  for (const page of results) {
    const props   = page.properties;
    const dateObj = props.Date?.date;
    if (!dateObj) continue;
    const dateStart = dateObj.start ? dateObj.start.substring(0, 10) : null;
    const dateEnd   = dateObj.end   ? dateObj.end.substring(0, 10)   : null;
    if (!dateStart) continue;

    // Intention sur 1 jour : ne garder que si le jour est dans le mois
    if (!dateEnd) {
      if (dateStart < firstDay || dateStart > lastDay) continue;
      if (!byDay[dateStart]) byDay[dateStart] = [];
      byDay[dateStart].push(buildEntry(props, dateStart, null));
      continue;
    }

    // Intention sur une période : ne garder que si elle chevauche le mois
    if (dateEnd < firstDay || dateStart > lastDay) continue;

    // Calculer l'intersection stricte avec le mois
    const iterStart = dateStart < firstDay ? firstDay : dateStart;
    const iterEnd   = dateEnd   > lastDay  ? lastDay  : dateEnd;

    let d = new Date(iterStart + "T00:00:00");
    const endD = new Date(iterEnd + "T00:00:00");
    while (d <= endD) {
      const key = d.toISOString().split("T")[0];
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(buildEntry(props, dateStart, dateEnd));
      d.setDate(d.getDate() + 1);
    }
  }

  return { month: monthParam, byDay };
}

// ── Construction d'une entrée ─────────────────────────────────────────────────

function buildEntry(props, dateStart, dateEnd) {
  return {
    nom: extractTitle(props.Nom) || "(sans nom)",
    demandeur: extractRichText(props.Demandeur) || null,
    description: extractRichText(props.Description) || null,
    dateDebut: dateStart,
    dateFin: dateEnd || null,
    fixe: (extractTitle(props.Nom) || "").trimEnd().endsWith("♦"),
    multiJours: !!dateEnd && dateEnd !== dateStart,
  };
}

function extractTitle(prop) {
  if (!prop?.title?.length) return "";
  return prop.title.map(t => t.plain_text).join("");
}

function extractRichText(prop) {
  if (!prop?.rich_text?.length) return "";
  return prop.rich_text.map(t => t.plain_text).join("");
}

function getParisTodayISO() {
  const now = new Date();
  const parisStr = now.toLocaleString("sv-SE", { timeZone: "Europe/Paris" });
  return parisStr.substring(0, 10);
}
