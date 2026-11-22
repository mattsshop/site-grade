// Site Grade – cloud sync (Firebase) – added in v1.6.0
// Syncs shots, target points and GPS control points per project between devices.
// localStorage stays the working copy (works with no signal); Firestore keeps every device in step.
// Calibration, laser HI and settings stay on each device.
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const firebaseConfig = {
  apiKey: 'AIzaSyDDwuwStTYw2sv2mqdjDWImbAPJwIhZoVg',
  authDomain: 'site-grade.firebaseapp.com',
  projectId: 'site-grade',
  storageBucket: 'site-grade.firebasestorage.app',
  messagingSenderId: '90870907521',
  appId: '1:90870907521:web:8c1415d339825d9d7dc380'
};

const C = window.cloud = { status: 'loading', user: null, err: '', lastSync: 0, pending: 0 };
const COLS = ['shots', 'points'];
let au, fs, auth, db, unsubs = [], pid = null, known = null, pushTimer = null;

/* ---------- helpers ---------- */
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {}) : v;
const stable = v => JSON.stringify(sortKeys(v));
// strip sync metadata (keys starting with _) and anything Firestore can't store (undefined, NaN)
const clean = v => JSON.parse(JSON.stringify(v, (k, x) => (k && k[0] === '_') ? undefined : (typeof x === 'number' && !isFinite(x)) ? null : x));
const newId = c => (c === 'shots' ? 'gs_' : 'gp_') + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const kKey = p => 'sg:sync:' + p;
const loadKnown = p => { try { const k = JSON.parse(localStorage.getItem(kKey(p))); if (k && k.shots) return k; } catch (e) {} return { shots: {}, points: {}, geo: '' }; };
const saveKnown = () => { try { localStorage.setItem(kKey(pid), JSON.stringify(known)); } catch (e) {} };
const saveLocal = () => { try { localStorage.setItem('sg:' + proj.id, JSON.stringify(S)); } catch (e) {} }; // no push
const who = () => C.user ? (C.user.email || C.user.uid) : '';
function setErr(e){
  const m = (e && (e.code || e.message)) || String(e);
  C.err = m.includes('permission-denied') ? 'This account is not allowed to sync – ask Matt to add it.'
    : m.includes('unauthorized-domain') ? 'Sign-in blocked: add this site to Firebase → Authentication → Authorized domains.'
    : m.includes('popup-closed') || m.includes('cancelled-popup') ? '' : 'Sync error: ' + m;
  render();
}

/* ---------- UI (Setup → Cloud sync card) ---------- */
function render(){
  const el = document.getElementById('cloudStatus'); if (!el) return;
  const inB = document.getElementById('cloudIn'), outB = document.getElementById('cloudOut');
  let h = '';
  if (C.status === 'loading') h = '<span style="grid-column:1/3">Starting…</span>';
  else if (C.status === 'unavailable') h = '<span style="grid-column:1/3;color:var(--target)">Cloud sync not available (no signal when the app opened). Your data is safe on this device – it will sync next time.</span>';
  else if (!C.user) h = '<span style="grid-column:1/3">Not signed in – shots stay on this device only.</span>';
  else {
    h = `<span>Signed in</span><b>${(C.user.email || 'Google account').replace(/</g, '&lt;')}</b>`;
    h += `<span>Status</span><b style="color:${navigator.onLine ? 'var(--ok)' : 'var(--target)'}">${navigator.onLine ? 'Syncing' : 'Offline – will sync later'}</b>`;
    if (C.lastSync) h += `<span>Last sync</span><b>${new Date(C.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b>`;
  }
  if (C.err) h += `<span style="grid-column:1/3;color:var(--cut)">${C.err.replace(/</g, '&lt;')}</span>`;
  el.innerHTML = h;
  if (inB) inB.style.display = (C.status === 'ready' && !C.user) ? '' : 'none';
  if (outB) outB.style.display = C.user ? '' : 'none';
  const dot = document.getElementById('cloudDot');
  if (dot) { dot.style.display = C.user ? '' : 'none'; dot.title = navigator.onLine ? 'Cloud sync on' : 'Offline – will sync'; dot.style.opacity = navigator.onLine ? 1 : .45; }
}
window.cloudRender = render;
addEventListener('online', render); addEventListener('offline', render);

/* ---------- remote → local ---------- */
function rerender(geoChanged){
  saveLocal();
  if (geoChanged && typeof geoFit === 'function') geoFit();
  if (typeof renderPins === 'function') renderPins();
  if (document.getElementById('logView')?.classList.contains('active') && typeof renderLog === 'function') renderLog();
  if (document.getElementById('setupView')?.classList.contains('active') && typeof renderSetup === 'function') renderSetup();
}
function onRemote(c, snap){
  if (!S || !proj || proj.id !== pid) return;
  let changed = false;
  for (const ch of snap.docChanges()) {
    const id = ch.doc.id;
    if (ch.type === 'removed') {
      delete known[c][id];
      const n = S[c].length; S[c] = S[c].filter(x => x.id !== id);
      if (S[c].length !== n) changed = true;
      continue;
    }
    if (ch.doc.metadata.hasPendingWrites) continue; // our own write echoing back
    const data = clean(ch.doc.data()), hs = stable(data);
    const i = S[c].findIndex(x => x.id === id);
    if (i < 0) { S[c].push(data); changed = true; }
    else {
      const local = stable(clean(S[c][i]));
      const dirty = known[c][id] && local !== known[c][id]; // edited here, not pushed yet → keep ours
      if (local !== hs && !dirty) { S[c][i] = data; changed = true; }
    }
    known[c][id] = hs;
  }
  if (c === 'shots' && changed) {
    S.shots.sort((a, b) => (a.time || 0) - (b.time || 0));
    S.nextShot = Math.max(S.nextShot || 1, ...S.shots.map(s => (s.n || 0) + 1));
  }
  saveKnown(); C.lastSync = Date.now();
  if (changed) rerender(false);
  render();
}
function onGeo(d){
  if (!S || !proj || proj.id !== pid || !d.exists() || d.metadata.hasPendingWrites) return;
  const list = clean(d.data().list || []), hs = stable(list), local = stable(clean(S.geo));
  const dirty = known.geo && local !== known.geo;
  known.geo = hs; saveKnown();
  if (local !== hs && !dirty) { S.geo = list; rerender(true); }
}

/* ---------- local → remote ---------- */
function schedulePush(ms){ clearTimeout(pushTimer); pushTimer = setTimeout(push, ms); }
async function push(){
  if (!C.user || !db || !S || !proj || proj.id !== pid) return;
  const ops = [];
  let idsAdded = false;
  for (const c of COLS) {
    const ids = new Set();
    for (const it of S[c]) {
      if (!it.id) { it.id = newId(c); idsAdded = true; }
      ids.add(it.id);
      const d = clean(it), hs = stable(d);
      if (known[c][it.id] !== hs) { ops.push(['set', fs.doc(db, 'projects', pid, c, it.id), { ...d, _by: who(), _t: fs.serverTimestamp() }]); known[c][it.id] = hs; }
    }
    for (const id of Object.keys(known[c])) if (!ids.has(id)) { ops.push(['del', fs.doc(db, 'projects', pid, c, id)]); delete known[c][id]; }
  }
  const g = clean(S.geo || []), gh = stable(g);
  if (known.geo !== gh) { ops.push(['set', fs.doc(db, 'projects', pid, 'meta', 'geo'), { list: g, _by: who(), _t: fs.serverTimestamp() }]); known.geo = gh; }
  if (idsAdded) saveLocal();
  saveKnown();
  if (!ops.length) return;
  try {
    for (let i = 0; i < ops.length; i += 400) {
      const b = fs.writeBatch(db);
      for (const [t, ref, data] of ops.slice(i, i + 400)) t === 'set' ? b.set(ref, data) : b.delete(ref);
      b.commit().then(() => { C.lastSync = Date.now(); C.err = ''; render(); }).catch(setErr); // resolves when the server has it; queued offline
    }
  } catch (e) { setErr(e); }
}

/* ---------- per-project listeners ---------- */
function detach(){ unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = []; pid = null; }
function attach(){
  detach();
  if (!C.user || !db || !proj || !S) return;
  pid = proj.id; known = loadKnown(pid);
  for (const c of COLS) unsubs.push(fs.onSnapshot(fs.collection(db, 'projects', pid, c), { includeMetadataChanges: false }, s => onRemote(c, s), setErr));
  unsubs.push(fs.onSnapshot(fs.doc(db, 'projects', pid, 'meta', 'geo'), onGeo, setErr));
  schedulePush(1500); // first sign-in on this device: uploads what's already here
}
window.cloudOnSave = () => { if (C.user && pid && proj && proj.id === pid) schedulePush(400); };
window.cloudOnProject = () => { if (C.user) attach(); render(); };

C.signIn = async () => {
  if (!auth) return;
  C.err = ''; render();
  const p = new au.GoogleAuthProvider();
  try { await au.signInWithPopup(auth, p); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) { try { await au.signInWithRedirect(auth, p); } catch (e2) { setErr(e2); } }
    else setErr(e);
  }
};
C.signOut = async () => { detach(); try { await au.signOut(auth); } catch (e) { setErr(e); } };
C.syncNow = () => { if (C.user) schedulePush(0); };

/* ---------- start ---------- */
(async () => {
  try {
    const [app, auth_, fs_] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
    au = auth_; fs = fs_;
    const fbApp = app.initializeApp(firebaseConfig);
    auth = au.getAuth(fbApp);
    try { db = fs.initializeFirestore(fbApp, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
    catch (e) { db = fs.getFirestore(fbApp); }
    C.status = 'ready';
    au.getRedirectResult(auth).catch(setErr);
    au.onAuthStateChanged(auth, u => {
      const was = C.user; C.user = u;
      if (u) { attach(); if (!was) window.toast && toast('Cloud sync on – ' + (u.email || 'signed in')); }
      else detach();
      render();
    });
  } catch (e) { C.status = 'unavailable'; render(); }
  render();
})();
document.getElementById('cloudIn')?.addEventListener('click', () => C.signIn());
document.getElementById('cloudOut')?.addEventListener('click', () => C.signOut());
