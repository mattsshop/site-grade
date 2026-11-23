// Site Grade – Survey / As-built mode (v1.7.0)
// Shoot coded RTK points on a site with no plan, see them on USGS imagery, sync with Firebase,
// export to Civil 3D (PNEZD), AutoCAD (DXF) and Google Earth (KML).
const VERSION = '1.7.1';
const $ = s => document.querySelector(s);
const FT = 3.28083989501;
const isNum = v => typeof v === 'number' && isFinite(v);
const f2 = n => isNum(n) ? n.toFixed(2) : '—';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Could not save on this device'); } }
};
let tt; function toast(m, ms = 2600){ const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(tt); tt = setTimeout(() => t.style.display = 'none', ms); }
const rid = p => p + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 14) : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
$('#verLbl').textContent = 'Site Grade v' + VERSION + ' · Survey / As-built';

/* ---------- Georgia state plane (NAD83, US survey ft) ---------- */
const ZONES = { W: { name: 'NAD83 Georgia West (EPSG 2240), US ft', lon0: -84.16666666666667, FE: 700000 },
                E: { name: 'NAD83 Georgia East (EPSG 2239), US ft', lon0: -82.16666666666667, FE: 200000 } };
function tmGA(lat, lon, zone){
  const z = ZONES[zone] || ZONES.W;
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.9999, d = Math.PI / 180;
  const phi = lat * d, lam = lon * d, phi0 = 30 * d, lam0 = z.lon0 * d;
  const M = p => a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p)
            + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
  const sn = Math.sin(phi), cs = Math.cos(phi), N = a / Math.sqrt(1 - e2 * sn * sn), T = Math.tan(phi) ** 2, C = ep2 * cs * cs, A = (lam - lam0) * cs;
  const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (M(phi) - M(phi0) + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  const USFT = 1200 / 3937;
  return { E: (z.FE + x) / USFT, N: y / USFT };
}

/* ---------- codes ---------- */
const CODES = [
  { c: 'GRD', n: 'Ground', col: '#a3e635' }, { c: 'TC', n: 'Top of curb', col: '#f59e0b', line: 1 }, { c: 'BC', n: 'Bottom of curb / gutter', col: '#fb923c', line: 1 },
  { c: 'EP', n: 'Edge of pavement', col: '#e5e7eb', line: 1 }, { c: 'SW', n: 'Sidewalk edge', col: '#cbd5e1', line: 1 }, { c: 'DITCH', n: 'Ditch / swale', col: '#38bdf8', line: 1 },
  { c: 'FFE', n: 'Finished floor / slab', col: '#f472b6' }, { c: 'MH', n: 'Manhole / structure', col: '#c084fc' }, { c: 'INV', n: 'Pipe invert', col: '#818cf8' },
  { c: 'BM', n: 'Benchmark', col: '#facc15' }, { c: 'PP', n: 'Power pole', col: '#ef4444' }, { c: 'TREE', n: 'Tree', col: '#22c55e' },
  { c: 'FENCE', n: 'Fence', col: '#a8a29e', line: 1 }, { c: 'PT', n: 'Other point', col: '#ffffff' }
];
const CODE = Object.fromEntries(CODES.map(x => [x.c, x]));
let curCode = store.get('sv:code', 'GRD');

/* ---------- state ---------- */
let sites = store.get('sv:sites', []);           // [{id,name,zone,created}]
let site = null, D = null, cal = null;            // D = {pts:[], nextN, lines:{code:n}}
const dataKey = id => 'sv:site:' + id;
const loadData = id => Object.assign({ pts: [], nextN: 1, lines: {} }, store.get(dataKey(id), {}));
function saveData(push = true){ if (!site) return; store.set(dataKey(site.id), D); if (push) Cloud.changed(site.id); }
const saveSites = () => store.set('sv:sites', sites);

/* ---------- map ---------- */
const map = L.map('map', { zoomControl: false, maxZoom: 22, attributionControl: true }).setView([33.75, -84.39], 11);
const layers = {
  SAT: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 16, maxZoom: 22, attribution: 'Imagery: USGS The National Map' }),
  STREET: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxNativeZoom: 19, maxZoom: 22, attribution: '© OpenStreetMap contributors' }),
  NONE: null
};
let layerName = store.get('sv:layer', 'SAT');
function setLayer(n){
  Object.values(layers).forEach(l => l && map.hasLayer(l) && map.removeLayer(l));
  layerName = n; store.set('sv:layer', n);
  if (layers[n]) layers[n].addTo(map);
  $('#layerBtn').innerHTML = '<small>MAP</small>' + ({ SAT: 'SAT', STREET: 'ST', NONE: 'OFF' }[n]);
}
setLayer(layerName);
$('#layerBtn').onclick = () => setLayer({ SAT: 'STREET', STREET: 'NONE', NONE: 'SAT' }[layerName]);
const ptLayer = L.layerGroup().addTo(map), lineLayer = L.layerGroup().addTo(map);
const zoomLabels = () => map.getContainer().classList.toggle('far', map.getZoom() < 19);
map.on('zoomend', zoomLabels); zoomLabels();

/* ---------- GPS ---------- */
const gps = { fix: null, wid: null, follow: true, marker: null, circle: null, first: true };
function quality(f = gps.fix){
  if (!f) return 'none';
  return f.acc <= 0.1 ? 'rtk' : f.acc <= 0.6 ? 'float' : 'gps';
}
function startGps(){
  if (!('geolocation' in navigator)) return toast('This device has no location');
  if (gps.wid != null) return;
  gps.wid = navigator.geolocation.watchPosition(onPos, e => {
    if (e.code === 1) toast('Location blocked – allow location for this site in Chrome (Precise)', 5000);
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
function onPos(p){
  const c = p.coords;
  gps.fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: isNum(c.altitude) ? c.altitude : null, t: Date.now() };
  const ll = [c.latitude, c.longitude];
  if (!gps.marker) {
    gps.marker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    gps.circle = L.circle(ll, { radius: c.accuracy, color: '#3b82f6', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
  } else { gps.marker.setLatLng(ll); gps.circle.setLatLng(ll).setRadius(c.accuracy); }
  if (gps.first && !(D && D.pts.length)) { map.setView(ll, 19); gps.first = false; }
  else if (gps.follow) map.panTo(ll, { animate: false });
  renderPanel();
}
$('#followBtn').onclick = () => {
  gps.follow = !gps.follow; $('#followBtn').classList.toggle('on', gps.follow);
  if (gps.follow && gps.fix) map.panTo([gps.fix.lat, gps.fix.lon]);
};
map.on('dragstart', () => { if (gps.follow) { gps.follow = false; $('#followBtn').classList.remove('on'); } });

const elevOf = f => (f && isNum(f.alt)) ? f.alt * FT + (cal ? cal.offsetFt : 0) : NaN;
function renderPanel(){
  const q = quality(), f = gps.fix, b = $('#fixBadge');
  b.className = 'fix ' + q;
  b.textContent = !f ? 'WAITING FOR GPS…' : q === 'rtk' ? `● RTK FIXED  ±${(f.acc * FT * 12).toFixed(1)}"` : q === 'float' ? `● FLOAT – WAIT  ±${(f.acc * FT * 12).toFixed(0)}"` : `● NO RTK  ±${(f.acc * FT).toFixed(1)} ft`;
  const e = elevOf(f);
  $('#elevVal').textContent = f && !isNum(f.alt) ? 'no height' : f2(e);
  $('#elevNote').textContent = !site ? 'no site' : cal ? `from ${cal.bmName} = ${f2(cal.bmElev)}` : 'not calibrated – raw GPS height';
}

/* ---------- code chips ---------- */
function renderCodes(){
  $('#codes').innerHTML = CODES.map(x => `<button class="code${x.c === curCode ? ' on' : ''}" data-c="${x.c}">${x.c}${x.line && D ? `<small style="font-weight:600;opacity:.7"> ${D.lines[x.c] || 1}</small>` : ''}</button>`).join('');
  $('#lineBtn').disabled = !CODE[curCode]?.line;
  $('#lineBtn').textContent = CODE[curCode]?.line ? `New ${curCode} line` : 'New line';
}
$('#codes').onclick = e => { const b = e.target.closest('.code'); if (!b) return; curCode = b.dataset.c; store.set('sv:code', curCode); renderCodes(); toast(CODE[curCode].n, 1200); };
$('#lineBtn').onclick = () => {
  if (!D || !CODE[curCode]?.line) return;
  D.lines[curCode] = (D.lines[curCode] || 1) + 1; saveData(false); renderCodes();
  toast(`Next ${curCode} shots start line ${D.lines[curCode]}`);
};

/* ---------- shooting (5 s average, Fixed guard) ---------- */
const AVG_SEC = 5;
const shot = { active: false };
$('#shootBtn').onclick = () => {
  if (!site) return openSheet('sitesSheet');
  if (shot.active) return;
  const f = gps.fix;
  if (!f || Date.now() - f.t > 5000) return toast('No GPS position yet');
  const q = quality();
  if (q !== 'rtk' && !confirm(`Rover is not RTK Fixed (${q === 'float' ? 'FLOAT' : 'no RTK'}). Point may be off by tenths or feet.\n\nShoot anyway?`)) return;
  collect(AVG_SEC, $('#shootBtn'), 'Hold still…', (sm, worst) => {
    if (!sm.length) return toast('No GPS readings – try again');
    const lat = avg(sm.map(s => s.lat)), lon = avg(sm.map(s => s.lon)), sp = tmGA(lat, lon, site.zone);
    const alts = sm.filter(s => isNum(s.alt)).map(s => s.alt);
    const altM = alts.length ? avg(alts) : null;
    const el = isNum(altM) ? altM * FT + (cal ? cal.offsetFt : 0) : null;
    const spread = alts.length ? (Math.max(...alts) - Math.min(...alts)) * FT : null;
    const p = { id: rid('sp_'), n: D.nextN++, code: curCode, line: CODE[curCode].line ? (D.lines[curCode] || 1) : null, note: '',
      time: Date.now(), lat, lon, E: +sp.E.toFixed(3), N: +sp.N.toFixed(3), zone: site.zone,
      elev: isNum(el) ? +el.toFixed(3) : null, alt_m: isNum(altM) ? +altM.toFixed(4) : null, calibrated: !!cal, bm: cal ? cal.bmName : null,
      acc_m: +avg(sm.map(s => s.acc)).toFixed(3), quality: worst, n_avg: sm.length, spread_ft: isNum(spread) ? +spread.toFixed(3) : null, by: Cloud.who() };
    D.pts.push(p); saveData(); renderPoints();
    toast(`#${p.n} ${p.code} ${isNum(p.elev) ? f2(p.elev) : ''}${worst !== 'rtk' ? ' ⚠ not Fixed' : isNum(spread) && spread > 0.1 ? ' ⚠ readings varied – re-shoot?' : ''}`);
  });
};
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
const qRank = { rtk: 0, float: 1, gps: 2, none: 3 };
function collect(sec, btn, label, done){
  shot.active = true; const t0 = Date.now(), sm = [], txt = btn.textContent; let lastT = null, worst = quality();
  btn.disabled = true;
  const tick = setInterval(() => {
    const f = gps.fix;
    if (f && f.t !== lastT && Date.now() - f.t < 3000) { lastT = f.t; sm.push(f); const q = quality(f); if (qRank[q] > qRank[worst]) worst = q; }
    const left = sec - (Date.now() - t0) / 1000;
    btn.textContent = `${label} ${Math.max(1, Math.ceil(left))}`;
    if (left <= 0) { clearInterval(tick); shot.active = false; btn.disabled = false; btn.textContent = txt; done(sm, worst); }
  }, 200);
}

/* ---------- points on the map ---------- */
let measure = null;
function renderPoints(){
  ptLayer.clearLayers(); lineLayer.clearLayers();
  if (!D) return;
  const groups = {};
  for (const p of D.pts) {
    const c = CODE[p.code] || CODE.PT;
    const m = L.circleMarker([p.lat, p.lon], { radius: 6, color: '#111', weight: 1.5, fillColor: c.col, fillOpacity: p.quality === 'rtk' ? 1 : .35, dashArray: p.quality === 'rtk' ? null : '2 2' })
      .bindTooltip(`${p.n} ${p.code}${isNum(p.elev) ? ' ' + f2(p.elev) : ''}`, { permanent: true, direction: 'right', offset: [6, 0], className: 'pt-lbl' })
      .on('click', () => measure ? measureTap(p) : openPoint(p));
    m.addTo(ptLayer);
    if (c.line && p.line) (groups[p.code + '#' + p.line] ||= []).push(p);
  }
  for (const [k, arr] of Object.entries(groups)) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.n - b.n);
    L.polyline(arr.map(p => [p.lat, p.lon]), { color: (CODE[k.split('#')[0]] || CODE.PT).col, weight: 2.5, opacity: .9, interactive: false }).addTo(lineLayer);
  }
  $('#siteSub').textContent = `${D.pts.length} point${D.pts.length === 1 ? '' : 's'} · ${site.zone === 'E' ? 'GA East' : 'GA West'}${cal ? ' · BM ' + cal.bmName : ''}`;
}
$('#fitBtn').onclick = () => {
  if (D && D.pts.length) { map.fitBounds(L.latLngBounds(D.pts.map(p => [p.lat, p.lon])).pad(.2), { maxZoom: 20 }); gps.follow = false; $('#followBtn').classList.remove('on'); }
  else if (gps.fix) map.setView([gps.fix.lat, gps.fix.lon], 19);
};

/* ---------- measure ---------- */
$('#measBtn').onclick = () => {
  measure = measure ? null : { a: null };
  $('#measBtn').classList.toggle('on', !!measure);
  $('#measure').style.display = measure ? 'block' : 'none';
  $('#measure').textContent = 'Measure: tap the first point';
};
function measureTap(p){
  if (!measure.a) { measure.a = p; $('#measure').textContent = `From #${p.n} ${p.code} – tap the second point`; return; }
  const a = measure.a, dE = p.E - a.E, dN = p.N - a.N, h = Math.hypot(dE, dN);
  const dz = isNum(p.elev) && isNum(a.elev) ? p.elev - a.elev : NaN;
  $('#measure').innerHTML = `<b>#${a.n} → #${p.n}</b><br>${h.toFixed(2)} ft horizontal` +
    (isNum(dz) ? `<br>Δ elev ${dz >= 0 ? '+' : ''}${dz.toFixed(2)} ft · slope ${h > 0 ? (dz / h * 100).toFixed(2) : '—'}%` : '') + '<br><span class="muted">tap a point to measure from #' + p.n + '</span>';
  measure.a = p;
}

/* ---------- sheets ---------- */
function openSheet(id){ document.querySelectorAll('.sheet.open').forEach(s => s.classList.remove('open')); $('#bg').style.display = 'block'; $('#' + id).classList.add('open'); }
function closeSheets(){ document.querySelectorAll('.sheet.open').forEach(s => s.classList.remove('open')); $('#bg').style.display = 'none'; }
$('#bg').onclick = closeSheets;

/* sites */
function renderSites(){
  $('#siteList').innerHTML = sites.length ? sites.slice().sort((a, b) => (b.created || 0) - (a.created || 0)).map(s => {
    const n = (store.get(dataKey(s.id), { pts: [] }).pts || []).length;
    return `<div class="item${site && s.id === site.id ? ' cur' : ''}" data-id="${s.id}"><div class="t"><b>${esc(s.name)}</b><span>${n} pts · ${s.zone === 'E' ? 'GA East' : 'GA West'} · ${new Date(s.created || Date.now()).toLocaleDateString()}</span></div>›</div>`;
  }).join('') : '<div class="muted">No sites yet.</div>';
}
$('#sitesBtn').onclick = () => { renderSites(); openSheet('sitesSheet'); };
$('#siteList').onclick = e => { const it = e.target.closest('.item'); if (!it) return; openSite(it.dataset.id); closeSheets(); };
$('#createSite').onclick = () => {
  const name = $('#newName').value.trim(); if (!name) return toast('Give the site a name');
  const s = { id: rid('site_'), name, zone: $('#newZone').value, created: Date.now() };
  sites.push(s); saveSites(); store.set(dataKey(s.id), { pts: [], nextN: 1, lines: {} });
  Cloud.changed(s.id); $('#newName').value = ''; openSite(s.id); closeSheets(); toast('Site created – set your benchmark, then shoot');
};
function openSite(id){
  site = sites.find(s => s.id === id) || null;
  if (!site) { D = null; cal = null; $('#siteName').textContent = 'Survey / As-built'; $('#siteSub').textContent = 'Pick or create a site'; renderPoints(); renderCodes(); renderPanel(); return; }
  store.set('sv:last', id);
  D = loadData(id); cal = store.get('sv:cal:' + id, null);
  $('#siteName').textContent = site.name;
  measure = null; $('#measure').style.display = 'none'; $('#measBtn').classList.remove('on');
  renderPoints(); renderCodes(); renderPanel();
  if (D.pts.length) { map.fitBounds(L.latLngBounds(D.pts.map(p => [p.lat, p.lon])).pad(.2), { maxZoom: 20 }); gps.follow = false; $('#followBtn').classList.remove('on'); gps.first = false; }
  Cloud.openSite(id);
}

/* menu */
$('#menuBtn').onclick = () => { Cloud.render(); openSheet('menuSheet'); };
$('#delSite').onclick = function(){
  if (!site) return;
  if (!(this.dataset.armed && Date.now() - this.dataset.armed < 3000)) { this.dataset.armed = Date.now(); this.textContent = 'Tap again – deletes the site and all its points'; setTimeout(() => this.textContent = 'Delete this site', 3000); return; }
  const id = site.id; sites = sites.filter(s => s.id !== id); saveSites();
  try { localStorage.removeItem(dataKey(id)); localStorage.removeItem('sv:cal:' + id); } catch (e) {}
  Cloud.deleteSite(id); openSite(null); closeSheets(); toast('Site deleted');
  this.textContent = 'Delete this site';
};

/* calibrate */
function renderCal(){
  $('#calInfo').innerHTML = cal ? `<span>Calibrated to</span><b>${esc(cal.bmName)} = ${f2(cal.bmElev)}</b><span>When</span><b>${new Date(cal.time).toLocaleString()}</b><span>Readings</span><b>${cal.n}</b>`
    : '<span>Status</span><b>Not calibrated – raw GPS heights</b>';
  if (cal) { $('#bmName').value = cal.bmName; $('#bmElev').value = cal.bmElev.toFixed(2); }
}
$('#calOpen').onclick = () => { if (!site) return toast('Open a site first'); renderCal(); openSheet('calSheet'); };
$('#calStart').onclick = () => {
  const el = parseFloat($('#bmElev').value), name = $('#bmName').value.trim() || 'BM';
  if (!isNum(el)) return toast('Enter the benchmark elevation');
  const f = gps.fix; if (!f || !isNum(f.alt)) return toast('No GPS height yet – is the rover connected?');
  if (quality() !== 'rtk' && !confirm('Rover is not RTK Fixed. Calibrate anyway?')) return;
  collect(AVG_SEC, $('#calStart'), 'Hold still…', (sm) => {
    const alts = sm.filter(s => isNum(s.alt)).map(s => s.alt); if (!alts.length) return toast('No GPS heights – try again');
    const altM = avg(alts);
    cal = { bmName: name, bmElev: el, offsetFt: el - altM * FT, time: Date.now(), n: alts.length };
    store.set('sv:cal:' + site.id, cal);
    // record the benchmark as a point too
    const lat = avg(sm.map(s => s.lat)), lon = avg(sm.map(s => s.lon)), sp = tmGA(lat, lon, site.zone);
    D.pts.push({ id: rid('sp_'), n: D.nextN++, code: 'BM', line: null, note: name, time: Date.now(), lat, lon, E: +sp.E.toFixed(3), N: +sp.N.toFixed(3), zone: site.zone,
      elev: el, alt_m: +altM.toFixed(4), calibrated: true, bm: name, acc_m: +avg(sm.map(s => s.acc)).toFixed(3), quality: quality(), n_avg: sm.length, spread_ft: +((Math.max(...alts) - Math.min(...alts)) * FT).toFixed(3), by: Cloud.who() });
    saveData(); renderPoints(); renderPanel(); renderCal();
    toast(`Calibrated ✓ ${name} = ${f2(el)}`);
  });
};
$('#calClear').onclick = () => { if (!site) return; cal = null; try { localStorage.removeItem('sv:cal:' + site.id); } catch (e) {} renderCal(); renderPanel(); renderPoints(); toast('Calibration cleared'); };

/* point detail */
let curPt = null;
$('#ptCode').innerHTML = CODES.map(x => `<option value="${x.c}">${x.c} – ${x.n}</option>`).join('');
function openPoint(p){
  curPt = p;
  $('#ptTitle').textContent = `Point #${p.n} – ${p.code}`;
  const q = { rtk: 'RTK Fixed', float: 'Float', gps: 'No RTK' }[p.quality] || p.quality;
  $('#ptInfo').innerHTML = `<span>Elevation</span><b>${isNum(p.elev) ? f2(p.elev) + (p.calibrated ? '' : ' (raw GPS)') : '—'}</b>
    <span>Northing</span><b>${p.N.toFixed(2)}</b><span>Easting</span><b>${p.E.toFixed(2)}</b>
    <span>Lat / Long</span><b>${p.lat.toFixed(8)}, ${p.lon.toFixed(8)}</b>
    <span>Fix</span><b>${q} ±${(p.acc_m * FT * 12).toFixed(1)}"</b>
    <span>Averaged</span><b>${p.n_avg} readings${isNum(p.spread_ft) ? ` · spread ${(p.spread_ft * 12).toFixed(1)}"` : ''}</b>
    <span>Line</span><b>${p.line ? p.code + ' ' + p.line : '—'}</b>
    <span>Shot</span><b>${new Date(p.time).toLocaleString()}${p.by ? ' · ' + esc(p.by) : ''}</b>`;
  $('#ptCode').value = p.code; $('#ptNote').value = p.note || '';
  openSheet('ptSheet');
}
$('#ptSave').onclick = () => {
  if (!curPt) return;
  const nc = $('#ptCode').value;
  if (nc !== curPt.code) { curPt.code = nc; curPt.line = CODE[nc].line ? (D.lines[nc] || 1) : null; }
  curPt.note = $('#ptNote').value.trim();
  saveData(); renderPoints(); closeSheets();
};
$('#ptDel').onclick = function(){
  if (!(this.dataset.armed && Date.now() - this.dataset.armed < 3000)) { this.dataset.armed = Date.now(); this.textContent = 'Tap again to delete'; setTimeout(() => this.textContent = 'Delete', 3000); return; }
  D.pts = D.pts.filter(p => p !== curPt); saveData(); renderPoints(); closeSheets(); this.textContent = 'Delete';
};

/* list */
$('#listOpen').onclick = () => {
  if (!site) return toast('Open a site first');
  const pts = D.pts.slice().sort((a, b) => a.n - b.n);
  $('#listSum').textContent = `${pts.length} points · ${cal ? 'elevations from ' + cal.bmName + ' = ' + f2(cal.bmElev) : 'raw GPS heights (not calibrated)'}`;
  $('#listBody').innerHTML = pts.map(p => `<tr data-id="${p.id}"><td>${p.n}</td><td>${p.code}${p.line ? ' ' + p.line : ''}</td><td>${isNum(p.elev) ? f2(p.elev) : '—'}</td><td style="color:${p.quality === 'rtk' ? 'var(--ok)' : 'var(--cut)'}">${p.quality === 'rtk' ? 'Fixed' : p.quality === 'float' ? 'Float' : 'GPS'}</td><td>${esc(p.note)}</td></tr>`).join('');
  openSheet('listSheet');
};
$('#listBody').onclick = e => {
  const tr = e.target.closest('tr'); if (!tr) return; const p = D.pts.find(x => x.id === tr.dataset.id); if (!p) return;
  closeSheets(); gps.follow = false; $('#followBtn').classList.remove('on'); map.setView([p.lat, p.lon], 21); setTimeout(() => openPoint(p), 300);
};

/* ---------- export ---------- */
const slug = s => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'site';
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
async function shareFile(text, name, type){
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const sortedPts = () => D.pts.slice().sort((a, b) => a.n - b.n);
const desc = p => [p.code + (p.line ? p.line : ''), p.note].filter(Boolean).join(' ').replace(/,/g, ' ');
$('#expOpen').onclick = () => {
  if (!site) return toast('Open a site first');
  $('#expInfo').innerHTML = `${D.pts.length} points · coordinates ${ZONES[site.zone].name} · elevations ${cal ? 'from ' + esc(cal.bmName) + ' = ' + f2(cal.bmElev) : '<b style="color:var(--target)">raw GPS height (not calibrated)</b>'}`;
  openSheet('expSheet');
};
$('#expPnezd').onclick = () => {
  const t = sortedPts().map(p => [p.n, p.N.toFixed(3), p.E.toFixed(3), isNum(p.elev) ? p.elev.toFixed(3) : '', desc(p)].join(',')).join('\r\n') + '\r\n';
  shareFile(t, `${slug(site.name)}-PNEZD-${stamp()}.csv`, 'text/csv');
};
$('#expCsv').onclick = () => {
  const h = 'Point,Code,Line,Note,Northing,Easting,Elevation,Zone,Latitude,Longitude,GPS Height (m),Calibrated,Benchmark,H Acc (ft),Fix,Readings,Spread (ft),Time,By';
  const q = v => /[",\n]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : (v ?? '');
  const t = [h, ...sortedPts().map(p => [p.n, p.code, p.line ?? '', p.note, p.N.toFixed(3), p.E.toFixed(3), isNum(p.elev) ? p.elev.toFixed(3) : '', p.zone,
    p.lat.toFixed(9), p.lon.toFixed(9), p.alt_m ?? '', p.calibrated ? 'Yes' : 'No', p.bm ?? '', (p.acc_m * FT).toFixed(3),
    { rtk: 'Fixed', float: 'Float', gps: 'No RTK' }[p.quality] || '', p.n_avg, p.spread_ft ?? '', new Date(p.time).toLocaleString(), p.by || ''].map(q).join(','))].join('\r\n') + '\r\n';
  shareFile(t, `${slug(site.name)}-points-${stamp()}.csv`, 'text/csv');
};
$('#expKml').onclick = () => {
  const pts = sortedPts(), x = s => esc(s);
  let k = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(site.name)}</name>\n`;
  for (const p of pts) k += `<Placemark><name>${p.n} ${x(p.code)}${isNum(p.elev) ? ' ' + p.elev.toFixed(2) : ''}</name><description>${x(desc(p))} | Elev ${isNum(p.elev) ? p.elev.toFixed(3) : '—'} | ${p.quality}</description><Point><coordinates>${p.lon.toFixed(9)},${p.lat.toFixed(9)},0</coordinates></Point></Placemark>\n`;
  const groups = {};
  for (const p of pts) if (CODE[p.code]?.line && p.line) (groups[p.code + ' ' + p.line] ||= []).push(p);
  for (const [k2, arr] of Object.entries(groups)) if (arr.length > 1) k += `<Placemark><name>${x(k2)}</name><LineString><tessellate>1</tessellate><coordinates>${arr.map(p => `${p.lon.toFixed(9)},${p.lat.toFixed(9)},0`).join(' ')}</coordinates></LineString></Placemark>\n`;
  k += '</Document></kml>\n';
  shareFile(k, `${slug(site.name)}-${stamp()}.kml`, 'application/vnd.google-earth.kml+xml');
};
$('#expDxf').onclick = () => {
  const pts = sortedPts(), L2 = [];
  const g = (c, v) => L2.push(String(c), String(v));
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const lay = c => 'SV-' + c.replace(/[^A-Z0-9]/gi, '');
  for (const p of pts) {
    const z = isNum(p.elev) ? p.elev : 0;
    g(0, 'POINT'); g(8, lay(p.code)); g(10, p.E.toFixed(3)); g(20, p.N.toFixed(3)); g(30, z.toFixed(3));
    g(0, 'TEXT'); g(8, lay(p.code) + '-LBL'); g(10, (p.E + 0.8).toFixed(3)); g(20, (p.N + 0.3).toFixed(3)); g(30, z.toFixed(3)); g(40, '0.8');
    g(1, `${p.n} ${p.code}${p.line ? p.line : ''} ${isNum(p.elev) ? p.elev.toFixed(2) : ''}`.trim());
  }
  const groups = {};
  for (const p of pts) if (CODE[p.code]?.line && p.line) (groups[p.code + '#' + p.line] ||= []).push(p);
  for (const [k, arr] of Object.entries(groups)) {
    if (arr.length < 2) continue;
    g(0, 'POLYLINE'); g(8, lay(k.split('#')[0]) + '-LINE'); g(66, 1); g(10, '0'); g(20, '0'); g(30, '0'); g(70, 8);
    for (const p of arr) { g(0, 'VERTEX'); g(8, lay(k.split('#')[0]) + '-LINE'); g(10, p.E.toFixed(3)); g(20, p.N.toFixed(3)); g(30, (isNum(p.elev) ? p.elev : 0).toFixed(3)); g(70, 32); }
    g(0, 'SEQEND'); g(8, lay(k.split('#')[0]) + '-LINE');
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  shareFile(L2.join('\r\n') + '\r\n', `${slug(site.name)}-${stamp()}.dxf`, 'application/dxf');
};

/* ---------- cloud sync (Firebase project site-grade) ---------- */
const Cloud = (() => {
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const cfg = { apiKey: 'AIzaSyDDwuwStTYw2sv2mqdjDWImbAPJwIhZoVg', authDomain: 'site-grade.firebaseapp.com', projectId: 'site-grade',
    storageBucket: 'site-grade.firebasestorage.app', messagingSenderId: '90870907521', appId: '1:90870907521:web:8c1415d339825d9d7dc380' };
  let au, fs, auth, db, user = null, status = 'loading', err = '', unsubSites = null, unsubPts = null, openId = null;
  const timers = {};
  const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {}) : v;
  const stable = v => JSON.stringify(sortKeys(v));
  const clean = v => JSON.parse(JSON.stringify(v, (k, x) => (k && k[0] === '_') ? undefined : (typeof x === 'number' && !isFinite(x)) ? null : x));
  const kKey = id => 'sv:sync:' + id;
  const getK = id => store.get(kKey(id), { pts: {}, meta: '' });
  const who = () => user ? (user.email || user.uid) : '';
  function setErr(e){
    const m = (e && (e.code || e.message)) || String(e);
    err = m.includes('permission-denied') ? 'This account is not allowed to sync (Firestore rules).'
      : m.includes('unauthorized-domain') ? 'Sign-in blocked: add this site under Firebase → Authentication → Authorized domains.'
      : m.includes('popup-closed') || m.includes('cancelled-popup') ? '' : 'Sync error: ' + m;
    render();
  }
  function render(){
    const el = $('#cloudMsg'); if (!el) return;
    el.innerHTML = status === 'unavailable' ? 'Not available (no signal when opened). Points are safe on this device.'
      : status === 'loading' ? 'Starting…' : user ? `Signed in as <b>${esc(user.email || 'Google account')}</b> – sites and points sync ${navigator.onLine ? 'now' : 'when back online'}.`
      : 'Not signed in – points stay on this device only.';
    if (err) el.innerHTML += `<br><span style="color:var(--cut)">${esc(err)}</span>`;
    $('#cloudIn').style.display = status === 'ready' && !user ? '' : 'none';
  }
  const meta = s => ({ name: s.name, zone: s.zone, created: s.created });
  function pushSite(id){
    if (!user || !db) return;
    const s = sites.find(x => x.id === id), k = getK(id), ops = [];
    if (!s) { // deleted locally
      ops.push(['del', fs.doc(db, 'sites', id)]);
      for (const pid of Object.keys(k.pts)) ops.push(['del', fs.doc(db, 'sites', id, 'pts', pid)]);
      try { localStorage.removeItem(kKey(id)); } catch (e) {}
    } else {
      const m = clean(meta(s)), mh = stable(m);
      if (k.meta !== mh) { ops.push(['set', fs.doc(db, 'sites', id), { ...m, _by: who(), _t: fs.serverTimestamp() }]); k.meta = mh; }
      const d = store.get(dataKey(id), { pts: [] }), ids = new Set();
      for (const p of d.pts || []) {
        ids.add(p.id); const c = clean(p), h = stable(c);
        if (k.pts[p.id] !== h) { ops.push(['set', fs.doc(db, 'sites', id, 'pts', p.id), { ...c, _t: fs.serverTimestamp() }]); k.pts[p.id] = h; }
      }
      for (const pid of Object.keys(k.pts)) if (!ids.has(pid)) { ops.push(['del', fs.doc(db, 'sites', id, 'pts', pid)]); delete k.pts[pid]; }
      store.set(kKey(id), k);
    }
    for (let i = 0; i < ops.length; i += 400) {
      const b = fs.writeBatch(db);
      for (const [t, ref, data] of ops.slice(i, i + 400)) t === 'set' ? b.set(ref, data) : b.delete(ref);
      b.commit().then(() => { err = ''; render(); }).catch(setErr);
    }
  }
  function onSites(snap){
    let changed = false;
    for (const ch of snap.docChanges()) {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        if (sites.some(s => s.id === id)) { sites = sites.filter(s => s.id !== id); try { localStorage.removeItem(dataKey(id)); localStorage.removeItem(kKey(id)); } catch (e) {} changed = true; if (site && site.id === id) openSite(null); }
        continue;
      }
      if (ch.doc.metadata.hasPendingWrites) continue;
      const m = clean(ch.doc.data()), i = sites.findIndex(s => s.id === id);
      const k = getK(id); k.meta = stable(clean(meta(m))); store.set(kKey(id), k);
      if (i < 0) { sites.push({ id, ...meta(m) }); changed = true; }
      else if (stable(meta(sites[i])) !== stable(meta(m))) { sites[i] = { id, ...meta(m) }; changed = true; if (site && site.id === id) { site = sites[i]; $('#siteName').textContent = site.name; } }
    }
    if (changed) { saveSites(); if ($('#sitesSheet').classList.contains('open')) renderSites(); if (!site && sites.length) openSite(store.get('sv:last', sites[0].id)); }
  }
  function onPts(id, snap){
    if (!site || site.id !== id) return;
    const k = getK(id); let changed = false;
    for (const ch of snap.docChanges()) {
      const pid = ch.doc.id;
      if (ch.type === 'removed') { delete k.pts[pid]; const n = D.pts.length; D.pts = D.pts.filter(p => p.id !== pid); if (D.pts.length !== n) changed = true; continue; }
      if (ch.doc.metadata.hasPendingWrites) continue;
      const data = clean(ch.doc.data()), h = stable(data), i = D.pts.findIndex(p => p.id === pid);
      if (i < 0) { D.pts.push(data); changed = true; }
      else { const loc = stable(clean(D.pts[i])), dirty = k.pts[pid] && loc !== k.pts[pid]; if (loc !== h && !dirty) { D.pts[i] = data; changed = true; } }
      k.pts[pid] = h;
    }
    store.set(kKey(id), k);
    if (changed) { D.nextN = Math.max(D.nextN || 1, ...D.pts.map(p => (p.n || 0) + 1)); saveData(false); renderPoints(); }
  }
  function attach(){
    if (unsubSites) unsubSites();
    unsubSites = fs.onSnapshot(fs.collection(db, 'sites'), onSites, setErr);
    for (const s of sites) pushSite(s.id); // first sign-in: upload what's on this device
    if (site) openSiteListen(site.id);
  }
  function openSiteListen(id){
    if (unsubPts) { unsubPts(); unsubPts = null; }
    openId = id; if (!user || !db || !id) return;
    unsubPts = fs.onSnapshot(fs.collection(db, 'sites', id, 'pts'), s => onPts(id, s), setErr);
  }
  (async () => {
    try {
      const [app, a, f] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
      au = a; fs = f;
      const fbApp = app.initializeApp(cfg);
      auth = au.getAuth(fbApp);
      try { db = fs.initializeFirestore(fbApp, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); } catch (e) { db = fs.getFirestore(fbApp); }
      status = 'ready';
      au.getRedirectResult(auth).catch(setErr);
      au.onAuthStateChanged(auth, u => {
        user = u;
        if (u) attach(); else { if (unsubSites) unsubSites(); if (unsubPts) unsubPts(); unsubSites = unsubPts = null; }
        render();
      });
    } catch (e) { status = 'unavailable'; }
    render();
  })();
  $('#cloudIn').onclick = async () => {
    if (!auth) return; err = ''; render();
    const p = new au.GoogleAuthProvider();
    try { await au.signInWithPopup(auth, p); }
    catch (e) { if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) { try { await au.signInWithRedirect(auth, p); } catch (e2) { setErr(e2); } } else setErr(e); }
  };
  addEventListener('online', render); addEventListener('offline', render);
  return {
    who, render,
    changed(id){ if (!user) return; clearTimeout(timers[id]); timers[id] = setTimeout(() => pushSite(id), 400); },
    openSite(id){ if (user) openSiteListen(id); },
    deleteSite(id){ if (user) pushSite(id); }
  };
})();

/* ---------- start ---------- */
renderCodes(); renderPanel();
openSite(store.get('sv:last', sites[0]?.id));
if (!site) setTimeout(() => { renderSites(); openSheet('sitesSheet'); }, 300);
startGps();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
