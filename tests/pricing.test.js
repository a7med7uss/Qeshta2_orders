import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
import { ladder, isValidAmount, nextStep, indexMenu, priceCart } from "../public/lib/pricing.js";
import { MENU as menu } from "../public/lib/menu-data.js";
const idx = indexMenu(menu), get = id => idx.get(id);
test("المنيو المبني مطابق للمنيو المعتمد (menu.json)", () => assert.deepEqual(menu, JSON.parse(readFileSync(new URL("../data/menu.json", import.meta.url)))));
test("شاورما: 90 ← 290 ثم وردة 300 ← 400", () => {
  const L = ladder(get("c01")); assert.equal(L[0].amount, 90); assert.equal(L.find(r=>r.amount===130).size, "عادي");
  assert.equal(L.find(r=>r.amount===140).size, "جامبو"); assert.equal(L.find(r=>r.amount===300).size, "وردة"); assert.equal(L.at(-1).amount, 400);
});
test("التحويل عند 140 والرسائل عند الحدود", () => {
  assert.equal(nextStep(get("c01"), 130, 1).flipped, true);
  assert.equal(nextStep(get("c01"), 290, 1).amount, 290); assert.equal(nextStep(get("c01"), 300, -1).amount, 300);
  assert.match(nextStep(get("c01"), 290, 1).message, /الوردة بتبدأ من 300/);
  assert.equal(nextStep(get("c01"), 400, 1).message, "ده أقصى حد لهذا الصنف.");
});
test("كرسبي 75: يقفز من 95 إلى 100", () => { const n = nextStep(get("c03"), 95, 1); assert.equal(n.amount, 100); assert.equal(n.size, "جامبو"); });
test("كل صنف له سلّم صالح (82 صنف)", () => { let n = 0; for (const it of idx.values()) if (["sized","single"].includes(it.kind)) { assert.ok(ladder(it).every(r => isValidAmount(it, r.amount))); n++; } assert.equal(n, 82); });
test("رفض الأسعار غير المسموحة", () => { for (const a of [85, 95, 295, 410]) assert.equal(isValidAmount(get("c01"), a), false); assert.equal(isValidAmount(get("r01"), 215), false); });
test("سلة: توصيل مجاني، مشروب 25، صنف بلا سعر، أساس وزيادة", () => {
  const r = priceCart(menu, [{id:"c01",amount:120,qty:1},{id:"cf10",qty:2},{id:"ca11",qty:1}]);
  assert.equal(r.total, 170); assert.equal(r.delivery_fee, 0); assert.equal(r.lines[0].base, 90); assert.deepEqual(r.pending_confirmation, ["باكيت بطاطس ميكسات أصناف أخرى"]);
  assert.throws(() => priceCart(menu, [{id:"c01",amount:95,qty:1}]));
});
