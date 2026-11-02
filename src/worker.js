import { MENU } from "../public/lib/menu-data.js";
import { priceCart } from "../public/lib/pricing.js";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const PAY = { cash: "الدفع عند الاستلام", wallet: "محفظة", instapay: "إنستا (غير متاح)" };
const ST = { new: "طلب جديد", confirmed: "تم التأكيد", out_for_delivery: "خرج للتوصيل", delivered: "تم التسليم", cancelled: "تم الإلغاء" };
const NEXT = { new: ["confirmed", "cancelled"], confirmed: ["out_for_delivery", "cancelled"], out_for_delivery: ["delivered", "cancelled"] };
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const tg = (env, m, b) => fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()).catch(() => ({ ok: false }));
const owners = env => String(env.OWNER_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const isOwner = (env, id) => owners(env).includes(String(id));
async function isStaff(env, id) { return isOwner(env, id) || !!(await env.DB.prepare("SELECT 1 x FROM staff WHERE telegram_id=? AND active=1").bind(id).first()); }

function itemCategory(itemId) {
  const c = MENU.categories.find(x => x.items?.some(i => i.id === itemId) || x.additions?.some(i => i.id === itemId));
  if (!c) return "أصناف";
  if (!c.parent_category) return c.name;
  const parent = MENU.categories.find(x => x.id === c.parent_category);
  return parent ? `${parent.name} › ${c.name}` : c.name;
}
function whatsappPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("0")) return "20" + digits.slice(1);
  if (digits.startsWith("20")) return digits;
  return digits;
}
function whatsappUrl(phone, message) {
  const target = whatsappPhone(phone);
  return target ? `https://wa.me/${target}?text=${encodeURIComponent(message.slice(0, 900))}` : null;
}
function orderWhatsAppMessage(o, items, env) {
  const summary = items.map(i => {
    const size = i.size ? ` (${i.size})` : "";
    const price = i.pend ? "السعر يحدد بالتواصل" : ` — ${i.unit * i.qty} جنيه`;
    return [
      `• ${itemCategory(i.id)} / ${i.name}${size} × ${i.qty}${price}`,
      ...(i.note ? [`  ملاحظة: ${i.note}`] : [])
    ].join("\n");
  }).join("\n");
  const lines = [
    `السلام عليكم ${o.name}`,
    `بخصوص طلبك رقم ${o.code} من مطعم قشطة:`,
    "",
    summary,
    "",
    `الإجمالي: ${o.total} جنيه.`,
    `طريقة الدفع: ${o.pay === "wallet" ? "فودافون كاش" : o.pay === "cash" ? "الدفع عند الاستلام" : "إنستا باي غير متاح حالياً"}.`
  ];
  if (o.pay === "wallet") {
    if (env.WALLET_NUMBER) {
      lines.push("");
      lines.push("بيانات التحويل:");
      lines.push(`${env.WALLET_PROVIDER || "Vodafone Cash"}: ${env.WALLET_NUMBER}${env.WALLET_OWNER ? ` — باسم ${env.WALLET_OWNER}` : ""}`);
      lines.push("بعد التحويل برجاء إرسال صورة تأكيد العملية على نفس المحادثة.");
    } else {
      lines.push("بيانات التحويل غير متاحة حالياً. برجاء انتظار تأكيد المطعم قبل التحويل.");
    }
  }
  lines.push("", "شكراً لطلبك من قشطة.");
  return lines.join("\n");
}
const ORDER_ACTION_BASE = "https://qeshta2-orders.qeshta.workers.dev";
const ORDER_ACTION_TTL_SECONDS = 30 * 24 * 60 * 60;
const actionEncoder = new TextEncoder();

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeBase64Url(value) {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function orderActionKey(env) {
  if (!env.WEBHOOK_SECRET) throw new Error("Order action signing key is not configured");
  return crypto.subtle.importKey("raw", actionEncoder.encode(env.WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function createOrderActionToken(env, id, action) {
  if (!["confirmed", "cancelled", "revive"].includes(action)) throw new Error("Invalid order action");
  const payload = encodeBase64Url(actionEncoder.encode(JSON.stringify({
    id: Number(id), action, exp: Math.floor(Date.now() / 1000) + ORDER_ACTION_TTL_SECONDS
  })));
  const key = await orderActionKey(env);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, actionEncoder.encode(payload)));
  return payload + "." + encodeBase64Url(signature);
}
async function verifyOrderActionToken(env, token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const key = await orderActionKey(env);
    const valid = await crypto.subtle.verify("HMAC", key, decodeBase64Url(parts[1]), actionEncoder.encode(parts[0]));
    if (!valid) return null;
    const value = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    if (!Number.isSafeInteger(value.id) || value.id < 1 ||
        !["confirmed", "cancelled", "revive"].includes(value.action) ||
        !Number.isSafeInteger(value.exp) || value.exp < Math.floor(Date.now() / 1000)) return null;
    return value;
  } catch {
    return null;
  }
}
async function orderActionUrl(env, id, action) {
  const token = await createOrderActionToken(env, id, action);
  return ORDER_ACTION_BASE + "/api/order-action?t=" + encodeURIComponent(token);
}
function orderActionHtml(title, message, token, action, status) {
  const safe = value => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const labels = {
    confirmed: ["تأكيد الطلب", "هل أنت متأكد أنك تريد تأكيد هذا الطلب؟", "نعم، تأكيد الطلب"],
    cancelled: ["إلغاء الطلب", "هل أنت متأكد أنك تريد إلغاء هذا الطلب؟", "نعم، إلغاء الطلب"],
    revive: ["إعادة إحياء الطلب", "هل تريد إعادة هذا الطلب إلى قائمة الطلبات الجديدة؟", "نعم، إعادة إحياء الطلب"]
  };
  const choice = labels[action];
  const form = choice
    ? '<p class="question">' + choice[1] + '</p><form method="POST" action="/api/order-action">' +
      '<input type="hidden" name="token" value="' + safe(token) + '">' +
      '<button class="yes" type="submit" name="decision" value="yes">' + choice[2] + '</button>' +
      '<button class="no" type="submit" name="decision" value="no">لا، تراجع</button></form>'
    : "";
  const html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">' +
    '<title>' + safe(title) + ' - قشطة</title><style>' +
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#17100d;color:#fff;font-family:Arial,Tahoma,sans-serif;padding:20px}' +
    'main{width:min(100%,440px);background:#241914;border:1px solid #594033;border-radius:22px;padding:26px;box-shadow:0 18px 60px #0008}' +
    'h1{font-size:23px;margin:0 0 14px}.msg{color:#e8d8cb;line-height:1.9;margin:0 0 22px}.question{font-size:19px;line-height:1.8}' +
    'button{width:100%;border:0;border-radius:14px;padding:15px;margin-top:10px;font-size:17px;font-weight:bold;cursor:pointer}' +
    '.yes{background:#e94a13;color:white}.no{background:#3b2c25;color:white}small{color:#bba99c}</style></head><body><main>' +
    '<h1>' + safe(title) + '</h1><p class="msg">' + safe(message) + '</p>' + form +
    '<small>قشطة — إدارة الطلبات</small></main></body></html>';
  return new Response(html, { status: status || 200, headers: {
    "content-type": "text/html; charset=UTF-8",
    "cache-control": "no-store, max-age=0",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  }});
}
async function handleOrderAction(req, env) {
  if (req.method !== "GET" && req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let token = "";
  let decision = "";
  if (req.method === "GET") token = new URL(req.url).searchParams.get("t") || "";
  else {
    const origin = req.headers.get("origin") || (() => {
      try { return new URL(req.headers.get("referer") || "").origin; } catch { return ""; }
    })();
    if (origin && origin !== ORDER_ACTION_BASE)
      return orderActionHtml("تعذر تنفيذ الإجراء", "افتح الزر من رسالة الطلب داخل Telegram ثم حاول مرة أخرى.", "", "", 403);
    const form = await req.formData().catch(() => null);
    token = String(form && form.get("token") || "");
    decision = String(form && form.get("decision") || "");
  }
  const payload = await verifyOrderActionToken(env, token);
  if (!payload) return orderActionHtml("الرابط غير صالح", "انتهت صلاحية الرابط أو أنه غير صحيح. اطلب تحديث أزرار الطلب من مسؤول النظام.", "", "", 403);
  const row = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(payload.id).first();
  if (!row) return orderActionHtml("الطلب غير موجود", "لم يتم العثور على الطلب في قاعدة البيانات.", "", "", 404);
  const allowed = payload.action === "revive" ? row.status === "cancelled" : row.status === "new";
  if (!allowed) return orderActionHtml("تم تحديث الطلب بالفعل", "الحالة الحالية للطلب هي: " + (ST[row.status] || row.status) + ".", "", "", 409);
  if (req.method === "GET") {
    const labels = {
      confirmed: ["تأكيد الطلب", "الطلب " + row.code + " جاهز للتأكيد."],
      cancelled: ["إلغاء الطلب", "الطلب " + row.code + " سيتم إلغاؤه."],
      revive: ["إعادة إحياء الطلب", "الطلب " + row.code + " سيعود إلى الطلبات الجديدة."]
    };
    return orderActionHtml(labels[payload.action][0], labels[payload.action][1], token, payload.action, 200);
  }
  if (decision !== "yes" && decision !== "no")
    return orderActionHtml("اختيار غير صالح", "لم يتم تغيير حالة الطلب.", "", "", 400);
  if (decision === "no")
    return orderActionHtml("لم يتم تغيير الطلب", "تم التراجع. حالة الطلب لم تتغير، ويمكنك الرجوع إلى Telegram.", "", "", 200);

  const result = payload.action === "revive"
    ? await reviveOrder(env, row, null, env.CHAT_ID, row.tg_message_id)
    : await changeOrderStatus(env, row, payload.action, null, env.CHAT_ID, row.tg_message_id);
  if (!result.ok) return orderActionHtml("لم يتم تنفيذ الإجراء", result.message, "", "", 409);
  if (!result.messageUpdated)
    return orderActionHtml("تم تحديث قاعدة البيانات", result.message + ". لكن تعذر تحديث رسالة Telegram؛ استخدم /refreshorder من الجروب لمزامنتها.", "", "", 502);
  return orderActionHtml("تم بنجاح", result.message + ". تم تحديث قاعدة البيانات ورسالة الطلب في Telegram.", "", "", 200);
}
async function orderKeyboard(o, status, items, env) {
  if (status === "cancelled") {
    return { inline_keyboard: [[{ text: "♻️ إعادة إحياء الطلب", url: await orderActionUrl(env, o.id, "revive") }]] };
  }
  // Once confirmed, all inline actions are removed from the message.
  if (status !== "new") return { inline_keyboard: [] };

  const [confirmUrl, cancelUrl] = await Promise.all([
    orderActionUrl(env, o.id, "confirmed"),
    orderActionUrl(env, o.id, "cancelled")
  ]);
  const rows = [[
    { text: "✅ تأكيد الطلب", url: confirmUrl },
    { text: "❌ إلغاء الطلب", url: cancelUrl }
  ]];

  const phone = String(o.phone || "").replace(/[\s-]/g, "");
  const contactRow = [];
  if (phone) contactRow.push({ text: "📋 نسخ رقم العميل", copy_text: { text: phone.slice(0, 256) } });
  const wa = whatsappUrl(phone, orderWhatsAppMessage(o, items, env));
  if (wa) contactRow.push({ text: "📤 إرسال تفاصيل الطلب للعميل", url: wa });
  if (contactRow.length) rows.push(contactRow);

  if (o.lat !== null && o.lat !== undefined && o.lng !== null && o.lng !== undefined &&
      Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng))) {
    const coords = `${o.lat},${o.lng}`;
    rows.push([
      { text: "📍 Google Maps", url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}` },
      { text: "🍎 Apple Maps", url: `https://maps.apple.com/?ll=${encodeURIComponent(coords)}&q=${encodeURIComponent("موقع العميل")}` }
    ]);
  }
  return { inline_keyboard: rows };
}

// تنسيق مقسّم بوضوح لتقليل تزاحم النص على الهاتف.
function text(o, items, env = {}) {
  const t = new Date(o.created_at || Date.now()).toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" });
  const itemLines = items.map((i, n) => {
    const section = itemCategory(i.id);
    const size = i.size ? ` — ${i.size}` : "";
    const price = i.pend ? "السعر بالتليفون" : `${i.unit * i.qty} ج`;
    const increase = !i.pend && i.base && i.unit > i.base ? ` (الأساس ${i.base} + زيادة ${i.unit - i.base})` : "";
    return [`${n + 1}) ${section} / ${i.name}${size} × ${i.qty}`, `   السعر: ${price}${increase}`, ...(i.note ? [`   ملاحظة: ${i.note}`] : [])].join("\n");
  });
  const pending = items.filter(i => i.pend).map(i => i.name);
  const lines = [
    `🔔 طلب جديد #${o.code}`,
    "━━━━━━━━━━━━━━━━━━",
    "👤 بيانات العميل",
    `الاسم: ${o.name}`,
    `الهاتف: ${o.phone} (اضغط على الرقم للاتصال)`,
    `العنوان: ${o.address || "غير مكتوب"}`,
    ...(o.lat !== null && o.lat !== undefined && o.lng !== null && o.lng !== undefined ? [`إحداثيات الموقع: ${o.lat}, ${o.lng}`] : []),
    "━━━━━━━━━━━━━━━━━━",
    "🛒 تفاصيل الطلب",
    ...itemLines,
    "━━━━━━━━━━━━━━━━━━",
    "💰 الحساب",
    `قيمة الأكل: ${o.subtotal} جنيه`,
    "التوصيل: مجاني",
    `الإجمالي: ${o.total} جنيه`,
    `طريقة الدفع: ${PAY[o.pay]}`,
    ...(o.pay === "wallet" && !env.WALLET_NUMBER ? ["⚠️ رقم المحفظة غير مضبوط في إعدادات Worker؛ لا تحوّل قبل تأكيد المطعم."] : []),
    ...(o.pay === "instapay" && !env.INSTAPAY_IPA && !env.INSTAPAY_PAYMENT_LINK ? ["⚠️ بيانات InstaPay غير مضبوطة بعد؛ راجع العميل قبل التحويل."] : []),
    ...(pending.length ? [`⚠️ سعر يتحدد بالتليفون: ${pending.join("، ")}`] : []),
    ...(o.dbFail ? ["⚠️ لم يُحفظ في القاعدة: سجّله يدوياً"] : []),
    ...(o.status && o.status !== "new" ? [`📌 الحالة: ${ST[o.status] || o.status}`] : []),
    ...(o.cancel_reason ? [`سبب الإلغاء: ${o.cancel_reason}`] : []),
    "━━━━━━━━━━━━━━━━━━",
    `🕒 ${t}`
  ];
  const message = lines.join("\n");
  return message.length > 3900 ? message.slice(0, 3880) + "\n… تم اختصار بقية التفاصيل." : message;
}
async function sendOrder(env, id, o, items) {
  const r = await tg(env, "sendMessage", {
    chat_id: env.CHAT_ID,
    text: text({ ...o, id }, items, env),
    reply_markup: await orderKeyboard({ ...o, id }, "new", items, env),
    disable_web_page_preview: true
  });
  if (id && env.DB) await env.DB.prepare("UPDATE orders SET tg_attempts=tg_attempts+1, tg_sent=?, tg_message_id=? WHERE id=?").bind(r.ok ? 1 : 0, r.result?.message_id ?? null, id).run().catch(() => {});
  return r.ok;
}

async function order(req, env) {
  let b; try { b = await req.json(); } catch { return J({ error: "طلب غير صالح" }, 400); }
  if (b.hp) return J({ ok: true, code: "QST-0000" }); // حقل مخفي للبوتات
  if (!env.BOT_TOKEN || !env.CHAT_ID || !env.WEBHOOK_SECRET || !env.TURNSTILE_SECRET) {
    return J({ error: "نظام الطلبات غير جاهز لاستقبال الطلبات حالياً" }, 503);
  }
  const name = String(b.name || "").trim().replace(/\s+/g, " "), phone = String(b.phone || "").replace(/[\s-]/g, "");
  const address = String(b.address || "").trim().slice(0, 300);
  const rawLat = b.lat === null || b.lat === undefined || b.lat === "" ? null : Number(b.lat);
  const rawLng = b.lng === null || b.lng === undefined || b.lng === "" ? null : Number(b.lng);
  const hasCoordinates = Number.isFinite(rawLat) && Number.isFinite(rawLng) &&
    rawLat >= -90 && rawLat <= 90 && rawLng >= -180 && rawLng <= 180;
  const lat = hasCoordinates ? rawLat : null, lng = hasCoordinates ? rawLng : null;
  if (name.split(" ").length < 2 || name.length > 60) return J({ error: "اكتب الاسم الثنائي" }, 400);
  if (!/^01[0125]\d{8}$/.test(phone)) return J({ error: "رقم الموبايل غير صحيح" }, 400);
  if ((b.lat != null || b.lng != null) && !hasCoordinates) return J({ error: "الموقع الجغرافي غير صالح" }, 400);
  if (!address && !hasCoordinates) return J({ error: "من فضلك اكتب العنوان بالتفصيل أو حدد موقعك من زر تحديد الموقع." }, 400);
  if (!PAY[b.pay]) return J({ error: "اختر طريقة الدفع" }, 400);
  if (b.pay === "instapay") return J({ error: "InstaPay غير متاح حالياً. اختر الدفع عند الاستلام أو فودافون كاش." }, 400);
  if (!/^[\w-]{8,64}$/.test(String(b.idem || ""))) return J({ error: "طلب غير صالح" }, 400);
  // Idempotent retries must work even when the original one-use Turnstile token has expired.
  try {
    const prior = await env.DB.prepare("SELECT code FROM orders WHERE idem_key=?").bind(b.idem).first();
    if (prior) return J({ ok: true, code: prior.code, duplicate: true });
  } catch {
    return J({ error: "تعذر التحقق من الطلب، حاول مرة أخرى" }, 503);
  }
  // Fail closed: public order creation is unavailable until Turnstile is configured.
  if (!env.TURNSTILE_SECRET) return J({ error: "خدمة التحقق غير جاهزة، حاول لاحقاً" }, 503);
  const f = new FormData(); f.append("secret", env.TURNSTILE_SECRET); f.append("response", String(b.token || ""));
  const v = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f }).then(r => r.json()).catch(() => ({}));
  if (!v.success) return J({ error: "فشل التحقق، حاول مرة أخرى" }, 403);

  const raw = Array.isArray(b.lines) ? b.lines : [];
  if (raw.length > 40) return J({ error: "عدد الأصناف في الطلب أكبر من المسموح" }, 400);
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
    if (!ins.meta.changes) return J({ ok: true, code: row.code, duplicate: true }); // طلب متزامن بنفس مفتاح المنع
    id = row.id; o.code = "QST-" + String(id).padStart(4, "0");
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET code=? WHERE id=?").bind(o.code, id),
      ...items.map(i => env.DB.prepare("INSERT INTO order_items(order_id,item_ref,name,size,qty,base_price,chosen_price,note) VALUES(?,?,?,?,?,?,?,?)").bind(id, i.id, i.name, i.size, i.qty, i.base, i.pend ? -1 : i.unit, i.note || null)),
      env.DB.prepare("INSERT INTO order_events(order_id,event) VALUES(?,'created')").bind(id)]);
  } catch (e) {
    // D1 batch is transactional, but the initial order insert is separate: remove the shell row if details failed.
    if (id !== null) await env.DB.prepare("DELETE FROM orders WHERE id=?").bind(id).run().catch(() => {});
    o.dbFail = true; o.code = "QST-E" + (Date.now() % 100000); id = null;
  }
  await sendOrder(env, id, o, items); // إن فشل الإرسال يعيده Cron كل دقيقة
  return J({ ok: true, code: o.code });
}

async function rowToOrder(env, r) {
  const its = (await env.DB.prepare("SELECT item_ref,name,size,qty,base_price,chosen_price,note FROM order_items WHERE order_id=?").bind(r.id).all()).results;
  return [{ id: r.id, code: r.code, name: r.customer_name, phone: r.phone, address: r.address_text, lat: r.lat, lng: r.lng, pay: r.payment_method, subtotal: r.subtotal, total: r.total, created_at: r.created_at, status: r.status, cancel_reason: r.cancel_reason },
    its.map(i => ({ id: i.item_ref, name: i.name, size: i.size, qty: i.qty, base: i.base_price, unit: Math.max(i.chosen_price, 0), pend: i.chosen_price < 0, note: i.note }))];
}
async function retry(env) {
  const rows = (await env.DB.prepare("SELECT * FROM orders WHERE tg_sent=0 AND tg_attempts<5 AND status='new' ORDER BY id LIMIT 5").all()).results;
  for (const r of rows) { const [o, items] = await rowToOrder(env, r); await sendOrder(env, r.id, o, items); }
}

async function editOrderTelegramMessage(env, row, chatId = env.CHAT_ID, messageId = row.tg_message_id) {
  const [o, items] = await rowToOrder(env, row);
  const result = await tg(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text(o, items, env),
    reply_markup: await orderKeyboard(o, row.status, items, env),
    disable_web_page_preview: true
  });
  return !!result.ok;
}
async function changeOrderStatus(env, row, to, uid, chatId, messageId) {
  if (!(NEXT[row.status] || []).includes(to)) return { ok: false, message: "حالة الطلب اتغيّرت بالفعل" };
  const result = await env.DB.prepare(
    `UPDATE orders SET status=?, cancel_reason=NULL, confirmed_by=CASE WHEN ?='confirmed' THEN ? ELSE confirmed_by END, updated_at=${NOW} WHERE id=? AND status=?`
  ).bind(to, to, uid, row.id, row.status).run();
  if (!result.meta.changes) return { ok: false, message: "حالة الطلب اتغيّرت بالفعل من عضو آخر" };
  await env.DB.prepare("INSERT INTO order_events(order_id,event,by_telegram_id) VALUES(?,?,?)")
    .bind(row.id, to, uid).run();
  const refreshed = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(row.id).first();
  const messageUpdated = refreshed
    ? await editOrderTelegramMessage(env, refreshed, chatId, messageId)
    : false;
  return {
    ok: true,
    message: to === "confirmed" ? "تم تأكيد الطلب" : "تم إلغاء الطلب",
    messageUpdated
  };
}
async function showOrderDecision(q, env, row, to) {
  if (!["confirmed", "cancelled"].includes(to)) return { ok: false, message: "الإجراء غير معروف" };
  if (row.status !== "new") return { ok: false, message: "لا يمكن تغيير هذا الطلب؛ حالته الحالية: " + (ST[row.status] || row.status) };
  const [o, items] = await rowToOrder(env, row);
  const question = to === "confirmed" ? "هل أنت متأكد من تأكيد الطلب؟" : "هل أنت متأكد من إلغاء الطلب؟";
  const result = await tg(env, "editMessageText", {
    chat_id: q.message.chat.id,
    message_id: q.message.message_id,
    text: text(o, items, env) + "\n\n⚠️ " + question,
    reply_markup: { inline_keyboard: [[
      { text: to === "confirmed" ? "نعم، تأكيد الطلب" : "نعم، إلغاء الطلب", callback_data: `yes:${row.id}:${to}` },
      { text: "لا، تراجع", callback_data: `no:${row.id}:${to}` }
    ]] },
    disable_web_page_preview: true
  });
  return { ok: !!result.ok, message: result.ok ? question : "تعذر عرض رسالة التأكيد. حاول مرة أخرى." };
}
async function restoreOrderMessage(q, env, row) {
  const [o, items] = await rowToOrder(env, row);
  const result = await tg(env, "editMessageText", {
    chat_id: q.message.chat.id,
    message_id: q.message.message_id,
    text: text(o, items, env),
    reply_markup: await orderKeyboard(o, row.status, items, env),
    disable_web_page_preview: true
  });
  return !!result.ok;
}
async function reviveOrder(env, row, uid, chatId, messageId) {
  if (row.status !== "cancelled") return { ok: false, message: "الطلب ليس ملغياً" };
  const result = await env.DB.prepare(
    `UPDATE orders SET status='new', cancel_reason=NULL, confirmed_by=NULL, updated_at=${NOW} WHERE id=? AND status='cancelled'`
  ).bind(row.id).run();
  if (!result.meta.changes) return { ok: false, message: "تم تحديث الطلب من عضو آخر" };
  await env.DB.prepare("INSERT INTO order_events(order_id,event,by_telegram_id) VALUES(?,'revived',?)")
    .bind(row.id, uid).run();
  const refreshed = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(row.id).first();
  const messageUpdated = refreshed
    ? await editOrderTelegramMessage(env, refreshed, chatId, messageId)
    : false;
  return { ok: true, message: "تم إحياء الطلب وإعادته كطلب جديد", messageUpdated };
}
async function onButton(q, env) {
  const ans = (t, alert = false) => tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: t, show_alert: alert });
  try {
    const [kind, sid, action] = String(q.data || "").split(":");
    const id = Number(sid), uid = q.from?.id;
    if (!Number.isSafeInteger(id) || id < 1) return ans("رقم الطلب غير صالح", true);
    const row = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
    if (!row) return ans("الطلب غير موجود", true);

    // New buttons and legacy buttons both open the confirmation step, never mutate status immediately.
    if ((kind === "ask" && ["confirmed", "cancelled"].includes(action)) ||
        (kind === "s" && ["confirmed", "cancelled"].includes(action)) ||
        (kind === "c" && ["open", "customer", "no_answer", "address", "other"].includes(action))) {
      const decision = await showOrderDecision(q, env, row, action === "confirmed" ? "confirmed" : "cancelled");
      return ans(decision.message, !decision.ok);
    }

    if (kind === "yes" && ["confirmed", "cancelled"].includes(action)) {
      const result = await changeOrderStatus(env, row, action, uid, q.message.chat.id, q.message.message_id);
      if (!result.ok) return ans(result.message, true);
      if (!result.messageUpdated) return ans(result.message + "، لكن تعذر تحديث نص رسالة Telegram", true);
      return ans(result.message);
    }

    if (kind === "no" && ["confirmed", "cancelled"].includes(action)) {
      if (row.status !== "new") return ans("الطلب اتغيّرت حالته بالفعل", true);
      const restored = await restoreOrderMessage(q, env, row);
      return ans(restored ? "تم التراجع، لم تتغير حالة الطلب" : "تعذر استعادة رسالة الطلب", !restored);
    }

    if (kind === "revive" && action === "now") {
      const result = await reviveOrder(env, row, uid, q.message.chat.id, q.message.message_id);
      if (!result.ok) return ans(result.message, true);
      if (!result.messageUpdated) return ans(result.message + "، لكن تعذر تحديث رسالة Telegram", true);
      return ans(result.message);
    }

    return ans("هذا الزر لم يعد متاحاً. حدّث رسالة الطلب.", true);
  } catch (error) {
    console.error("Telegram callback failed:", error);
    return ans("تعذر تنفيذ الإجراء. حاول مرة أخرى أو راجع سجلات Worker.", true);
  }
}
async function onCommand(m, env) {
  const [cmd, arg] = m.text.trim().split(/\s+/), t = cmd.split("@")[0], uid = m.from.id;
  const rep = s => tg(env, "sendMessage", { chat_id: m.chat.id, text: s, reply_to_message_id: m.message_id });
  if (t === "/myid") return rep(`رقمك: ${uid}`);
  // يسمح للمالك فقط بمعرفة معرّف مجموعة الاختبار من دون كشفه في السجلات أو المحادثات.
  if (t === "/chatid" && isOwner(env, uid)) return rep(`معرّف المجموعة: ${m.chat.id}`);
  if (t === "/refreshorder") {
    if (!isOwner(env, uid)) return rep("الأمر ده متاح لمالك البوت فقط.");
    const ref = String(arg || "").trim().toUpperCase();
    if (!ref) return rep("استخدم الأمر هكذا: /refreshorder QST-0007");
    const row = await env.DB.prepare("SELECT * FROM orders WHERE code=? OR CAST(id AS TEXT)=?").bind(ref, ref).first();
    if (!row) return rep("لم أجد الطلب. تأكد من رقم QST.");
    if (!row.tg_message_id) return rep("الطلب لا يحتوي على رسالة Telegram محفوظة.");
    const updated = await editOrderTelegramMessage(env, row, m.chat.id, row.tg_message_id);
    return rep(updated ? "تم تحديث أزرار ورسالة الطلب " + row.code + "." : "تعذر تحديث الرسالة. راجع سجلات Worker.");
  }
  if (t === "/fixbuttons") {
    if (!isOwner(env, uid)) return rep("الأمر ده متاح لمالك البوت فقط.");
    if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) return rep("إعدادات Telegram غير مكتملة في Cloudflare.");
    const webhookUrl = "https://qeshta2-orders.qeshta.workers.dev/api/tg";
    const registration = await tg(env, "setWebhook", {
      url: webhookUrl,
      secret_token: env.WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false
    });
    if (!registration.ok) {
      console.error("Telegram setWebhook failed", registration.description || "unknown error");
      return rep("تعذر تحديث Webhook. راجع سجل Worker ثم حاول مرة أخرى.");
    }
    const info = await tg(env, "getWebhookInfo", {});
    if (!info.ok) return rep("تم إرسال إعداد Webhook، لكن تعذر قراءة حالة التحقق.");
    const currentUrl = String(info.result?.url || "");
    const updates = Array.isArray(info.result?.allowed_updates) ? info.result.allowed_updates : [];
    const callbackEnabled = updates.includes("callback_query");
    const urlMatches = currentUrl === webhookUrl;
    const lastError = info.result?.last_error_message;
    return rep([
      urlMatches && callbackEnabled ? "✅ تم إصلاح استقبال أزرار Telegram." : "⚠️ تم تحديث Webhook لكن التحقق غير مكتمل.",
      `العنوان: ${urlMatches ? "صحيح" : "غير مطابق"}`,
      `callback_query: ${callbackEnabled ? "مفعّل" : "غير مفعّل"}`,
      `الرسائل المعلقة: ${Number(info.result?.pending_update_count || 0)}`,
      ...(lastError ? [`آخر خطأ من Telegram: ${String(lastError).slice(0, 300)}`] : [])
    ].join("\n"));
  }
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
      console.info("Telegram order callback received", { chatId: actualChat, userId: u.callback_query.from?.id, action: String(u.callback_query.data || "").split(":")[2] || "unknown" });
      if (!adminChat || actualChat !== adminChat) {
        await tg(env, "answerCallbackQuery", { callback_query_id: u.callback_query.id, text: "المجموعة غير معتمدة", show_alert: true });
      } else {
        await onButton(u.callback_query, env);
      }
    } else if (u.message) {
      const m = u.message;
      const actualChat = String(m.chat?.id ?? "");
      if (m.text?.startsWith("/")) {
        const command = m.text.trim().split(/\s+/)[0].split("@")[0];
        const publicMyIdLookup = command === "/myid";
        const ownerChatIdLookup = command === "/chatid" && isOwner(env, m.from?.id);
        if (publicMyIdLookup || ownerChatIdLookup || (adminChat && actualChat === adminChat)) await onCommand(m, env);
      }
    }
  } catch (error) {
    console.error("Telegram webhook update failed:", error);
    if (u.callback_query?.id) {
      await tg(env, "answerCallbackQuery", {
        callback_query_id: u.callback_query.id,
        text: "حصل خطأ أثناء تنفيذ الإجراء. حاول مرة أخرى.",
        show_alert: true
      });
    }
  }
  return new Response("ok");
}
export default {
  async fetch(req, env) {
    const p = new URL(req.url).pathname;
    if (p === "/api/order" && req.method === "POST") return order(req, env);
    if (p === "/api/order-action") return handleOrderAction(req, env);
    if (p === "/api/tg" && req.method === "POST") return hook(req, env);
    if (p.startsWith("/api/")) return J({ error: "not found" }, 404);
    return env.ASSETS.fetch(req);
  },
  async scheduled(_e, env, ctx) { ctx.waitUntil(retry(env)); },
};
