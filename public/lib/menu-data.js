// مصدر المنيو الوحيد (الأسماء كما كتبها صاحب المطعم). لتعديل سعر: غيّر الرقم هنا فقط.
const S = 10, CAP = 100;
const sized = (id, name, a, b, c) => { const B = [["عادي", a], ["جامبو", b], ["وردة", c]];
  return { id, name, kind: "sized", segments: B.map(([size, base], k) => { let to = base; if (k < 2) { while (to + S < B[k + 1][1]) to += S; } else to = base + CAP; return { size, base, from: base, to, step: S }; }) }; };
const single = (id, name, p) => ({ id, name, kind: "single", base: p, from: p, to: p + CAP, step: S });
const fixed = (id, name, amount) => ({ id, name, kind: "fixed", amount });
const free = (id, name) => ({ id, name, kind: "free" });
const unpriced = (id, name) => ({ id, name, kind: "unpriced", needs_phone_confirmation: true });
const mk = (p, rows, f) => rows.map((r, n) => f(p + String(n + 1).padStart(2, "0"), ...r));
const cat = (id, name, type, items, extra = {}) => ({ id, name, type, ...extra, items });
const crepes = [["كريب شاورما",90,140,300],["كريب فاهيتا",120,160,300],["كريب كرسبي",75,100,280],["كريب زنجر",85,110,300],["كريب استربس",70,100,280],["كريب بانيه",40,100,200],["كريب برجر",85,120,300],["برجر فحم",95,140,300],["كريب سجق",95,140,300],["كريب سوسيس",100,160,300],["كريب سوبر كرانشي",70,100,240],["بيف مدخن",100,160,380],["بيف بيكون",100,160,380],["بيف زبدة",100,160,380],["كوردن بلو",90,160,300],["لحمة ستيك",160,195,390],["كريب شيش",120,170,380],["كريب بطاطس",50,100,200],["كريب كفتة عادي",85,135,300],["كفتة فحم",95,140,300]];
const cmix = [["جبن",100,160,200],["لحوم",120,170,340],["فراخ",140,185,370]];
const adds = [["باكيت طاطس عادي",20],["باكيت طاطس رومي",80],["باكيت طاطس شيدر",85],["باكيت طاطس موتزاريلا",70],["باكيت بطاطس ميكسات استربس",95],["باكيت بطاطس ميكسات كفتة",85],["باكيت بطاطس ميكسات سوسيس",100],["باكيت بطاطس ميكسات شيش",150],["باكيت بطاطس ميكسات كوردن بلو",140]];
const rolls = [["شاورما",110],["فاهيتا",130],["كرسبي",100],["زنجر",100],["بانيه",80],["برجر",100],["برجر فحم",120],["سجق",120],["سوسيس",140],["سوبر كرانشي",100],["بيف مدخن",110],["بيف بيكون",110],["بيف زبدة",110],["كوردن بلو",120],["لحمة ستيك",160],["شيش",140],["بطاطس",80],["كفتة عادي",100],["كفتة فحم",130]];
const rmix = [["ميكس جبن",120],["ميكس لحوم",160],["ميكس فراخ",170]];
const burg = [["عادي",100],["دبل",160],["زنجر",100],["سجق",110],["شيش",140],["كفتة فحم",120]];
const fet = [["شاورما",140],["فاهيتا",160],["كرسبي",110],["زنجر",120],["بانيه",100],["برجر فحم",140],["سجق",140],["سوسيس",160],["سوبر كرانشي",100],["بيف مدخن",140],["بيف بيكون",140],["بيف زبدة",140],["كوردن بلو",130],["لحمة ستيك",170],["شيش",140],["بطاطس",80],["كفتة فحم",140]];
const fmix = [["ميكس جبن",170],["ميكس لحوم",170],["ميكس فراخ",180]];
const sauces = ["صوص تيكسس","صوص رانش","صوص باربيكيو","صوص شيدر","كاتشب زيادة","مايونيز زيادة","شطة زيادة","نوع إسبايسي للكريب"];
export const MENU = {
  restaurant: { name: "مطعم قشطة", currency: "EGP", language: "ar", text_direction: "rtl" },
  rules: { step: S, extra_cap_without_next_tier: CAP, delivery_fee: 0, size_order: ["عادي", "جامبو", "وردة"],
    notes: "عادي وجامبو سلّم واحد: الاسم يتحول عند أول سعر للجامبو. الوردة سلّم مستقل. غير ذلك: من السعر الأساسي حتى +100." },
  ui: { size_colors: { "عادي": { bg: "#FF5A1F", fg: "#FFFFFF" }, "جامبو": { bg: "#FFD166", fg: "#3A1F10" }, "وردة": { bg: "#B3261E", fg: "#FFFFFF" } } },
  categories: [
    cat("crepes", "الكريب", "main", mk("c", crepes, sized), { sizes: ["عادي", "جامبو", "وردة"] }),
    cat("crepe_mix", "كريب ميكس", "subcategory", mk("cm", cmix, sized), { parent_category: "crepes" }),
    cat("crepe_additions", "إضافات الكريب", "subcategory", [fixed("ca01", "كونة", 30), ...adds.map(([a, p], n) => single("ca" + String(n + 2).padStart(2, "0"), a, p)), unpriced("ca11", "باكيت بطاطس ميكسات أصناف أخرى")], { parent_category: "crepes" }),
    cat("crepe_free_options", "إضافات مجانية واختيارات", "subcategory", [...sauces.map((s, n) => free("cf0" + (n + 1), s)), single("cf09", "طبق عيش توست", 20), fixed("cf10", "المشروبات الغازية جميع الأنواع", 25)], { parent_category: "crepes" }),
    cat("rolls", "الرولات", "main", mk("r", rolls, single)),
    cat("roll_mix", "رول ميكس", "subcategory", mk("rm", rmix, single), { parent_category: "rolls" }),
    cat("burgers", "البرجر", "main", mk("b", burg, single), { additions: [single("ba01", "إضافة جبن", 40)], removable_items: ["الخس الكابوتشا", "حلقات البصل", "الطماطم"] }),
    cat("crepe_feteer", "كريب فطير", "main", mk("f", fet, single)),
    cat("feteer_mix", "فطير ميكس", "subcategory", mk("fm", fmix, single), { parent_category: "crepe_feteer" }),
  ],
};
