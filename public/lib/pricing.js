// منطق الأسعار: يُستخدم في المتصفح (للعرض) وفي السيرفر (للتحقق النهائي).
export function ladder(item) {
  if (item.kind === "single") return rung(item.from, item.to, item.step, null);
  if (item.kind === "sized") return item.segments.flatMap(s => rung(s.from, s.to, s.step, s.size));
  return [];
}
function rung(from, to, step, size) { const o = []; for (let a = from; a <= to; a += step) o.push({ amount: a, size }); return o; }
export const isValidAmount = (item, amount) => ladder(item).some(r => r.amount === amount);
export const sizeAt = (item, amount) => ladder(item).find(r => r.amount === amount)?.size ?? null;
export const baseOf = (item, amount) => item.kind === "sized" ? item.segments.find(s => s.size === sizeAt(item, amount))?.base : item.kind === "single" ? item.base : (item.amount ?? 0);
// dir: +1 أو -1. الوردة سلّم مستقل: لا ننتقل إليها بالزيادة من الجامبو.
export function nextStep(item, amount, dir) {
  const all = ladder(item), cur = all.find(r => r.amount === amount);
  if (!cur) throw new Error("سعر غير صالح");
  const L = all.filter(r => (r.size === "وردة") === (cur.size === "وردة")), i = L.findIndex(r => r.amount === amount), n = L[i + dir];
  if (!n) {
    if (dir < 0) return { ...cur, limit: "min" };
    const rose = item.kind === "sized" && cur.size !== "وردة" ? item.segments.find(s => s.size === "وردة") : null;
    return { ...cur, limit: "max", message: rose ? `ده آخر سعر للجامبو، والوردة بتبدأ من ${rose.base}.` : "ده أقصى حد لهذا الصنف." };
  }
  return { ...n, flipped: n.size !== cur.size };
}
export function indexMenu(menu) {
  const m = new Map();
  for (const c of menu.categories) for (const it of [...c.items, ...(c.additions ?? [])]) m.set(it.id, it);
  return m;
}
// سطر الطلب: { id, amount, qty }. التوصيل مجاني دائماً. الصنف بلا سعر لا يدخل الإجمالي.
export function priceCart(menu, lines) {
  const idx = indexMenu(menu); let subtotal = 0; const out = [];
  for (const l of lines) {
    const it = idx.get(l.id); if (!it) throw new Error("صنف غير موجود");
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 50) throw new Error("كمية غير صالحة");
    let unit = 0, pend = false;
    if (it.kind === "fixed") unit = it.amount;
    else if (it.kind === "unpriced") pend = true;
    else if (it.kind !== "free") { if (!isValidAmount(it, l.amount)) throw new Error("سعر غير مسموح: " + it.name); unit = l.amount; }
    subtotal += unit * l.qty;
    out.push({ id: it.id, name: it.name, size: it.kind === "sized" ? sizeAt(it, l.amount) : null, qty: l.qty, unit, base: pend ? 0 : baseOf(it, l.amount), pend });
  }
  const delivery_fee = menu.rules.delivery_fee;
  return { lines: out, subtotal, delivery_fee, total: subtotal + delivery_fee, pending_confirmation: out.filter(x => x.pend).map(x => x.name) };
}
