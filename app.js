/* New York City's civil service lists — page logic.
   Reads the JSON that build.py writes into data/ and draws every chart as SVG or HTML.
   Colours come from house.css tokens so nothing is hard-coded. */
(function () {
'use strict';

/* ------------------------------------------------------------ utilities */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const NS = 'http://www.w3.org/2000/svg';
const css = getComputedStyle(document.documentElement);
const tok = n => css.getPropertyValue('--' + n).trim();
const INK = {};
['cobalt', 'vermilion', 'sun', 'mint', 'rose', 'cyan', 'orange', 'lilac', 'fg', 'fg2', 'line', 'line2', 'bg', 'bg2', 'grid'].forEach(k => INK[k] = tok(k));
const KIND = {
  oc: {label: 'Open competitive', ink: 'cobalt'},
  promo: {label: 'Promotional', ink: 'lilac'},
  qie: {label: 'Qualified incumbent', ink: 'mint'}
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = n => n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US');
const fmt1 = n => n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString('en-US');
const pct = (x, d) => x == null ? '—' : (x * 100).toFixed(d || 0) + '%';
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const spell = n => (n >= 0 && n < 10 && n % 1 === 0) ? SMALL[n] : fmt(n);
const MON = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const MONF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : (many || one + 's')}`;
const pd = s => s ? new Date(s + 'T12:00:00') : null;
const apDate = s => { const d = pd(s); return d ? `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : '—'; };
const apMonth = s => { const d = pd(s); return d ? `${MONF[d.getMonth()]} ${d.getFullYear()}` : '—'; };   // AP: month alone with a year is spelled out
const apMonS = s => { const d = pd(s); return d ? `${MON[d.getMonth()]} ${d.getFullYear()}` : '—'; };     // short form for table cells
const TODAY = new Date();
const yearsBetween = (a, b) => (b - a) / (365.25 * 864e5);
const money = n => n == null ? null : '$' + Math.round(n).toLocaleString('en-US');
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

const ACR = new Set(['EMT', 'EMS', 'IT', 'LAN', 'WAN', 'DC', 'DOT', 'CUNY', 'HVAC', 'NYPD', 'FDNY', 'NYCHA', 'HRA', 'DOE', 'DEP',
  'DSNY', 'ACS', 'DOC', 'DCAS', 'DOB', 'HPD', 'DHS', 'DSS', 'OATH', 'TLC', 'EEO', 'GIS', 'HR', 'MIS', 'II', 'III', 'IV', 'VI',
  'VII', 'VIII', 'CCRB', 'DOHMH', 'DOI', 'DYCD', 'SBS', 'DCP', 'DORIS', 'MTA', 'TBTA', 'LPN', 'RN', 'EKG', 'MRI', 'HAZMAT', 'WTC',
  'DA', 'DMV', 'CPA', 'PC', 'MA', 'NYC', 'ADA', 'CDL', 'OTI', 'DOITT', 'DFTA', 'CFB', 'BIC', 'ECTP', 'DOF', 'DDC', 'OMB', 'OEM',
  'DCWP', 'DCLA', 'CSC', 'EEPC', 'FISA', 'IBO', 'DVS', 'NYCERS', 'TRS', 'OCME', 'HHC', 'H+H', 'SCA', 'LAN/WAN',
  'PSE', 'SSA', 'TEA', 'IBT', 'SEIU', 'CWA', 'UFA', 'PBA', 'DC37', 'AFSCME', 'TWU', 'OSA', 'CSA', 'UFT', 'COBA', 'LBA', 'SBA', 'CEA', 'USA', 'NYSNA', 'PEF', 'ATU', 'IUOE', 'IBEW', 'UFOA', 'DEA', 'CIR']);
const SMALLW = new Set(['of', 'and', 'for', 'the', 'on', 'to', 'in', 'at', 'a', 'an', 'or', 'by', 'with']);

/* Job titles in sentence case, keeping acronyms and Roman numerals. */
function sc(s) {
  if (!s) return '';
  let t = s.replace(/N\.Y\.C\./g, 'NYC').toLowerCase();
  t = t.replace(/[a-z0-9+.'/]+/gi, w => {
    const up = w.toUpperCase();
    if (ACR.has(up) || ACR.has(up.replace(/[.']/g, ''))) return up;
    return w;
  });
  t = t.replace(/\bnyc\b/gi, 'New York City');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
/* Agency names in title case, with the city's abbreviations spelled out. */
function agName(raw) {
  if (!raw) return '';
  let s = raw.trim().replace(/N\.Y\.C\./g, 'New York City').replace(/\bNYC\b/g, 'New York City')
    .replace(/^HRA\//, 'Human Resources Administration/').replace(/&/g, 'and').replace(/\bDEPT\b/g, 'Department');
  let i = 0;
  s = s.toLowerCase().replace(/[a-z0-9'.+-]+/gi, w => {
    const up = w.toUpperCase(); i++;
    if (ACR.has(up) && up !== 'MA' && up !== 'PC' && up !== 'DA') return up;
    if (i > 1 && SMALLW.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
  return s.replace(/New York City/gi, 'New York City').replace(/\bNew York City Transit Authority\b/, 'New York City Transit');
}
const coverage = L => L.c ? Math.min(1, L.c[0] / L.n) : 0;   // share of the list's names ever sent
const kindLabel = L => L.k === 'promo' ? 'Promotional, ' + agName(L.ag) : KIND[L.k].label;

function svg(w, h) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('width', w); s.setAttribute('height', h); s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  return s;
}
function sv(parent, tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}
const lin = (d0, d1, r0, r1) => v => r0 + (v - d0) / ((d1 - d0) || 1) * (r1 - r0);
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function ticks(max, n) {
  const step = niceMax(max / (n || 4));
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}
const short = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(Math.round(n));

/* ------------------------------------------------------------ data */
const D = {};
const files = ['summary', 'lists', 'titles', 'agencies', 'history', 'scores', 'overlap', 'provisionals', 'certs', 'daily'];
Promise.all(files.map(f => fetch('data/' + f + '.json', {cache: 'no-cache'}).then(r => {
  if (!r.ok) throw new Error(f + '.json: HTTP ' + r.status);
  return r.json();
}))).then(res => {
  files.forEach((f, i) => D[f] = res[i]);
  D.L = D.lists.lists;
  D.byId = {};
  D.L.forEach(L => { D.byId[L.id] = L; L.estD = pd(L.est); });
  D.S = D.summary;
  init();
}).catch(err => {
  $('#asof').innerHTML = '<span class="err">The data didn\'t load: ' + esc(err.message) + '</span>';
  console.error(err);
});

/* ------------------------------------------------------------ init */
function init() {
  const S = D.S;
  $('#asof').textContent = `Data as of ${apDate(S.asOf)}. Rebuilt daily.`;
  writeOpening();
  writeTime();
  drawAll();
  buildSearch();
  writeHow();
  writeDepth();
  writeAge();
  writePools();
  writeScores();
  writeProv();
  writeFlow();
  writeWho();
  buildAllTable();
  writeLimits();
  writeFoot();
  window.addEventListener('resize', debounce(drawAll, 150));
  window.addEventListener('hashchange', route);
  $$('[data-close]').forEach(b => b.addEventListener('click', closeDrawer));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  route();
  const h = location.hash.slice(1);
  if (h && !h.includes('=')) { const t = document.getElementById(h); if (t) setTimeout(() => t.scrollIntoView(), 60); }
}

function drawAll() {
  drawPaceMain();
  drawDepthBars();
  drawGantt();
  drawPastFour();
  drawLifespan();
  drawPools();
  drawScoreHist();
  drawResidency();
  drawProvTrend();
  drawFlow();
  if (D.profile) D.profile();
}

/* ------------------------------------------------------------ opening */
/* Each name on a list counts as "sent" if its list number appears on at least one certification
   (a batch of names the city sent an agency with openings). Capped at the list's size. */
const sentCount = L => L.c ? Math.min(L.c[0], L.n) : 0;
function standing() {
  const t = {sent: 0, not: 0, pol: 0, pend: 0, polLists: 0, pendLists: 0};
  D.L.forEach(L => {
    if (L.st === 'pending') { t.pend += L.n; t.pendLists++; }
    else if (L.cn === 'police') { t.pol += L.n; t.polLists++; }
    else { const x = sentCount(L); t.sent += x; t.not += L.n - x; }
  });
  t.total = t.sent + t.not + t.pol + t.pend;
  return t;
}
function writeOpening() {
  const S = D.S, t = standing();
  $('#finding').textContent = `The city has sent ${fmt(t.sent)} of the ${fmt(t.total)} names on its civil service lists to an agency with job openings at least once.`;
  const k = S.kinds;
  $('#lede').innerHTML =
    `The Department of Citywide Administrative Services publishes every list of people who passed a city civil service exam: ` +
    `<b>${fmt(S.rows)}</b> names on <b>${fmt(S.lists)}</b> lists, from ${fmt(S.exams)} exams for ${fmt(S.titles)} job titles. ` +
    `A person on two lists is counted twice; there are about ${fmt(Math.round(S.names / 1000) * 1000)} different names in all. ` +
    `${fmt(k.oc.lists)} lists are open to the public; ${fmt(k.promo.lists)} are promotional lists, open only to one agency's employees; ` +
    `${spell(k.qie.lists)} are qualifying lists for people already doing the job temporarily. People stay on a list after they are hired, ` +
    `turn down a job or are dropped, and the data doesn't say which happened to whom.`;
  $('#openAside').innerHTML = `<p class="aside"><b>How the city hires from a list.</b> When an agency has openings in a job title, the city sends it a batch of names from the list for that title, starting at the top and going down in rank order. The agency must hire from the people in that batch: for each opening, it picks one of the three highest-ranked people who want the job. The city publishes a record of every batch and every name on it.</p>
    <p class="aside"><b>What this bar shows.</b> All ${fmt(t.total)} names on the lists, sorted into four groups by one question: has this name ever been in a batch sent to an agency?</p>`;
  const seg = [
    ['s-reach', 'Sent to an agency at least once', t.sent, 'Their name has been in at least one batch sent to an agency with openings, so they could be considered for a job. Being sent is not being hired; the data doesn\'t record who was hired.'],
    ['s-not', 'Never sent to an agency', t.not, 'They are on a list agencies can hire from, but their name hasn\'t been in any batch yet. Most are lower on their list than the city has gone so far.'],
    ['s-pol', 'Police officer lists: unknown', t.pol, `The city's records of batches sent for police officer stop on ${apDate(S.police.lastCert)}, so there is no way to tell for these ${spell(t.polLists)} lists.`],
    ['s-pend', 'Lists not open for hiring yet', t.pend, `These ${fmt(t.pendLists)} lists have been published but haven't taken effect, so no agency can hire from them yet.`],
  ];
  $('#stand').setAttribute('aria-label', seg.map(x => `${x[1]}: ${fmt(x[2])}`).join('; '));
  $('#stand').innerHTML = seg.map(x => `<div class="${x[0]}" style="flex:${x[2]} 1 0" data-t="${esc(x[1])}" data-n="${x[2]}" data-d="${esc(x[3])}"></div>`).join('');
  const sw = {'s-reach': `background:${INK.sun}`, 's-not': `box-shadow:inset 0 0 0 1.5px ${INK.fg2}`, 's-pol': `background:${INK.fg2};opacity:.55`, 's-pend': `background:${INK.orange};opacity:.7`};
  $('#standKey').innerHTML = seg.map(x => `<div><span class="lbl"><i class="sw" style="${sw[x[0]]}"></i>${x[1]}</span><b>${fmt(x[2])} names</b><span>${pct(x[2] / t.total)} of all names. ${x[3]}</span></div>`).join('');
  $$('#stand > div').forEach(d => {
    const show = () => { $('#standOut').innerHTML = `<b>${d.dataset.t}</b>: ${fmt(+d.dataset.n)} names, ${pct(+d.dataset.n / t.total)} of all names.`; };
    d.addEventListener('pointerenter', show); d.addEventListener('click', show);
  });
  // the lists holding the names never sent
  const un = D.L.filter(L => L.st !== 'pending' && L.cn !== 'police' && L.n - sentCount(L) > 0).sort((a, b) => (b.n - sentCount(b)) - (a.n - sentCount(a)));
  const top = un.slice(0, 8), rest = un.slice(8);
  const two = top.slice(0, 2), twoN = two.reduce((a, L) => a + L.n - sentCount(L), 0);
  $('#unreachedTitle').textContent = `Which lists hold the ${fmt(t.not)} names never sent to an agency`;
  $('#unreachedAside').innerHTML = `Each bar is one list, all drawn to the same scale. The outlined bar is everyone on the list; the yellow part is the people whose names have been sent to an agency at least once. ` +
    `${fmt(twoN)} of the ${fmt(t.not)} names never sent, ${pct(twoN / t.not)}, are on two lists: ${two.map(L => `${esc(sc(L.t).toLowerCase())} (in use since ${apMonth(L.est)})`).join(' and ')}.`;
  const rows = top.map(L => ({label: `${sc(L.t)} list from ${L.est.slice(0, 4)}${L.k === 'promo' ? ', promotional' : ''}`, title: L.tc.padStart(5, '0'),
    v: L.n, fill: sentCount(L), ink: 'sun', val: `${fmt(L.n - sentCount(L))} never sent <small>of ${fmt(L.n)} on the list</small>`}));
  const restN = rest.reduce((a, L) => a + L.n - sentCount(L), 0);
  $('#unreached').innerHTML = barRows(rows, {max: Math.max(...rows.map(r => r.v))}) +
    (rest.length ? `<p class="note" style="margin-top:8px">The other ${fmt(rest.length)} lists hold the remaining ${fmt(restN)} names never sent, ${fmt(rest[0].n - sentCount(rest[0]))} or fewer on each.</p>` : '');
  wireLists($('#unreached'));
  $('#policeNote').innerHTML = `How the counts are made: a name counts as sent if its rank number on its list appears in at least one batch in the city's certification records. Records for police officer stop on ${apDate(S.police.lastCert)}, which is why those ${spell(S.police.lists)} lists (${fmt(S.police.rows)} names) are shown as unknown. The <a href="methodology.html">methodology</a> has the details.`;
}

/* ------------------------------------------------------------ time on the list */
const monthIdx = d => d.getFullYear() * 12 + d.getMonth();
const monthsOn = iso => monthIdx(TODAY) - monthIdx(pd(iso));       // calendar months since a date (chart axis)
const monthsSince = iso => Math.floor((TODAY - pd(iso)) / (30.4375 * 864e5));   // completed months, for durations in words
const rank = n => n % 1 ? n.toLocaleString('en-US', {maximumFractionDigits: 1}) : fmt(n);
function dur(m) {
  const y = Math.floor(m / 12), r = m % 12;
  const ys = y ? `${spell(y)} year${y > 1 ? 's' : ''}` : '', ms = r ? `${spell(r)} month${r > 1 ? 's' : ''}` : '';
  return ys && ms ? `${ys}, ${ms}` : (ys || ms || 'less than a month');
}
const monthName = (est, off) => { const d = pd(est); const t = new Date(d.getFullYear(), d.getMonth() + off, 15); return `${MONF[t.getMonth()]} ${t.getFullYear()}`; };
const TB = [[0, 1, 'Under 1 year'], [1, 2, '1 to 2 years'], [2, 3, '2 to 3 years'], [3, 4, '3 to 4 years'], [4, 6, '4 to 6 years'], [6, 99, 'More than 6 years']];
function writeTime() {
  const S = D.S, t = standing();
  const rows = TB.map(b => ({b, sent: 0, not: 0, pol: 0, lists: []}));
  D.L.forEach(L => {
    if (L.st === 'pending') return;
    const y = yearsBetween(pd(L.est), TODAY), r = rows.find(x => y >= x.b[0] && y < x.b[1]);
    if (L.cn === 'police') r.pol += L.n; else { const x = sentCount(L); r.sent += x; r.not += L.n - x; }
    r.lists.push(L);
  });
  const max = Math.max(...rows.map(r => r.sent + r.not + r.pol));
  $('#timeAside').innerHTML = `<p class="aside">Everyone on a list was put on it the day the list took effect, so the time a name has been on a list is the time since that list took effect. (A few people were added later; the data doesn't say when.) Each bar below is the names on lists that took effect that long ago, colored the same way as the chart above: <span style="color:${INK.sun}">yellow</span> for names sent to an agency at least once, outlined for names never sent, gray for police officer lists, whose status is unknown.</p>`;
  $('#timeBars').innerHTML = rows.map((r, i) => {
    const tot = r.sent + r.not + r.pol, w = v => (v / max * 100).toFixed(2) + '%';
    return `<div class="tr" data-i="${i}"><div class="tl">${r.b[2]}</div><div class="tt">
      <div style="width:${w(r.sent)};background:${INK.sun}" title="Sent at least once: ${fmt(r.sent)}"></div>
      <div style="width:${w(r.not)};box-shadow:inset 0 0 0 1.5px ${INK.fg2}" title="Never sent: ${fmt(r.not)}"></div>
      <div style="width:${w(r.pol)};background:${INK.fg2};opacity:.55" title="Police officer lists: ${fmt(r.pol)}"></div></div>
      <div class="tv">${fmt(tot)} <small>names</small></div></div>`;
  }).join('');
  $$('#timeBars .tr').forEach(el => {
    const r = rows[+el.dataset.i];
    const show = () => { $('#timeOut').innerHTML = `<b>Lists in use for ${r.b[2].toLowerCase()}</b> (${fmt(r.lists.length)} lists): ${fmt(r.sent)} names sent to an agency at least once, ${fmt(r.not)} never sent${r.pol ? `, ${fmt(r.pol)} on police officer lists (unknown)` : ''}.`; };
    el.addEventListener('pointerenter', show); el.addEventListener('click', show);
  });
  // sentences
  const notOld = D.L.filter(L => L.st !== 'pending' && L.cn !== 'police' && yearsBetween(pd(L.est), TODAY) >= 2);
  const notOldN = notOld.reduce((a, L) => a + L.n - sentCount(L), 0);
  const newN = rows[0].not;
  const big = notOld.slice().sort((a, b) => (b.n - sentCount(b)) - (a.n - sentCount(a)))[0];
  const six = rows[5], sixN = six.sent + six.not + six.pol;
  const sixTop = six.lists.slice().sort((a, b) => b.n - a.n).slice(0, 3);
  $('#timeText').innerHTML = `
    <p>Of the ${fmt(t.not)} names never sent to an agency, <b>${fmt(newN)}</b> are on lists that took effect less than a year ago. <b>${fmt(notOldN)}</b> have been on their list for more than two years without being sent${big ? `, and ${fmt(big.n - sentCount(big))} of those are on one list: ${esc(sc(big.t).toLowerCase())}, in use since ${apDate(big.est)}` : ''}.</p>
    <p>${fmt(sixN)} names have been on their list for more than six years, on ${spell(six.lists.length)} lists; the largest are ${sixTop.map(L => `${esc(sc(L.t).toLowerCase())} (${fmt(L.n)} names, since ${apMonth(L.est)})`).join(', ')}. The city has sent ${six.not && six.not < 1000 ? `all but ${fmt(six.not)}` : pct(six.sent / Math.max(1, six.sent + six.not))} of them at least once. Those lists are still in use because they were extended past four years.</p>
    <p class="note">Not shown: ${fmt(t.pend)} names on ${fmt(t.pendLists)} lists that have been published but haven't taken effect, so no agency can hire from them yet. Those lists were published a median of ${fmt1(S.pending.medMonths)} months ago.</p>`;
  // one list, month by month
  $('#paceAside').innerHTML = `<p class="aside">Pick a list. The tall outlined box is the whole list, with No. 1 at the top and the last name at the bottom. Moving right is time passing, from the day the list took effect to today. The <span style="color:${INK.sun}">yellow</span> area shows how far down the list the city had sent names by each month. Anyone below the yellow at the right edge has been waiting the full width of the chart.</p>`;
  const opts = D.L.filter(L => L.fr && L.n >= 300).sort((a, b) => b.n - a.n);
  const sel = $('#pacePick');
  sel.innerHTML = opts.map(L => `<option value="${esc(L.id)}">${esc(sc(L.t))}, ${L.k === 'promo' ? 'promotional, ' : ''}in use since ${apMonth(L.est)} (${fmt(L.n)} names)</option>`).join('');
  const def = opts.find(L => L.id === '2060-000-000') || opts[0];
  if (def) sel.value = def.id;
  sel.addEventListener('change', drawPaceMain);
}
function drawPaceMain() {
  const L = D.byId[$('#pacePick').value];
  if (!L) return;
  drawPace($('#pace'), L, $('#paceOut'), 300);
  $('#paceText').innerHTML = `<p>${paceSentence(L)}</p><p class="note">A batch can skip people, so someone ranked above the yellow line may not have been sent yet. The month-by-month line comes from the city's records of batches sent since January 2018.</p>`;
}
function paceSentence(L) {
  const fr = L.fr || [], now = monthsOn(L.est);
  if (!fr.length) return `The city hasn't sent any names from this list. It has been in use for ${dur(monthsSince(L.est))}.`;
  const f = fr[0], last = fr[fr.length - 1];
  let out = `This list took effect in ${apMonth(L.est)}. The city first sent names from it in ${monthName(L.est, f[0])}${f[0] ? `, ${dur(f[0])} later,` : ','} going down to No. ${rank(f[1])}.`;
  if (fr.length > 1) out += ` It went furthest in ${monthName(L.est, last[0])}, ${dur(last[0])} after the list took effect, down to No. ${rank(last[1])}.`;
  // the longest stretch with no deeper batch
  let gap = 0, gapAt = null;
  for (let i = 0; i < fr.length; i++) {
    const nx = i + 1 < fr.length ? fr[i + 1][0] : now;
    if (nx - fr[i][0] > gap) { gap = nx - fr[i][0]; gapAt = i; }
  }
  if (gap >= 6 && gapAt != null && gapAt < fr.length - 1) out += ` Between ${monthName(L.est, fr[gapAt][0])} and ${monthName(L.est, fr[gapAt + 1][0])}, ${dur(gap)}, no batch went deeper than No. ${rank(fr[gapAt][1])}.`;
  if (last[1] >= L.mx - 0.5) out += ` That is the bottom of the list.`;
  else if (L.rc != null) out += ` The ${fmt(L.n - L.rc)} people ranked below No. ${rank(last[1])} have been on the list for ${dur(monthsSince(L.est))} without the city sending names that far down.`;
  return out;
}
function drawPace(box, L, out, h) {
  const fr = L.fr || [];
  const W = box.clientWidth || 600, H = h || 280;
  const narrow = W < 520;
  const m = {l: narrow ? 64 : 78, r: 10, t: 10, b: 40};
  const s = svg(W, H);
  const now = Math.max(1, monthsOn(L.est));
  const X = lin(0, now, m.l, W - m.r), Y = lin(1, Math.max(2, L.mx), m.t, H - m.b);
  // the whole list
  sv(s, 'rect', {x: X(0), y: Y(1), width: X(now) - X(0), height: Y(L.mx) - Y(1), fill: 'none', stroke: INK.fg2, 'stroke-width': 1.5});
  fr.forEach((p, i) => {
    const x0 = X(p[0]), x1 = X(i + 1 < fr.length ? fr[i + 1][0] : now);
    sv(s, 'rect', {x: x0, y: Y(1), width: Math.max(1, x1 - x0), height: Math.max(1, Y(Math.min(p[1], L.mx)) - Y(1)), fill: INK.sun, 'fill-opacity': .9});
  });
  // rank labels
  sv(s, 'text', {x: m.l - 8, y: Y(1) + 10, 'text-anchor': 'end'}, 'No. 1');
  sv(s, 'text', {x: m.l - 8, y: Y(L.mx), 'text-anchor': 'end'}, 'No. ' + fmt(L.mx));
  sv(s, 'text', {x: m.l - 8, y: (Y(1) + Y(L.mx)) / 2 + 4, 'text-anchor': 'end'}, 'Halfway');
  // say in words what the two areas are
  const last = fr.length ? fr[fr.length - 1] : null;
  const reach = last ? Math.min(last[1], L.mx) : 0;
  if (last) sv(s, 'text', {x: X(now) - 8, y: Math.min(Y(reach) + 16, H - m.b - 6), 'text-anchor': 'end', class: 'lab'},
    reach >= L.mx - 0.5 ? 'Sent all the way to the bottom' : `Sent so far: down to No. ${rank(reach)}`);
  if (L.rc != null && L.n - L.rc > 0 && Y(L.mx) - Y(reach) > 60)
    sv(s, 'text', {x: (X(0) + X(now)) / 2, y: (Y(reach) + Y(L.mx)) / 2 + 4, 'text-anchor': 'middle', class: 'lab'},
      narrow ? `Not sent yet: ${fmt(L.n - L.rc)} people` : `Not sent yet: the ${fmt(L.n - L.rc)} people ranked below No. ${rank(reach)}`);
  // time axis: years since the list took effect
  const step = narrow ? (now > 48 ? 24 : 12) : (now > 48 ? 12 : 6);
  for (let mo = 0; mo <= now; mo += step) {
    sv(s, 'line', {x1: X(mo), x2: X(mo), y1: H - m.b, y2: H - m.b + 5, stroke: INK.line});
    sv(s, 'text', {x: X(mo), y: H - m.b + 18, 'text-anchor': mo === 0 ? 'start' : 'middle'}, mo === 0 ? apMonS(L.est) : (mo % 12 ? `${mo} mo.` : `${mo / 12} yr${mo > 12 ? 's' : ''}`));
  }
  sv(s, 'text', {x: X(now), y: H - m.b + 32, 'text-anchor': 'end', class: 'lab'}, 'Today');
  const vl = sv(s, 'line', {y1: m.t, y2: H - m.b, stroke: INK.fg, 'stroke-width': 1, opacity: 0});
  const move = ev => {
    const rect = s.getBoundingClientRect();
    const mx = (ev.clientX - rect.left) * (W / rect.width);
    const mo = Math.max(0, Math.min(now, Math.round((mx - m.l) / (W - m.l - m.r) * now)));
    let rk = 0;
    fr.forEach(p => { if (p[0] <= mo) rk = p[1]; });
    vl.setAttribute('x1', X(mo)); vl.setAttribute('x2', X(mo)); vl.setAttribute('opacity', .8);
    out.innerHTML = rk ? `By <b>${monthName(L.est, mo)}</b>, ${dur(mo)} after the list took effect, the city had sent names down to <b>No. ${rank(rk)}</b>, ${pct(Math.min(1, rk / L.mx))} of the way down.`
      : `By <b>${monthName(L.est, mo)}</b>, ${dur(mo)} after the list took effect, the city had not sent any names from it.`;
  };
  s.addEventListener('pointermove', move); s.addEventListener('click', move);
  box.replaceChildren(s);
  out.innerHTML = 'Hover or tap the chart to read any month.';
}

function depthText(L) {
  if (L.st === 'pending') return 'not in use yet';
  if (L.cn === 'police') return 'no certification data for this title since ' + apMonth(D.S.police.lastCert);
  if (!L.c) return 'no names sent to agencies yet';
  if (L.dp >= 0.999) return `sent to agencies down to the last name (No. ${fmt(L.c[1])})`;
  return `sent to agencies down to No. ${fmt(L.c[1])} of ${fmt(L.mx)} (${pct(L.dp)})`;
}
/* ------------------------------------------------------------ search and profiles */
const ALIASES = {
  nypd: 'POLICE DEPARTMENT', police: 'POLICE DEPARTMENT', fdny: 'FIRE DEPARTMENT', fire: 'FIRE DEPARTMENT',
  dsny: 'DEPARTMENT OF SANITATION', sanitation: 'DEPARTMENT OF SANITATION', hra: 'SOCIAL SERVICES', dss: 'SOCIAL SERVICES',
  nycha: 'HOUSING AUTHORITY', doe: 'DEPARTMENT OF EDUCATION', dot: 'DEPARTMENT OF TRANSPORTATION', dep: 'ENVIRONMENTAL PROTECTION',
  acs: "CHILDREN'S SERVICES", doc: 'DEPARTMENT OF CORRECTION', correction: 'DEPARTMENT OF CORRECTION', dohmh: 'HEALTH AND MENTAL',
  health: 'HEALTH AND MENTAL', hpd: 'HOUSING PRESERVATION', dob: 'DEPARTMENT OF BUILDINGS', dcas: 'CITYWIDE ADMINISTRATIVE',
  dhs: 'HOMELESS SERVICES', mta: 'TRANSIT AUTHORITY', transit: 'TRANSIT AUTHORITY', subway: 'TRANSIT AUTHORITY', nyct: 'TRANSIT AUTHORITY',
  parks: 'PARKS', dpr: 'PARKS', dof: 'DEPARTMENT OF FINANCE', finance: 'DEPARTMENT OF FINANCE', law: 'LAW DEPARTMENT',
  comptroller: 'COMPTROLLER', oti: 'TECHNOLOGY', doitt: 'TECHNOLOGY', ddc: 'DESIGN AND CONSTRUCTION', dycd: 'YOUTH',
  probation: 'PROBATION', hhc: 'HEALTH + HOSPITALS', tlc: 'TAXI', ccrb: 'COMPLAINT REVIEW', oath: 'ADMINISTRATIVE TRIALS'
};
function buildSearch() {
  const items = [];
  const listNames = {};
  D.L.forEach(L => { const k = L.tc.padStart(5, '0'); listNames[k] = (listNames[k] || 0) + L.n; });
  Object.entries(D.titles).forEach(([tc, T]) => {
    items.push({type: 'title', id: tc, name: sc(T.t), raw: T.t.toLowerCase(), size: listNames[tc] || 0,
      sub: listNames[tc] ? `Title · ${fmt(listNames[tc])} names on lists` : (T.prov ? `Title · ${fmt(T.prov[0])} provisionals` : 'Title · past lists only')});
  });
  Object.entries(D.agencies).forEach(([ac, A]) => {
    const promo = D.L.filter(L => L.k === 'promo' && L.ac === ac).length;
    items.push({type: 'agency', id: ac, name: agName(A.nm), raw: A.nm.toLowerCase(), size: (A.emp || 0) + 1e6,
      sub: 'Agency' + (A.emp ? ` · ${fmt(A.emp)} employees` : '') + (promo ? ` · ${promo} promotional lists` : '')});
  });
  D.search = items;
  const q = $('#q'), res = $('#sres');
  let hits = [], sel = -1;
  function render() {
    res.innerHTML = '';
    hits.forEach((h, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'option');
      if (i === sel) b.className = 'on';
      b.innerHTML = `<span>${esc(h.name)}</span><small>${esc(h.sub)}</small>`;
      b.addEventListener('mousedown', e => { e.preventDefault(); pick(h); });
      res.appendChild(b);
    });
    res.hidden = !hits.length;
    q.setAttribute('aria-expanded', hits.length ? 'true' : 'false');
  }
  function find(v) {
    v = v.trim().toLowerCase();
    if (!v) return [];
    const alias = ALIASES[v.replace(/[^a-z]/g, '')];
    const out = [];
    items.forEach(it => {
      let sc_ = 0;
      const nm = it.name.toLowerCase();
      if (alias && it.type === 'agency' && it.raw.toUpperCase().includes(alias)) sc_ = 6;
      else if (nm === v || it.raw === v) sc_ = 5;
      else if (it.id === v.padStart(it.type === 'title' ? 5 : 3, '0') && /^\d+$/.test(v)) sc_ = 5;
      else if (nm.startsWith(v) || it.raw.startsWith(v)) sc_ = 4;
      else if (new RegExp('\\b' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(nm)) sc_ = 3;
      else if (nm.includes(v) || it.raw.includes(v)) sc_ = 2;
      if (sc_) out.push([sc_, it]);
    });
    // titles that have lists, and agencies, rank ahead of provisional-only titles; then match quality; then size
    const has = it => it.type === 'agency' || it.size > 0 ? 1 : 0;
    out.sort((a, b) => has(b[1]) - has(a[1]) || b[0] - a[0] || b[1].size - a[1].size);
    return out.slice(0, 14).map(x => x[1]);
  }
  q.addEventListener('input', () => { hits = find(q.value); sel = hits.length ? 0 : -1; render(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (hits[sel]) pick(hits[sel]); e.preventDefault(); }
    else if (e.key === 'Escape') { hits = []; render(); }
  });
  q.addEventListener('blur', () => setTimeout(() => { res.hidden = true; }, 150));
  q.addEventListener('focus', () => { if (hits.length) res.hidden = false; });
  function pick(h) {
    hits = []; render(); q.value = h.name;
    location.hash = (h.type === 'title' ? 'title=' : 'agency=') + h.id;
  }
  const tries = [['title', '70310', 'Firefighter'], ['title', '12626', 'Staff analyst'], ['agency', '056', 'Police Department'],
    ['agency', '998', 'New York City Transit'], ['title', '10251', 'Clerical associate'], ['agency', '069', 'Social Services']];
  $('#tries').innerHTML = 'Try ' + tries.filter(t => (t[0] === 'title' ? D.titles : D.agencies)[t[1]])
    .map(t => `<button type="button" data-h="${t[0]}=${t[1]}">${esc(t[2])}</button>`).join('');
  $$('#tries button').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.h; }));
}

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const mt = h.match(/^title=(.+)$/), ma = h.match(/^agency=(.+)$/), ml = h.match(/^list=(.+)$/);
  if (mt && D.titles[mt[1]]) { renderTitle(mt[1]); return; }
  if (ma && D.agencies[ma[1]]) { renderAgency(ma[1]); return; }
  if (ml && D.byId[ml[1]]) { openList(ml[1], true); }
}

function scrollToProfile() {
  const p = $('#profile');
  const top = p.getBoundingClientRect().top + window.scrollY - 12;
  if (Math.abs(window.scrollY - top) > 40) window.scrollTo({top, behavior: 'smooth'});
}
function closeProfile() {
  $('#profile').innerHTML = '';
  D.profile = null;
  history.replaceState(null, '', location.pathname + location.search + '#lookup');
}

/* small reusable pieces for profiles */
function listTable(lists, opts) {
  opts = opts || {};
  if (!lists.length) return '<p class="aside">None.</p>';
  const cap = opts.cap || 12;
  const rows = lists.map((L, i) => `<tr class="clk" data-list="${esc(L.id)}"${i >= cap ? ' data-xtra hidden' : ''}>
    <td>${opts.title ? '<b>' + esc(sc(L.t)) + '</b><br>' : ''}<small>Exam ${esc(L.ex)}${opts.kind === false ? '' : ' · ' + esc(kindLabel(L))}</small></td>
    <td class="n">${fmt(L.n)}</td><td>${L.est ? apMonS(L.est) : '<small>Not yet</small>'}</td>
    <td>${L.ext ? apMonS(L.ext) + ' <small>extended</small>' : (L.ann ? apMonS(L.ann) : '—')}</td>
    <td>${depthCell(L)}</td></tr>`).join('');
  return `<div class="tw"><table class="h"><thead><tr><th>${opts.title ? 'Title and exam' : 'Exam'}</th><th class="n">Names</th><th>Took effect</th><th>Ends</th><th>Names sent down to</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    (lists.length > cap ? `<div class="more"><button class="btn" type="button" data-more>Show all ${fmt(lists.length)} lists</button></div>` : '');
}
function depthCell(L) {
  if (L.st === 'pending') return '<small>List not in use yet</small>';
  if (L.cn === 'police') return '<small>Unknown (no records)</small>';
  if (!L.c) return '<span class="dbar"></span><small>None sent yet</small>';
  const words = L.dp >= 0.999 ? 'Bottom of list' : `No. ${fmt(L.c[1])} (${pct(L.dp)})`;
  return `<span class="dbar"><i style="width:${(L.dp * 100).toFixed(1)}%"></i></span>${words}`;
}
function wireLists(root) {
  $$('[data-more]', root).forEach(b => b.addEventListener('click', () => {
    const tb = b.closest('.pblock') || root;
    $$('tr[data-xtra]', tb).forEach(tr => { tr.hidden = false; });
    b.parentNode.remove();
  }));
  $$('tr[data-list]', root).forEach(tr => tr.addEventListener('click', () => openList(tr.dataset.list)));
  $$('[data-title]', root).forEach(b => b.addEventListener('click', () => { location.hash = 'title=' + b.dataset.title; }));
  $$('[data-agency]', root).forEach(b => b.addEventListener('click', () => { location.hash = 'agency=' + b.dataset.agency; }));
}
function barRows(rows, o) {
  // rows: {label, html?, v, fill?, ink, val, title?, agency?}
  o = o || {};
  const max = o.max || Math.max(1, ...rows.map(r => r.v));
  return rows.map(r => {
    const lab = r.title ? `<button type="button" data-title="${esc(r.title)}">${esc(r.label)}</button>` :
      r.agency ? `<button type="button" data-agency="${esc(r.agency)}">${esc(r.label)}</button>` : esc(r.label);
    const w = (r.v / max * 100).toFixed(2), f = r.fill != null ? (r.fill / max * 100).toFixed(2) : null;
    const ink = INK[r.ink || 'cobalt'];
    const bar = f != null ? `<u style="width:${w}%;background:${ink}"></u><i style="width:${f}%;background:${ink}"></i>` : `<i style="width:${w}%;background:${ink}"></i>`;
    return `<div class="br"><div class="bl" title="${esc(r.label)}">${lab}</div><div class="bt">${bar}</div><div class="bv">${r.val}</div></div>`;
  }).join('');
}
function vbars(box, data, o) {
  // data: [{x, v, ink, partial, tip}]; draws a vertical bar chart from zero
  o = o || {};
  const W = box.clientWidth || 400, H = o.h || 190;
  const m = {l: 44, r: 8, t: 12, b: 26};
  const s = svg(W, H);
  const max = niceMax(Math.max(o.minMax || 0, ...data.map(d => d.v)) || 1);
  const Y = lin(0, max, H - m.b, m.t);
  ticks(max, 3).forEach(v => {
    sv(s, 'line', {x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: INK.grid});
    sv(s, 'text', {x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end'}, o.pct ? pct(v) : short(v));
  });
  const bw = (W - m.l - m.r) / data.length;
  const out = o.out;
  data.forEach((d, i) => {
    const x = m.l + i * bw;
    const r = sv(s, 'rect', {x: x + bw * 0.14, width: Math.max(1, bw * 0.72), y: Y(d.v), height: Math.max(0, Y(0) - Y(d.v)),
      fill: INK[d.ink || 'cobalt'], 'fill-opacity': d.partial ? .45 : .9});
    const every = Math.ceil(data.length / Math.max(2, Math.floor((W - m.l) / 40)));
    if (i % every === 0 || i === data.length - 1) sv(s, 'text', {x: x + bw / 2, y: H - 8, 'text-anchor': 'middle'}, d.xl != null ? d.xl : d.x);
    const hit = sv(s, 'rect', {x, width: bw, y: m.t, height: H - m.t - m.b, fill: 'transparent'});
    if (out) {
      const show = () => { out.innerHTML = d.tip; $$('rect', s).forEach(e => e.removeAttribute('stroke')); r.setAttribute('stroke', INK.sun); r.setAttribute('stroke-width', 2); };
      hit.addEventListener('pointerenter', show); hit.addEventListener('click', show);
    }
  });
  sv(s, 'line', {x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: INK.line});
  box.replaceChildren(s);
}
function lineChart(box, series, o) {
  // series: [{pts:[[xDate|num, y]], ink, w}], draws from zero
  o = o || {};
  const W = box.clientWidth || 600, H = o.h || 240;
  const m = {l: 48, r: 12, t: 14, b: 28};
  const s = svg(W, H);
  const xs = series.flatMap(se => se.pts.map(p => +p[0]));
  const x0 = o.x0 != null ? +o.x0 : Math.min(...xs), x1 = o.x1 != null ? +o.x1 : Math.max(...xs);
  const ymax = niceMax(o.ymax || Math.max(...series.flatMap(se => se.pts.map(p => p[1]))) * 1.05);
  const X = lin(x0, x1, m.l, W - m.r), Y = lin(0, ymax, H - m.b, m.t);
  ticks(ymax, 4).forEach(v => {
    sv(s, 'line', {x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: INK.grid});
    sv(s, 'text', {x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end'}, o.pct ? pct(v) : short(v));
  });
  if (o.dates) {
    const y0 = new Date(x0).getFullYear(), y1 = new Date(x1).getFullYear();
    const step = Math.ceil((y1 - y0 + 1) / Math.max(2, Math.floor((W - m.l) / 52)));
    for (let y = y0; y <= y1; y += step) {
      const xx = X(+new Date(y + '-01-01T12:00:00'));
      if (xx < m.l - 1) continue;
      sv(s, 'text', {x: xx, y: H - 8, 'text-anchor': 'middle'}, y);
    }
  } else {
    ticks(x1, 5).forEach(v => { if (v >= x0) sv(s, 'text', {x: X(v), y: H - 8, 'text-anchor': 'middle'}, short(v)); });
  }
  (o.marks || []).forEach(mk => {
    sv(s, 'line', {x1: X(mk.x), x2: X(mk.x), y1: m.t, y2: H - m.b, stroke: INK.fg, 'stroke-width': 1});
    sv(s, 'text', {x: X(mk.x) + (mk.anchor === 'end' ? -5 : 5), y: m.t + 10, 'text-anchor': mk.anchor || 'start', class: 'lab'}, mk.label);
  });
  series.forEach(se => {
    const d = se.pts.map((p, i) => (i ? 'L' : 'M') + X(+p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join('');
    if (se.area) sv(s, 'path', {d: d + `L${X(+se.pts[se.pts.length - 1][0])},${Y(0)}L${X(+se.pts[0][0])},${Y(0)}Z`, fill: INK[se.ink], 'fill-opacity': .18});
    sv(s, 'path', {d, fill: 'none', stroke: INK[se.ink], 'stroke-width': se.w || 2.2});
  });
  sv(s, 'line', {x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: INK.line});
  if (o.onHover) {
    const vl = sv(s, 'line', {y1: m.t, y2: H - m.b, stroke: INK.sun, 'stroke-width': 1, opacity: 0});
    const move = ev => {
      const rect = s.getBoundingClientRect();
      const mx = (ev.clientX - rect.left) * (W / rect.width);
      const xv = x0 + (mx - m.l) / (W - m.l - m.r) * (x1 - x0);
      const xx = o.onHover(xv);
      if (xx != null) { vl.setAttribute('x1', X(+xx)); vl.setAttribute('x2', X(+xx)); vl.setAttribute('opacity', 1); }
    };
    s.addEventListener('pointermove', move); s.addEventListener('click', move);
  }
  box.replaceChildren(s);
}
function nearestBy(arr, v, f) {
  let best = arr[0], bd = Infinity;
  arr.forEach(a => { const d = Math.abs(f(a) - v); if (d < bd) { bd = d; best = a; } });
  return best;
}

function renderTitle(tc) {
  const T = D.titles[tc];
  const lists = D.L.filter(L => L.tc.padStart(5, '0') === tc).sort((a, b) => (b.est || '9') < (a.est || '9') ? -1 : 1);
  const ended = D.history.ended.filter(e => e[8] === tc);
  const S = D.S;
  const inUse = lists.filter(L => L.st !== 'pending'), pend = lists.filter(L => L.st === 'pending');
  const names = inUse.reduce((a, L) => a + L.n, 0);
  const byK = k => inUse.filter(L => L.k === k).length;
  const meta = [`Title code ${tc}`];
  if (T.u) meta.push('Union: ' + (T.bu ? T.bu + ', ' : '') + agName(T.u) + (T.u.length >= 30 ? '…' : ''));
  if (T.inv) meta.push('Background investigation before appointment: ' + T.inv.toLowerCase());
  if (T.lo && T.hi) meta.push(`Salary range in the city's title catalog: ${money(T.lo)} to ${money(T.hi)}`);
  const sum = [];
  if (inUse.length) {
    const parts = [];
    if (byK('oc')) parts.push(`${spell(byK('oc'))} open competitive`);
    if (byK('promo')) parts.push(`${spell(byK('promo'))} promotional`);
    if (byK('qie')) parts.push(`${spell(byK('qie'))} qualified incumbent`);
    sum.push(`<b>${fmt(names)}</b> names on ${spell(inUse.length)} list${inUse.length > 1 ? 's' : ''} in use (${parts.join(', ')}).`);
  } else sum.push('No lists in use for this title right now.');
  if (pend.length) sum.push(`${spell(pend.length)} more list${pend.length > 1 ? 's' : ''} with ${fmt(pend.reduce((a, L) => a + L.n, 0))} names ${pend.length > 1 ? 'have' : 'has'} been published but not yet put in use.`);
  if (T.emp) sum.push(`<b>${fmt(T.emp)}</b> people held this title at some point in ${S.civilYear}, according to the city's Civil List.`);
  if (T.prov) sum.push(`<b>${fmt(T.prov[0])}</b> ${T.prov[0] === 1 ? 'provisional employee' : 'provisional employees'} as of ${apDate(S.prov.date)}, ${fmt(T.prov[1])} of them for more than two years.`);
  else sum.push(`No provisional employees in this title as of ${apDate(S.prov.date)}.`);
  if (T.next && T.next.length) sum.push(`Next exam: ${T.next.map(n => `${esc(n.t)} (${esc(n.k.toLowerCase())}), applications ${apDate(n.s)} to ${apDate(n.e)}`).join('; ')}.`);

  // agencies sent names from this title's open lists
  const drAg = {};
  lists.filter(L => L.dr).forEach(L => L.dr.forEach(d => {
    const a = drAg[d[0]] || (drAg[d[0]] = {rows: 0, last: ''});
    a.rows += d[1]; if (d[3] > a.last) a.last = d[3];
  }));
  const drRows = Object.entries(drAg).sort((a, b) => b[1].rows - a[1].rows).slice(0, 12).map(([ac, a]) => ({
    label: D.agencies[ac] ? agName(D.agencies[ac].nm) : 'Agency ' + ac, agency: D.agencies[ac] ? ac : null, v: a.rows, ink: 'cobalt',
    val: `${fmt(a.rows)} <small>last ${apMonS(a.last)}</small>`}));
  // employees and provisionals by agency
  const agRows = {};
  (T.empAg || []).forEach(([ac, n]) => { (agRows[ac] = agRows[ac] || {emp: 0, prov: 0, y2: 0}).emp = n; });
  (T.provAg || []).forEach(([ac, n, y2]) => { const r = agRows[ac] = agRows[ac] || {emp: 0, prov: 0, y2: 0}; r.prov = n; r.y2 = y2; });
  const agTable = Object.entries(agRows).sort((a, b) => (b[1].emp + b[1].prov) - (a[1].emp + a[1].prov)).slice(0, 14);
  // score distribution across lists in use
  const h = new Array(11).fill(0);
  inUse.forEach(L => L.h.forEach((v, i) => h[i] += v));
  const cr = [0, 0, 0, 0, 0];
  inUse.forEach(L => L.cr.forEach((v, i) => cr[i] += v));

  const html = `<div class="profile">
    <button class="close" type="button" id="pclose">Close</button>
    <div class="pmeta">Job title</div>
    <h2>${esc(tname(tc, T.t))}</h2>
    <div class="pmeta">${meta.map(esc).join(' · ')}</div>
    <p class="psum">${sum.join(' ')}</p>
    <div class="pgrid">
      <div class="pblock pwide"><h3>Lists for this title</h3>
        <p class="aside">Every list in the active dataset. Click a row for its full record.</p>${listTable(lists)}</div>
      <div class="pblock"><h3>Names on each list, by year it took effect</h3>
        <p class="aside">Lists in use and lists that have ended (records of ended lists start with those that ended in ${apMonth(S.ended.firstTerm)}).</p>
        <div class="chart" id="pPool"></div><div class="readout" id="pPoolOut"></div></div>
      <div class="pblock"><h3>Agencies sent names from its open lists</h3>
        <p class="aside">Names on certifications since 2018, counting a person each time they were sent.</p>
        ${drRows.length ? '<div class="bars">' + barRows(drRows) + '</div>' : '<p class="aside">No certifications from an open list in use.</p>'}</div>
      <div class="pblock"><h3>Where people in this title work</h3>
        <p class="aside">People in the title during ${S.civilYear} (Civil List) and provisional employees as of ${apDate(S.prov.date)}.</p>
        ${agTable.length ? `<div class="tw"><table class="h"><thead><tr><th>Agency</th><th class="n">In title, ${S.civilYear}</th><th class="n">Provisional</th><th class="n">2+ years</th></tr></thead><tbody>${
          agTable.map(([ac, r]) => `<tr><td>${D.agencies[ac] ? `<button type="button" data-agency="${ac}" class="linkish">${esc(agName(D.agencies[ac].nm))}</button>` : 'Agency ' + esc(ac)}</td><td class="n">${fmt(r.emp)}</td><td class="n">${r.prov ? fmt(r.prov) : ''}</td><td class="n">${r.y2 ? fmt(r.y2) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="aside">No one in this title in the Civil List.</p>'}</div>
      <div class="pblock"${inUse.length ? '' : ' hidden'}><h3>Scores on its lists in use</h3>
        <p class="aside">Adjusted final average, credits included.</p>
        <div class="chart" id="pHist"></div><div class="readout" id="pHistOut"></div>
        <p class="note">${creditSentence(cr)}</p></div>
      <div class="pblock"><h3>Certifications for this title, by year</h3>
        <p class="aside">Batches of names sent to agencies, from any list for the title. The current year is partial.</p>
        <div class="chart" id="pFlow"></div><div class="readout" id="pFlowOut"></div></div>
      ${ended.length ? `<div class="pblock pwide"><h3>Lists that have ended</h3>
        <div class="tw"><table class="h"><thead><tr><th>Exam</th><th class="n">Names</th><th>Took effect</th><th>Ended</th><th class="n">Years in use</th></tr></thead><tbody>${
          ended.slice().reverse().slice(0, 25).map(e => `<tr><td><small>Exam ${esc(e[0])} · ${e[2] === 'oc' ? 'Open competitive' : 'Promotional' + (D.agencies[e[9]] ? ', ' + esc(agName(D.agencies[e[9]].nm)) : '')}</small></td><td class="n">${fmt(e[3])}</td><td>${apMonS(e[4])}</td><td>${apMonS(e[5])}</td><td class="n">${fmt1(e[6])}</td></tr>`).join('')}</tbody></table></div>
        ${ended.length > 25 ? `<p class="note">Showing the 25 most recent of ${fmt(ended.length)}.</p>` : ''}</div>` : ''}
    </div></div>`;
  $('#profile').innerHTML = html;
  $('#pclose').addEventListener('click', closeProfile);
  wireLists($('#profile'));
  D.profile = () => {
    // names per list by year
    const yr = {};
    lists.filter(L => L.est).forEach(L => { const y = +L.est.slice(0, 4); (yr[y] = yr[y] || {n: 0, c: 0}).n += L.n; yr[y].c++; });
    ended.forEach(e => { const y = +e[4].slice(0, 4); (yr[y] = yr[y] || {n: 0, c: 0}).n += e[3]; yr[y].c++; });
    const ys = Object.keys(yr).map(Number);
    if (ys.length) {
      const data = [];
      for (let y = Math.min(...ys); y <= Math.max(...ys); y++) data.push({x: y, xl: "'" + String(y).slice(2), v: yr[y] ? yr[y].n : 0, ink: 'cobalt',
        tip: yr[y] ? `<b>${y}</b>: ${fmt(yr[y].n)} names on ${spell(yr[y].c)} list${yr[y].c > 1 ? 's' : ''} that took effect that year` : `<b>${y}</b>: no list took effect`});
      vbars($('#pPool'), data, {out: $('#pPoolOut')});
    } else $('#pPool').innerHTML = '<p class="aside">No lists with dates.</p>';
    if (inUse.length) vbars($('#pHist'), D.S.scores.bins.map((b, i) => ({x: b, xl: ['<70', '70', '75', '80', '85', '90', '95', '100', '>100', '>105', '>110'][i], v: h[i], ink: 'sun',
      tip: `<b>${b}</b>: ${fmt(h[i])} names`})), {out: $('#pHistOut'), h: 170});
    const fl = (T.flow || []).filter(f => f[0] >= flowStart());
    if (fl.length) {
      const y0 = fl[0][0], y1 = new Date().getFullYear(), m = {};
      fl.forEach(f => m[f[0]] = f);
      const data = [];
      for (let y = y0; y <= y1; y++) data.push({x: y, xl: "'" + String(y).slice(2), v: m[y] ? m[y][1] : 0, ink: 'cyan', partial: y === y1,
        tip: m[y] ? `<b>${y}${y === y1 ? ', so far' : ''}</b>: ${fmt(m[y][1])} certifications carrying ${fmt(m[y][2])} names; ${fmt(m[y][3])} flagged as replacing a provisional` : `<b>${y}</b>: none`});
      vbars($('#pFlow'), data, {out: $('#pFlowOut'), h: 170});
    } else $('#pFlow').innerHTML = '<p class="aside">No certifications recorded for this title.</p>';
  };
  D.profile();
  scrollToProfile();
}
function creditSentence(cr) {
  const parts = [];
  if (cr[4]) parts.push(`${fmt(cr[4])} with the residency credit`);
  if (cr[0] + cr[1]) parts.push(`${fmt(cr[0] + cr[1])} with a veterans' credit (${fmt(cr[1])} disabled)`);
  if (cr[2] + cr[3]) parts.push(`${fmt(cr[2] + cr[3])} legacy credits`);
  return parts.length ? 'Credits on these lists: ' + parts.join('; ') + '.' : 'No one on these lists has a named credit.';
}

function renderAgency(ac) {
  const A = D.agencies[ac], S = D.S;
  const promo = D.L.filter(L => L.k === 'promo' && L.ac === ac).sort((a, b) => b.n - a.n);
  const promoUse = promo.filter(L => L.st !== 'pending');
  const draws = [];
  D.L.forEach(L => (L.dr || []).forEach(d => { if (d[0] === ac) draws.push({L, rows: d[1], ncert: d[2], last: d[3]}); }));
  draws.sort((a, b) => b.rows - a.rows);
  const ended = D.history.ended.filter(e => e[9] === ac && e[2] === 'promo');
  const sum = [];
  if (A.emp) sum.push(`<b>${fmt(A.emp)}</b> people worked here at some point in ${S.civilYear}, according to the city's Civil List.`);
  if (promoUse.length) sum.push(`<b>${spell(promoUse.length)}</b> promotional list${promoUse.length > 1 ? 's' : ''} in use, with ${fmt(promoUse.reduce((a, L) => a + L.n, 0))} names.`);
  else sum.push('No promotional lists in use.');
  if (draws.length) sum.push(`Since 2018 it has been sent names from <b>${spell(draws.length)}</b> open list${draws.length > 1 ? 's' : ''} still in use, ${fmt(draws.reduce((a, d) => a + d.rows, 0))} names in all (a person sent twice counts twice).`);
  if (A.prov) sum.push(`<b>${fmt(A.prov[0])}</b> ${A.prov[0] === 1 ? 'provisional employee' : 'provisional employees'} as of ${apDate(S.prov.date)}, ${fmt(A.prov[1])} of them for more than two years.`);
  else sum.push(`No provisional employees reported as of ${apDate(S.prov.date)}.`);
  const titleHasOpen = tc => D.L.filter(L => L.tc.padStart(5, '0') === tc && L.k === 'oc' && L.st !== 'pending');
  const html = `<div class="profile">
    <button class="close" type="button" id="pclose">Close</button>
    <div class="pmeta">City agency</div>
    <h2>${esc(agName(A.nm))}</h2>
    <div class="pmeta">Agency code ${esc(ac)}</div>
    <p class="psum">${sum.join(' ')}</p>
    <div class="pgrid">
      <div class="pblock pwide"><h3>Its promotional lists</h3>
        <p class="aside">Lists only this agency's employees could join. Click a row for its full record.</p>${listTable(promo, {title: true, kind: false})}</div>
      <div class="pblock"><h3>Open lists it has drawn from</h3>
        <p class="aside">Names the city has sent this agency from lists open to the public that are still in use. A person sent twice counts twice.</p>
        ${draws.length ? '<div class="bars">' + barRows(draws.slice(0, 15).map(d => ({label: sc(d.L.t) + ' (' + d.L.est.slice(0, 4) + ')', title: d.L.tc.padStart(5, '0'), v: d.rows, ink: 'cobalt',
          val: `${fmt(d.rows)} <small>last ${apMonS(d.last)}</small>`}))) + '</div>' + (draws.length > 15 ? `<p class="note">Top 15 of ${draws.length}.</p>` : '') : '<p class="aside">None since 2018.</p>'}</div>
      <div class="pblock"><h3>Provisional employees over time</h3>
        <p class="aside">From the city's quarterly report. The lighter line is those serving more than two years.</p>
        <div class="chart" id="pProv"></div><div class="readout" id="pProvOut"></div></div>
      <div class="pblock pwide"><h3>Titles where it has provisional employees</h3>
        ${A.provTitles.length ? `<div class="tw"><table class="h"><thead><tr><th>Title</th><th class="n">Provisional</th><th class="n">2+ years</th><th class="n">Names on public lists</th><th>Sent down to</th></tr></thead><tbody>${
          A.provTitles.slice(0, 30).map(([tc, t, n, y2]) => { const ol = titleHasOpen(tc); const dp = ol.length ? Math.max(...ol.map(L => L.dp || 0)) : null;
            return `<tr><td>${D.titles[tc] ? `<button type="button" data-title="${esc(tc)}" class="linkish">${esc(tname(tc, t))}</button>` : esc(tname(tc, t))}</td><td class="n">${fmt(n)}</td><td class="n">${fmt(y2)}</td><td class="n">${ol.length ? fmt(ol.reduce((a, L) => a + L.n, 0)) : '<small>No open list</small>'}</td><td>${dp != null ? `<span class="dbar"><i style="width:${(dp * 100).toFixed(1)}%"></i></span>${pct(dp)}` : ''}</td></tr>`; }).join('')}</tbody></table></div>
          ${A.provTitles.length > 30 ? `<p class="note">Top 30 of ${A.provTitles.length} titles.</p>` : ''}` : '<p class="aside">None in the latest report.</p>'}</div>
      <div class="pblock"><h3>Certifications it received, by year</h3>
        <p class="aside">Batches of names sent from any list. The current year is partial.</p>
        <div class="chart" id="pFlow"></div><div class="readout" id="pFlowOut"></div></div>
      <div class="pblock"><h3>Promotional lists that have ended</h3>
        ${ended.length ? `<div class="tw"><table class="h"><thead><tr><th>Title</th><th class="n">Names</th><th>Ended</th><th class="n">Years</th></tr></thead><tbody>${
          ended.slice().reverse().slice(0, 12).map(e => `<tr><td>${esc(sc(e[1]))} <small>exam ${esc(e[0])}</small></td><td class="n">${fmt(e[3])}</td><td>${apMonS(e[5])}</td><td class="n">${fmt1(e[6])}</td></tr>`).join('')}</tbody></table></div>
          <p class="note">${fmt(ended.length)} promotional lists for this agency ended since ${apMonth(S.ended.firstTerm)}${ended.length > 12 ? '; the 12 most recent are shown' : ''}.</p>` : '<p class="aside">None in the records.</p>'}</div>
    </div></div>`;
  $('#profile').innerHTML = html;
  $('#pclose').addEventListener('click', closeProfile);
  wireLists($('#profile'));
  D.profile = () => {
    const pt = A.provTrend || [];
    if (pt.length > 1) {
      const P = pt.map(p => [pd(p[0]), p[1], p[2]]);
      lineChart($('#pProv'), [{pts: P.map(p => [p[0], p[1]]), ink: 'rose', area: true}, {pts: P.map(p => [p[0], p[2]]), ink: 'rose', w: 1.2}],
        {dates: true, h: 200, onHover: xv => { const p = nearestBy(P, xv, q => +q[0]); $('#pProvOut').innerHTML = `<b>${apDate(p[0].toISOString().slice(0, 10))}</b>: ${fmt(p[1])} provisional, ${fmt(p[2])} for more than two years`; return p[0]; }});
    } else $('#pProv').innerHTML = '<p class="aside">No provisional employees in the reports.</p>';
    const fl = (A.flow || []).filter(f => f[0] >= flowStart());
    if (fl.length) {
      const y0 = fl[0][0], y1 = new Date().getFullYear(), m = {};
      fl.forEach(f => m[f[0]] = f);
      const data = [];
      for (let y = y0; y <= y1; y++) data.push({x: y, xl: "'" + String(y).slice(2), v: m[y] ? m[y][1] : 0, ink: 'cyan', partial: y === y1,
        tip: m[y] ? `<b>${y}${y === y1 ? ', so far' : ''}</b>: ${fmt(m[y][1])} certifications carrying ${fmt(m[y][2])} names; ${fmt(m[y][3])} flagged as replacing a provisional` : `<b>${y}</b>: none`});
      vbars($('#pFlow'), data, {out: $('#pFlowOut'), h: 170});
    } else $('#pFlow').innerHTML = '<p class="aside">No certifications recorded.</p>';
  };
  D.profile();
  scrollToProfile();
}

/* ------------------------------------------------------------ list drawer */
function openList(id, fromRoute) {
  const L = D.byId[id];
  if (!L) return;
  const S = D.S;
  $('#dLbl').textContent = `Exam ${L.ex} · ${kindLabel(L)}${L.g !== '000' ? ' · group ' + L.g : ''}`;
  $('#dTitle').textContent = sc(L.t);
  const status = {pending: 'Published, not yet in use', term: 'In use, within its first four years', ext: 'In use on an extension past four years', past: 'Past its end date'}[L.st];
  const rows = [
    ['Names on the list', `${fmt(L.n)}${L.ins ? `, including ${fmt(L.ins)} added after it took effect (they carry fractional list numbers)` : ''}`],
    ['Status', status],
    ['Published', L.pub ? apDate(L.pub) : '<small>Not recorded</small>'],
    ['Took effect', L.est ? `${apDate(L.est)}. Everyone on the list has been on it since then: ${dur(monthsSince(L.est))}.` : '<small>Not yet</small>'],
    ['Four-year end date', L.ann ? apDate(L.ann) : '—'],
    ['Extended to', L.ext ? apDate(L.ext) + (L.est ? ` (${fmt1(yearsBetween(pd(L.est), pd(L.ext)))} years in all)` : '') : '<small>No extension</small>'],
    ['Scores', `lowest ${L.sc[0]}, median ${L.sc[1]}, highest ${L.sc[2]}`],
    ['Largest tie', L.tie[0] > 1 ? `${fmt(L.tie[0])} people at ${L.tie[1]}` : 'No ties'],
    ['Credits', creditSentence(L.cr).replace('Credits on these lists: ', '')],
  ];
  if (L.cn === 'police') rows.push(['Sent to agencies', `No certification records for police officer since ${apDate(S.police.lastCert)}.`]);
  else if (L.c) {
    rows.push(['How far down', `${cap(depthText(L))}. First batch ${apDate(L.c[3])}, latest ${apDate(L.c[4])}.`]);
    rows.push(['Names on certifications', `${fmt(L.c[2])} in all, covering ${fmt(Math.min(L.c[0], L.n))} different list numbers (${pct(coverage(L))} of the list): on average each name sent went out ${fmt1(L.c[2] / Math.max(1, Math.min(L.c[0], L.n)))} times.`]);
  } else if (L.est) rows.push(['Sent to agencies', 'No certifications from this list yet.']);
  const T = D.titles[L.tc.padStart(5, '0')];
  let body = `<dl class="f">${rows.map(r => `<div><dt>${r[0]}</dt><dd>${r[1]}</dd></div>`).join('')}</dl>`;
  if (L.c && L.dp != null) body += `<div style="margin:6px 0 18px">
    <div class="bt" style="height:16px;background:${INK.line2};position:relative"><i style="position:absolute;left:0;top:0;bottom:0;width:${(L.dp * 100).toFixed(1)}%;background:${INK.sun};display:block"></i></div>
    <p class="note">Filled: the share of the list, from No. 1 down, that agencies have been sent.</p></div>`;
  if (L.dr && L.dr.length) {
    body += `<div class="narr"><h4>Agencies sent names from this list</h4></div><div class="bars">` + barRows(L.dr.slice(0, 12).map(d => ({
      label: D.agencies[d[0]] ? agName(D.agencies[d[0]].nm) : 'Agency ' + d[0], v: d[1], ink: KIND[L.k].ink,
      val: `${fmt(d[1])} <small>${fmt(d[2])} people · last ${apMonS(d[3])}</small>`}))) + '</div>';
    if (L.dr.length > 12) body += `<p class="note">Top 12 of ${L.dr.length} agencies.</p>`;
  }
  if (L.fr) body += `<div class="narr"><h4>How far down this list the city has gone, month by month</h4><p>${paceSentence(L)}</p></div><div class="chart" id="dPace"></div><div class="readout" id="dPaceOut"></div>`;
  body += `<div class="narr"><h4>Scores</h4></div><div class="chart" id="dHist"></div><div class="readout" id="dHistOut"></div>`;
  body += `<div class="narr"><h4>More</h4><p>`;
  if (T) body += `<button class="srcbtn" type="button" data-title="${esc(L.tc.padStart(5, '0'))}">Everything on ${esc(sc(L.t))}</button> `;
  if (L.k === 'promo' && D.agencies[L.ac]) body += `<button class="srcbtn" type="button" data-agency="${esc(L.ac)}">${esc(agName(D.agencies[L.ac].nm))}</button> `;
  body += `<a class="srcbtn" href="https://data.cityofnewyork.us/resource/vx8i-nprf.json?exam_no=${encodeURIComponent(L.ex)}&list_agency_code=${encodeURIComponent(L.ac)}&$limit=50000" target="_blank" rel="noopener">This list's rows on NYC Open Data</a></p></div>`;
  $('#dBody').innerHTML = body;
  $$('[data-title]', $('#dBody')).forEach(b => b.addEventListener('click', () => { closeDrawer(); location.hash = 'title=' + b.dataset.title; }));
  $$('[data-agency]', $('#dBody')).forEach(b => b.addEventListener('click', () => { closeDrawer(); location.hash = 'agency=' + b.dataset.agency; }));
  const d = $('#drawer');
  d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (L.fr) requestAnimationFrame(() => drawPace($('#dPace'), L, $('#dPaceOut'), 220));
  requestAnimationFrame(() => vbars($('#dHist'), S.scores.bins.map((b, i) => ({x: b, xl: ['<70', '70', '75', '80', '85', '90', '95', '100', '>100', '>105', '>110'][i], v: L.h[i], ink: KIND[L.k].ink,
    tip: `<b>${b}</b>: ${fmt(L.h[i])} names`})), {out: $('#dHistOut'), h: 160}));
  if (!fromRoute) history.replaceState(null, '', '#list=' + id);
}
function closeDrawer() {
  const d = $('#drawer');
  if (!d.classList.contains('open')) return;
  d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (location.hash.startsWith('#list=')) history.replaceState(null, '', location.pathname + location.search);
}

/* ------------------------------------------------------------ how a list works */
function writeHow() {
  const S = D.S, st = S.status;
  const steps = [
    ['Exam', `The Department of Citywide Administrative Services (DCAS) gives an exam for a title. ${fmt(S.upcomingExams)} exams have application periods open now or later in the schedule DCAS posted ${apDate(S.schedAsOf)}.`],
    ['Published', `Scores come out and a proposed list is published. <b>${fmt(st.pending.lists)}</b> lists (${fmt(st.pending.rows)} names) are published but not yet in use.`],
    ['Takes effect', `The list is established and agencies can hire from it. <b>${fmt(st.term.lists)}</b> lists (${fmt(st.term.rows)} names) are within their first four years.`],
    ['Certified', `For a vacancy, DCAS sends the agency names from the top: a certification. The agency must pick one of the three highest-ranked people willing to take the job (Civil Service Law §61).`],
    ['Hired or removed', `People hired, who decline or who don't report are taken off the list in DCAS's own system. The open data doesn't record any of this.`],
    ['Four years', `State law sets a list's life at one to four years. It can be extended for as long as a hiring freeze lasted (Civil Service Law §56). <b>${fmt(st.ext.lists)}</b> lists (${fmt(st.ext.rows)} names) are on extensions.`],
    ['Ends', `A list ends at its end date or, after one year, when a new list for the title takes effect. <b>${fmt(S.ended.lists)}</b> lists have ended since ${apMonth(S.ended.firstTerm)}.`],
  ];
  $('#steps').innerHTML = steps.map(s => `<div><h4>${s[0]}</h4><p>${s[1]}</p></div>`).join('');
  const gl = [
    ['Open competitive', 'A list anyone who meets the qualifications could test for.'],
    ['Promotional', "A list open only to people already in a lower title, usually at one agency. Each agency's promotional list is separate, even when several agencies share one exam."],
    ['Qualified incumbent', 'A list for provisional employees already doing the job, who pass a qualifying exam to become permanent. Everyone on the current lists has a score of 100.'],
    ['List number', 'Rank on the list. People added after a list takes effect are slotted in with fractional numbers like 6608.5; the data doesn\'t say why each was added.'],
    ['Adjusted final average', 'The exam score plus any credits. Passing is usually 70.'],
    ['Certification', 'A batch of names DCAS sends an agency so it can fill vacancies or replace provisional employees. It may hold part of a list, the whole list or several lists. Being certified means being eligible to be considered, not being offered a job.'],
    ['How far down names have been sent', 'The lowest-ranked list number the city has ever included in a batch sent to an agency, as a share of the whole list. 100% means the city has sent names all the way to the bottom of the list.'],
    ['Provisional employee', 'Someone holding a competitive title without having been hired off a list for it. State law limits a provisional appointment to nine months (Civil Service Law §65).'],
    ['Extension', 'Keeping a list in use past its four-year end date, which state law allows for the length of a hiring freeze.'],
    ['Group number', "A few lists carry group 001. The city's data dictionary says people in group 001 may be considered before those on the primary group 000 list."],
  ];
  $('#gloss').innerHTML = gl.map(g => `<dt>${g[0]}</dt><dd>${g[1]}</dd>`).join('');
}

/* ------------------------------------------------------------ depth */
const DB = [['never', 'None sent yet', .12], ['lt25', 'Under 25%', .3], ['lt50', '25% to 49%', .5], ['lt90', '50% to 89%', .72], ['full', '90% or more', 1]];
function writeDepth() {
  const S = D.S, om = S.ocMeasured;
  const old = Object.entries(S.depthAge).filter(([k]) => k.startsWith('4+|'));
  const oldN = old.reduce((a, [, v]) => a + v.lists, 0), oldFull = (S.depthAge['4+|full'] || {lists: 0}).lists;
  const exc = D.L.filter(L => L.k === 'oc' && L.est && L.n >= 1000 && L.dp != null && L.dp < 0.9).sort((a, b) => b.n - a.n);
  const covL = D.L.filter(L => L.k === 'oc' && L.est && L.dp != null && coverage(L) >= 0.9);
  const covN = covL.length, covRows = covL.reduce((a, L) => a + L.n, 0);
  const top = D.L.filter(L => L.c && L.k === 'oc' && L.n >= 500).map(L => ({L, r: L.c[2] / L.n})).sort((a, b) => b.r - a.r).slice(0, 3);
  $('#depthText').innerHTML = `
    <p>Each batch of names the city sends an agency (the city calls it a certification) records the rank number of every person in it. The lowest-ranked number the city has ever sent from a list shows how far down that list it has gone. Being sent means a person can be considered for a job; the data doesn't show who was hired.</p>
    <p>There are <b>${fmt(om.lists)}</b> lists open to the public that are in use and have records of batches. On <b>${fmt(covN)}</b> of them, holding ${fmt(covRows)} names, at least 90% of the people on the list have been sent to an agency at least once. Counted instead by the lowest-ranked number ever sent, ${fmt(om.full)} lists have been sent at least 90% of the way down and ${fmt(D.L.filter(L => L.k === 'oc' && L.est && L.dp != null && L.dp >= 0.999).length)} all the way to the bottom. The two counts differ because some batches skip people: a "selective" batch, for example, includes only people with a particular skill or license. ${oldN ? (oldFull === oldN ? `Every one of the ${spell(oldN)} public lists in use for more than four years has been sent at least 90% of the way down.` : `${cap(spell(oldFull))} of the ${spell(oldN)} public lists in use for more than four years have been sent at least 90% of the way down.`) : ''}</p>
    <p>${exc.length ? `${cap(spell(exc.length))} public lists of 1,000 or more names have been sent less than 90% of the way down; they are listed below. The two largest are ${exc.slice(0, 2).map(L => `the ${esc(sc(L.t).toLowerCase())} list, in use since ${apMonth(L.est)}, which the city has sent down to No. ${fmt(L.c ? L.c[1] : 0)} of ${fmt(L.mx)}`).join(', and ')}.` : ''}</p>`;
  $('#excBars').innerHTML = barRows(exc.map(L => ({label: `${sc(L.t)} (since ${apMonth(L.est)})`, title: L.tc.padStart(5, '0'), v: L.n, fill: L.n * (L.dp || 0), ink: 'cobalt',
    val: `sent down to No. ${fmt(L.c ? L.c[1] : 0)} <small>of ${fmt(L.mx)}</small>`})));
  wireLists($('#excBars'));
  $('#timesSent').innerHTML = `Names go out more than once. On the median open list of 100 or more names, the certifications carry ${fmt1(S.certPerName.median)} entries for every name on the list. ` +
    top.map(t => `${esc(sc(t.L.t))} (${t.L.est.slice(0, 4)}): ${fmt(t.L.c[2])} entries for ${fmt(t.L.n)} names, about ${fmt(t.r)} each`).join('; ') + '.';
  // heat grid by age
  const ages = [['0-1', 'Under a year'], ['1-2', '1 to 2 years'], ['2-3', '2 to 3 years'], ['3-4', '3 to 4 years'], ['4+', 'More than 4']];
  let h = `<div class="ovl" style="grid-template-columns:minmax(90px,130px) repeat(5,minmax(0,1fr))"><div></div>${DB.map(b => `<div style="color:${INK.fg2};font-size:12.5px;padding:0 0 4px">${b[1]}</div>`).join('')}`;
  ages.forEach(([k, lab]) => {
    const tot = DB.reduce((a, b) => a + ((S.depthAge[k + '|' + b[0]] || {}).lists || 0), 0);
    h += `<div class="n">${lab}</div>`;
    DB.forEach(b => {
      const v = (S.depthAge[k + '|' + b[0]] || {}).lists || 0, sh = tot ? v / tot : 0;
      h += `<div class="c" style="background:rgba(255,210,63,${(0.06 + sh * 0.94).toFixed(2)});color:${sh > 0.45 ? '#111311' : INK.fg}" title="${v} lists">${v || ''}</div>`;
    });
  });
  $('#depthAge').innerHTML = h + '</div>';
  // biggest lists
  const big = D.L.filter(L => L.st !== 'pending').slice().sort((a, b) => b.n - a.n).slice(0, 30);
  $('#bigLists').innerHTML = barRows(big.map(L => ({label: `${sc(L.t)} (${L.est.slice(0, 4)}${L.k === 'promo' ? ', promotional' : ''})`, title: L.tc.padStart(5, '0'),
    v: L.n, fill: L.cn === 'police' ? 0 : L.n * (L.dp || 0), ink: KIND[L.k].ink,
    val: L.cn === 'police' ? `${fmt(L.n)} <small>no data</small>` : L.dp >= .999 ? `${fmt(L.n)} <small>all sent</small>` : `${fmt(L.n)} <small>to No. ${L.c ? fmt(L.c[1]) : 0}</small>`})));
  wireLists($('#bigLists'));
}
function drawDepthBars() {
  const S = D.S, box = $('#depthBars');
  const rows = [['oc', 'Open competitive'], ['promo', 'Promotional'], ['qie', 'Qualified incumbent']];
  let h = '<div style="display:grid;gap:12px">';
  rows.forEach(([k, lab]) => {
    const tot = DB.reduce((a, b) => a + ((S.depth[k + '|' + b[0]] || {}).names || 0), 0);
    const lists = DB.reduce((a, b) => a + ((S.depth[k + '|' + b[0]] || {}).lists || 0), 0);
    h += `<div><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px"><b>${lab}</b><span style="color:${INK.fg2}">${fmt(tot)} names on ${fmt(lists)} lists</span></div><div style="display:flex;height:22px">`;
    DB.forEach(b => {
      const v = S.depth[k + '|' + b[0]] || {names: 0, lists: 0};
      if (!v.names) return;
      h += `<div title="${b[1]}: ${fmt(v.names)} names on ${fmt(v.lists)} lists" style="width:${(v.names / tot * 100).toFixed(2)}%;background:rgba(255,210,63,${b[2]});border-right:1px solid ${INK.bg}"></div>`;
    });
    h += '</div></div>';
  });
  const pol = S.police;
  h += `<div><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px"><b>Police officer</b><span style="color:${INK.fg2}">${fmt(pol.rows)} names on ${fmt(pol.lists)} lists</span></div><div style="height:22px;border:1px dashed ${INK.fg2};font-size:12.5px;color:${INK.fg2};padding:2px 8px">No certification data</div></div>`;
  box.innerHTML = h + '</div>';
  $('#depthKey').innerHTML = DB.map(b => `<span class="key"><i style="background:rgba(255,210,63,${b[2]})"></i>${b[1]}</span>`).join('');
}

/* ------------------------------------------------------------ age */
let ganttMin = 1000;
function writeAge() {
  const S = D.S, o = S.oldest;
  const longRun = D.L.filter(L => L.st === 'ext' && L.est && L.ext && yearsBetween(pd(L.est), pd(L.ext)) >= 8).sort((a, b) => b.n - a.n);
  const yrs = D.history.years.filter(y => !y.partial && y.y >= 2016);
  const recent = yrs.filter(y => y.y >= 2021);
  const recPast = recent.reduce((a, y) => a + y.past4, 0), recLists = recent.reduce((a, y) => a + y.lists, 0);
  $('#ageText').innerHTML = `
    <p>A list is supposed to last one to four years. State law lets it run longer for as long as a hiring freeze kept agencies from filling vacancies (Civil Service Law §56); DCAS describes extensions as being at the commissioner's discretion. <b>${fmt(S.status.ext.lists)}</b> lists in use, with ${fmt(S.status.ext.rows)} names, are past four years on extensions, all running to ${Object.keys(S.extYears).sort().join(' or ')}.</p>
    <p>The oldest list in use is the ${esc(sc(o.t).toLowerCase())} list, which took effect ${apDate(o.est)} and is extended to ${apDate(o.ext)}, ${spell(Math.round(yearsBetween(pd(o.est), pd(o.ext))))} years in all. ${longRun.length > 1 ? `${cap(spell(longRun.length))} lists will have run eight years or more: ${longRun.map(L => `${esc(sc(L.t).toLowerCase())} (${L.est.slice(0, 4)}, ${fmt(L.n)} names)`).join(', ')}.` : ''}</p>
    <p>Extensions are routine. Of the ${fmt(recLists)} lists that ended from 2021 through ${recent.length ? recent[recent.length - 1].y : ''}, ${fmt(recPast)} (${pct(recPast / recLists)}) had run more than four years.</p>`;
  $('#firstTerm').textContent = apMonth(S.ended.firstTerm);
  const pg = {};
  D.L.filter(L => L.st === 'pending' && L.pub).forEach(L => {
    const g = pg[L.ex + L.tc] = pg[L.ex + L.tc] || {L, n: 0, lists: 0};
    g.n += L.n; g.lists++;
  });
  const pend = Object.values(pg).map(g => ({...g, m: yearsBetween(pd(g.L.pub), TODAY) * 12})).sort((a, b) => b.m - a.m);
  const lg = S.lag;
  $('#pendText').innerHTML = `<p><b>${fmt(S.status.pending.lists)}</b> lists with ${fmt(S.status.pending.rows)} names have been published but have not taken effect. The median has waited ${fmt1(S.pending.medMonths)} months since publication; ${fmt(S.pending.over12)} have waited more than a year. Among lists in use that have both dates (${fmt(lg.n)} of them), the median gap between publication and taking effect was ${fmt(lg.med)} days; the longest, for ${esc(sc(lg.longest.t).toLowerCase())}, ran from ${apDate(lg.longest.pub)} to ${apDate(lg.longest.est)}.</p>
    <p class="note">DCAS's own measure of the step before this, from exam to results, was a median of 101 business days in fiscal 2026 and 158 in fiscal 2025, against a target of 197 (Mayor's Management Report, September 2026).</p>`;
  $('#pendBars').innerHTML = barRows(pend.slice(0, 15).map(p => ({label: `${sc(p.L.t)}${p.L.k === 'promo' ? ` (promotional${p.lists > 1 ? ', ' + p.lists + ' agencies' : ''})` : ''}`, title: p.L.tc.padStart(5, '0'),
    v: p.m, ink: 'orange', val: `${fmt(p.m)} months <small>${plural(p.n, 'name')}</small>`})));
  wireLists($('#pendBars'));
  $$('#age .chip').forEach(b => b.addEventListener('click', () => {
    ganttMin = +b.dataset.min;
    $$('#age .chip').forEach(c => c.setAttribute('aria-pressed', c === b));
    drawGantt();
  }));
  $('#ganttKey').innerHTML = `<span class="key"><i style="background:${INK.cobalt}"></i>First four years</span><span class="key"><i style="background:${INK.vermilion}"></i>Extension</span><span class="key"><i style="background:${INK.sun}"></i>Today</span>`;
}
function drawGantt() {
  const box = $('#gantt');
  const lists = D.L.filter(L => L.est && L.n >= ganttMin).sort((a, b) => a.est < b.est ? -1 : a.est > b.est ? 1 : b.n - a.n);
  const W = box.clientWidth || 800;
  const labels = W >= 700 && lists.length <= 140;
  const rowH = lists.length > 400 ? 2 : lists.length > 140 ? 4 : 13;
  const m = {l: labels ? 230 : 10, r: 12, t: 22, b: 26};
  const H = m.t + m.b + lists.length * rowH;
  const s = svg(W, H);
  const x0 = new Date('2018-01-01'), x1 = new Date('2031-01-01');
  const X = lin(+x0, +x1, m.l, W - m.r);
  for (let y = 2018; y <= 2031; y++) {
    const xx = X(+new Date(y + '-01-01'));
    sv(s, 'line', {x1: xx, x2: xx, y1: m.t, y2: H - m.b, stroke: INK.grid});
    if (W > 560 || y % 2 === 0) sv(s, 'text', {x: xx, y: m.t - 8, 'text-anchor': 'middle'}, y);
  }
  const rects = [];
  lists.forEach((L, i) => {
    const y = m.t + i * rowH;
    const a = X(+pd(L.est)), b = X(+pd(L.ann)), c = L.ext ? X(+pd(L.ext)) : null;
    const hh = Math.max(1.5, rowH - (rowH > 6 ? 4 : 1));
    sv(s, 'rect', {x: a, y: y + (rowH - hh) / 2, width: Math.max(1, b - a), height: hh, fill: INK.cobalt, 'fill-opacity': .85});
    if (c) sv(s, 'rect', {x: b, y: y + (rowH - hh) / 2, width: Math.max(1, c - b), height: hh, fill: INK.vermilion, 'fill-opacity': .9});
    if (labels) {
      const t = sc(L.t) + (L.k === 'promo' ? ' (prom.)' : '');
      sv(s, 'text', {x: m.l - 8, y: y + rowH - 3, 'text-anchor': 'end', style: 'font-size:11.5px'}, t.length > 34 ? t.slice(0, 33) + '…' : t);
    }
    rects.push({L, y});
  });
  const tx = X(+TODAY);
  sv(s, 'line', {x1: tx, x2: tx, y1: m.t - 4, y2: H - m.b + 4, stroke: INK.sun, 'stroke-width': 1.5});
  sv(s, 'text', {x: tx + 4, y: H - m.b + 18, class: 'lab'}, 'Today');
  const hl = sv(s, 'rect', {x: m.l, width: W - m.l - m.r, height: rowH, fill: INK.fg, 'fill-opacity': 0});
  s.addEventListener('pointermove', ev => {
    const rect = s.getBoundingClientRect();
    const my = (ev.clientY - rect.top) * (H / rect.height);
    const i = Math.floor((my - m.t) / rowH);
    const r = rects[i];
    if (!r) return;
    hl.setAttribute('y', r.y); hl.setAttribute('fill-opacity', .08);
    const L = r.L;
    $('#ganttOut').innerHTML = `<b>${esc(sc(L.t))}</b>, exam ${esc(L.ex)} · ${esc(kindLabel(L))} · ${fmt(L.n)} names · took effect ${apDate(L.est)} · ends ${apDate(L.ext || L.ann)}${L.ext ? ', after an extension' : ''}`;
  });
  s.addEventListener('click', ev => {
    const rect = s.getBoundingClientRect();
    const i = Math.floor(((ev.clientY - rect.top) * (H / rect.height) - m.t) / rowH);
    if (rects[i]) openList(rects[i].L.id);
  });
  box.replaceChildren(s);
}
function drawPastFour() {
  const ys = D.history.years.filter(y => y.y >= 2016);
  vbars($('#pastFour'), ys.map(y => ({x: y.y, xl: "'" + String(y.y).slice(2), v: y.past4 / y.lists, ink: 'vermilion', partial: y.partial,
    tip: `<b>${y.y}${y.partial ? ', so far' : ''}</b>: ${fmt(y.past4)} of ${fmt(y.lists)} lists that ended had run more than four years (${pct(y.past4 / y.lists)}); ${fmt(y.early)} ended before their four-year date, usually when a new list replaced them. Median life ${fmt1(y.medLife)} years.`})),
  {out: $('#pastFourOut'), pct: true, h: 200, minMax: 1});
}
function drawLifespan() {
  const box = $('#lifespan'), E = D.history.ended;
  const W = box.clientWidth || 500, H = 230, m = {l: 40, r: 10, t: 12, b: 26};
  const s = svg(W, H);
  const x0 = new Date('2016-01-01'), x1 = new Date(TODAY.getFullYear() + 1 + '-01-01');
  const X = lin(+x0, +x1, m.l, W - m.r), Y = lin(0, 12, H - m.b, m.t);
  [0, 2, 4, 6, 8, 10, 12].forEach(v => { sv(s, 'line', {x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: v === 4 ? INK.fg : INK.grid}); sv(s, 'text', {x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end'}, v); });
  for (let y = 2016; y <= x1.getFullYear(); y += W > 480 ? 1 : 2) sv(s, 'text', {x: X(+new Date(y + '-07-01')), y: H - 8, 'text-anchor': 'middle'}, "'" + String(y).slice(2));
  sv(s, 'text', {x: W - m.r, y: Y(4) - 5, 'text-anchor': 'end', class: 'lab'}, 'Four years');
  const maxN = Math.max(...E.map(e => e[3]));
  const pts = E.map(e => ({e, x: X(+pd(e[5])), y: Y(Math.min(12, e[6])), r: 1.4 + Math.sqrt(e[3] / maxN) * 11}));
  pts.slice().sort((a, b) => b.r - a.r).forEach(p => sv(s, 'circle', {cx: p.x, cy: p.y, r: p.r, fill: INK[p.e[7] ? 'vermilion' : 'cobalt'], 'fill-opacity': .5, style: 'mix-blend-mode:screen'}));
  s.addEventListener('pointermove', ev => {
    const rect = s.getBoundingClientRect();
    const mx = (ev.clientX - rect.left) * (W / rect.width), my = (ev.clientY - rect.top) * (H / rect.height);
    let best = null, bd = 1e9;
    pts.forEach(p => { const d = Math.hypot(p.x - mx, p.y - my) - p.r; if (d < bd) { bd = d; best = p; } });
    if (best && bd < 8) { const e = best.e; $('#lifespanOut').innerHTML = `<b>${esc(sc(e[1]))}</b>, exam ${esc(e[0])} (${e[2] === 'oc' ? 'open competitive' : 'promotional'}) · ${fmt(e[3])} names · ${apMonth(e[4])} to ${apMonth(e[5])}, ${fmt1(e[6])} years${e[7] ? ', extended' : ''}`; }
  });
  box.replaceChildren(s);
  $('#lifespanOut').innerHTML = `<span class="key"><i style="background:${INK.cobalt}"></i>No extension</span><span class="key"><i style="background:${INK.vermilion}"></i>Extended</span>`;
}

/* ------------------------------------------------------------ pools */
function writePools() {
  const P = D.history.pools;
  const sizes = tc => Object.entries(P[tc].years).map(([y, v]) => [+y, v[0]]).sort((a, b) => a[0] - b[0]);
  const ff = sizes('70310'), sw = sizes('70112');
  const sent = [];
  if (ff.length >= 2) sent.push(`The firefighter list that took effect in ${ff[ff.length - 1][0]} has ${fmt(ff[ff.length - 1][1])} names; the ${ff[ff.length - 2][0]} list had ${fmt(ff[ff.length - 2][1])}${ff.length >= 3 ? ` and the ${ff[ff.length - 3][0]} list ${fmt(ff[ff.length - 3][1])}` : ''}.`);
  if (sw.length >= 2) sent.push(`The ${sw[sw.length - 1][0]} sanitation worker list has ${fmt(sw[sw.length - 1][1])} names; the ${sw[sw.length - 2][0]} list had ${fmt(sw[sw.length - 2][1])}.`);
  $('#poolText').innerHTML = `<p>Names on each list open to the public, by the year the list took effect, combining lists in use with lists that have ended. ${sent.join(' ')} A list's size depends on how many people applied, how many passed and how the exam was given, so a smaller list is a smaller pool of passers, which may or may not mean less interest.</p>
    <p class="note">DCAS reports ${fmt(119117)} applications for all its exams in fiscal 2026, down from ${fmt(166000)} in fiscal 2025 (Mayor's Management Report, September 2026).</p>`;
  const yrs = D.S.police.estYears;
  const pol = P['70210'] ? Object.keys(P['70210'].years).map(Number) : [];
  const missing = [];
  if (pol.length) for (let y = Math.min(...pol); y <= Math.max(...pol); y++) if (!pol.includes(y)) missing.push(y);
  $('#poolNote').innerHTML = `Each chart has its own scale. Records of ended lists cover lists that ended from ${apMonth(D.S.ended.firstTerm)} on, so lists that took effect before about 2012 are mostly missing.` +
    (missing.length ? ` No public police officer list that took effect in ${missing.join(', ').replace(/, (\d+)$/, ' or $1')} appears in either dataset, so those years read zero.` : '');
}
function drawPools() {
  const P = D.history.pools, wrap = $('#poolCharts');
  const y0 = 2011, y1 = TODAY.getFullYear();
  const ORDER = ['70210', '70310', '70112', '70410', '53052', '60817', '71651', '70810', '91207', '91211', '90744', '91203'];
  wrap.innerHTML = '';
  ORDER.filter(tc => P[tc]).concat(Object.keys(P).filter(tc => !ORDER.includes(tc))).map(tc => [tc, P[tc]]).forEach(([tc, p]) => {
    const d = document.createElement('div');
    d.innerHTML = `<h4><button type="button" data-title="${tc}" style="background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer;text-decoration:underline;text-decoration-color:${INK.line}">${esc(p.label)}</button></h4><div class="chart"></div><div class="readout" style="font-size:13px;min-height:2.6em"></div>`;
    wrap.appendChild(d);
    const data = [];
    for (let y = y0; y <= y1; y++) {
      const v = p.years[y];
      data.push({x: y, xl: "'" + String(y).slice(2), v: v ? v[0] : 0, ink: 'cobalt', tip: v ? `<b>${y}</b>: ${fmt(v[0])} names on ${spell(v[1])} list${v[1] > 1 ? 's' : ''}` : `<b>${y}</b>: none`});
    }
    vbars($('.chart', d), data, {out: $('.readout', d), h: 140});
    const latest = Object.keys(p.years).map(Number).sort().pop();
    $('.readout', d).innerHTML = latest ? `Latest: ${fmt(p.years[latest][0])} names, ${latest}` : '';
  });
  wireLists(wrap);
}

/* ------------------------------------------------------------ scores */
function writeScores() {
  const S = D.S, sc_ = S.scores, cr = S.credits;
  $('#scoreText').innerHTML = `<p>A list ranks people by adjusted final average: the exam score plus any credits. Passing is usually 70, and a score above 100 can only come from credits. <b>${fmt(sc_.eq100)}</b> entries on lists in use are exactly 100 and <b>${fmt(sc_.over100)}</b> are above it.</p>
    <p>The data names four credits. Subtracting them at the values in state law and DCAS's exam notices leaves ${fmt(sc_.unflagged)} entries still above 100, so a handful carry a credit the data doesn't label.</p>`;
  const ct = D.scores.creditTitles;
  const where = idx => ct.filter(r => r[idx] > 0).sort((a, b) => b[idx] - a[idx]).slice(0, 3).map(r => `${sc(r[0]).toLowerCase()} ${fmt(r[idx])}`).join(', ');
  const rows = [
    ['Residency', `${sc_.resPoints}`, cr.res, 'New York City residents, on police officer, firefighter and sanitation worker exams', where(6)],
    ["Veterans'", '5 open, 2.5 promotional', cr.vet, 'Usable once (Civil Service Law §85)', where(2)],
    ["Disabled veterans'", '10 open, 5 promotional', cr.dvet, 'Usable once (§85)', where(3)],
    ['Legacy, parent', '10', cr.par, 'Child of a firefighter, police officer or emergency medical technician who died in the line of duty, including from the World Trade Center attack and rescue (§§85-a to 85-c)', where(4)],
    ['Legacy, sibling', '10', cr.sib, `Sibling of the same; ${fmt(cr.legacyBoth)} people have both legacy credits`, where(5)],
  ];
  $('#creditTable').innerHTML = `<thead><tr><th>Credit</th><th class="n">Points</th><th class="n">Entries</th><th>Who and where</th></tr></thead><tbody>${rows.map(r =>
    `<tr><td><b>${r[0]}</b></td><td class="n">${r[1]}</td><td class="n">${fmt(r[2])}</td><td>${r[3]}<br><small>Most: ${esc(r[4])}</small></td></tr>`).join('')}</tbody>`;
  $('#histKey').innerHTML = ['oc', 'promo', 'qie'].map(k => `<span class="key"><i style="background:${INK[KIND[k].ink]}"></i>${KIND[k].label}</span>`).join('');
  // residency
  const R = D.scores.residency;
  const sel = $('#resPick');
  sel.innerHTML = R.map((r, i) => `<option value="${i}">${esc(sc(r.t))}, exam ${esc(r.ex)} (${fmt(r.n)} names, ${r.est.slice(0, 4)})</option>`).join('');
  sel.addEventListener('change', drawResidency);
  const ff = R.find(r => r.ex === '4044'), sw = R.find(r => r.ex === '2060');
  const at = (r, k) => r && r.at[k] ? r.at[k] : null;
  const s1 = [];
  if (ff && at(ff, '1000')) s1.push(`Among the first 1,000 names on the firefighter list there are <b>${fmt(at(ff, '1000')[0])}</b> nonresidents; ranked without the credit there would be <b>${fmt(at(ff, '1000')[1])}</b>. A nonresident with a perfect 100 and no other credit ranks behind every resident who scored ${101 - sc_.resPoints} or better.`);
  const swL = D.byId['2060-000-000'];
  if (sw && sw.reach && at(sw, String(sw.reach)) && swL && swL.c) s1.push(`On the sanitation worker list, the city has sent names down to No. ${fmt(swL.c[1])}, which covers the top ${fmt(sw.reach)} people on it. They include ${fmt(at(sw, String(sw.reach))[0])} nonresidents; ranked without the credit, the top ${fmt(sw.reach)} would include ${fmt(at(sw, String(sw.reach))[1])}.`);
  const pol = R.filter(r => r.t === 'POLICE OFFICER').map(r => r.resShare);
  $('#resText').innerHTML = `<p>Police officer, firefighter and sanitation worker exams add ${sc_.resPoints} points for city residents who qualify, according to DCAS's notices of examination; the notices cite no statute for it. Residents are ${pct(sw ? sw.resShare : 0)} of the sanitation list, ${pct(ff ? ff.resShare : 0)} of the firefighter list${pol.length ? ` and ${pct(Math.min(...pol))} to ${pct(Math.max(...pol))} of each large police officer list` : ''}.</p><p>${s1.join(' ')}</p>`;
  $('#resNote').innerHTML = `The comparison removes the ${sc_.resPoints} points from every resident and re-ranks, keeping the original order for ties; it holds everything else fixed, which real behavior wouldn't. ${fmt(sc_.resLow)} residents on police lists score below ${70 + sc_.resPoints}, which a ${sc_.resPoints}-point credit on a passing score can't produce; the data doesn't show why.`;
  $('#resKey').innerHTML = `<span class="key"><i style="background:${INK.orange}"></i>As ranked</span><span class="key"><i style="background:${INK.cobalt}"></i>If the residency points were removed</span><span class="key"><i style="background:${INK.fg}"></i>How far down the city has sent names</span>`;
  // ties
  const ties = D.scores.ties.slice(0, 10);
  $('#tieText').innerHTML = `<p>Scores are whole numbers on most lists, so many people share one. Within a tie the list still gives each person a different number; the data doesn't say how DCAS orders them. State law lets the city treat everyone tied with the third-highest willing candidate as reachable (Civil Service Law §61).</p>`;
  $('#tieBars').innerHTML = barRows(ties.map(t => { const L = D.byId[t.id]; return {label: `${sc(L.t)} (${L.est ? L.est.slice(0, 4) : 'pending'})`, title: L.tc.padStart(5, '0'), v: t.n, ink: 'sun',
    val: `${fmt(t.n)} <small>at ${t.s}</small>`}; }));
  wireLists($('#tieBars'));
}
function drawScoreHist() {
  const S = D.S.scores, box = $('#scoreHist');
  const W = box.clientWidth || 500, rowH = 22, m = {l: 112, r: 70, t: 4, b: 4};
  const H = m.t + m.b + S.bins.length * rowH;
  const s = svg(W, H);
  const tot = S.bins.map((b, i) => S.hist.oc[i] + S.hist.promo[i] + S.hist.qie[i]);
  const X = lin(0, Math.max(...tot), m.l, W - m.r);
  S.bins.forEach((b, i) => {
    const y = m.t + i * rowH;
    sv(s, 'text', {x: m.l - 8, y: y + 15, 'text-anchor': 'end'}, b);
    let x = m.l;
    ['oc', 'promo', 'qie'].forEach(k => {
      const w = X(S.hist[k][i]) - m.l;
      if (w > 0) sv(s, 'rect', {x, y: y + 3, width: w, height: rowH - 6, fill: INK[KIND[k].ink], 'fill-opacity': .9});
      x += w;
    });
    sv(s, 'text', {x: x + 6, y: y + 15}, fmt(tot[i]));
  });
  box.replaceChildren(s);
}
function drawResidency() {
  const R = D.scores.residency, r = R[+($('#resPick').value || 0)];
  if (!r) return;
  const pts = r.pts;
  const marks = r.reach ? [{x: r.reach, label: `Sent so far: top ${fmt(r.reach)}`, anchor: r.reach > r.n * .7 ? 'end' : 'start'}] : [];
  lineChart($('#resChart'), [{pts: pts.map(p => [p[0], p[1]]), ink: 'orange'}, {pts: pts.map(p => [p[0], p[2]]), ink: 'cobalt'}],
    {pct: true, x0: 0, x1: r.n, ymax: Math.max(.05, ...pts.map(p => Math.max(p[1], p[2]))), marks, h: 240,
      onHover: xv => { const p = nearestBy(pts, xv, q => q[0]); $('#resOut').innerHTML = `Top <b>${fmt(p[0])}</b> names: ${pct(p[1], 1)} nonresidents as ranked, ${pct(p[2], 1)} if the residency points were removed`; return p[0]; }});
  $('#resOut').innerHTML = `Across: the top N names on the list. Up: the share of those names held by nonresidents. ${r.reach ? '' : 'The city has no records of batches sent for this title since ' + apMonth(D.S.police.lastCert) + ', so there is no line for how far down it has sent names.'}`;
}

/* ------------------------------------------------------------ provisionals */
let provShown = 25;
function writeProv() {
  const S = D.S, p = S.prov, tr = D.provisionals.trend;
  const first = tr[0];
  $('#provText').innerHTML = `<p>A provisional employee holds a competitive title without having been hired off a list for it. State law allows a provisional appointment only when no appropriate list exists, caps it at nine months, and requires it to end within two months (four at most) after an appropriate list takes effect (Civil Service Law §65). The city reports provisional employees every quarter under the City Charter (§814).</p>
    <p>The count fell from ${fmt(first.tot)} in ${apMonth(first.d)} to <b>${fmt(p.tot)}</b> on ${apDate(p.date)}. Of those, <b>${fmt(p.y2)}</b> had served more than two years. <b>${fmt(p.inOC)}</b> work in titles that have a list open to the public in use, ${fmt(p.inOCy2)} of them for more than two years. The report doesn't say why any provisional appointment is still in place.</p>
    <p class="note">${p.nullRows ? `${cap(spell(p.nullRows))} rows in the source have no report date and together count ${fmt(p.nullTotal)} provisionals; they are left out.` : ''}</p>`;
  $('#provKey').innerHTML = `<span class="key"><i style="background:${INK.rose}"></i>All provisional employees</span><span class="key"><i style="background:${INK.rose};opacity:.5"></i>Serving more than two years</span>`;
  renderProvTable();
  $('#provMore').addEventListener('click', () => { provShown += 50; renderProvTable(); });
}
/* the provisional report cuts title names at 30 characters; prefer the full name from a list */
function tname(tc, t) {
  const full = D.titles[tc] && D.titles[tc].t;
  const best = full && full.length > (t || '').length ? full : t;
  return sc(best) + ((best || '').length === 30 ? '…' : '');
}
function renderProvTable() {
  const rows = D.provisionals.titles.slice(0, provShown);
  $('#provTable').innerHTML = `<thead><tr><th>Title</th><th class="n">Provisional</th><th class="n">2+ years</th><th class="n">Agencies</th><th class="n">Names on public lists</th><th>Sent down to</th></tr></thead><tbody>${rows.map(r =>
    `<tr><td>${D.titles[r.tc] ? `<button type="button" data-title="${esc(r.tc)}" class="linkish">${esc(tname(r.tc, r.t))}</button>` : esc(tname(r.tc, r.t))}</td><td class="n">${fmt(r.tot)}</td><td class="n">${fmt(r.y2)}</td><td class="n">${fmt(r.ag)}</td><td class="n">${r.lists ? fmt(r.names) : '<small>None</small>'}</td><td>${r.dp != null ? `<span class="dbar"><i style="width:${(r.dp * 100).toFixed(1)}%"></i></span>${pct(r.dp)}` : ''}</td></tr>`).join('')}</tbody>`;
  $('#provMore').hidden = provShown >= D.provisionals.titles.length;
  wireLists($('#provTable'));
}
function drawProvTrend() {
  const tr = D.provisionals.trend.map(t => [pd(t.d), t.tot, t.y2]);
  lineChart($('#provTrend'), [{pts: tr.map(t => [t[0], t[1]]), ink: 'rose', area: true}, {pts: tr.map(t => [t[0], t[2]]), ink: 'rose', w: 1.3}],
    {dates: true, h: 260, onHover: xv => { const t = nearestBy(tr, xv, q => +q[0]); $('#provOut').innerHTML = `<b>${apDate(t[0].toISOString().slice(0, 10))}</b>: ${fmt(t[1])} provisional employees, ${fmt(t[2])} serving more than two years`; return t[0]; }});
}

/* ------------------------------------------------------------ certifications by year */
function writeFlow() {
  const S = D.S, f = S.certFlow, ys = D.certs.years;
  const last = ys.filter(y => !y.partial).slice(-2);
  const y0 = flowStart(), stray = ys.filter(y => y.y < y0).reduce((a, y) => a + y.certs, 0);
  $('#flowText').innerHTML = `<p>The certification records run from ${y0}, when ${fmt((ys.find(y => y.y === y0) || {}).certs)} were issued, through today: ${fmt(f.certs)} certifications in all${stray ? ` (${plural(stray, 'record')} dated earlier ${stray === 1 ? 'is' : 'are'} left off the charts)` : ''}. On the median certification, DCAS sent ${fmt1(f.medRatio)} names for each vacancy. The median certification went out ${spell(f.medLag)} days after the agency asked for it.</p>
    ${last.length === 2 ? `<p>The share of certifications flagged as replacing a provisional employee was ${fmt1(last[0].provShare)}% in ${last[0].y} and ${fmt1(last[1].provShare)}% in ${last[1].y}. The data doesn't say what changed.</p>` : ''}`;
}
function flowStart() { const y = D.certs.years.find(y => y.certs >= 100); return y ? y.y : 2016; }
function drawFlow() {
  const ys = D.certs.years.filter(y => y.y >= flowStart());
  vbars($('#flowCerts'), ys.map(y => ({x: y.y, xl: "'" + String(y.y).slice(2), v: y.certs, ink: 'cyan', partial: y.partial,
    tip: `<b>${y.y}${y.partial ? ', so far' : ''}</b>: ${fmt(y.certs)} certifications carrying ${fmt(y.names)} names; median ${fmt1(y.medRatio)} names per vacancy`})), {out: $('#flowOut'), h: 210});
  vbars($('#flowProv'), ys.map(y => ({x: y.y, xl: "'" + String(y.y).slice(2), v: (y.provShare || 0) / 100, ink: 'rose', partial: y.partial,
    tip: `<b>${y.y}${y.partial ? ', so far' : ''}</b>: ${fmt1(y.provShare)}% of certifications flagged as replacing a provisional employee`})), {out: $('#flowProvOut'), h: 210, pct: true, minMax: 1});
}

/* ------------------------------------------------------------ who */
function writeWho() {
  const byT = {};
  D.L.forEach(L => { const k = L.tc.padStart(5, '0'); const t = byT[k] = byT[k] || {t: L.t, oc: 0, promo: 0, qie: 0}; t[L.k] += L.n; });
  const tt = Object.entries(byT).map(([tc, t]) => ({tc, ...t, n: t.oc + t.promo + t.qie})).sort((a, b) => b.n - a.n).slice(0, 20);
  $('#topTitles').innerHTML = barRows(tt.map(t => ({label: sc(t.t), title: t.tc, v: t.n, fill: t.oc, ink: 'cobalt', val: fmt(t.n) + (t.promo ? ` <small>${fmt(t.promo)} prom.</small>` : '')})));
  const byA = {};
  D.L.filter(L => L.k === 'promo').forEach(L => { const a = byA[L.ac] = byA[L.ac] || {n: 0, c: 0}; a.n += L.n; a.c++; });
  const aa = Object.entries(byA).sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  $('#topAgencies').innerHTML = barRows(aa.map(([ac, a]) => ({label: D.agencies[ac] ? agName(D.agencies[ac].nm) : 'Agency ' + ac, agency: D.agencies[ac] ? ac : null, v: a.n, ink: 'lilac', val: `${fmt(a.n)} <small>${a.c} lists</small>`})));
  wireLists($('#who'));
  // overlap
  const O = D.overlap, S = D.S;
  const idx = tc => O.titles.findIndex(t => t[0] === tc);
  const v = (a, b) => { const i = idx(a), j = idx(b); return i >= 0 && j >= 0 ? O.m[i][j] : null; };
  const mul = S.multi, two = Object.entries(mul).filter(([k]) => +k >= 2).reduce((a, [, n]) => a + n, 0), five = Object.entries(mul).filter(([k]) => +k >= 5).reduce((a, [, n]) => a + n, 0);
  const pr = S.policeRepeat, prTwo = Object.entries(pr).filter(([k]) => +k >= 2).reduce((a, [, n]) => a + n, 0), prAll = Object.values(pr).reduce((a, n) => a + n, 0);
  $('#ovlText').innerHTML = `<p>The data has no person ID, so this matches on first name, middle initial and last name, using only the ${fmt(S.namesMI)} names that have a middle initial. Of those, ${fmt(two)} appear on two or more lists and ${fmt(five)} on five or more.</p>
    <p>The entry-level uniformed and transit jobs share a pool. ${pct(v('70410', '70210'))} of the names on correction officer lists are also on a police officer list; ${pct(v('53052', '70310'))} of emergency medical specialist trainees are on the firefighter list; ${pct(v('91211', '91207'))} of train operators are on the conductor list. ${pct(prTwo / prAll, 1)} of the names on police officer lists are on more than one of them, from retaking the exam.</p>`;
  $('#ovlNote').innerHTML = `Numbers are percentages. Read across: the share of the row title's names that also appear on the column title's lists. Two different people with the same name and initial count as a match. The low shares between unrelated titles, often under 1%, suggest such false matches are rare.`;
  drawOverlap();
}
function drawOverlap() {
  const O = D.overlap;
  const n = O.titles.length;
  let h = `<div class="ovl" style="grid-template-columns:minmax(110px,190px) repeat(${n},minmax(0,1fr))"><div></div>`;
  O.titles.forEach(t => { h += `<div class="h">${esc(t[1])}</div>`; });
  O.titles.forEach((t, i) => {
    h += `<div class="n" title="${esc(t[1])}: ${fmt(t[2])} names with a middle initial">${esc(t[1])}</div>`;
    O.m[i].forEach((v, j) => {
      if (i === j) { h += `<div class="c" style="background:${INK.bg2}"></div>`; return; }
      const a = Math.min(1, (v || 0) / 0.3);
      h += `<div class="c" title="${esc(t[1])} also on ${esc(O.titles[j][1])}: ${pct(v, 1)}" style="background:rgba(60,200,216,${(0.05 + a * 0.95).toFixed(2)});color:${a > 0.45 ? '#111311' : INK.fg2}">${v >= 0.005 ? Math.round(v * 100) : ''}</div>`;
    });
  });
  $('#overlap').innerHTML = h + '</div>';
}

/* ------------------------------------------------------------ every list */
let allShown = 50, allSort = {k: 'n', d: -1};
function buildAllTable() {
  $('#allCount').textContent = fmt(D.L.length);
  ['#allQ', '#allKind', '#allStatus'].forEach(s => $(s).addEventListener('input', () => { allShown = 50; renderAll(); }));
  $('#allMore').addEventListener('click', () => { allShown += 100; renderAll(); });
  renderAll();
}
function renderAll() {
  const q = $('#allQ').value.trim().toLowerCase(), k = $('#allKind').value, st = $('#allStatus').value;
  let rows = D.L.filter(L => (!k || L.k === k) && (!st || L.st === st) &&
    (!q || L.t.toLowerCase().includes(q) || sc(L.t).toLowerCase().includes(q) || L.ex.includes(q) || agName(L.ag).toLowerCase().includes(q)));
  const key = {t: L => L.t, ag: L => kindLabel(L), n: L => L.n, est: L => L.est || '9999', end: L => L.ext || L.ann || '9999', dp: L => L.dp == null ? -1 : L.dp}[allSort.k];
  rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * allSort.d; });
  const head = [['t', 'Title'], ['ag', 'Type'], ['n', 'Names'], ['est', 'Took effect'], ['end', 'Ends'], ['dp', 'Names sent down to']];
  $('#allTable').innerHTML = `<thead><tr>${head.map(h => `<th${h[0] === 'n' ? ' class="n"' : ''}><button type="button" data-s="${h[0]}">${h[1]}${allSort.k === h[0] ? (allSort.d > 0 ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead><tbody>${
    rows.slice(0, allShown).map(L => `<tr class="clk" data-list="${esc(L.id)}"><td><b>${esc(sc(L.t))}</b> <small>exam ${esc(L.ex)}</small></td><td><small>${esc(kindLabel(L))}</small></td><td class="n">${fmt(L.n)}</td><td>${L.est ? apMonS(L.est) : '<small>Not yet</small>'}</td><td>${L.ext ? apMonS(L.ext) + ' <small>ext.</small>' : L.ann ? apMonS(L.ann) : '—'}</td><td>${depthCell(L)}</td></tr>`).join('')}</tbody>`;
  $$('#allTable th button').forEach(b => b.addEventListener('click', () => {
    allSort = {k: b.dataset.s, d: allSort.k === b.dataset.s ? -allSort.d : (b.dataset.s === 'n' || b.dataset.s === 'dp' ? -1 : 1)};
    renderAll();
  }));
  $('#allMore').hidden = allShown >= rows.length;
  $('#allShown').textContent = `Showing ${fmt(Math.min(allShown, rows.length))} of ${fmt(rows.length)}`;
  wireLists($('#allTable'));
}

/* ------------------------------------------------------------ limits and footer */
function writeLimits() {
  const S = D.S;
  const items = [
    ['Who was hired.', 'The active list keeps everyone who passed. Appointments, declines and removals happen in DCAS\'s own system and never reach the open data, so the totals here are passers, not people still waiting. The city\'s annual list-utilization report (Local Law 50 of 2004) does count appointments and removals, but its open-data version has no reporting-year field and repeats thousands of rows exactly, so this page doesn\'t use it.'],
    ['Police hiring.', `Certification records for police officer stop on ${apDate(S.police.lastCert)}, so the depth of the ${spell(S.police.lists)} police officer lists can't be measured.`],
    ['Who anyone is.', 'There are no ages, races, genders, addresses or boroughs. The page never shows names, and the only use of them is counting distinct people and matching across lists.'],
    ['People, exactly.', 'Without a person ID, "distinct names" and the cross-list matches count first name, middle initial and last name. Two people with the same name merge; one person who wrote a name two ways splits.'],
    ['How ties are broken.', 'People with the same score get different list numbers; the data doesn\'t say how.'],
    ['Every credit.', `Four credits are named. ${fmt(S.scores.unflagged)} entries score above 100 after removing them, so a few carry a credit the data doesn't label.`],
    ['History of the active list.', 'The active dataset is replaced daily and keeps no history. This page saves a small daily record of its headline counts from October 2026 on; older history exists only for lists that have ended, and only for those that ended from ' + apMonth(S.ended.firstTerm) + ' on.'],
    ['Why a list was extended.', 'The data gives the extension date but not the reason.'],
    ['Vacancies.', 'Certifications carry a vacancy count, but the same opening can appear on more than one certification, so summing them would overcount. The page uses the vacancy count only for names sent per vacancy on each certification.'],
  ];
  $('#limitList').innerHTML = items.map(i => `<li><b>${i[0]}</b> ${i[1]}</li>`).join('');
}
function writeFoot() {
  const S = D.S;
  const src = [['vx8i-nprf', 'Civil Service List (Active)'], ['qu8g-sxqf', 'Civil Service List (Terminated)'], ['a9md-ynri', 'Civil Service List Certification'],
    ['uxsm-hzx3', 'Charter Mandated Quarterly Report on Provisionals'], ['ye3c-m4ga', 'Civil List'], ['nzjr-3966', 'NYC Civil Service Titles'], ['4ptz-hmtc', 'Annual Examination Schedule']];
  $('#foot').innerHTML = `<p><b>Sources.</b> Seven Department of Citywide Administrative Services datasets on NYC Open Data: ${src.map(s => `<a href="https://data.cityofnewyork.us/d/${s[0]}">${s[1]}</a>`).join(', ')}. Context figures from the <a href="https://www.nyc.gov/assets/operations/downloads/pdf/mmr2026/dcas.pdf">Mayor's Management Report</a>, state Civil Service Law and DCAS notices of examination, cited where used.</p>
    <p><b>How it's made.</b> A script downloads the data every day, totals it and writes the files this page reads; no names leave that step. Active list as of ${apDate(S.asOf)}; Civil List for ${S.civilYear}; provisional report for ${apDate(S.prov.date)}; exam schedule posted ${apDate(S.schedAsOf)}. <a href="methodology.html">Methodology</a> · <a href="how-i-built-this.html">How I built this</a> · <a href="https://github.com/joshgreenman1973/nyc-civil-service-hiring">Code and data</a></p>
    <p>By Josh Greenman. This page replaced an earlier version on Oct. 14, 2026; the <a href="how-i-built-this.html#changes">change log</a> says what was corrected.</p>`;
}
})();
