#!/usr/bin/env python3
"""
Build the baked JSON for the NYC civil-service hiring dashboard.

Pulls three DCAS datasets from NYC Open Data (SODA API, stdlib only, no token)
and aggregates them server- and client-side into compact JSON in data/.

Datasets
  vx8i-nprf  Civil Service List (Active)          — the STOCK of eligibles
  a9md-ynri  Civil Service List Certification     — the FLOW to agencies
  qjzt-ytn9  LL50 Eligible List Utilization       — the OUTCOMES (appt / fall-off)

Run:  python3 build.py
"""
import json, urllib.request, urllib.parse, datetime, sys, statistics
from collections import defaultdict

BASE = "https://data.cityofnewyork.us/resource/{}.json"
ACTIVE, CERT, UTIL = "vx8i-nprf", "a9md-ynri", "qjzt-ytn9"
CATALOG = "nzjr-3966"   # NYC Civil Service Titles — the full title catalog
OUT = "data"

def soql(dataset, params):
    url = BASE.format(dataset) + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "nyc-civil-service-hiring/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

def fnum(d, k):
    v = d.get(k)
    if v in (None, ""): return None
    try: return float(v)
    except (ValueError, TypeError): return None

def inum(d, k):
    v = fnum(d, k)
    return int(v) if v is not None else None

def ymd(s):
    if not s: return None
    try: return datetime.date.fromisoformat(s[:10])
    except ValueError: return None

def write(name, obj):
    import os
    path = f"{OUT}/{name}"
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"  wrote {name}  ({os.path.getsize(path)//1024} KB)")

# ---------------------------------------------------------------- 1. STOCK
print("1/4  Active lists (the stock of eligibles)…")
head = soql(ACTIVE, {"$select":
    "count(list_no) as candidates, count(distinct exam_no) as exams, "
    "count(distinct list_title_desc) as titles, count(distinct list_agency_desc) as agencies, "
    "min(established_date) as oldest, max(established_date) as newest"})[0]
stock = {k: (inum(head, k) if k in ("candidates","exams","titles","agencies") else head[k][:10])
         for k in head}

# per-title stock
title_stock = soql(ACTIVE, {"$select":
    "list_title_desc as title, count(list_no) as candidates, count(distinct exam_no) as lists",
    "$group": "list_title_desc", "$order": "candidates DESC", "$limit": "5000"})
title_stock = [{"title": t["title"], "candidates": inum(t,"candidates"), "lists": inum(t,"lists")}
               for t in title_stock if t.get("title")]
print(f"     {stock['candidates']:,} candidates on {stock['exams']} lists, {stock['titles']} titles")

# full civil-service title catalog — to show the sheer number/complexity of titles
cat = soql(CATALOG, {"$select":
    "count(distinct title) as codes, count(distinct descr) as descriptions, "
    "count(distinct union_descr) as unions"})[0]
inv = soql(CATALOG, {"$select": "count(*) as n",
    "$where": "upper(investigation_before_appointment)='YES'"})[0]
catalog = {"title_codes": inum(cat,"codes"), "descriptions": inum(cat,"descriptions"),
           "unions": inum(cat,"unions"), "investigation_titles": inum(inv,"n")}
print(f"     catalog: {catalog['title_codes']:,} title codes, {catalog['unions']} unions")

# per-exam list windows (established -> anniversary) for the "clock"
lists = soql(ACTIVE, {"$select":
    "exam_no, max(list_title_desc) as title, count(list_no) as n, "
    "max(established_date) as est, max(anniversary_date) as anniv, max(extension_date) as ext",
    "$group": "exam_no", "$limit": "5000"})
window_days = []
for l in lists:
    est, anniv, ext = ymd(l.get("est")), ymd(l.get("anniv")), ymd(l.get("ext"))
    end = ext or anniv
    if est and end and end > est:
        window_days.append((end - est).days)

# ---------------------------------------------------------------- 2. FLOW
print("2/4  Certifications (the flow to agencies)…")
# one row per certification (headers repeat per candidate row — collapse with max)
certs = soql(CERT, {"$select":
    "cert_issue_no, max(cert_date) as cert_date, max(request_date) as req_date, "
    "max(list_title_desc) as title, max(list_agency_desc) as agency, "
    "max(no_vacancies) as vac, max(no_requested) as req, max(no_certified) as certd, "
    "max(provisional_replacement) as prov",
    "$group": "cert_issue_no", "$limit": "60000"})
print(f"     {len(certs):,} distinct certifications 2007–present")

flow_year = defaultdict(lambda: {"certs":0,"vac":0,"req":0,"certd":0,"prov":0})
cert_ratios, req_lag = [], []
agency_flow = defaultdict(lambda: {"certs":0,"vac":0,"prov":0})
title_flow = defaultdict(lambda: {"certs":0,"vac":0,"certd":0})
for c in certs:
    cd, rd = ymd(c.get("cert_date")), ymd(c.get("req_date"))
    vac, req, certd = inum(c,"vac"), inum(c,"req"), inum(c,"certd")
    prov = 1 if (c.get("prov") or "").strip().upper() in ("Y","YES","TRUE") else 0
    yr = cd.year if cd else None
    if yr and 2007 <= yr <= 2026:
        f = flow_year[yr]
        f["certs"] += 1; f["prov"] += prov
        if vac: f["vac"] += vac
        if req: f["req"] += req
        if certd: f["certd"] += certd
    if vac and certd and vac > 0:
        cert_ratios.append(certd / vac)
    if cd and rd and cd >= rd:
        req_lag.append((cd - rd).days)
    ag = (c.get("agency") or "").strip()
    if ag:
        a = agency_flow[ag]; a["certs"] += 1; a["prov"] += prov
        if vac: a["vac"] += vac
    ti = (c.get("title") or "").strip()
    if ti:
        t = title_flow[ti]; t["certs"] += 1
        if vac: t["vac"] += vac
        if certd: t["certd"] += certd

# ---------------------------------------------------------------- 3. OUTCOMES
print("3/4  List utilization (the outcomes: appointed vs fell off)…")
util = soql(UTIL, {"$limit": "60000"})
print(f"     {len(util):,} title-year utilization rows")
REASONS = {  # column -> human label (why a candidate left a list without being hired)
    "dea_cnt":"Declined appointment", "frm_cnt":"Failed to report — medical",
    "fri_cnt":"Failed to report — investigation", "frp_cnt":"Failed to report — psychological",
    "frh_cnt":"Failed to report — physical", "ftr_cnt":"Failed to report — interview",
    "fra_cnt":"Failed / declined after accepting", "nfp_cnt":"Undeliverable mailing address",
    "ova_cnt":"Overage for position", "nle_cnt":"No longer in eligible title",
    "aol_cnt":"Appointed off another list", "dce_cnt":"Deceased",
    "dlx_cnt":"Declined — location", "tin_cnt":"Declined — temporary", "unf_cnt":"Underage at filing",
}
funnel_tot = {"appts": 0, "cns": 0}
reason_tot = defaultdict(int)
funnel_year = defaultdict(lambda: {"appts":0, "removed":0})
for u in util:
    a = inum(u, "appt_cnt") or 0
    funnel_tot["appts"] += a
    funnel_tot["cns"] += inum(u, "cns_cnt") or 0
    removed = 0
    for col, label in REASONS.items():
        v = inum(u, col) or 0
        reason_tot[label] += v
        if col not in ("aol_cnt",):  # aol = appointed elsewhere, not a true fall-off
            removed += v
    # utilization rows have no clean year column; use list_est_date year as a proxy bucket
    est = ymd(u.get("list_est_date"))
    if est and 2004 <= est.year <= 2026:
        funnel_year[est.year]["appts"] += a
        funnel_year[est.year]["removed"] += removed

# ---------------------------------------------------------------- 4. ASSEMBLE
print("4/4  Assembling…")

def hist(vals, edges):
    labels, counts = [], [0]*(len(edges)+1)
    for v in vals:
        placed = False
        for i, e in enumerate(edges):
            if v <= e:
                counts[i] += 1; placed = True; break
        if not placed: counts[-1] += 1
    lo = 0
    for e in edges:
        labels.append(f"{lo}–{e}"); lo = e
    labels.append(f"{edges[-1]}+")
    return [{"bucket": l, "n": c} for l, c in zip(labels, counts)]

years = sorted(flow_year)
flow = [{"year": y, **{k: flow_year[y][k] for k in ("certs","vac","req","certd","prov")}} for y in years]

# merge title stock + flow into one bottleneck table
tmap = {t["title"]: {"title": t["title"], "candidates": t["candidates"], "lists": t["lists"],
                     "certs": 0, "vac": 0, "certd": 0} for t in title_stock}
for ti, t in title_flow.items():
    if ti in tmap:
        tmap[ti].update(certs=t["certs"], vac=t["vac"], certd=t["certd"])
    else:
        tmap[ti] = {"title": ti, "candidates": 0, "lists": 0, **t}
bottleneck = sorted(tmap.values(), key=lambda x: -x["candidates"])[:40]

agencies = sorted(
    [{"agency": a, **v, "prov_pct": round(100*v["prov"]/v["certs"],1) if v["certs"] else 0}
     for a, v in agency_flow.items() if v["certs"] >= 20],
    key=lambda x: -x["certs"])[:30]

reasons = sorted(({"reason": k, "n": v} for k, v in reason_tot.items() if k != "Appointed off another list"),
                 key=lambda x: -x["n"])

latest = max(years)
stats = {
    "generated": datetime.date.today().isoformat(),
    "cert_range": [certs and min((c.get("cert_date") or "9999")[:10] for c in certs),
                   certs and max((c.get("cert_date") or "0")[:10] for c in certs)],
    "stock": stock,
    "catalog": catalog,
    "flow_latest": next(f for f in flow if f["year"] == latest),
    "latest_year": latest,
    # honest ratios (aggregate vs typical)
    "ratio_aggregate": round(sum(f["certd"] for f in flow)/sum(f["vac"] for f in flow), 1),
    "ratio_median_cert": round(statistics.median(cert_ratios), 1),
    "prov_share_latest": round(100*flow_year[latest]["prov"]/flow_year[latest]["certs"], 1),
    "req_lag_median": int(statistics.median(req_lag)) if req_lag else None,
    "req_lag_p90": int(statistics.quantiles(req_lag, n=10)[8]) if len(req_lag) > 10 else None,
    "window_median_days": int(statistics.median(window_days)) if window_days else None,
    "funnel": {
        "appointed": funnel_tot["appts"],
        "reasons": reasons,
        "removed_total": sum(r["n"] for r in reasons),
    },
    "n_certs": len(certs),
    "n_util_rows": len(util),
}

write("stats.json", stats)
write("flow.json", flow)
# every active-list title (title, candidates) for the complexity treemap
write("titles_all.json", [{"t": t["title"], "n": t["candidates"]} for t in title_stock])
write("bottleneck.json", bottleneck)
write("agencies.json", agencies)
write("ratio_dist.json", hist(cert_ratios, [1,2,3,5,10,25,50,100]))
write("lag_dist.json", hist(req_lag, [7,30,60,90,180,365]))
write("funnel_year.json", [{"year": y, **funnel_year[y]} for y in sorted(funnel_year)])
print("Done.")
