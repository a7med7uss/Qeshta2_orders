import { MENU } from "../public/lib/menu-data.js";
import { priceCart } from "../public/lib/pricing.js";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const PAY = { cash: "كاش", wallet: "محفظة", instapay: "إنستا" };
const ST = { new: "جديد", confirmed: "تم التأكيد", out_for_delivery: "خرج للتوصيل", delivered: "تم التسليم", cancelled: "ملغي" };
const NEXT = { new: ["confirmed", "cancelled"], confirmed: ["out_for_delivery", "cancelled"], out_for_delivery: ["delivered", "cancelled"] };
const BTN = { confirmed: "✅ تم التأكيد", out_for_delivery: "🚚 خرج للتوصيل", delivered: "✔️ تم التسليم", cancelled: "❌ إلغاء" };
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const tg = (env, m, b) => fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()).catch(() => ({ ok: false }));
const kb = (id, st) => ({ inline_keyboard: [(NEXT[st] || []).map(n => ({ text: BTN[n], callback_data: `s:${id}:${n}` }))] });
const owners = env => String(env.OWNER_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const isOwner = (env, id) => owners(env).includes(String(id));
async function isStaff(env, id) { return isOwner(env, id) || !!(await env.DB.prepare("SELECT 1 x FROM staff WHERE telegram_id=? AND active=1").bind(id).first()); }

// رسالة الطلب (الصيغة المعتمدة)
function text(o, items) {
  const t = new Date(o.created_at || Date.now()).toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" });
  const map = o.lat ? ` (https://maps.google.com/?q=${o.lat},${o.lng})` : "";
  const L = items.map(i => `🍽 ${i.qty}× ${i.name}${i.size ? " " + i.size : ""} — ` + (i.pend ? "السعر بالتليفون" : `${i.unit * i.qty} ج`) + (!i.pend && i.base && i.unit > i.base ? ` (الأساس ${i.base} + زيادة ${i.unit - i.base})` : "") + (i.note ? `\n   📝 ${i.note}` : ""));
  const pend = items.filter(i => i.pend).map(i => i.name);
  return [`🔔 طلب جديد #${o.code}`, `👤 ${o.name} – ${o.phone}`, `📍 العنوان: ${o.address || "-"}${map}`, ...L,
    `💰 الأكل ${o.subtotal} + التوصيل مجاني = الإجمالي ${o.total} ج`, `💳 الدفع: ${PAY[o.pay]}`,
    ...(pend.length ? [`⚠️ سعر يتحدد بالتليفون: ${pend.join("، ")}`] : []), ...(o.dbFail ? ["⚠️ لم يُحفظ في القاعدة: سجّله يدوياً"] : []), `🕐 ${t}`].join("\n");
}
async function sendOrder(env, id, o, items) {
  const r = await tg(env, "sendMessage", { chat_id: env.CHAT_ID, text: text(o, items), reply_markup: kb(id, "new"), disable_web_page_preview: true });
  if (id && env.DB) await env.DB.prepare("UPDATE orders SET tg_attempts=tg_attempts+1, tg_sent=?, tg_message_id=? WHERE id=?").bind(r.ok ? 1 : 0, r.result?.message_id ?? null, id).run().catch(() => {});
  return r.ok;
}

async function order(req, env) {
  let b; try { b = await req.json(); } catch { return J({ error: "طلب غير صالح" }, 400); }
  if (b.hp) return J({ ok: true, code: "QST-0000" }); // حقل مخفي للبوتات
  const name = String(b.name || "").trim().replace(/\s+/g, " "), phone = String(b.phone || "").replace(/[\s-]/g, "");
  const address = String(b.address || "").trim().slice(0, 300), lat = Number(b.lat) || null, lng = Number(b.lng) || null;
  if (name.split(" ").length < 2 || name.length > 60) return J({ error: "اكتب الاسم الثنائي" }, 400);
  if (!/^01[0125]\d{8}$/.test(phone)) return J({ error: "رقم الموبايل غير صحيح" }, 400);
  if (!address && !lat) return J({ error: "حدد العنوان أو موقعك" }, 400);
  if (!PAY[b.pay]) return J({ error: "اختر طريقة الدفع" }, 400);
  if (!/^[\w-]{8,64}$/.test(String(b.idem || ""))) return J({ error: "طلب غير صالح" }, 400);
  if (env.TURNSTILE_SECRET) {
    const f = new FormData(); f.append("secret", env.TURNSTILE_SECRET); f.append("response", String(b.token || ""));
    const v = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f }).then(r => r.json()).catch(() => ({}));
    if (!v.success) return J({ error: "فشل التحقق، حاول مرة أخرى" }, 403);
  }
  const raw = (Array.isArray(b.lines) ? b.lines : []).slice(0, 40);
  let priced; try { priced = priceCart(MENU, raw.map(l => ({ id: String(l.id), amount: Number(l.amount), qty: Number(l.qty) }))); } catch (e) { return J({ error: e.message }, 400); }
  if (!priced.lines.length) return J({ error: "السلة فاضية" }, 400);
  const items = priced.lines.map((l, i) => ({ ...l, note: String(raw[i].note || "").slice(0, 120) }));
  const o = { name, phone, address, lat, lng, pay: b.pay, subtotal: priced.subtotal, total: priced.total, created_at: new Date().toISOString() };
  let id = null;
  try {
    const recent = await env.DB.prepare(`SELECT COUNT(*) c FROM orders WHERE phone=? AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')`).bind(phone).first();
    if (recent.c >= 3) return J({ error: "عدد الطلبات كبير، اتصل بنا من فضلك" }, 429);
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO orders(idem_key,customer_name,phone,address_text,lat,lng,payment_method,subtotal,delivery_fee,total) VALUES(?,?,?,?,?,?,?,?,0,?)").bind(b.idem, name, phone, address, lat, lng, b.pay, o.subtotal, o.total).run();
    const row = await env.DB.prepare("SELECT id,code FROM orders WHERE idem_key=?").bind(b.idem).first();
    if (!ins.meta.changes) return J({ ok: true, code: row.code, duplicate: true }); // منع التكرار
    id = row.id; o.code = "QST-" + String(id).padStart(4, "0");
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET code=? WHERE id=?").bind(o.code, id),
      ...items.map(i => env.DB.prepare("INSERT INTO order_items(order_id,item_ref,name,size,qty,base_price,chosen_price,note) VALUES(?,?,?,?,?,?,?,?)").bind(id, i.id, i.name, i.size, i.qty, i.base, i.pend ? -1 : i.unit, i.note || null)),
      env.DB.prepare("INSERT INTO order_events(order_id,event) VALUES(?,'created')").bind(id)]);
  } catch (e) { o.dbFail = true; o.code = "QST-E" + (Date.now() % 100000); id = null; }
  await sendOrder(env, id, o, items); // إن فشل الإرسال يعيده Cron كل دقيقة
  return J({ ok: true, code: o.code });
}

async function rowToOrder(env, r) {
  const its = (await env.DB.prepare("SELECT item_ref,name,size,qty,base_price,chosen_price,note FROM order_items WHERE order_id=?").bind(r.id).all()).results;
  return [{ code: r.code, name: r.customer_name, phone: r.phone, address: r.address_text, lat: r.lat, lng: r.lng, pay: r.payment_method, subtotal: r.subtotal, total: r.total, created_at: r.created_at },
    its.map(i => ({ name: i.name, size: i.size, qty: i.qty, base: i.base_price, unit: Math.max(i.chosen_price, 0), pend: i.chosen_price < 0, note: i.note }))];
}
async function retry(env) {
  const rows = (await env.DB.prepare("SELECT * FROM orders WHERE tg_sent=0 AND tg_attempts<5 AND status='new' ORDER BY id LIMIT 5").all()).results;
  for (const r of rows) { const [o, items] = await rowToOrder(env, r); await sendOrder(env, r.id, o, items); }
}

async function onButton(q, env) {
  const ans = (t, alert = false) => tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: t, show_alert: alert });
  const [, sid, to] = String(q.data || "").split(":"), id = Number(sid), uid = q.from.id;
  if (!(await isStaff(env, uid))) return ans("مش مسموح لك", true);
  const cur = await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(id).first();
  if (!cur || !(NEXT[cur.status] || []).includes(to)) return ans("الحالة اتغيّرت بالفعل");
  const up = await env.DB.prepare(`UPDATE orders SET status=?, confirmed_by=CASE WHEN ?='confirmed' THEN ? ELSE confirmed_by END, updated_at=${NOW} WHERE id=? AND status=?`).bind(to, to, uid, id, cur.status).run();
  if (!up.meta.changes) return ans("اتغيّرت بالفعل من حد تاني");
  await env.DB.prepare("INSERT INTO order_events(order_id,event,by_telegram_id) VALUES(?,?,?)").bind(id, to, uid).run();
  await tg(env, "editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `${q.message.text}\n📌 ${ST[to]} — ${q.from.first_name}`, reply_markup: kb(id, to), disable_web_page_preview: true });
  return ans(ST[to]);
}

async function onCommand(m, env) {
  const [cmd, arg] = m.text.trim().split(/\s+/), t = cmd.split("@")[0], uid = m.from.id;
  const rep = s => tg(env, "sendMessage", { chat_id: m.chat.id, text: s, reply_to_message_id: m.message_id });
  if (t === "/myid") return rep(`رقمك: ${uid}`);
  // يسمح للمالك فقط بمعرفة معرّف مجموعة الاختبار من دون كشفه في السجلات أو المحادثات.
  if (t === "/chatid" && isOwner(env, uid)) return rep(`معرّف المجموعة: ${m.chat.id}`);
  if (!(await isStaff(env, uid))) return;
  if (t === "/pending") {
    const p = Math.max(1, Number(arg) || 1);
    const rs = (await env.DB.prepare("SELECT code,customer_name,phone,total,status FROM orders WHERE status IN('new','confirmed','out_for_delivery') ORDER BY id LIMIT 6 OFFSET ?").bind((p - 1) * 5).all()).results;
    if (!rs.length) return rep("مفيش طلبات مفتوحة");
    return rep(rs.slice(0, 5).map(r => `#${r.code} — ${r.customer_name} ${r.phone} — ${r.total} ج — ${ST[r.status]}`).join("\n") + (rs.length > 5 ? `\n… في المزيد: /pending ${p + 1}` : ""));
  }
  if (t === "/staff") { const rs = (await env.DB.prepare("SELECT telegram_id,name FROM staff WHERE active=1").all()).results; return rep(`المالك: ${owners(env).join("، ")}\nالموظفين:\n` + (rs.map(r => `${r.name || "-"} (${r.telegram_id})`).join("\n") || "لا يوجد")); }
  if ((t === "/addstaff" || t === "/removestaff") && isOwner(env, uid)) {
    const r = m.reply_to_message?.from, sid = r && !r.is_bot ? r.id : Number(arg);
    if (!sid) return rep("اعمل Reply على رسالة الشخص بالأمر، أو اكتب: " + t + " رقم_تيليجرام");
    if (t === "/addstaff") await env.DB.prepare("INSERT INTO staff(telegram_id,name,role,active) VALUES(?,?,'staff',1) ON CONFLICT(telegram_id) DO UPDATE SET active=1,name=excluded.name").bind(sid, r?.first_name || null).run();
    else await env.DB.prepare("UPDATE staff SET active=0 WHERE telegram_id=?").bind(sid).run();
    return rep(t === "/addstaff" ? `تمت إضافة ${r?.first_name || sid}` : `تم حذف ${sid}`);
  }
}

async function hook(req, env) {
  if (!env.WEBHOOK_SECRET || req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) return new Response("no", { status: 401 });
  const u = await req.json().catch(() => ({}));
  const adminChat = String(env.CHAT_ID || "");
  try {
    if (u.callback_query) {
      const actualChat = String(u.callback_query.message?.chat?.id ?? "");
      if (!adminChat || actualChat !== adminChat) {
        await tg(env, "answerCallbackQuery", { callback_query_id: u.callback_query.id, text: "المجموعة غير معتمدة", show_alert: true });
      } else {
        await onButton(u.callback_query, env);
      }
    } else if (u.message?.text?.startsWith("/")) {
      const m = u.message;
      const command = m.text.trim().split(/\s+/)[0].split("@")[0];
      const publicMyIdLookup = command === "/myid";
      const ownerChatIdLookup = command === "/chatid" && isOwner(env, m.from?.id);
      if (publicMyIdLookup || ownerChatIdLookup || (adminChat && String(m.chat?.id) === adminChat)) {
        await onCommand(m, env);
      }
    }
  } catch (e) { console.error(e); }
  return new Response("ok");
}

export default {
  async fetch(req, env) {
    const p = new URL(req.url).pathname;
    if (p === "/api/order" && req.method === "POST") return order(req, env);
    if (p === "/api/tg" && req.method === "POST") return hook(req, env);
    if (p.startsWith("/api/")) return J({ error: "not found" }, 404);
    return env.ASSETS.fetch(req);
  },
  async scheduled(_e, env, ctx) { ctx.waitUntil(retry(env)); },
};
