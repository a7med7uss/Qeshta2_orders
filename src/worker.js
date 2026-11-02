import { MENU } from "../public/lib/menu-data.js";
import { priceCart } from "../public/lib/pricing.js";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const PAY = { cash: "كاش", wallet: "محفظة", instapay: "إنستا" };
const ST = { new: "جديد", confirmed: "تم التأكيد", out_for_delivery: "خرج للتوصيل", delivered: "تم التسليم", cancelled: "ملغي" };
const NEXT = { new: ["confirmed", "cancelled"], confirmed: ["out_for_delivery", "cancelled"], out_for_delivery: ["delivered", "cancelled"] };
const BTN = { confirmed: "✅ تم التأكيد", out_for_delivery: "🚚 خرج للتوصيل", delivered: "✔️ تم التسليم" };
const CANCEL_REASONS = {
  customer: "العميل طلب الإلغاء",
  no_answer: "العميل لا يرد",
  address: "العنوان غير واضح"
};
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
  const summary = items.map(i => `• ${itemCategory(i.id)} / ${i.name}${i.size ? ` (${i.size})` : ""} × ${i.qty}`).join("\n");
  const lines = [
    `السلام عليكم ${o.name}`,
    `بخصوص طلبك ${o.code} من مطعم قشطة:`,
    summary,
    `الإجمالي: ${o.total} جنيه.`
  ];
  if (o.pay === "wallet") {
    if (env.WALLET_NUMBER) lines.push(`بيانات التحويل: ${env.WALLET_PROVIDER || "المحفظة"} — ${env.WALLET_NUMBER}${env.WALLET_OWNER ? ` — باسم ${env.WALLET_OWNER}` : ""}`);
    else lines.push("يرجى التواصل معنا لتأكيد بيانات المحفظة قبل التحويل.");
    lines.push("بعد التحويل برجاء إرسال صورة تأكيد العملية.");
  } else if (o.pay === "instapay") {
    if (env.INSTAPAY_IPA) lines.push(`InstaPay IPA: ${env.INSTAPAY_IPA}`);
    if (env.INSTAPAY_PAYMENT_LINK) lines.push(`رابط الدفع: ${env.INSTAPAY_PAYMENT_LINK}`);
    if (!env.INSTAPAY_IPA && !env.INSTAPAY_PAYMENT_LINK) lines.push("بيانات InstaPay غير متاحة حالياً. برجاء انتظار تأكيد المطعم قبل التحويل.");
    else lines.push("بعد التحويل برجاء إرسال صورة تأكيد العملية.");
  }
  lines.push("شكراً لطلبك من قشطة.");
  return lines.join("\n");
}
function orderKeyboard(o, status, items, env) {
  const rows = [];
  const next = NEXT[status] || [];
  const actions = next.filter(x => x !== "cancelled").map(n => ({ text: BTN[n], callback_data: `s:${o.id}:${n}` }));
  if (actions.length) rows.push(actions);
  if (next.includes("cancelled")) rows.push([{ text: "❌ إلغاء", callback_data: `c:${o.id}:open` }]);

  const phone = String(o.phone || "").replace(/[\s-]/g, "");
  const contactRow = [];
  if (phone) contactRow.push({ text: "📋 نسخ رقم العميل", copy_text: { text: phone.slice(0, 256) } });
  const wa = whatsappUrl(phone, orderWhatsAppMessage(o, items, env));
  if (wa) contactRow.push({ text: "💬 واتساب", url: wa });
  if (contactRow.length) rows.push(contactRow);

  if (o.lat !== null && o.lat !== undefined && o.lng !== null && o.lng !== undefined &&
      Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng))) {
    const coords = `${o.lat},${o.lng}`;
    rows.push([
      { text: "📍 Google Maps", url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}` },
      { text: "🍎 Apple Maps", url: `https://maps.apple.com/?ll=${encodeURIComponent(coords)}&q=${encodeURIComponent("موقع العميل")}` }
    ]);
  }

  if (o.pay === "wallet" && env.WALLET_NUMBER) {
    rows.push([{ text: "💳 نسخ رقم المحفظة", copy_text: { text: String(env.WALLET_NUMBER).slice(0, 256) } }]);
  } else if (o.pay === "instapay") {
    const payment = [];
    if (env.INSTAPAY_IPA) payment.push({ text: "📋 نسخ InstaPay IPA", copy_text: { text: String(env.INSTAPAY_IPA).slice(0, 256) } });
    if (env.INSTAPAY_PAYMENT_LINK && /^https:\/\//i.test(env.INSTAPAY_PAYMENT_LINK)) payment.push({ text: "فتح رابط InstaPay", url: env.INSTAPAY_PAYMENT_LINK });
    if (payment.length) rows.push(payment);
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
    ...(o.pay === "wallet" && env.WALLET_NUMBER ? [`المحفظة: ${env.WALLET_PROVIDER || "محفظة"} — ${env.WALLET_NUMBER}`] : []),
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
    reply_markup: orderKeyboard({ ...o, id }, "new", items, env),
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
  if (!address && !hasCoordinates) return J({ error: "حدد العنوان أو موقعك" }, 400);
  if (!PAY[b.pay]) return J({ error: "اختر طريقة الدفع" }, 400);
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
  await tg(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text(o, items, env),
    reply_markup: orderKeyboard(o, row.status, items, env),
    disable_web_page_preview: true
  });
}
async function changeOrderStatus(env, row, to, uid, reason = null, chatId = env.CHAT_ID, messageId = row.tg_message_id) {
  if (!(NEXT[row.status] || []).includes(to)) return { ok: false, message: "الحالة اتغيّرت بالفعل" };
  const result = await env.DB.prepare(
    `UPDATE orders SET status=?, cancel_reason=CASE WHEN ?='cancelled' THEN ? ELSE cancel_reason END, confirmed_by=CASE WHEN ?='confirmed' THEN ? ELSE confirmed_by END, updated_at=${NOW} WHERE id=? AND status=?`
  ).bind(to, to, reason, to, uid, row.id, row.status).run();
  if (!result.meta.changes) return { ok: false, message: "الحالة اتغيّرت بالفعل من موظف آخر" };
  await env.DB.prepare("INSERT INTO order_events(order_id,event,by_telegram_id) VALUES(?,?,?)")
    .bind(row.id, to, uid).run();
  const refreshed = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(row.id).first();
  if (refreshed) await editOrderTelegramMessage(env, refreshed, chatId, messageId);
  return { ok: true, message: ST[to] || to };
}
async function onButton(q, env) {
  const ans = (t, alert = false) => tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: t, show_alert: alert });
  try {
    const [kind, sid, action] = String(q.data || "").split(":");
    const id = Number(sid), uid = q.from?.id;
    if (!Number.isSafeInteger(id) || id < 1) return ans("رقم الطلب غير صالح", true);
    if (!(await isStaff(env, uid))) return ans("مش مسموح لك", true);

    const row = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
    if (!row) return ans("الطلب غير موجود", true);

    if ((kind === "c" && action === "open") || (kind === "s" && action === "cancelled")) {
      await tg(env, "editMessageReplyMarkup", {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
        reply_markup: { inline_keyboard: [
          [
            { text: "العميل طلب الإلغاء", callback_data: `c:${id}:customer` },
            { text: "العميل لا يرد", callback_data: `c:${id}:no_answer` }
          ],
          [
            { text: "العنوان غير واضح", callback_data: `c:${id}:address` },
            { text: "سبب آخر", callback_data: `c:${id}:other` }
          ],
          [{ text: "رجوع", callback_data: `c:${id}:back` }]
        ] }
      });
      return ans("اختر سبب الإلغاء");
    }

    if (kind === "c" && action === "back") {
      const [o, items] = await rowToOrder(env, row);
      await tg(env, "editMessageReplyMarkup", {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
        reply_markup: orderKeyboard(o, row.status, items, env)
      });
      return ans("تم الرجوع");
    }

    if (kind === "c" && action === "other") {
      await tg(env, "sendMessage", {
        chat_id: env.CHAT_ID,
        text: `اكتب سبب إلغاء الطلب #${row.code} بالرد على هذه الرسالة.`,
        reply_to_message_id: q.message.message_id,
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: "اكتب سبب الإلغاء" }
      });
      return ans("اكتب السبب في رسالة رد");
    }

    if (kind === "c" && Object.hasOwn(CANCEL_REASONS, action)) {
      const result = await changeOrderStatus(env, row, "cancelled", uid, CANCEL_REASONS[action], q.message.chat.id, q.message.message_id);
      return ans(result.message, !result.ok);
    }

    if (kind === "s" && ["confirmed", "out_for_delivery", "delivered"].includes(action)) {
      const result = await changeOrderStatus(env, row, action, uid, null, q.message.chat.id, q.message.message_id);
      return ans(result.message, !result.ok);
    }

    return ans("الإجراء غير معروف", true);
  } catch (error) {
    console.error("Telegram callback failed:", error);
    return ans("تعذر تنفيذ الإجراء. حاول مرة أخرى أو راجع سجلات Worker.", true);
  }
}
async function onCancelReasonReply(m, env) {
  const prompt = String(m.reply_to_message?.text || "");
  const match = prompt.match(/^اكتب سبب إلغاء الطلب #([A-Z0-9-]+)/);
  if (!match) return false;
  if (!(await isStaff(env, m.from?.id))) return true;
  const reason = String(m.text || "").trim().slice(0, 200);
  if (reason.length < 3) {
    await tg(env, "sendMessage", { chat_id: env.CHAT_ID, text: "اكتب سبباً أوضح (3 أحرف على الأقل).", reply_to_message_id: m.message_id });
    return true;
  }
  const row = await env.DB.prepare("SELECT * FROM orders WHERE code=?").bind(match[1]).first();
  if (!row) {
    await tg(env, "sendMessage", { chat_id: env.CHAT_ID, text: "الطلب غير موجود.", reply_to_message_id: m.message_id });
    return true;
  }
  const result = await changeOrderStatus(env, row, "cancelled", m.from.id, reason);
  await tg(env, "sendMessage", {
    chat_id: env.CHAT_ID,
    text: result.ok ? `تم إلغاء ${row.code}. السبب: ${reason}` : result.message,
    reply_to_message_id: m.message_id
  });
  return true;
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
    } else if (u.message) {
      const m = u.message;
      const actualChat = String(m.chat?.id ?? "");
      if (m.text?.startsWith("/")) {
        const command = m.text.trim().split(/\s+/)[0].split("@")[0];
        const publicMyIdLookup = command === "/myid";
        const ownerChatIdLookup = command === "/chatid" && isOwner(env, m.from?.id);
        if (publicMyIdLookup || ownerChatIdLookup || (adminChat && actualChat === adminChat)) await onCommand(m, env);
      } else if (adminChat && actualChat === adminChat && m.reply_to_message) {
        await onCancelReasonReply(m, env);
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
    if (p === "/api/tg" && req.method === "POST") return hook(req, env);
    if (p.startsWith("/api/")) return J({ error: "not found" }, 404);
    return env.ASSETS.fetch(req);
  },
  async scheduled(_e, env, ctx) { ctx.waitUntil(retry(env)); },
};
