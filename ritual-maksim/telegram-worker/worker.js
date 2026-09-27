/**
 * Cloudflare Worker alternative to send.php, for static hosting without PHP.
 *
 * Secrets (wrangler secret put ...):
 *   TELEGRAM_BOT_TOKEN  token from @BotFather
 *   TELEGRAM_CHAT_ID    one or more chat ids, comma-separated
 * Var (wrangler.toml):
 *   ALLOWED_ORIGIN      site origin allowed to post, e.g. https://ritual-maksim.by
 *   TELEGRAM_API_BASE   optional Bot API base URL (default https://api.telegram.org)
 */

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function buildMessage({ name, topic, page }, digits, now = new Date()) {
  const pretty = `+375 ${digits.slice(3, 5)} ${digits.slice(5, 8)}-${digits.slice(8, 10)}-${digits.slice(10, 12)}`;
  const when = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Minsk", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(now).replace(",", "");
  const lines = [
    "🕯 <b>Новая заявка с сайта</b>",
    "",
    `<b>Тема:</b> ${esc(topic || "Обратный звонок")}`,
    `<b>Имя:</b> ${esc(name || "—")}`,
    `<b>Телефон:</b> ${pretty}`,
  ];
  if (page) lines.push(`<b>Страница:</b> ${esc(page)}`);
  lines.push(`<i>${when}</i>`);
  return lines.join("\n");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").replace(/\/$/, "");
    const cors = allowed
      ? { "Access-Control-Allow-Origin": allowed, "Vary": "Origin" }
      : { "Access-Control-Allow-Origin": "*" };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" },
      });
    }
    if (request.method !== "POST") return json(405, { ok: false, error: "method" }, { ...cors, Allow: "POST" });
    if (allowed && origin && origin.replace(/\/$/, "") !== allowed) return json(403, { ok: false, error: "origin" }, cors);

    const token = (env.TELEGRAM_BOT_TOKEN || "").trim();
    const chatIds = String(env.TELEGRAM_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!token || !chatIds.length) return json(500, { ok: false, error: "config" }, cors);

    let data;
    try {
      const raw = await request.text();
      if (raw.length > 8192) return json(413, { ok: false, error: "size" }, cors);
      data = JSON.parse(raw);
    } catch {
      return json(400, { ok: false, error: "json" }, cors);
    }
    if (clip(data.website, 200)) return json(200, { ok: true }, cors); // honeypot

    const digits = String(data.phone ?? "").replace(/\D/g, "");
    if (!/^375\d{9}$/.test(digits)) return json(422, { ok: false, error: "phone" }, cors);

    const text = buildMessage({ name: clip(data.name, 80), topic: clip(data.topic, 80), page: clip(data.page, 200) }, digits);
    const results = await Promise.all(chatIds.map((chat_id) =>
      fetch(`${(env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "")}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
      }).then((r) => r.ok, () => false)
    ));
    return results.some(Boolean) ? json(200, { ok: true }, cors) : json(502, { ok: false, error: "telegram" }, cors);
  },
};
