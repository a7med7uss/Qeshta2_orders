import json
S=10;CAP=100
def sized(i,name,a,b,c):
    segs=[]
    bases=[("عادي",a),("جامبو",b),("وردة",c)]
    for k,(sz,base) in enumerate(bases):
        if k<2:
            nxt=bases[k+1][1];to=base
            while to+S<nxt: to+=S
        else: to=base+CAP
        segs.append({"size":sz,"base":base,"from":base,"to":to,"step":S})
    return {"id":i,"name":name,"kind":"sized","segments":segs}
def single(i,name,p): return {"id":i,"name":name,"kind":"single","base":p,"from":p,"to":p+CAP,"step":S}
def fixed(i,name,p): return {"id":i,"name":name,"kind":"fixed","amount":p}
def free(i,name): return {"id":i,"name":name,"kind":"free"}
def unpriced(i,name): return {"id":i,"name":name,"kind":"unpriced","needs_phone_confirmation":True}
def mk(prefix,rows,f): return [f(f"{prefix}{n+1:02d}",*r) for n,r in enumerate(rows)]
crepes=[("كريب شاورما",90,140,300),("كريب فاهيتا",120,160,300),("كريب كرسبي",75,100,280),("كريب زنجر",85,110,300),("كريب استربس",70,100,280),("كريب بانيه",40,100,200),("كريب برجر",85,120,300),("برجر فحم",95,140,300),("كريب سجق",95,140,300),("كريب سوسيس",100,160,300),("كريب سوبر كرانشي",70,100,240),("بيف مدخن",100,160,380),("بيف بيكون",100,160,380),("بيف زبدة",100,160,380),("كوردن بلو",90,160,300),("لحمة ستيك",160,195,390),("كريب شيش",120,170,380),("كريب بطاطس",50,100,200),("كريب كفتة عادي",85,135,300),("كفتة فحم",95,140,300)]
cmix=[("جبن",100,160,200),("لحوم",120,170,340),("فراخ",140,185,370)]
cadd=[("كونة",)]
adds=[("باكيت طاطس عادي",20),("باكيت طاطس رومي",80),("باكيت طاطس شيدر",85),("باكيت طاطس موتزاريلا",70),("باكيت بطاطس ميكسات استربس",95),("باكيت بطاطس ميكسات كفتة",85),("باكيت بطاطس ميكسات سوسيس",100),("باكيت بطاطس ميكسات شيش",150),("باكيت بطاطس ميكسات كوردن بلو",140)]
rolls=[("شاورما",110),("فاهيتا",130),("كرسبي",100),("زنجر",100),("بانيه",80),("برجر",100),("برجر فحم",120),("سجق",120),("سوسيس",140),("سوبر كرانشي",100),("بيف مدخن",110),("بيف بيكون",110),("بيف زبدة",110),("كوردن بلو",120),("لحمة ستيك",160),("شيش",140),("بطاطس",80),("كفتة عادي",100),("كفتة فحم",130)]
rmix=[("ميكس جبن",120),("ميكس لحوم",160),("ميكس فراخ",170)]
burg=[("عادي",100),("دبل",160),("زنجر",100),("سجق",110),("شيش",140),("كفتة فحم",120)]
fet=[("شاورما",140),("فاهيتا",160),("كرسبي",110),("زنجر",120),("بانيه",100),("برجر فحم",140),("سجق",140),("سوسيس",160),("سوبر كرانشي",100),("بيف مدخن",140),("بيف بيكون",140),("بيف زبدة",140),("كوردن بلو",130),("لحمة ستيك",170),("شيش",140),("بطاطس",80),("كفتة فحم",140)]
fmix=[("ميكس جبن",170),("ميكس لحوم",170),("ميكس فراخ",180)]
sauces=["صوص تيكسس","صوص رانش","صوص باربيكيو","صوص شيدر","كاتشب زيادة","مايونيز زيادة","شطة زيادة","نوع إسبايسي للكريب"]
cadd_items=[fixed("ca01","كونة",30)]+[single(f"ca{n+2:02d}",a,p) for n,(a,p) in enumerate(adds)]+[unpriced("ca11","باكيت بطاطس ميكسات أصناف أخرى")]
cfree=[free(f"cf{n+1:02d}",s) for n,s in enumerate(sauces)]+[single("cf09","طبق عيش توست",20),fixed("cf10","المشروبات الغازية جميع الأنواع",25)]
cat=lambda i,n,t,items,**k:{"id":i,"name":n,"type":t,**k,"items":items}
menu={"restaurant":{"name":"مطعم قشطة","currency":"EGP","language":"ar","text_direction":"rtl"},
"rules":{"step":S,"extra_cap_without_next_tier":CAP,"delivery_fee":0,"size_order":["عادي","جامبو","وردة"],
"notes":"عادي وجامبو سلّم واحد: الاسم يتحول عند أول سعر للجامبو. الوردة سلّم مستقل. غير ذلك: من السعر الأساسي حتى +100."},
"ui":{"size_colors":{"عادي":{"bg":"#FF5A1F","fg":"#FFFFFF"},"جامبو":{"bg":"#FFD166","fg":"#3A1F10"},"وردة":{"bg":"#B3261E","fg":"#FFFFFF"}}},
"categories":[
cat("crepes","الكريب","main",mk("c",crepes,sized),sizes=["عادي","جامبو","وردة"]),
cat("crepe_mix","كريب ميكس","subcategory",mk("cm",cmix,sized),parent_category="crepes"),
cat("crepe_additions","إضافات الكريب","subcategory",cadd_items,parent_category="crepes"),
cat("crepe_free_options","إضافات مجانية واختيارات","subcategory",cfree,parent_category="crepes"),
cat("rolls","الرولات","main",mk("r",rolls,single)),
cat("roll_mix","رول ميكس","subcategory",mk("rm",rmix,single),parent_category="rolls"),
cat("burgers","البرجر","main",mk("b",burg,single),additions=[single("ba01","إضافة جبن",40)],removable_items=["الخس الكابوتشا","حلقات البصل","الطماطم"]),
cat("crepe_feteer","كريب فطير","main",mk("f",fet,single)),
cat("feteer_mix","فطير ميكس","subcategory",mk("fm",fmix,single),parent_category="crepe_feteer")]}
json.dump(menu,open("data/menu.json","w"),ensure_ascii=False,indent=1)
print(sum(len(c["items"]) for c in menu["categories"]),"items")
