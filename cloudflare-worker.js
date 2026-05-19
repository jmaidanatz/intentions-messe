/**
 * Cloudflare Worker — Proxy Anthropic pour PWA Intentions de Messe
 * Syntaxe Service Worker (addEventListener) — compatible éditeur web Cloudflare
 *
 * Variables d'environnement à définir dans Settings > Variables and Secrets :
 *   ANTHROPIC_API_KEY  → votre clé sk-ant-...   (type Secret)
 *   ALLOWED_ORIGIN     → https://votre-compte.github.io  (type Text, sans slash final)
 */

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGIN || "";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Vérification origine
  if (allowed && !origin.startsWith(allowed)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response("API key not configured", { status: 500 });
  }

  // Lecture du body
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Appel Anthropic
  const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  const data = await anthropicResponse.json();

  return new Response(JSON.stringify(data), {
    status: anthropicResponse.status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}
