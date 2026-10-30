import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs"; import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
function mkEnv() {
  const db = new DatabaseSync(":memory:"); db.exec(schema);
  const prep = sql => { let a = []; const o = { bind: (...x) => (a = x, o), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...a).changes) } }), first: async () => db.prepare(sql).get(...a) ?? null, all: async () => ({ results: db.prepare(sql).all(...a) }), _r: () => db.prepare(sql).run(...a) }; return o; };
  return { DB: { prepare: prep, batch: async s => s.forEach(x => x._r()) }, db, BOT_TOKEN: "t", CHAT_ID: "-100", OWNER_IDS: "6681233049", WEBHOOK_SECRET: "sec", TURNSTILE_SECRET: "turnstile-test-secret" };
}
const sent = []; globalThis.fetch = async (u, i) => { const b = i?.body && typeof i.body === "string" ? JSON.parse(i.body) : {}; sent.push({ u: String(u).split("/").pop(), b }); return { json: async () => ({ ok: true, success: true, result: { message_id: 42 } }) }; };
const post = (env, path, body, h = {}) => worker.fetch(new Request("https://x" + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }), env);
const ok = { idem: "idem-test-0001", name: "أحمد محمد", phone: "01012345678", address: "شارع النصر", pay: "cash", lines: [{ id: "c01", amount: 120, qty: 1, note: "" }, { id: "cf10", qty: 2 }] };
const tgHook = (env, upd, secret = "sec") => post(env, "/api/tg", upd, { "x-telegram-bot-api-secret-token": secret });
const press = (uid, to, id = 1) => ({ callback_query: { id: "q", data: `s:${id}:${to}`, from: { id: uid, first_name: "س" }, message: { chat: { id: -100 }, message_id: 42, text: "طلب" } } });

test("طلب صحيح: يُحفظ ويُرسل بالصيغة المعتمدة", async () => {
  const env = mkEnv(); sent.length = 0; const r = await post(env, "/api/order", ok), d = await r.json();
  assert.equal(d.code, "QST-0001"); const m = sent.find(x => x.u === "sendMessage").b.text;
  for (const s of ["🔔 طلب جديد #QST-0001", "👤 أحمد محمد – 01012345678", "الأساس 90 + زيادة 30", "الأكل 170 + التوصيل مجاني = الإجمالي 170 ج", "💳 الدفع: كاش"]) assert.ok(m.includes(s), s);
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
test("الـ webhook: رفض بدون السر، ومنع غير الموظفين، والمالك يؤكد، والضغط المكرر", async () => {
  const env = mkEnv(); await post(env, "/api/order", ok); sent.length = 0;
  assert.equal((await tgHook(env, press(1, "confirmed"), "bad")).status, 401);
  await tgHook(env, press(999, "confirmed")); assert.equal(sent.find(x => x.u === "answerCallbackQuery").b.text, "مش مسموح لك"); assert.equal(env.db.prepare("SELECT status FROM orders").get().status, "new");
  await tgHook(env, press(6681233049, "confirmed")); assert.equal(env.db.prepare("SELECT status,confirmed_by FROM orders").get().confirmed_by, 6681233049);
  sent.length = 0; await tgHook(env, press(6681233049, "confirmed")); assert.match(sent.find(x => x.u === "answerCallbackQuery").b.text, /اتغيّرت/);
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM order_events WHERE event='confirmed'").get().c, 1);
});
test("إضافة موظف بالرد وحذفه (المالك فقط)", async () => {
  const env = mkEnv(); await post(env, "/api/order", ok);
  const add = (uid) => ({ message: { text: "/addstaff", from: { id: uid }, chat: { id: -100 }, message_id: 1, reply_to_message: { from: { id: 555, first_name: "علي", is_bot: false } } } });
  await tgHook(env, add(999)); assert.equal(env.db.prepare("SELECT COUNT(*) c FROM staff").get().c, 0);
  await tgHook(env, add(6681233049)); await tgHook(env, press(555, "confirmed")); assert.equal(env.db.prepare("SELECT status FROM orders").get().status, "confirmed");
  await tgHook(env, { message: { text: "/removestaff 555", from: { id: 6681233049 }, chat: { id: -100 }, message_id: 2 } }); sent.length = 0; await tgHook(env, press(555, "out_for_delivery"));
  assert.equal(sent.find(x => x.u === "answerCallbackQuery").b.text, "مش مسموح لك");
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

test("رفض الإحداثيات الناقصة أو خارج النطاق", async () => {
  const env = mkEnv();
  const partial = { ...ok, address: "", lat: 30.1 };
  const invalid = { ...ok, address: "", lat: 300, lng: 31 };
  assert.equal((await post(env, "/api/order", { ...partial, idem: "coords-0001" })).status, 400);
  assert.equal((await post(env, "/api/order", { ...invalid, idem: "coords-0002" })).status, 400);
  assert.equal(env.db.prepare("SELECT COUNT(*) c FROM orders").get().c, 0);
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
