/**
 * Cloudflare Worker — Proxy Notion pour PWA Intentions de Messe
 *
 * Variables d'environnement :
 *   NOTION_TOKEN    → secret_...   (Secret)
 *   ALLOWED_ORIGIN  → https://jmaidanatz.github.io  (Text)
 *   NOTION_DB_ID    → 2d183ba074148018ae4dfee6db4c950d  (Text)
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

  const today = getParisTodayISO();

  // Récupérer toutes les entrées dont la date de début est <= aujourd'hui
  // Le filtrage fin >= aujourd'hui se fait dans extractIntention côté Worker
  const notionBody = {
    filter: {
      property: "Date",
      date: { on_or_before: today }
    },
    sorts: [{ property: "Date", direction: "descending" }],
    page_size: 50
  };

  const notionRes = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(notionBody),
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
  const intention = extractIntention(data.results, today);

  return new Response(JSON.stringify(intention), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

function extractIntention(results, today) {
  if (!results || results.length === 0) return { found: false };

  for (const page of results) {
    const props = page.properties;
    const dateStart = props.Date?.date?.start
      ? props.Date.date.start.substring(0, 10)
      : null;
    const dateEnd = props.Date?.date?.end
      ? props.Date.date.end.substring(0, 10)
      : null;

    if (!dateStart) continue;
    if (dateStart > today) continue;

    // Intention sur un seul jour : dateEnd est null, dateStart doit = today
    if (!dateEnd && dateStart !== today) continue;

    // Intention sur plusieurs jours : dateEnd doit être >= today
    if (dateEnd && dateEnd < today) continue;

    const nom = extractTitle(props.Nom);
    const demandeur = extractRichText(props.Demandeur);
    const description = extractRichText(props.Description);

    return {
      found: true,
      nom: nom || "(sans nom)",
      demandeur: demandeur || null,
      description: description || null,
      dateDebut: dateStart,
      dateFin: dateEnd || null,
      multiJours: !!dateEnd && dateEnd !== dateStart,
    };
  }

  return { found: false };
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
  const parisStr = now.toLocaleString("en-US", { timeZone: "Europe/Paris" });
  const paris = new Date(parisStr);
  const y = paris.getFullYear();
  const m = String(paris.getMonth() + 1).padStart(2, "0");
  const d = String(paris.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
