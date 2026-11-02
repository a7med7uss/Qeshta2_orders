import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs"; import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
function mkEnv() {
  const db = new DatabaseSync(":memory:"); db.exec(schema);
  const prep = sql => { let a = []; const o = { bind: (...x) => (a = x, o), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...a).changes) } }), first: async () => db.prepare(sql).get(...a) ?? null, all: async () => ({ results: db.prepare(sql).all(...a) }), _r: () => db.prepare(sql).run(...a) }; return o; };
  return { DB: { prepare: prep, batch: async s => s.forEach(x => x._r()) }, db, BOT_TOKEN: "t", CHAT_ID: "-100", OWNER_IDS: "6681233049", WEBHOOK_SECRET: "sec", TURNSTILE_SECRET: "turnstile-test-secret", WALLET_PROVIDER: "Vodafone Cash", WALLET_NUMBER: "01000000000", WALLET_OWNER: "Test Wallet Owner" };
}
const sent = [];
let webhookConfig = { url: "", allowed_updates: [] };
globalThis.fetch = async (u, i) => {
  const method = String(u).split("/").pop();
  const b = i?.body && typeof i.body === "string" ? JSON.parse(i.body) : {};
  sent.push({ u: method, b });
  if (method === "setWebhook") {
    webhookConfig = { url: b.url, allowed_updates: b.allowed_updates };
    return { json: async () => ({ ok: true, result: true }) };
  }
  if (method === "getWebhookInfo") {
    return { json: async () => ({ ok: true, result: { ...webhookConfig, pending_update_count: 0 } }) };
  }
  return { json: async () => ({ ok: true, success: true, result: { message_id: 42 } }) };
};
const post = (env, path, body, h = {}) => worker.fetch(new Request("https://x" + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }), env);
const ok = { idem: "idem-test-0001", name: "أحمد محمد", phone: "01012345678", address: "شارع النصر", lat: 30.1, lng: 31.2, pay: "cash", lines: [{ id: "c01", amount: 120, qty: 1, note: "" }, { id: "cf10", qty: 2 }] };
const tgHook = (env, upd, secret = "sec") => post(env, "/api/tg", upd, { "x-telegram-bot-api-secret-token": secret });
const press = (uid, to, id = 1) => ({ callback_query: { id: "q", data: `s:${id}:${to}`, from: { id: uid, first_name: "س" }, message: { chat: { id: -100 }, message_id: 42, text: "طلب" } } });

test("طلب صحيح: يُحفظ ويُرسل بالصيغة المعتمدة", async () => {
  const env = mkEnv(); sent.length = 0; const r = await post(env, "/api/order", ok), d = await r.json();
  assert.equal(d.code, "QST-0001"); const m = sent.find(x => x.u === "sendMessage").b.text;
  for (const s of ["🔔 طلب جديد #QST-0001", "👤 بيانات العميل", "الاسم: أحمد محمد", "الهاتف: 01012345678", "الكريب / كريب شاورما", "الأساس 90 + زيادة 30", "قيمة الأكل: 170 جنيه", "الإجمالي: 170 جنيه", "طريقة الدفع: الدفع عند الاستلام"]) assert.ok(m.includes(s), s);
  assert.equal(env.db.prepare("SELECT tg_sent FROM orders").get().tg_sent, 1);
});
test("منع التكرار: نفس المفتاح لا ينشئ طلباً ثانياً", async () => {
  const env = mkEnv(); sent.length = 0; await post(env, "/api/order", ok); const d = await (await post(env, "/api/order", ok)).json();
  assert.equal(d.duplicate, true); assert.equal(env.db.prepare("SELECT COUNT(*) c FROM orders").get().c, 1); assert.equal(sent.filter(x => x.u === "sendMessage").length, 1);
});
test("رفض: تليفون غلط، سعر معدّل، اسم أحادي، سلة فاضية", async () => {
  const env = mkEnv();
  for (const [p, c] of [[{ ...ok, phone: "123" }, 400], [{ ...ok, lines: [{ id: "c01", amount: 95, qty: 1 }] }, 400], [{ ...ok, name: "أحمد" }, 400], [{ ...ok, lines: [] }, 400]]) assert.equal((await post(env, "/api/order", { ...p, idem: "i-" + Math.random() })).status, c);
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM orders").get().c, 0);
});
test("الحقل المخفي: لا طلب ولا رسالة", async () => { const env = mkEnv(); sent.length = 0; await post(env, "/api/order", { ...ok, hp: "x" }); assert.equal(env.db.prepare("SELECT COUNT(*) c FROM orders").get().c, 0); assert.equal(sent.length, 0); });
test("أي عضو في جروب المطبخ يؤكد بعد موافقة صريحة، وخارج الجروب يُرفض", async () => {
  const env = mkEnv();
  await post(env, "/api/order", { ...ok, lat: 30.1, lng: 31.2 });
  sent.length = 0;

  const badSecret = await tgHook(env, press(999, "confirmed"), "bad");
  assert.equal(badSecret.status, 401);

  // Any group member can request confirmation, but the DB is unchanged until Yes.
  const ask = press(999, "confirmed");
  await tgHook(env, ask);
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "new");
  const prompt = sent.find(x => x.u === "editMessageText");
  assert.ok(prompt.b.text.includes("هل أنت متأكد من تأكيد الطلب؟"));
  const promptButtons = prompt.b.reply_markup.inline_keyboard.flat();
  assert.ok(promptButtons.some(x => x.callback_data === "yes:1:confirmed"));
  assert.ok(promptButtons.some(x => x.callback_data === "no:1:confirmed"));

  // Canceling the prompt restores the original order without changing status.
  await tgHook(env, { callback_query: { ...ask.callback_query, id: "q-no", data: "no:1:confirmed" } });
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "new");
  const restored = sent.filter(x => x.u === "editMessageText").at(-1);
  assert.ok(restored.b.reply_markup.inline_keyboard.flat().some(x => x.text === "✅ تأكيد الطلب" && x.url?.includes("/api/order-action")));

  // The same ordinary member confirms the order.
  await tgHook(env, { callback_query: { ...ask.callback_query, id: "q-yes", data: "yes:1:confirmed" } });
  const row = env.db.prepare("SELECT status,confirmed_by FROM orders WHERE id=1").get();
  assert.equal(row.status, "confirmed");
  assert.equal(row.confirmed_by, 999);
  const finalMessage = sent.filter(x => x.u === "editMessageText").at(-1);
  assert.ok(finalMessage.b.text.includes("الحالة: تم التأكيد"));
  assert.deepEqual(finalMessage.b.reply_markup.inline_keyboard, []);

  // Callback queries from another chat remain rejected.
  sent.length = 0;
  const outsider = press(999, "confirmed");
  outsider.callback_query.message.chat.id = -200;
  await tgHook(env, outsider);
  assert.equal(sent.find(x => x.u === "answerCallbackQuery").b.text, "المجموعة غير معتمدة");
});
test("أوامر إدارة الموظفين للمالك فقط، وأزرار الطلب لأي عضو حتى بعد حذفه من staff", async () => {
  const env = mkEnv(); await post(env, "/api/order", ok);
  const add = (uid) => ({ message: { text: "/addstaff", from: { id: uid }, chat: { id: -100 }, message_id: 1, reply_to_message: { from: { id: 555, first_name: "علي", is_bot: false } } } });
  await tgHook(env, add(999));
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM staff").get().c, 0);
  await tgHook(env, add(6681233049));
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM staff").get().c, 1);

  await tgHook(env, { message: { text: "/removestaff 555", from: { id: 6681233049 }, chat: { id: -100 }, message_id: 2 } });
  sent.length = 0;
  await tgHook(env, { message: { text: "/pending", from: { id: 555 }, chat: { id: -100 }, message_id: 3 } });
  assert.equal(sent.filter(x => x.u === "sendMessage").length, 0, "admin commands stay restricted");

  const q = press(555, "confirmed");
  await tgHook(env, q);
  await tgHook(env, { callback_query: { ...q.callback_query, id: "q-yes", data: "yes:1:confirmed" } });
  assert.equal(env.db.prepare("SELECT status,confirmed_by FROM orders").get().status, "confirmed");
  assert.equal(env.db.prepare("SELECT confirmed_by FROM orders").get().confirmed_by, 555);
});

test("تقييد أوامر الإدارة والأزرار على جروب الإدارة مع إتاحة /chatid للمالك", async () => {
  const env = mkEnv(); sent.length = 0;
  await tgHook(env, { message: { text: "/pending", from: { id: 6681233049 }, chat: { id: -200 }, message_id: 7 } });
  assert.equal(sent.length, 0, "يجب تجاهل أوامر الإدارة من خارج الجروب المحدد");

  await tgHook(env, { message: { text: "/myid", from: { id: 777 }, chat: { id: 777 }, message_id: 71 } });
  assert.ok(sent.some(x => x.u === "sendMessage" && x.b.text.includes("777")), "/myid remains available in private chats");
  sent.length = 0;

  await tgHook(env, { message: { text: "/chatid", from: { id: 6681233049 }, chat: { id: -200 }, message_id: 8 } });
  assert.ok(sent.some(x => x.u === "sendMessage" && x.b.text.includes("-200")), "المالك يستطيع معرفة معرّف جروب الاختبار");

  sent.length = 0;
  const q = press(6681233049, "confirmed");
  q.callback_query.message.chat.id = -200;
  await tgHook(env, q);
  assert.equal(sent.find(x => x.u === "answerCallbackQuery").b.text, "المجموعة غير معتمدة");
  assert.equal(env.db.prepare("SELECT status FROM orders").get(), undefined);
});

test("رفض الطلب إذا كان Turnstile secret غير مضبوط", async () => {
  const env = mkEnv(); env.TURNSTILE_SECRET = ""; sent.length = 0;
  const r = await post(env, "/api/order", ok);
  assert.equal(r.status, 503);
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM orders").get().c, 0);
  assert.equal(sent.filter(x => x.u === "sendMessage").length, 0);
});

test("إعادة نفس الطلب لا تُرفض بسبب حد الطلبات", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", ok);
  const verifiedBeforeReplay = sent.filter(x => x.u === "siteverify").length;
  env.db.prepare("INSERT INTO orders(idem_key,customer_name,phone,payment_method,subtotal,total) VALUES('other-1','اسم تجريبي','01012345678','cash',0,0)").run();
  env.db.prepare("INSERT INTO orders(idem_key,customer_name,phone,payment_method,subtotal,total) VALUES('other-2','اسم تجريبي','01012345678','cash',0,0)").run();
  const replay = await (await post(env, "/api/order", ok)).json();
  assert.equal(replay.duplicate, true);
  assert.equal(replay.code, "QST-0001");
  assert.equal(sent.filter(x => x.u === "siteverify").length, verifiedBeforeReplay, "replay should not reuse/verify the one-use Turnstile token");
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM orders").get().c, 3);
  assert.equal(sent.filter(x => x.u === "sendMessage").length, 1);
});

test("العنوان المكتوب يكفي، والموقع الدقيق اختياري، والإحداثيات الجزئية ترفض", async () => {
  const env = mkEnv();
  const missing = { ...ok, address: "", lat: undefined, lng: undefined };
  const partial = { ...ok, address: "", lat: 30.1, lng: undefined };
  const invalid = { ...ok, address: "", lat: 300, lng: 31 };
  assert.equal((await post(env, "/api/order", { ...missing, idem: "coords-missing-01" })).status, 400);
  assert.equal((await post(env, "/api/order", { ...partial, idem: "coords-0001" })).status, 400);
  assert.equal((await post(env, "/api/order", { ...invalid, idem: "coords-0002" })).status, 400);
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM orders").get().c, 0);

  sent.length = 0;
  const addressOnly = { ...ok, idem: "address-only-0001", address: "شارع النصر بجوار المدرسة", lat: null, lng: null };
  const response = await post(env, "/api/order", addressOnly);
  assert.equal(response.status, 200);
  const row = env.db.prepare("SELECT address_text,lat,lng FROM orders WHERE idem_key=?").get("address-only-0001");
  assert.equal(row.address_text, "شارع النصر بجوار المدرسة");
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
  const message = sent.find(x => x.u === "sendMessage").b;
  assert.ok(message.text.includes("شارع النصر بجوار المدرسة"));
  const buttons = message.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.some(x => x.text === "📍 Google Maps"), false);
  assert.equal(buttons.some(x => x.text === "🍎 Apple Maps"), false);
});

test("حفظ إحداثيات الموقع الدقيق في D1 وإظهار أزرار الخرائط", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", { ...ok, idem: "coords-save-0001", lat: 30.123456, lng: 31.654321 });
  const row = env.db.prepare("SELECT lat,lng FROM orders WHERE idem_key=?").get("coords-save-0001");
  assert.equal(row.lat, 30.123456);
  assert.equal(row.lng, 31.654321);
  const msg = sent.find(x => x.u === "sendMessage").b;
  assert.ok(msg.text.includes("30.123456, 31.654321"));
  const buttons = msg.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(x => x.text === "📍 Google Maps"));
  assert.ok(buttons.some(x => x.text === "🍎 Apple Maps"));
});

test("تنظيف سجل الطلب إذا فشل حفظ تفاصيله في D1", async () => {
  const env = mkEnv(); sent.length = 0;
  env.DB.batch = async () => { throw new Error("simulated detail insert failure"); };
  const result = await (await post(env, "/api/order", ok)).json();
  assert.match(result.code, /^QST-E/);
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM orders").get().c, 0);
  const message = sent.find(x => x.u === "sendMessage").b.text;
  assert.match(message, /لم يُحفظ في القاعدة/);
});

test("رفض الطلب إذا كانت إعدادات تشغيل البوت أو الجروب أو الأسرار ناقصة", async () => {
  for (const key of ["BOT_TOKEN", "CHAT_ID", "WEBHOOK_SECRET", "TURNSTILE_SECRET"]) {
    const env = mkEnv(); env[key] = ""; sent.length = 0;
    const r = await post(env, "/api/order", ok);
    assert.equal(r.status, 503, key);
    assert.equal(env.db.prepare("SELECT COUNT(*) c FROM orders").get().c, 0, key);
    assert.equal(sent.filter(x => x.u === "sendMessage").length, 0, key);
  }
});


test("تمييز الكريب العادي والوردة وإظهار القسم لكل صنف", async () => {
  const env = mkEnv(); sent.length = 0;
  const body = { ...ok, idem: "crepe-sizes-0001", lines: [
    { id: "c04", amount: 85, qty: 1, note: "" },
    { id: "c04", amount: 300, qty: 1, note: "" },
    { id: "b03", amount: 100, qty: 1, note: "" }
  ] };
  await post(env, "/api/order", body);
  const message = sent.find(x => x.u === "sendMessage").b.text;
  assert.ok(message.includes("الكريب / كريب زنجر — عادي × 1"));
  assert.ok(message.includes("الكريب / كريب زنجر — وردة × 1"));
  assert.ok(message.includes("البرجر / زنجر"));
});

test("أزرار الطلب تشمل إرسال WhatsApp والخرائط، ولا تعرض المحفظة في جروب المطبخ", async () => {
  const env = mkEnv(); sent.length = 0;
  const body = { ...ok, idem: "buttons-check-0001", pay: "wallet", lat: 30.1, lng: 31.2 };
  await post(env, "/api/order", body);
  const message = sent.find(x => x.u === "sendMessage").b;
  const flat = message.reply_markup.inline_keyboard.flat();
  assert.ok(flat.some(x => x.copy_text?.text === "01012345678"));
  assert.ok(flat.some(x => x.text === "📤 إرسال تفاصيل الطلب للعميل" && x.url.startsWith("https://wa.me/")));
  assert.ok(flat.some(x => x.text === "📍 Google Maps" && x.url.includes("30.1%2C31.2")));
  assert.ok(flat.some(x => x.text === "🍎 Apple Maps" && x.url.startsWith("https://maps.apple.com/")));
  assert.equal(flat.some(x => x.copy_text?.text === "01000000000"), false);
  assert.equal(message.text.includes("01000000000"), false);
  assert.equal(message.text.includes("Test Wallet Owner"), false);

  const waButton = flat.find(x => x.text === "📤 إرسال تفاصيل الطلب للعميل");
  const waText = new URL(waButton.url).searchParams.get("text");
  assert.ok(waText.includes("Vodafone Cash: 01000000000 — باسم Test Wallet Owner"));
  assert.ok(waText.includes("طريقة الدفع: فودافون كاش"));
  assert.ok(waText.includes("الإجمالي: 170 جنيه."));
});

test("الدفع عند الاستلام لا يضيف أي بيانات محفظة إلى رسالة WhatsApp", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", { ...ok, idem: "cash-wa-no-wallet-01", pay: "cash" });
  const msg = sent.find(x => x.u === "sendMessage").b;
  const button = msg.reply_markup.inline_keyboard.flat().find(x => x.text === "📤 إرسال تفاصيل الطلب للعميل");
  const waText = new URL(button.url).searchParams.get("text");
  assert.ok(waText.includes("طريقة الدفع: الدفع عند الاستلام"));
  assert.equal(waText.includes("01000000000"), false);
  assert.equal(waText.includes("Vodafone Cash"), false);
  assert.equal(msg.text.includes("01000000000"), false);
});

test("الإلغاء يتطلب تأكيداً، يزيل بقية الأزرار، ويعرض زر إعادة الإحياء فقط", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", ok);

  const ask = press(999, "cancelled");
  ask.callback_query.data = "ask:1:cancelled";
  await tgHook(env, ask);
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "new");
  const prompt = sent.find(x => x.u === "editMessageText");
  assert.ok(prompt.b.text.includes("هل أنت متأكد من إلغاء الطلب؟"));
  assert.ok(prompt.b.reply_markup.inline_keyboard.flat().some(x => x.callback_data === "yes:1:cancelled"));
  assert.ok(prompt.b.reply_markup.inline_keyboard.flat().some(x => x.callback_data === "no:1:cancelled"));

  // Explicitly choosing No must restore the original buttons.
  await tgHook(env, { callback_query: { ...ask.callback_query, id: "q-no", data: "no:1:cancelled" } });
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "new");
  const restored = sent.filter(x => x.u === "editMessageText").at(-1);
  assert.ok(restored.b.reply_markup.inline_keyboard.flat().some(x => x.text === "✅ تأكيد الطلب" && x.url?.includes("/api/order-action")));

  // Yes cancels and removes every action except the single revive button.
  await tgHook(env, { callback_query: { ...ask.callback_query, id: "q-yes", data: "yes:1:cancelled" } });
  let row = env.db.prepare("SELECT status,cancel_reason FROM orders WHERE id=1").get();
  assert.equal(row.status, "cancelled");
  assert.equal(row.cancel_reason, null);
  const cancelledMessage = sent.filter(x => x.u === "editMessageText").at(-1);
  assert.ok(cancelledMessage.b.text.includes("الحالة: تم الإلغاء"));
  assert.deepEqual(cancelledMessage.b.reply_markup.inline_keyboard.flat().map(x => x.text), ["♻️ إعادة إحياء الطلب"]);
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM order_events WHERE event='cancelled'").get().c, 1);

  // Revive returns the order to new and clears cancellation fields.
  const revive = { callback_query: { id: "q-revive", data: "revive:1:now", from: { id: 999 }, message: { chat: { id: -100 }, message_id: 42 } } };
  await tgHook(env, revive);
  row = env.db.prepare("SELECT status,cancel_reason,confirmed_by FROM orders WHERE id=1").get();
  assert.equal(row.status, "new");
  assert.equal(row.cancel_reason, null);
  assert.equal(row.confirmed_by, null);
  const revivedMessage = sent.filter(x => x.u === "editMessageText").at(-1);
  assert.ok(revivedMessage.b.reply_markup.inline_keyboard.flat().some(x => x.text === "✅ تأكيد الطلب" && x.url?.includes("/api/order-action")));
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM order_events WHERE event='revived'").get().c, 1);
});

test("تأكيد إلغاء الطلب لا يحفظ الإلغاء قبل الضغط على نعم", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", ok);
  const ask = press(999, "cancelled");
  ask.callback_query.data = "ask:1:cancelled";
  await tgHook(env, ask);
  await tgHook(env, { callback_query: { ...ask.callback_query, id: "q-no", data: "no:1:cancelled" } });
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "new");
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM order_events WHERE event='cancelled'").get().c, 0);
});

test("فشل معالجة callback يرسل تنبيهاً بدلاً من ترك زر Telegram معلقاً", async () => {
  const env = mkEnv(); sent.length = 0;
  env.DB.prepare = () => { throw new Error("simulated D1 error"); };
  await tgHook(env, press(6681233049, "confirmed"));
  assert.ok(sent.some(x => x.u === "answerCallbackQuery" && x.b.text.includes("تعذر تنفيذ الإجراء")));
});

test("InstaPay مرفوض من الخادم حتى لو تم تجاوز الواجهة", async () => {
  const env = mkEnv(); sent.length = 0;
  const body = { ...ok, idem: "no-ipa-data-0001", pay: "instapay" };
  const response = await post(env, "/api/order", body);
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.match(result.error, /InstaPay غير متاح حالياً/);
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM orders").get().c, 0);
  assert.equal(sent.filter(x => x.u === "sendMessage").length, 0);
});

test("طلب المحفظة يحذر المطبخ إذا لم يتم ضبط رقم التحويل", async () => {
  const env = mkEnv();
  env.WALLET_NUMBER = "";
  sent.length = 0;
  await post(env, "/api/order", { ...ok, idem: "wallet-unconfigured-01", pay: "wallet" });
  const message = sent.find(x => x.u === "sendMessage").b.text;
  assert.ok(message.includes("رقم المحفظة غير مضبوط"));
  const buttons = sent.find(x => x.u === "sendMessage").b.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.some(x => x.text === "💳 نسخ رقم المحفظة"), false);
});

test("الواجهة تجعل GPS اختيارياً وتطلب عنواناً أو موقعاً واحداً على الأقل", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("enableHighAccuracy: true"));
  assert.ok(html.includes("timeout: 25000"));
  assert.ok(html.includes("تحديد الموقع الدقيق اختياري"));
  assert.ok(html.includes("if (!address && !hasLocation)"));
  assert.ok(html.includes("lat: hasLocation ? loc.lat : null"));
  assert.ok(html.includes("navigator.geolocation.getCurrentPosition"));
});

test("إعادة رسم صفحة الدفع لا تمسح GPS المختار، ويمسح بعد نجاح الطلب", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const openStart = html.indexOf("function openCheckout()");
  const openEnd = html.indexOf("async function submit()", openStart);
  const submitStart = openEnd;
  const submitEnd = html.indexOf("document.addEventListener", submitStart);
  const openBlock = html.slice(openStart, openEnd);
  const submitBlock = html.slice(submitStart, submitEnd);
  assert.equal(openBlock.includes("loc = null"), false);
  assert.ok(submitBlock.includes("cart = []; idem = null; loc = null;"));
});

test("واجهة الدفع تعرض عدم إتاحة InstaPay وتعيد الاختيار إلى الدفع عند الاستلام", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("<span>الدفع عند الاستلام</span>"));
  assert.ok(html.includes('id="paymsg"'));
  assert.ok(html.includes('addEventListener("change"'));
  assert.ok(html.includes("لم يتم إتاحة InstaPay حالياً"));
  assert.ok(html.includes('input[name="pay"][value="cash"]'));
});

test("عند تأكيد الطلب تزال كل الأزرار، وعند الإلغاء يبقى زر الإحياء فقط", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", ok);
  const ask = press(999, "confirmed");
  await tgHook(env, ask);
  await tgHook(env, { callback_query: { ...ask.callback_query, id: "q-yes", data: "yes:1:confirmed" } });
  const confirmedMessage = sent.filter(x => x.u === "editMessageText").at(-1);
  assert.deepEqual(confirmedMessage.b.reply_markup.inline_keyboard, []);
});

test("أمر /fixbuttons يفعّل callback_query في Webhook للمالك فقط", async () => {
  const env = mkEnv(); sent.length = 0;
  const message = (uid, id) => ({ message: {
    text: "/fixbuttons",
    from: { id: uid },
    chat: { id: -100 },
    message_id: id
  } });

  await tgHook(env, message(999, 4));
  assert.equal(sent.some(x => x.u === "setWebhook"), false, "غير المالك لا يستطيع تغيير Webhook");

  await tgHook(env, message(6681233049, 5));
  const set = sent.find(x => x.u === "setWebhook");
  assert.ok(set, JSON.stringify(sent));
  assert.equal(set.b.url, "https://qeshta2-orders.qeshta.workers.dev/api/tg");
  assert.deepEqual(set.b.allowed_updates, ["message", "callback_query"]);
  assert.equal(set.b.secret_token, "sec");
  assert.equal(set.b.drop_pending_updates, false);
  assert.ok(sent.some(x => x.u === "getWebhookInfo"));
  const reply = sent.filter(x => x.u === "sendMessage").at(-1);
  assert.ok(reply.b.text.includes("callback_query: مفعّل"));
  assert.ok(reply.b.text.includes("العنوان: صحيح"));
});

test("أزرار Telegram الجديدة تستخدم روابط موقعة ولا تعتمد على callback_query", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", { ...ok, idem: "signed-urls-0001" });
  const message = sent.find(x => x.u === "sendMessage").b;
  const buttons = message.reply_markup.inline_keyboard.flat();
  const confirm = buttons.find(x => x.text === "✅ تأكيد الطلب");
  const cancel = buttons.find(x => x.text === "❌ إلغاء الطلب");
  assert.ok(confirm?.url?.startsWith("https://qeshta2-orders.qeshta.workers.dev/api/order-action?t="));
  assert.ok(cancel?.url?.startsWith("https://qeshta2-orders.qeshta.workers.dev/api/order-action?t="));
  assert.equal(confirm.callback_data, undefined);
  assert.equal(cancel.callback_data, undefined);
});

test("رابط التأكيد يعرض صفحة نعم/تراجع ولا يغير D1 قبل الموافقة", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", { ...ok, idem: "signed-confirm-0001" });
  const msg = sent.find(x => x.u === "sendMessage").b;
  const url = msg.reply_markup.inline_keyboard.flat().find(x => x.text === "✅ تأكيد الطلب").url;
  const view = await worker.fetch(new Request(url), env);
  assert.equal(view.status, 200);
  const html = await view.text();
  assert.ok(html.includes("هل أنت متأكد"));
  assert.ok(html.includes("لا، تراجع"));
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "new");

  const token = new URL(url).searchParams.get("t");
  const form = new FormData();
  form.set("token", token);
  form.set("decision", "no");
  const no = await worker.fetch(new Request("https://qeshta2-orders.qeshta.workers.dev/api/order-action", {
    method: "POST", headers: { Origin: "https://qeshta2-orders.qeshta.workers.dev" }, body: form
  }), env);
  assert.equal(no.status, 200);
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "new");
});

test("رابط التأكيد يحدّث D1 ورسالة Telegram بعد نعم ويمنع إعادة الاستخدام", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", { ...ok, idem: "signed-confirm-0002" });
  const msg = sent.find(x => x.u === "sendMessage").b;
  const url = msg.reply_markup.inline_keyboard.flat().find(x => x.text === "✅ تأكيد الطلب").url;
  const token = new URL(url).searchParams.get("t");
  const form = new FormData();
  form.set("token", token);
  form.set("decision", "yes");
  const response = await worker.fetch(new Request("https://qeshta2-orders.qeshta.workers.dev/api/order-action", {
    method: "POST", headers: { Origin: "https://qeshta2-orders.qeshta.workers.dev" }, body: form
  }), env);
  assert.equal(response.status, 200);
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "confirmed");
  const updated = sent.filter(x => x.u === "editMessageText").at(-1).b;
  assert.ok(updated.text.includes("الحالة: تم التأكيد"));
  assert.deepEqual(updated.reply_markup.inline_keyboard, []);

  const replayForm = new FormData();
  replayForm.set("token", token);
  replayForm.set("decision", "yes");
  const replay = await worker.fetch(new Request("https://qeshta2-orders.qeshta.workers.dev/api/order-action", {
    method: "POST", headers: { Origin: "https://qeshta2-orders.qeshta.workers.dev" }, body: replayForm
  }), env);
  assert.equal(replay.status, 409);
});

test("رابط الإلغاء ثم الإحياء يحدّث D1 ويغير لوحة Telegram", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", { ...ok, idem: "signed-cancel-0001" });
  let msg = sent.find(x => x.u === "sendMessage").b;
  let url = msg.reply_markup.inline_keyboard.flat().find(x => x.text === "❌ إلغاء الطلب").url;
  let token = new URL(url).searchParams.get("t");
  let form = new FormData();
  form.set("token", token);
  form.set("decision", "yes");
  const cancel = await worker.fetch(new Request("https://qeshta2-orders.qeshta.workers.dev/api/order-action", {
    method: "POST", headers: { Origin: "https://qeshta2-orders.qeshta.workers.dev" }, body: form
  }), env);
  assert.equal(cancel.status, 200);
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "cancelled");
  msg = sent.filter(x => x.u === "editMessageText").at(-1).b;
  assert.ok(msg.text.includes("الحالة: تم الإلغاء"));
  const revive = msg.reply_markup.inline_keyboard.flat()[0];
  assert.equal(revive.text, "♻️ إعادة إحياء الطلب");
  assert.ok(revive.url.includes("/api/order-action?t="));

  const revivePage = await worker.fetch(new Request(revive.url), env);
  assert.ok((await revivePage.text()).includes("إعادة إحياء الطلب"));
  token = new URL(revive.url).searchParams.get("t");
  form = new FormData();
  form.set("token", token);
  form.set("decision", "yes");
  const resurrect = await worker.fetch(new Request("https://qeshta2-orders.qeshta.workers.dev/api/order-action", {
    method: "POST", headers: { Origin: "https://qeshta2-orders.qeshta.workers.dev" }, body: form
  }), env);
  assert.equal(resurrect.status, 200);
  assert.equal(env.db.prepare("SELECT status,cancel_reason FROM orders WHERE id=1").get().status, "new");
  msg = sent.filter(x => x.u === "editMessageText").at(-1).b;
  assert.ok(msg.reply_markup.inline_keyboard.flat().some(x => x.text === "✅ تأكيد الطلب"));
});

test("رابط إجراء مزور أو POST من Origin خارجي لا يغير الطلب", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", { ...ok, idem: "signed-security-0001" });
  const message = sent.find(x => x.u === "sendMessage").b;
  const url = message.reply_markup.inline_keyboard.flat().find(x => x.text === "✅ تأكيد الطلب").url;
  const token = new URL(url).searchParams.get("t");
  const forged = await worker.fetch(new Request("https://qeshta2-orders.qeshta.workers.dev/api/order-action?t=" + token.slice(0, -3) + "xyz"), env);
  assert.equal(forged.status, 403);
  const form = new FormData();
  form.set("token", token);
  form.set("decision", "yes");
  const csrf = await worker.fetch(new Request("https://qeshta2-orders.qeshta.workers.dev/api/order-action", {
    method: "POST", headers: { Origin: "https://evil.example" }, body: form
  }), env);
  assert.equal(csrf.status, 403);
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "new");
});

test("أمر /refreshorder يحدث أزرار الطلب القديم بدون تعديل D1", async () => {
  const env = mkEnv(); sent.length = 0;
  await post(env, "/api/order", { ...ok, idem: "refresh-old-0001" });
  sent.length = 0;
  const command = { message: {
    text: "/refreshorder QST-0001",
    from: { id: 6681233049 },
    chat: { id: -100 },
    message_id: 78
  } };
  await tgHook(env, command);
  const edited = sent.find(x => x.u === "editMessageText");
  assert.ok(edited);
  assert.ok(edited.b.reply_markup.inline_keyboard.flat().some(x => x.text === "✅ تأكيد الطلب" && x.url?.includes("/api/order-action")));
  assert.equal(env.db.prepare("SELECT status FROM orders WHERE id=1").get().status, "new");
});
