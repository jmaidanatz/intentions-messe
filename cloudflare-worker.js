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

  const intentions = extractIntentions(allResults, today);

  return new Response(JSON.stringify({ found: intentions.length > 0, intentions }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

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

    found.push({
      nom: extractTitle(props.Nom) || "(sans nom)",
      demandeur: extractRichText(props.Demandeur) || null,
      description: extractRichText(props.Description) || null,
      dateDebut: dateStart,
      dateFin: dateEnd || null,
      multiJours: !!dateEnd && dateEnd !== dateStart,
    });
  }

  return found;
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
