#!/usr/bin/env python3
"""
Build the data behind "New York City's civil service lists".

Pulls seven Department of Citywide Administrative Services (DCAS) datasets from
NYC Open Data, aggregates them and writes compact JSON into data/. Python
standard library only, no API token. Candidate names are read (to count
distinct people and cross-list overlap) but never written out.

  vx8i-nprf  Civil Service List (Active)         every name on every list in force
  qu8g-sxqf  Civil Service List (Terminated)     lists that have ended, with end dates
  a9md-ynri  Civil Service List Certification    names sent to agencies, per certification
  uxsm-hzx3  Charter Mandated Quarterly Report on Provisionals
  ye3c-m4ga  Civil List                          everyone employed in a city title, by year
  nzjr-3966  NYC Civil Service Titles            salary range, union, investigation flag
  4ptz-hmtc  Annual Examination Schedule         exams with upcoming application windows

Run:  python3 build.py            (downloads are cached in .cache/ by dataset update time)
Exit code is non-zero, and nothing is written, if any source looks empty or malformed.
"""
import csv, datetime, http.client, json, math, os, statistics, sys, time, urllib.error, urllib.parse, urllib.request
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data")
CACHE = os.path.join(HERE, ".cache")
DOMAIN = "https://data.cityofnewyork.us"
UA = {"User-Agent": "nyc-civil-service-lists-dashboard/2.0 (github.com/joshgreenman1973/nyc-civil-service-hiring)"}
TODAY = datetime.date.fromisoformat(os.environ["BUILD_DATE"]) if os.environ.get("BUILD_DATE") else datetime.date.today()

ACTIVE, TERMINATED, CERT, PROV, CIVIL, TITLES, SCHED = (
    "vx8i-nprf", "qu8g-sxqf", "a9md-ynri", "uxsm-hzx3", "ye3c-m4ga", "nzjr-3966", "4ptz-hmtc")

POLICE_TITLE = "70210"
# Points per credit. Residency: 10 on the current police, firefighter and sanitation notices of examination
# (and a resident with no other credit tops out at exactly 110 on every such list). Veterans: Civil Service
# Law §85, 5/10 on open-competitive exams, 2.5/5 on promotional. Legacy: §§85-a to 85-c, 10 each for a
# parent and a sibling.
RES_POINTS = 10
# Titles followed across years and across lists. All are open-competitive entry titles
# with large lists; the set is fixed here so the charts don't reshuffle day to day.
TRACKED = [
    ("70210", "Police officer"), ("70310", "Firefighter"), ("70112", "Sanitation worker"),
    ("70410", "Correction officer"), ("53052", "Emergency medical specialist trainee"),
    ("60817", "School safety agent"), ("71651", "Traffic enforcement agent"),
    ("91207", "Conductor"), ("91211", "Train operator"), ("90744", "Track worker"),
    ("91203", "Bus operator"), ("70810", "Special officer"),
]


class BuildError(Exception):
    pass


def check(cond, msg):
    if not cond:
        raise BuildError(msg)


# ------------------------------------------------------------------ fetching
def get(url, tries=6, timeout=900):
    """GET with backoff. Socrata answers anonymous throttling with 403 as well as 429."""
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(20 * (i + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead) as e:
            last = e
            if i < tries - 1:
                time.sleep(20 * (i + 1))
                continue
            raise
    raise last


def soql(ds, params):
    return json.loads(get(f"{DOMAIN}/resource/{ds}.json?" + urllib.parse.urlencode(params)))


def meta(ds):
    return json.loads(get(f"{DOMAIN}/api/views/{ds}.json"))


def csv_rows(ds, updated_at):
    """Full CSV export, cached on disk by the dataset's rowsUpdatedAt stamp."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{ds}-{updated_at}.csv")
    if not os.path.exists(path):
        for old in os.listdir(CACHE):
            if old.startswith(ds + "-"):
                os.remove(os.path.join(CACHE, old))
        print(f"  downloading {ds} …", flush=True)
        data = get(f"{DOMAIN}/api/views/{ds}/rows.csv?accessType=DOWNLOAD")
        with open(path + ".part", "wb") as f:
            f.write(data)
        os.replace(path + ".part", path)
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames, list(reader)


# ------------------------------------------------------------------ helpers
def mdy(s):
    s = (s or "").strip()
    if not s:
        return None
    m, d, y = s.split("/")
    return datetime.date(int(y), int(m), int(d))


def isod(s):
    s = (s or "").strip()
    return datetime.date.fromisoformat(s[:10]) if s else None


def iso(d):
    return d.isoformat() if d else None


def years(a, b):
    return (b - a).days / 365.25


def pct(vals, q):
    v = sorted(vals)
    if not v:
        return None
    k = (len(v) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def r1(x, n=1):
    return None if x is None else round(x, n)


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def norm_exam(s):
    s = (s or "").strip()
    return s[-4:].zfill(4) if s else s


SCORE_BINS = [(None, 70), (70, 75), (75, 80), (80, 85), (85, 90), (90, 95), (95, 100), (100, 100.001),
              (100.001, 105.001), (105.001, 110.001), (110.001, None)]
SCORE_LABELS = ["Under 70", "70–74", "75–79", "80–84", "85–89", "90–94", "95–99", "100",
                "Over 100 to 105", "Over 105 to 110", "Over 110"]


def score_bin(x):
    for i, (lo, hi) in enumerate(SCORE_BINS):
        if (lo is None or x >= lo) and (hi is None or x < hi):
            return i
    return len(SCORE_BINS) - 1


def write(name, obj):
    path = os.path.join(OUT, name)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
    os.replace(path + ".tmp", path)
    print(f"  wrote data/{name} ({os.path.getsize(path) // 1024} KB)")


# ================================================================== build
def build():
    t0 = time.time()
    m_active = meta(ACTIVE)
    m_term = meta(TERMINATED)
    as_of = datetime.datetime.fromtimestamp(m_active["rowsUpdatedAt"]).date()
    print(f"Active list updated {as_of}; terminated list updated "
          f"{datetime.datetime.fromtimestamp(m_term['rowsUpdatedAt']).date()}")

    # ---------------------------------------------------------- 1. active lists
    print("1/7 Active lists")
    EXPECT = ["Exam No", "List No", "First Name", "MI", "Last Name", "Adj. FA", "List Title Code",
              "List Title Desc", "Group No", "List Agency Code", "List Agency Desc", "List Div Code",
              "Published Date", "Established Date", "Anniversary Date", "Extension Date", "Veteran Credit",
              "Parent Lgy Credit", "Sibling Lgy Credit", "Residency Credit"]
    hdr, rows = csv_rows(ACTIVE, m_active["rowsUpdatedAt"])
    check(hdr == EXPECT, f"active list columns changed: {hdr}")
    check(len(rows) > 100_000, f"active list has only {len(rows)} rows")

    lists = {}
    by_list_rows = defaultdict(list)
    names_all, names_mi = set(), set()
    key_exams = defaultdict(set)        # name key (with middle initial) -> exams
    key_titles = defaultdict(set)       # name key -> title codes (open-competitive lists only)
    legacy_keys = set()
    for r in rows:
        ex = r["Exam No"].strip().zfill(4)
        ac = r["List Agency Code"].strip()
        g = r["Group No"].strip()
        lid = f"{ex}-{ac}-{g}"
        afa = float(r["Adj. FA"])
        ln = float(r["List No"])
        res = bool(r["Residency Credit"].strip())
        vet = r["Veteran Credit"].strip()
        par = bool(r["Parent Lgy Credit"].strip())
        sib = bool(r["Sibling Lgy Credit"].strip())
        L = lists.get(lid)
        if L is None:
            desc = r["List Agency Desc"].strip()
            kind = "qie" if desc == "QUALIFIED INCUMBENT" else ("oc" if ac == "000" else "promo")
            L = lists[lid] = {
                "id": lid, "ex": ex, "t": r["List Title Desc"].strip(), "tc": r["List Title Code"].strip(),
                "ag": desc, "ac": ac, "g": g, "k": kind,
                "pub": mdy(r["Published Date"]), "est": mdy(r["Established Date"]),
                "ann": mdy(r["Anniversary Date"]), "ext": mdy(r["Extension Date"]),
            }
        by_list_rows[lid].append((ln, afa, res, vet, par, sib))
        first, mi, last = r["First Name"].strip().upper(), r["MI"].strip().upper(), r["Last Name"].strip().upper()
        k = f"{first}|{mi}|{last}"
        names_all.add(k)
        if mi:
            names_mi.add(k)
            key_exams[k].add(ex)
            if L["k"] == "oc":
                key_titles[k].add(L["tc"])
        if par or sib:
            legacy_keys.add(k)
    check(len(lists) > 500, f"only {len(lists)} lists")

    # per-list statistics
    tot = Counter()
    unflagged = 0
    res_check = {"max": 0, "low": 0}
    hist_by_kind = {k: [0] * len(SCORE_BINS) for k in ("oc", "promo", "qie")}
    ties_all = []
    for lid, L in lists.items():
        rr = sorted(by_list_rows[lid])
        scores = [x[1] for x in rr]
        L["n"] = len(rr)
        L["mx"] = rr[-1][0]
        L["ins"] = sum(1 for x in rr if x[0] % 1)
        L["sc"] = [min(scores), r1(statistics.median(scores), 2), max(scores)]
        h = [0] * len(SCORE_BINS)
        for s in scores:
            b = score_bin(s)
            h[b] += 1
            hist_by_kind[L["k"]][b] += 1
        L["h"] = h
        cnt = Counter(scores)
        top_score, top_n = max(cnt.items(), key=lambda kv: (kv[1], kv[0]))
        L["tie"] = [top_n, top_score]
        if top_n >= 2:
            ties_all.append((top_n, top_score, lid))
        vet = sum(1 for x in rr if x[3] == "Veteran's Credit")
        dvet = sum(1 for x in rr if x[3] == "Disabled Veteran's Credit")
        par = sum(1 for x in rr if x[4])
        sib = sum(1 for x in rr if x[5])
        resn = sum(1 for x in rr if x[2])
        L["cr"] = [vet, dvet, par, sib, resn]
        tot["legacy_both"] += sum(1 for x in rr if x[4] and x[5])
        promo = L["k"] == "promo"
        for (ln, afa, res, v, p, s) in rr:
            vpts = (5 if promo else 10) if v == "Disabled Veteran's Credit" else ((2.5 if promo else 5) if v else 0)
            flagged = RES_POINTS * res + vpts + 10 * p + 10 * s
            if afa - flagged > 100.0001:
                unflagged += 1
            if res and not (v or p or s):
                res_check["max"] = max(res_check["max"], afa)
                if afa < 70 + RES_POINTS:
                    res_check["low"] += 1
        # status
        if L["est"] is None:
            st = "pending"
        elif L["ann"] and L["ann"] >= TODAY:
            st = "term"
        elif L["ext"] and L["ext"] >= TODAY:
            st = "ext"
        else:
            st = "past"
        L["st"] = st
        tot["rows_" + L["k"]] += L["n"]
        tot["lists_" + L["k"]] += 1
    check(tot["lists_oc"] > 200, "too few open-competitive lists")

    # ---------------------------------------------------------- 2. certifications
    print("2/7 Certifications (three grouped queries, a few minutes)")
    sel = ("max(list_no::number) as maxcert, count(*) as rows, count(distinct list_no) as ncert, "
           "min(cert_date) as first, max(cert_date) as last")
    cert_t = soql(CERT, {"$select": "exam_no, list_title_code, " + sel, "$where": "cert_date >= '2018-01-01'",
                         "$group": "exam_no, list_title_code", "$limit": "50000"})
    cert_ta = soql(CERT, {"$select": "exam_no, list_title_code, list_agency_code, max(list_agency_desc) as agd, " + sel,
                          "$where": "cert_date >= '2018-01-01'",
                          "$group": "exam_no, list_title_code, list_agency_code", "$limit": "50000"})
    check(len(cert_t) > 1000 and len(cert_ta) > 1000, "certification aggregates look empty")
    police_last = soql(CERT, {"$select": "max(cert_date) as d", "$where": f"list_title_code = '{POLICE_TITLE}'"})
    police_last = isod(police_last[0].get("d")) if police_last else None

    def ckey(c, agency):
        k = (norm_exam(c["exam_no"]), (c.get("list_title_code") or "").strip().zfill(5))
        return k + ((c.get("list_agency_code") or "").strip().zfill(3),) if agency else k

    def cparse(c):
        return {"n": int(float(c["ncert"])), "mx": float(c["maxcert"]), "r": int(float(c["rows"])),
                "f": isod(c["first"]), "l": isod(c["last"])}

    CT = {ckey(c, False): cparse(c) for c in cert_t if c.get("maxcert")}
    CTA = {ckey(c, True): cparse(c) for c in cert_ta if c.get("maxcert")}
    agency_names = defaultdict(Counter)          # 3-digit agency code -> descriptions seen
    by_exam_title = defaultdict(list)             # (exam, title code) -> [(agency code, cert aggregate)]
    for c in cert_ta:
        if not c.get("maxcert"):
            continue
        k = ckey(c, True)
        by_exam_title[k[:2]].append((k[2], CTA[k]))
        if c.get("agd"):
            agency_names[k[2]][c["agd"].strip()] += 1
    requeried = 0
    for L in lists.values():
        L["c"], L["cn"] = None, None
        if L["est"] is None:
            continue
        tc5 = L["tc"].zfill(5)
        c = CTA.get((L["ex"], tc5, L["ac"].zfill(3))) if L["k"] == "promo" else CT.get((L["ex"], tc5))
        if c and c["f"] and c["f"] < L["est"] - datetime.timedelta(days=30):
            # exam numbers recycle each decade; restrict to certifications issued after this list began
            where = (f"exam_no in ('{L['ex']}','0{L['ex']}') AND list_title_code = '{tc5}' "
                     f"AND cert_date >= '{L['est'].isoformat()}'")
            if L["k"] == "promo":
                where += f" AND list_agency_code = '{L['ac'].zfill(3)}'"
            q = soql(CERT, {"$select": sel, "$where": where})
            requeried += 1
            c = cparse(q[0]) if q and q[0].get("maxcert") else None
        if c:
            L["c"] = c
            L["dp"] = round(min(1.0, c["mx"] / L["mx"]), 4) if L["mx"] else None
            if L["k"] != "promo":
                # which agencies have been sent names from this open list, and how many
                dr = [(ac, x) for ac, x in by_exam_title.get((L["ex"], tc5), [])
                      if not (x["f"] and x["f"] < L["est"] - datetime.timedelta(days=30))]
                L["dr"] = [[ac, x["r"], x["n"], iso(x["l"])] for ac, x in sorted(dr, key=lambda z: -z[1]["r"])]
        else:
            L["dp"] = 0.0
            if L["tc"] == POLICE_TITLE:
                L["cn"] = "police"
                L["dp"] = None
    print(f"  re-queried {requeried} lists whose exam number was reused")
    # how far down each list the city had sent names, month by month: the deepest list number on any
    # batch that month, carried forward. One grouped query (about four minutes on the server).
    fr_rows = soql(CERT, {"$select": "exam_no, list_title_code, list_agency_code, date_trunc_ym(cert_date) as m, "
                                     "max(list_no::number) as mx",
                          "$where": "cert_date >= '2018-01-01'",
                          "$group": "exam_no, list_title_code, list_agency_code, m", "$limit": "100000"})
    check(len(fr_rows) > 5000, "monthly certification frontier looks empty")
    fr_oc, fr_pr = defaultdict(dict), defaultdict(dict)
    for r in fr_rows:
        if not r.get("mx") or not r.get("m"):
            continue
        k = ckey(r, True)
        mon = r["m"][:7]
        v = float(r["mx"])
        fr_pr[k][mon] = max(fr_pr[k].get(mon, 0), v)
        fr_oc[k[:2]][mon] = max(fr_oc[k[:2]].get(mon, 0), v)
    for lid, L in lists.items():
        L["fr"] = None
        if L["est"] is None or L.get("cn") == "police" or not L.get("c"):
            continue
        tc5 = L["tc"].zfill(5)
        months = fr_pr.get((L["ex"], tc5, L["ac"].zfill(3))) if L["k"] == "promo" else fr_oc.get((L["ex"], tc5))
        if not months:
            continue
        e0 = L["est"].year * 12 + L["est"].month - 1
        best, pts = 0, []
        for mon in sorted(months):
            y, m = int(mon[:4]), int(mon[5:7])
            off = y * 12 + m - 1 - e0
            if off < -1:          # a batch from before this list began: a reused exam number
                continue
            if months[mon] > best:
                best = months[mon]
                pts.append([max(0, off), best])
        L["fr"] = pts or None

    # names "reached": at or above the deepest list number sent from the list
    for lid, L in lists.items():
        if L["est"] is None or L.get("cn") == "police":
            L["rc"] = None
        elif L.get("c"):
            L["rc"] = sum(1 for x in by_list_rows[lid] if x[0] <= L["c"]["mx"])
        else:
            L["rc"] = 0

    # certification-level flow (one record per certification; header fields repeat on every name row)
    certs = soql(CERT, {"$select": "cert_issue_no, max(cert_date) as cd, max(request_date) as rd, "
                                   "max(no_vacancies) as vac, max(no_certified) as certd, count(*) as rows, "
                                   "max(provisional_replacement) as prov, max(list_agency_code) as ac, "
                                   "max(list_title_code) as tc, max(list_agency_desc) as agd",
                        "$group": "cert_issue_no", "$limit": "100000"})
    check(len(certs) > 10000, "too few certifications")
    fy = defaultdict(lambda: {"certs": 0, "names": 0, "prov": 0, "ratios": [], "lags": []})
    flow_ag = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))   # agency -> year -> certs, names, prov
    flow_tc = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))   # title -> year -> certs, names, prov
    for c in certs:
        cd, rd = isod(c.get("cd")), isod(c.get("rd"))
        if not cd:
            continue
        isprov = (c.get("prov") or "").strip().upper() in ("Y", "YES")
        nrows = int(float(c.get("rows") or 0))
        for tgt, key in ((flow_ag, (c.get("ac") or "").strip().zfill(3)),
                         (flow_tc, (c.get("tc") or "").strip().zfill(5))):
            if key.strip("0"):
                v = tgt[key][cd.year]
                v[0] += 1
                v[1] += nrows
                v[2] += isprov
        if c.get("agd") and c.get("ac"):
            agency_names[(c["ac"]).strip().zfill(3)][c["agd"].strip()] += 1
        y = fy[cd.year]
        y["certs"] += 1
        y["names"] += int(float(c.get("rows") or 0))
        if (c.get("prov") or "").strip().upper() in ("Y", "YES"):
            y["prov"] += 1
        vac, certd = num(c.get("vac")), num(c.get("certd"))
        if vac and certd and vac > 0:
            y["ratios"].append(certd / vac)
        if rd and cd >= rd:
            y["lags"].append((cd - rd).days)
    cert_years = []
    for yr in sorted(fy):
        y = fy[yr]
        cert_years.append({"y": yr, "certs": y["certs"], "names": y["names"],
                           "provShare": r1(100 * y["prov"] / y["certs"]) if y["certs"] else None,
                           "medRatio": r1(statistics.median(y["ratios"])) if y["ratios"] else None,
                           "medLag": statistics.median(y["lags"]) if y["lags"] else None,
                           "partial": yr == TODAY.year})
    all_ratios = [x for y in fy.values() for x in y["ratios"]]
    all_lags = [x for y in fy.values() for x in y["lags"]]

    # ---------------------------------------------------------- 3. provisionals
    print("3/7 Provisionals")
    ptr = soql(PROV, {"$select": "report_date, sum(total_count) as tot, sum(pure_prov_25_mos) as p25, "
                                 "sum(step_prov_25_mos) as s25, sum(pure_prov_10_24_mos) as p1024, "
                                 "sum(step_prov_10_24_mos) as s1024",
                      "$where": "report_date IS NOT NULL", "$group": "report_date",
                      "$order": "report_date", "$limit": "500"})
    check(len(ptr) > 20, "provisional trend looks empty")
    prov_trend = [{"d": x["report_date"][:10], "tot": int(float(x["tot"])),
                   "y2": int(float(x["p25"])) + int(float(x["s25"])),
                   "m10": int(float(x["p1024"])) + int(float(x["s1024"]))} for x in ptr]
    prov_null = soql(PROV, {"$select": "count(*) as n, sum(total_count) as t", "$where": "report_date IS NULL"})[0]
    latest_prov = prov_trend[-1]["d"]
    prows = soql(PROV, {"$where": f"report_date = '{latest_prov}T00:00:00.000'", "$limit": "50000"})
    check(len(prows) > 300, "latest provisional report looks empty")
    patr = soql(PROV, {"$select": "report_date, agency_code, max(agency_description) as agd, "
                                  "sum(total_count) as tot, sum(pure_prov_25_mos) as p25, sum(step_prov_25_mos) as s25",
                       "$where": "report_date IS NOT NULL", "$group": "report_date, agency_code", "$limit": "50000"})
    check(len(patr) > 500, "provisional agency trend looks empty")
    prov_ag_trend = defaultdict(list)
    for x in patr:
        ac = (x.get("agency_code") or "").strip().zfill(3)
        prov_ag_trend[ac].append([x["report_date"][:10], int(float(x["tot"])),
                                  int(float(x.get("p25") or 0)) + int(float(x.get("s25") or 0))])
        if x.get("agd"):
            agency_names[ac][x["agd"].strip()] += 1
    prov_title = defaultdict(lambda: {"tot": 0, "y2": 0, "ag": set(), "t": ""})
    prov_title_agency = defaultdict(lambda: [0, 0])     # (title, agency code) -> total, 2+ years
    for p in prows:
        tc = (p.get("title_code") or "").strip().zfill(5)
        x = prov_title[tc]
        x["tot"] += int(float(p.get("total_count") or 0))
        x["y2"] += int(float(p.get("pure_prov_25_mos") or 0)) + int(float(p.get("step_prov_25_mos") or 0))
        x["ag"].add((p.get("agency_description") or "").strip())
        x["t"] = (p.get("title_description") or "").strip()
        ac = (p.get("agency_code") or "").strip().zfill(3)
        pa = prov_title_agency[(tc, ac)]
        pa[0] += int(float(p.get("total_count") or 0))
        pa[1] += int(float(p.get("pure_prov_25_mos") or 0)) + int(float(p.get("step_prov_25_mos") or 0))

    # ---------------------------------------------------------- 4. civil list, titles, schedule
    print("4/7 Civil List, title catalog, exam schedule")
    cy = soql(CIVIL, {"$select": "max(calendar_year) as y"})[0]["y"]
    emp_rows = soql(CIVIL, {"$select": "ttl, count(*) as n", "$where": f"calendar_year = '{cy}'",
                            "$group": "ttl", "$limit": "50000"})
    check(len(emp_rows) > 1000, "Civil List aggregate looks empty")
    emp = {(e.get("ttl") or "").strip().zfill(5): int(float(e["n"])) for e in emp_rows}
    ea = soql(CIVIL, {"$select": "dpt, max(agency_name) as nm, count(*) as n", "$where": f"calendar_year = '{cy}'",
                      "$group": "dpt", "$limit": "5000"})
    emp_ag = {}
    for e in ea:
        ac = (e.get("dpt") or "").strip().zfill(3)
        emp_ag[ac] = int(float(e["n"]))
        if e.get("nm"):
            agency_names[ac][e["nm"].strip()] += 1000      # Civil List names win
    eat = soql(CIVIL, {"$select": "dpt, ttl, count(*) as n", "$where": f"calendar_year = '{cy}'",
                       "$group": "dpt, ttl", "$limit": "100000"})
    check(len(eat) > 5000, "Civil List agency-by-title aggregate looks empty")
    emp_ag_title = defaultdict(list)
    for e in eat:
        emp_ag_title[(e.get("ttl") or "").strip().zfill(5)].append([(e.get("dpt") or "").strip().zfill(3), int(float(e["n"]))])
    trows = soql(TITLES, {"$limit": "20000"})
    check(len(trows) > 1000, "title catalog looks empty")
    tinfo = {}
    for t in trows:
        tc = (t.get("title") or "").strip().zfill(5)
        x = tinfo.setdefault(tc, {"lo": None, "hi": None, "u": None, "bu": None, "inv": None})
        lo, hi = num(t.get("min_rate")), num(t.get("max_rate"))
        if lo and lo > 1000:
            x["lo"] = lo if x["lo"] is None else min(x["lo"], lo)
        if hi and hi > 1000:
            x["hi"] = hi if x["hi"] is None else max(x["hi"], hi)
        if t.get("union_descr") and not x["u"]:
            x["u"] = t["union_descr"].strip()
            x["bu"] = (t.get("barg_unit") or "").strip() or None
        if t.get("investigation_before_appointment"):
            x["inv"] = t["investigation_before_appointment"].strip()
    sched_asof = soql(SCHED, {"$select": "max(data_current_as_of) as d"})[0]["d"][:10]
    srows = soql(SCHED, {"$where": f"data_current_as_of = '{sched_asof}T00:00:00.000'", "$limit": "5000"})
    upcoming = defaultdict(list)
    n_upcoming = 0
    for s in srows:
        end = isod(s.get("application_period_end_date"))
        if not end or end < TODAY:
            continue
        n_upcoming += 1
        tc = (s.get("title_code") or "").strip().zfill(5) if s.get("title_code") else None
        if tc:
            upcoming[tc].append({"ex": s.get("exam_number"), "t": (s.get("exam_title") or "").strip(),
                                 "s": (s.get("application_period_start") or "")[:10], "e": end.isoformat(),
                                 "k": (s.get("open_competitive_promotion") or "").strip()})

    # ---------------------------------------------------------- 5. terminated lists
    print("5/7 Terminated lists")
    T_EXPECT = EXPECT[:16] + ["Termination Date"] + EXPECT[16:]
    thdr, trows_ = csv_rows(TERMINATED, m_term["rowsUpdatedAt"])
    check(thdr == T_EXPECT, f"terminated list columns changed: {thdr}")
    check(len(trows_) > 100_000, f"terminated list has only {len(trows_)} rows")
    ended = {}
    for r in trows_:
        ex = r["Exam No"].strip().zfill(4)
        ac = r["List Agency Code"].strip()
        g = r["Group No"].strip()
        lid = f"{ex}-{ac}-{g}"
        est = mdy(r["Established Date"])
        tcode = r["List Title Code"].strip()
        if lid in lists and lists[lid]["tc"] == tcode and lists[lid]["est"] == est:
            continue
        ekey = (lid, tcode, est)
        E = ended.get(ekey)
        if E is None:
            E = ended[ekey] = {"ex": ex, "t": r["List Title Desc"].strip(), "tc": tcode, "ac": ac,
                              "k": "oc" if ac == "000" else "promo", "n": 0,
                              "est": mdy(r["Established Date"]), "ann": mdy(r["Anniversary Date"]),
                              "ext": mdy(r["Extension Date"]), "term": mdy(r["Termination Date"])}
        E["n"] += 1
    ended = [e for e in ended.values() if e["est"] and e["term"]]
    check(len(ended) > 500, "too few terminated lists")
    first_term = min(e["term"] for e in ended)
    by_term_year = defaultdict(lambda: {"lists": 0, "names": 0, "past4": 0, "early": 0, "lives": []})
    for e in ended:
        life = years(e["est"], e["term"])
        e["life"] = life
        y = by_term_year[e["term"].year]
        y["lists"] += 1
        y["names"] += e["n"]
        y["lives"].append(life)
        if life > 4.02:
            y["past4"] += 1
        if e["ann"] and e["term"] < e["ann"] - datetime.timedelta(days=5):
            y["early"] += 1
    term_years = [{"y": yr, "lists": v["lists"], "names": v["names"], "past4": v["past4"], "early": v["early"],
                   "medLife": r1(statistics.median(v["lives"]), 2), "partial": yr == TODAY.year}
                  for yr, v in sorted(by_term_year.items())]

    # names on each new open-competitive list, by year established, for the tracked titles
    pools = {}
    for tc, label in TRACKED:
        yrs = defaultdict(lambda: [0, 0])
        for L in lists.values():
            if L["tc"] == tc and L["k"] == "oc" and L["est"]:
                yrs[L["est"].year][0] += L["n"]
                yrs[L["est"].year][1] += 1
        for e in ended:
            if e["tc"] == tc and e["k"] == "oc":
                yrs[e["est"].year][0] += e["n"]
                yrs[e["est"].year][1] += 1
        pools[tc] = {"label": label, "years": {str(y): v for y, v in sorted(yrs.items())}}

    # ---------------------------------------------------------- 6. scores, credits, overlap
    print("6/7 Scores, credits, overlap")
    res_curves = []
    for L in sorted(lists.values(), key=lambda x: -x["n"]):
        if L["k"] != "oc" or L["cr"][4] < 0.2 * L["n"] or L["n"] < 1000:
            continue
        rr = sorted(by_list_rows[L["id"]])
        actual = [not x[2] for x in rr]                         # True = nonresident
        cf = sorted(rr, key=lambda x: (-(x[1] - RES_POINTS * x[2]), x[0]))  # remove the credit, keep list order for ties
        cfn = [not x[2] for x in cf]
        grid = sorted(set([int(round(L["n"] * (i / 60) ** 1.6)) for i in range(1, 61)] + [100, 250, 500, 1000, 2000, 5000]))
        grid = [g for g in grid if 1 <= g <= L["n"]]
        ca, cc = [0], [0]
        for i in range(L["n"]):
            ca.append(ca[-1] + actual[i])
            cc.append(cc[-1] + cfn[i])
        reach = None
        if L.get("c") and L["c"]["mx"]:
            reach = int(min(L["mx"], L["c"]["mx"]))
            # list positions are list numbers; convert the deepest certified list number to a row count
            reach = sum(1 for x in rr if x[0] <= L["c"]["mx"])
        pts = [[g, round(ca[g] / g, 4), round(cc[g] / g, 4)] for g in grid]
        at = {}
        for g in (500, 1000, 2000, 5000) + ((reach,) if reach else ()):
            if g and g <= L["n"]:
                at[str(g)] = [ca[g], cc[g]]
        cut = rr[999][1] if L["n"] >= 1000 else None
        res_curves.append({"id": L["id"], "t": L["t"], "ex": L["ex"], "n": L["n"], "est": iso(L["est"]),
                           "resShare": round(L["cr"][4] / L["n"], 4), "reach": reach, "pts": pts, "at": at,
                           "score1000": cut})

    ties_all.sort(reverse=True)
    ties = [{"id": lid, "n": n, "s": s} for n, s, lid in ties_all[:15]]

    credit_titles = defaultdict(lambda: [0, 0, 0, 0, 0, 0])   # n, vet, dvet, par, sib, res
    for L in lists.values():
        x = credit_titles[L["t"]]
        x[0] += L["n"]
        for i in range(5):
            x[i + 1] += L["cr"][i]

    tracked_codes = [tc for tc, _ in TRACKED]
    sets = {tc: set() for tc in tracked_codes}
    for k, tcs in key_titles.items():
        for tc in tcs:
            if tc in sets:
                sets[tc].add(k)
    overlap = {"titles": [[tc, lab, len(sets[tc])] for tc, lab in TRACKED],
               "m": [[(round(len(sets[a] & sets[b]) / len(sets[a]), 4) if sets[a] else None) for b in tracked_codes]
                     for a in tracked_codes]}
    multi = Counter(min(len(v), 10) for v in key_exams.values())
    police_exam_count = Counter()
    police_exams = {L["ex"] for L in lists.values() if L["tc"] == POLICE_TITLE}
    for k, exs in key_exams.items():
        n = len(exs & police_exams)
        if n:
            police_exam_count[min(n, 5)] += 1

    # ---------------------------------------------------------- 7. summary + output
    print("7/7 Summary")
    est_lists = [L for L in lists.values() if L["est"]]
    pend = [L for L in lists.values() if L["st"] == "pending"]
    for L in pend:
        L["wait"] = years(L["pub"], TODAY) * 12 if L["pub"] else None
    waits = [L["wait"] for L in pend if L["wait"] is not None]
    lagged = [(L["est"] - L["pub"]).days for L in est_lists if L["pub"] and L["est"] >= L["pub"]]
    longest_lag = max((L for L in est_lists if L["pub"] and L["est"] >= L["pub"]),
                      key=lambda L: (L["est"] - L["pub"]).days, default=None)
    ext_lists = [L for L in lists.values() if L["st"] == "ext"]
    oldest = min(est_lists, key=lambda L: (L["est"], -L["n"]))

    def depth_bucket(dp):
        if dp is None:
            return "nodata"
        if dp == 0:
            return "never"
        if dp < 0.25:
            return "lt25"
        if dp < 0.5:
            return "lt50"
        if dp < 0.9:
            return "lt90"
        return "full"

    buckets = defaultdict(lambda: {"lists": 0, "names": 0})
    age_grid = defaultdict(lambda: {"lists": 0, "names": 0})
    intens = []
    for L in est_lists:
        b = depth_bucket(L.get("dp"))
        L["db"] = b
        buckets[f"{L['k']}|{b}"]["lists"] += 1
        buckets[f"{L['k']}|{b}"]["names"] += L["n"]
        if L["k"] == "oc" and b != "nodata":
            age = years(L["est"], TODAY)
            ab = "0-1" if age < 1 else "1-2" if age < 2 else "2-3" if age < 3 else "3-4" if age < 4 else "4+"
            age_grid[f"{ab}|{b}"]["lists"] += 1
            age_grid[f"{ab}|{b}"]["names"] += L["n"]
            if L["c"] and L["n"] >= 100:
                intens.append(L["c"]["r"] / L["n"])

    oc_meas = [L for L in est_lists if L["k"] == "oc" and L["db"] != "nodata"]
    prov_in_oc = {tc for tc in prov_title if any(L["tc"].zfill(5) == tc and L["k"] == "oc" and L["est"]
                                                 for L in lists.values())}
    summary = {
        "asOf": as_of.isoformat(), "built": TODAY.isoformat(),
        "rows": len(rows), "lists": len(lists), "exams": len({L["ex"] for L in lists.values()}),
        "titles": len({L["tc"] for L in lists.values()}), "names": len(names_all), "namesMI": len(names_mi),
        "kinds": {k: {"lists": tot["lists_" + k], "rows": tot["rows_" + k]} for k in ("oc", "promo", "qie")},
        "status": {s: {"lists": sum(1 for L in lists.values() if L["st"] == s),
                       "rows": sum(L["n"] for L in lists.values() if L["st"] == s)}
                   for s in ("pending", "term", "ext", "past")},
        "oldest": {"id": oldest["id"], "t": oldest["t"], "est": iso(oldest["est"]), "ext": iso(oldest["ext"]),
                   "n": oldest["n"]},
        "longRun": sum(1 for L in ext_lists if years(L["est"], L["ext"]) >= 8),
        "extYears": dict(Counter(str(L["ext"].year) for L in ext_lists)),
        "pending": {"medMonths": r1(statistics.median(waits)) if waits else None,
                    "over12": sum(1 for w in waits if w > 12),
                    "over12rows": sum(L["n"] for L in pend if L["wait"] and L["wait"] > 12),
                    "longest": max(({"id": L["id"], "t": L["t"], "pub": iso(L["pub"]), "n": L["n"]} for L in pend
                                    if L["pub"]), key=lambda x: (TODAY - isod(x["pub"])).days, default=None)},
        "lag": {"n": len(lagged), "med": statistics.median(lagged) if lagged else None,
                "longest": {"id": longest_lag["id"], "t": longest_lag["t"], "pub": iso(longest_lag["pub"]),
                            "est": iso(longest_lag["est"])} if longest_lag else None},
        "depth": {k: v for k, v in buckets.items()}, "depthAge": {k: v for k, v in age_grid.items()},
        "ocMeasured": {"lists": len(oc_meas), "rows": sum(L["n"] for L in oc_meas),
                       "full": sum(1 for L in oc_meas if L["db"] == "full"),
                       "fullRows": sum(L["n"] for L in oc_meas if L["db"] == "full")},
        "certPerName": {"median": r1(statistics.median(intens)) if intens else None},
        "police": {"lists": sum(1 for L in lists.values() if L["tc"] == POLICE_TITLE),
                   "rows": sum(L["n"] for L in lists.values() if L["tc"] == POLICE_TITLE),
                   "lastCert": iso(police_last),
                   "estYears": sorted({L["est"].year for L in lists.values() if L["tc"] == POLICE_TITLE and L["est"]}
                                      | {e["est"].year for e in ended if e["tc"] == POLICE_TITLE})},
        "scores": {"bins": SCORE_LABELS, "hist": hist_by_kind, "eq100": sum(L["h"][7] for L in lists.values()),
                   "over100": sum(sum(L["h"][8:]) for L in lists.values()), "unflagged": unflagged,
                   "resPoints": RES_POINTS, "resMaxOnly": res_check["max"], "resLow": res_check["low"]},
        "credits": {"vet": sum(L["cr"][0] for L in lists.values()), "dvet": sum(L["cr"][1] for L in lists.values()),
                    "par": sum(L["cr"][2] for L in lists.values()), "sib": sum(L["cr"][3] for L in lists.values()),
                    "res": sum(L["cr"][4] for L in lists.values()), "legacyNames": len(legacy_keys),
                    "legacyBoth": tot["legacy_both"],
                    "resTitles": sorted({L["t"] for L in lists.values() if L["cr"][4] >= 50})},
        "inserted": {"rows": sum(L["ins"] for L in lists.values()),
                     "top": [{"id": L["id"], "t": L["t"], "ins": L["ins"], "n": L["n"]}
                             for L in sorted(lists.values(), key=lambda x: -x["ins"])[:5]]},
        "prov": {"date": latest_prov, "tot": prov_trend[-1]["tot"], "y2": prov_trend[-1]["y2"],
                 "inOC": sum(prov_title[tc]["tot"] for tc in prov_in_oc),
                 "inOCy2": sum(prov_title[tc]["y2"] for tc in prov_in_oc),
                 "nullRows": int(float(prov_null.get("n") or 0)), "nullTotal": int(float(prov_null.get("t") or 0)),
                 "first": prov_trend[0]["d"]},
        "certFlow": {"certs": len(certs), "medRatio": r1(statistics.median(all_ratios)) if all_ratios else None,
                     "medLag": statistics.median(all_lags) if all_lags else None,
                     "first": min(isod(c["cd"]) for c in certs if c.get("cd")).isoformat()},
        "multi": {str(k): v for k, v in sorted(multi.items())},
        "policeRepeat": {str(k): v for k, v in sorted(police_exam_count.items())},
        "ended": {"lists": len(ended), "names": sum(e["n"] for e in ended), "firstTerm": iso(first_term),
                  "past4": sum(1 for e in ended if e["life"] > 4.02)},
        "civilYear": cy, "schedAsOf": sched_asof, "upcomingExams": n_upcoming,
    }

    # ---- profiles for the title and agency search
    tnames = {}
    for e in ended:
        tnames[e["tc"].zfill(5)] = e["t"]
    for tc, x in prov_title.items():
        tnames.setdefault(tc, x["t"])
    for L in lists.values():
        tnames[L["tc"].zfill(5)] = L["t"]
    titles_out = {}
    for tc, nm in tnames.items():
        ti = tinfo.get(tc, {})
        pt = prov_title.get(tc)
        titles_out[tc] = {
            "t": nm, "emp": emp.get(tc), "lo": ti.get("lo"), "hi": ti.get("hi"), "u": ti.get("u"), "bu": ti.get("bu"),
            "inv": ti.get("inv"),
            "prov": [pt["tot"], pt["y2"]] if pt else None,
            "provAg": sorted(([ac, v[0], v[1]] for (t2, ac), v in prov_title_agency.items() if t2 == tc),
                             key=lambda z: -z[1]),
            "empAg": sorted(emp_ag_title.get(tc, []), key=lambda z: -z[1])[:15],
            "next": sorted(upcoming.get(tc, []), key=lambda x: x["s"])[:6],
            "flow": [[y] + v for y, v in sorted(flow_tc.get(tc, {}).items())],
        }

    ag_codes = ({L["ac"] for L in lists.values() if L["k"] == "promo"}
                | {d[0] for L in lists.values() for d in L.get("dr", [])}
                | set(prov_ag_trend) | set(flow_ag))
    agencies_out = {}
    for ac in ag_codes:
        if not ac.strip("0"):
            continue
        names = agency_names.get(ac)
        pts = sorted(prov_ag_trend.get(ac, []))
        latest = [x for x in pts if x[0] == latest_prov]
        agencies_out[ac] = {
            # sources cut agency names at different lengths; the longest spelling is the least truncated
            "nm": max(names, key=lambda n: (len(n), names[n])) if names else f"Agency {ac}",
            "emp": emp_ag.get(ac),
            "prov": latest[0][1:] if latest else None,
            "provTitles": sorted(([tc, tnames.get(tc, prov_title[tc]["t"]), v[0], v[1]]
                                  for (tc, a2), v in prov_title_agency.items() if a2 == ac), key=lambda z: -z[2]),
            "provTrend": pts,
            "flow": [[y] + v for y, v in sorted(flow_ag.get(ac, {}).items())],
        }
    check(len(agencies_out) > 40, f"only {len(agencies_out)} agencies")

    prov_table = []
    for tc, x in prov_title.items():
        oc_lists = [L for L in lists.values() if L["tc"].zfill(5) == tc and L["k"] == "oc" and L["est"]]
        prov_table.append({"tc": tc, "t": x["t"], "tot": x["tot"], "y2": x["y2"], "ag": len(x["ag"]),
                           "lists": len(oc_lists), "names": sum(L["n"] for L in oc_lists),
                           "dp": max((L["dp"] for L in oc_lists if L.get("dp") is not None), default=None)})
    prov_table.sort(key=lambda x: -x["tot"])

    def pack(L):
        o = {k: L[k] for k in ("id", "ex", "t", "tc", "ag", "ac", "g", "k", "n", "mx", "ins", "st", "sc", "h", "tie", "cr")}
        for k in ("pub", "est", "ann", "ext"):
            o[k] = iso(L[k])
        o["dp"] = L.get("dp")
        o["cn"] = L.get("cn")
        o["rc"] = L.get("rc")
        if L.get("fr"):
            o["fr"] = L["fr"]
        if L.get("c"):
            c = L["c"]
            o["c"] = [c["n"], c["mx"], c["r"], iso(c["f"]), iso(c["l"])]
        if L.get("dr"):
            o["dr"] = L["dr"]
        return o

    out_lists = sorted((pack(L) for L in lists.values()), key=lambda x: -x["n"])
    history = {"years": term_years, "pools": pools,
               "ended": [[e["ex"], e["t"], e["k"], e["n"], iso(e["est"]), iso(e["term"]), round(e["life"], 3),
                          1 if e["ext"] else 0, e["tc"].zfill(5), e["ac"]] for e in sorted(ended, key=lambda e: e["term"])]}

    os.makedirs(OUT, exist_ok=True)
    write("summary.json", summary)
    write("lists.json", {"lists": out_lists})
    write("titles.json", titles_out)
    write("agencies.json", agencies_out)
    write("history.json", history)
    write("scores.json", {"residency": res_curves, "ties": ties,
                          "creditTitles": sorted(([t] + v for t, v in credit_titles.items() if v[0] >= 300),
                                                 key=lambda x: -x[1])})
    write("overlap.json", overlap)
    write("provisionals.json", {"trend": prov_trend, "titles": prov_table[:400]})
    write("certs.json", {"years": cert_years,
                         "ratioHist": Counter(("1" if x <= 1 else "2" if x <= 2 else "3" if x <= 3 else "5" if x <= 5
                                               else "10" if x <= 10 else "25" if x <= 25 else "50" if x <= 50
                                               else "more") for x in all_ratios)})

    # daily snapshot: the source keeps no history, so keep a running log of the headline counts
    dpath = os.path.join(OUT, "daily.json")
    daily = json.load(open(dpath)) if os.path.exists(dpath) else []
    snap = {"d": as_of.isoformat(), "rows": len(rows), "lists": len(lists),
            "pending": summary["status"]["pending"]["lists"], "ext": summary["status"]["ext"]["lists"],
            "extRows": summary["status"]["ext"]["rows"], "ocFull": summary["ocMeasured"]["full"],
            "ocMeasured": summary["ocMeasured"]["lists"], "prov": summary["prov"]["tot"]}
    daily = [d for d in daily if d["d"] != snap["d"]] + [snap]
    write("daily.json", daily)
    print(f"Done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    try:
        build()
    except BuildError as e:
        print(f"BUILD FAILED: {e}", file=sys.stderr)
        sys.exit(2)
