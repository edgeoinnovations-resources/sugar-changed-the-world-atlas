/* ============================================================
   Sugar Changed the World — interactive atlas
   MapLibre GL JS + self-hosted Natural Earth. No API keys.
   ============================================================ */
'use strict';

const ACT_COLOR = { 0:'#3d3226', 1:'#b8791f', 2:'#9c2f2a', 3:'#1f5f80', 4:'#4a6f3c', 5:'#5d4e86' };
const EPOCHS = [-7500,-6000,-2000,-900,-515,-327,-286,530,640,700,950,1100,1200,1300,1400,1450,
                1493,1550,1600,1650,1700,1750,1800,1838,1870,1900,1917,1950];
const fmtYear = y => y < 0 ? `${Math.abs(y).toLocaleString()} BC` : `${y}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let DATA = {}, map, srcMarkers = [], popup, activeLayers = new Set(), curYear = 1950,
    curEra = 'e2', mode = 'story', playTimer = null, placeMarkers = [],
    gratMarkers = [], globeOn = false, userTurning = false, spinRAF = null, curStep = null;
const GRAT_LAYERS = ['grat-l', 'grat-polar', 'grat-trop', 'grat-eq'];
const LAND_SWAP = 5;            // zoom at which the 1:110m base hands over to 1:10m

/* ── geometry helpers ─────────────────────────────────────── */
function arc(a, b, bend = 0.2, n = 64) {
  let [x1, y1] = a, [x2, y2] = b;
  if (x2 - x1 > 180) x2 -= 360;
  if (x2 - x1 < -180) x2 += 360;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const cx = (x1 + x2) / 2 - dy * bend, cy = (y1 + y2) / 2 + dx * bend;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2]);
  }
  return pts;
}
function camPad() {
  if (window.innerWidth <= 900) return { top: 0, right: 0, bottom: 0, left: 0 };
  const el = document.getElementById('panel');
  const w = el ? el.getBoundingClientRect().width : 0;
  return { top: 20, right: 30, bottom: 20, left: Math.round(w) + 30 };
}
const fc = features => ({ type: 'FeatureCollection', features });
const pt = (lon, lat, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lon, lat] } });
const ln = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });

/* ── boot ─────────────────────────────────────────────────── */
Promise.all([
  fetch('data/sources.json').then(r => r.json()),
  fetch('data/layers.json').then(r => r.json()),
  fetch('data/narrative.json').then(r => r.json())
]).then(([s, l, n]) => {
  DATA = { sources: s.sources, ...l, ...n };
  // Build the readable site first so a map failure never costs the text and sources.
  buildStory();
  buildSourceGrid();
  wireUI();
  try { buildMap(); } catch (e) {
    document.getElementById('map').innerHTML =
      `<div style="padding:24px;max-width:34em;font-size:14px;line-height:1.6;color:#4b4036">
         <b>The map could not start.</b><br>${esc(e.message)}<br><br>
         This usually means the browser has WebGL disabled or unavailable.
         The story text and all 49 sources still work.</div>`;
  }
}).catch(e => {
  document.getElementById('story').innerHTML =
    `<div class="pad"><h2>Could not load the data</h2><p>${esc(e.message)}</p>
     <p class="lede">If you opened <code>index.html</code> straight off the disk, your browser blocked the data files.
     Run a local server instead: <code>python3 -m http.server</code> in this folder, then open
     <code>http://localhost:8000</code>.</p></div>`;
});

/* ── map ──────────────────────────────────────────────────── */
function buildMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8, sources: {}, layers: [
        { id: 'sea', type: 'background', paint: { 'background-color': '#dbd3c3' } }
      ]
    },
    center: [20, 15], zoom: 1.5, minZoom: 0.6, maxZoom: 11,
    attributionControl: { compact: true, customAttribution:
      'Basemap: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain) · ' +
      'Content after Aronson &amp; Budhos, <i>Sugar Changed the World</i> (2010)' },
    dragRotate: false, pitchWithRotate: false
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('load', onMapLoad);
}

function onMapLoad() {
  /* ---- basemap ---- */
  map.addSource('land', { type: 'geojson', data: 'data/ne_land.json' });
  map.addSource('countries', { type: 'geojson', data: 'data/ne_admin_0_countries.json' });
  map.addSource('grat', { type: 'geojson', data: 'data/ne_geographic_lines.json' });
  /* small islands the 1:110m land file drops entirely (Antigua, St Kitts, Dominica …) —
     only drawn once you zoom in, so the world view stays as designed */
  map.addSource('islands', { type: 'geojson', data: 'data/ne_islands.json' });
  /* 1:10m coastline (~1.3 km), which takes over from the 1:110m base once the story
     zooms in close enough for the coarse outline to stop looking like a coastline */
  map.addSource('land10', { type: 'geojson', data: 'data/ne_land_10m.json' });

  map.addLayer({ id: 'land-f', type: 'fill', source: 'land', maxzoom: LAND_SWAP,
    paint: { 'fill-color': '#f5f0e5' } });
  map.addLayer({ id: 'land10-f', type: 'fill', source: 'land10', minzoom: LAND_SWAP,
    paint: { 'fill-color': '#f5f0e5' } });
  map.addLayer({ id: 'isl-f', type: 'fill', source: 'islands', minzoom: 4,
    paint: { 'fill-color': '#f5f0e5' } });
  /* borders are 1:110m too, so they stop where the coastline gets sharper —
     past that they wander off the coast by more than they are worth */
  map.addLayer({ id: 'ctry-l', type: 'line', source: 'countries', maxzoom: 6.5,
    paint: { 'line-color': '#cfc3aa', 'line-width': 0.7 } });
  map.addLayer({ id: 'land-l', type: 'line', source: 'land', maxzoom: LAND_SWAP,
    paint: { 'line-color': '#bfb097', 'line-width': 0.9 } });
  map.addLayer({ id: 'land10-l', type: 'line', source: 'land10', minzoom: LAND_SWAP,
    paint: { 'line-color': '#bfb097', 'line-width': 0.9 } });
  map.addLayer({ id: 'isl-l', type: 'line', source: 'islands', minzoom: 4,
    paint: { 'line-color': '#bfb097', 'line-width': 0.9 } });
  map.addSource('latlines', { type: 'geojson', data: latLines() });

  /* Graticule in three weights so the lines can be told apart: the equator solid, the
     tropics heavier and warm (they are the point of the layer — cane grows between them),
     the polar circles and the date line faint. */
  map.addLayer({ id: 'grat-l', type: 'line', source: 'grat',
    filter: ['==', ['get', 'name'], 'International Date Line'],
    layout: { visibility: 'none' },
    paint: { 'line-color': '#a89b7d', 'line-width': 1, 'line-dasharray': [2, 4], 'line-opacity': 0.4 } });
  map.addLayer({ id: 'grat-polar', type: 'line', source: 'latlines',
    filter: ['==', ['get', 'cls'], 'polar'],
    layout: { visibility: 'none' },
    paint: { 'line-color': '#a89b7d', 'line-width': 1, 'line-dasharray': [2, 4], 'line-opacity': 0.5 } });
  map.addLayer({ id: 'grat-trop', type: 'line', source: 'latlines',
    filter: ['==', ['get', 'cls'], 'trop'],
    layout: { visibility: 'none', 'line-cap': 'butt' },
    paint: { 'line-color': '#a8762c', 'line-width': 1.5, 'line-dasharray': [4, 2.5], 'line-opacity': 0.85 } });
  map.addLayer({ id: 'grat-eq', type: 'line', source: 'latlines',
    filter: ['==', ['get', 'cls'], 'eq'],
    layout: { visibility: 'none' },
    paint: { 'line-color': '#6f5f47', 'line-width': 1.6, 'line-opacity': 0.9 } });

  buildThematic();
  applyState();

  /* pointer + popups */
  const clickable = ['diff-node', 'plant-c', 'st-emb', 'st-dest', 'sph-node', 'free-c', 'ind-o', 'ind-d', 'sci-c'];
  clickable.forEach(id => {
    map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', id, () => map.getCanvas().style.cursor = '');
    map.on('click', id, e => showPopup(e.features[0], e.lngLat));
  });
  ['diff-arc', 'sph-flow', 'ind-arc', 'ind-arc2'].forEach(id => {
    map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', id, () => map.getCanvas().style.cursor = '');
    map.on('click', id, e => showPopup(e.features[0], e.lngLat));
  });

  buildSourceMarkers();
  wireGlobeSpin();
  map.on('move', positionGratLabels);
}

/* ── thematic layers ──────────────────────────────────────── */
function buildThematic() {
  const D = DATA;

  /* 1 · diffusion ------------------------------------------------ */
  const nodeById = Object.fromEntries(D.diffusion.nodes.map(n => [n.id, n]));
  map.addSource('diff-arcs', { type: 'geojson', data: fc(D.diffusion.arcs.map(a => {
    const f = nodeById[a.from], t = nodeById[a.to];
    return ln(arc([f.lon, f.lat], [t.lon, t.lat], a.hinge ? 0.14 : 0.2),
      { year: a.year, label: a.label, hinge: !!a.hinge, kind: 'diff-arc',
        name: `${f.name} → ${t.name}`, when: fmtYear(a.year) });
  })) });
  map.addSource('diff-nodes', { type: 'geojson', data: fc(D.diffusion.nodes.map(n =>
    pt(n.lon, n.lat, { ...n, kind: 'diff-node' }))) });

  map.addLayer({ id: 'diff-arc', type: 'line', source: 'diff-arcs',
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: {
      'line-color': ['case', ['get', 'hinge'], '#9c2f2a', '#b8791f'],
      'line-width': ['case', ['get', 'hinge'], 3.2, 1.7],
      'line-opacity': 0.85,
      'line-dasharray': [2.2, 1.6]
    } });
  map.addLayer({ id: 'diff-node', type: 'circle', source: 'diff-nodes',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4.5, 6, 8],
      'circle-color': '#b8791f', 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f2'
    } });

  /* 2 · plantations ---------------------------------------------- */
  map.addSource('plants', { type: 'geojson', data: fc(D.plantations.map(p =>
    pt(p.lon, p.lat, { ...p, year: p.intro, kind: 'plant' }))) });
  map.addLayer({ id: 'plant-halo', type: 'circle', source: 'plants',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 9, 6, 22],
      'circle-color': '#9c2f2a', 'circle-opacity': 0.13
    } });
  map.addLayer({ id: 'plant-c', type: 'circle', source: 'plants',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4.5, 6, 9],
      'circle-color': '#9c2f2a', 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f2'
    } });

  /* 2b · slave trade --------------------------------------------- */
  map.addSource('st-emb-s', { type: 'geojson', data: fc(D.slaveTrade.embarkation.map(e =>
    pt(e.lon, e.lat, { ...e, kind: 'st-emb' }))) });
  map.addSource('st-dest-s', { type: 'geojson', data: fc(D.slaveTrade.destinations.map(d =>
    pt(d.lon, d.lat, { ...d, kind: 'st-dest' }))) });
  const stArcs = [];
  D.slaveTrade.embarkation.forEach(e => D.slaveTrade.destinations.forEach(d => {
    stArcs.push(ln(arc([e.lon, e.lat], [d.lon, d.lat], 0.13, 48), { kind: 'st-arc' }));
  }));
  map.addSource('st-arcs-s', { type: 'geojson', data: fc(stArcs) });

  map.addLayer({ id: 'st-arc', type: 'line', source: 'st-arcs-s',
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#9c2f2a', 'line-width': 1, 'line-opacity': 0.22 } });
  map.addLayer({ id: 'st-emb', type: 'circle', source: 'st-emb-s',
    layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 6, 6, 12],
      'circle-color': '#5a2320', 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f2' } });
  map.addLayer({ id: 'st-dest', type: 'circle', source: 'st-dest-s',
    layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 6, 6, 13],
      'circle-color': '#c1544b', 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f2' } });

  /* 3 · spherical trade ------------------------------------------ */
  const sphById = Object.fromEntries(D.sphericalTrade.nodes.map(n => [n.id, n]));
  const KIND_C = { goods: '#1f5f80', people: '#9c2f2a', sugar: '#b8791f', silver: '#5d4e86' };
  map.addSource('sph-flows', { type: 'geojson', data: fc(D.sphericalTrade.flows.map(f => {
    const a = sphById[f.from], b = sphById[f.to];
    return ln(arc([a.lon, a.lat], [b.lon, b.lat], 0.17, 56),
      { ...f, kind: 'sph-flow', color: KIND_C[f.kind], name: `${a.name} → ${b.name}` });
  })) });
  map.addSource('sph-nodes', { type: 'geojson', data: fc(D.sphericalTrade.nodes.map(n =>
    pt(n.lon, n.lat, { ...n, kind: 'sph-node' }))) });
  map.addLayer({ id: 'sph-flow', type: 'line', source: 'sph-flows',
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.8 } });
  map.addLayer({ id: 'sph-node', type: 'circle', source: 'sph-nodes',
    layout: { visibility: 'none' },
    paint: { 'circle-radius': 4.5, 'circle-color': '#3d3226',
      'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f2' } });

  /* 4 · freedom -------------------------------------------------- */
  map.addSource('free-s', { type: 'geojson', data: fc(D.freedom.map(f =>
    pt(f.lon, f.lat, { ...f, kind: 'free' }))) });
  map.addLayer({ id: 'free-c', type: 'circle', source: 'free-s',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'],
        1, ['case', ['coalesce', ['get', 'major'], false], 7, 4.5],
        6, ['case', ['coalesce', ['get', 'major'], false], 13, 9]],
      'circle-color': '#1f5f80', 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f2'
    } });

  /* 5 · indenture ------------------------------------------------ */
  const indArcs = [];
  D.indenture.origins.forEach(o => D.indenture.destinations.forEach(d => {
    if (o.id === 'bhojpur') return;
    indArcs.push(ln(arc([o.lon, o.lat], [d.lon, d.lat], 0.15, 64),
      { kind: 'ind-arc', name: `${o.name} → ${d.name}`, inBook: d.inBook, year: 1838 }));
  }));
  map.addSource('ind-arcs-s', { type: 'geojson', data: fc(indArcs) });
  map.addSource('ind-o-s', { type: 'geojson', data: fc(DATA.indenture.origins.map(o =>
    pt(o.lon, o.lat, { ...o, kind: 'ind-o' }))) });
  map.addSource('ind-d-s', { type: 'geojson', data: fc(DATA.indenture.destinations.map(d =>
    pt(d.lon, d.lat, { ...d, kind: 'ind-d' }))) });
  map.addLayer({ id: 'ind-arc', type: 'line', source: 'ind-arcs-s',
    layout: { visibility: 'none', 'line-cap': 'round' },
    filter: ['==', ['get', 'inBook'], true],
    paint: { 'line-color': '#4a6f3c', 'line-width': 1.6, 'line-opacity': 0.72 } });
  map.addLayer({ id: 'ind-arc2', type: 'line', source: 'ind-arcs-s',
    layout: { visibility: 'none', 'line-cap': 'round' },
    filter: ['==', ['get', 'inBook'], false],
    paint: { 'line-color': '#4a6f3c', 'line-width': 1.4, 'line-opacity': 0.34,
             'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'ind-o', type: 'circle', source: 'ind-o-s',
    layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 6, 6, 12],
      'circle-color': '#2f4a25', 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f2' } });
  map.addLayer({ id: 'ind-d', type: 'circle', source: 'ind-d-s',
    layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5, 6, 10],
      'circle-color': '#4a6f3c', 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f2' } });

  /* 6 · science -------------------------------------------------- */
  map.addSource('sci-s', { type: 'geojson', data: fc(DATA.science.map(s =>
    pt(s.lon, s.lat, { ...s, kind: 'sci' }))) });
  map.addLayer({ id: 'sci-c', type: 'circle', source: 'sci-s',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'],
        1, ['case', ['coalesce', ['get', 'major'], false], 7, 5],
        6, ['case', ['coalesce', ['get', 'major'], false], 13, 10]],
      'circle-color': '#5d4e86', 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f2'
    } });
}

/* ── source markers (HTML) ────────────────────────────────── */
function buildSourceMarkers() {
  DATA.sources.forEach(s => {
    const el = document.createElement('button');
    el.className = 'pin src' + (s.kind === 'map' ? ' map-kind' : '') + (s.kind === 'missing' ? ' miss' : '');
    el.style.setProperty('--c', ACT_COLOR[s.act] || ACT_COLOR[0]);
    el.innerHTML = '<span class="dot"></span>';
    el.title = s.title;
    el.setAttribute('aria-label', `Primary source: ${s.title}, ${s.date}`);
    el.addEventListener('click', ev => { ev.stopPropagation(); openSheet(s.id); });
    const m = new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
    el.setAttribute('aria-label', `Primary source: ${s.title}, ${s.date}`); // after addTo — MapLibre overwrites it
    srcMarkers.push({ id: s.id, act: s.act, marker: m, el });
  });
}

/* ── globe ────────────────────────────────────────────────────
   Steps marked "globe": true swap the flat map for a real 3-D globe and set it
   turning. Students can drag it, and the spin picks itself back up afterwards. */
const SPIN_DEG_PER_SEC = 4;                    // one full turn in about a minute and a half

function setGlobe(on) {
  if (!map || typeof map.setProjection !== 'function') return;   // no globe before MapLibre 5
  if (on === globeOn) return;
  globeOn = on;
  map.setProjection({ type: on ? 'globe' : 'mercator' });
  document.getElementById('map').classList.toggle('globe', on);
  if (on) startSpin(); else stopSpin();
}

/* One animation loop, never a chain of eased moves. An earlier version queued the next
   ease from 'moveend', which forked: a single drag fires both 'mouseup' and 'dragend',
   so two chains started, then four, and the competing eases stamped on every camera
   move the story asked for — including the one that carries you to the next step. */
function startSpin() {
  stopSpin();
  let last = 0;
  const tick = now => {
    spinRAF = requestAnimationFrame(tick);
    if (!last) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.25);   // a hidden tab comes back with a huge gap
    last = now;
    // hold still while the reader has hold of it, and while the story is flying the camera
    if (userTurning || map.isEasing() || map.isZooming() || map.isRotating()) return;
    const c = map.getCenter();
    map.setCenter([c.lng - SPIN_DEG_PER_SEC * dt, c.lat]);
  };
  spinRAF = requestAnimationFrame(tick);
}

function stopSpin() {
  if (spinRAF) cancelAnimationFrame(spinRAF);
  spinRAF = null;
  userTurning = false;
}

function wireGlobeSpin() {
  // only meaningful while the globe is up; the story's own eases must not look like a grab
  const hold = () => { if (globeOn) userTurning = true; };
  const release = () => { userTurning = false; };
  ['dragstart', 'wheel'].forEach(ev => map.on(ev, hold));
  ['dragend', 'zoomend', 'rotateend'].forEach(ev => map.on(ev, release));
  // let go outside the canvas and the map never hears about it
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
}

/* ── graticule ────────────────────────────────────────────────
   The latitude circles are generated here rather than taken from the Natural Earth
   lines file. That file stores each circle as a single line running the whole way
   round the world, and MapLibre only ever drew it in one copy of the world — which is
   why the equator gave out east of Greenwich. Short segments render everywhere. The
   file is still used for the International Date Line, which is a political zig-zag. */
const LAT_LINES = [
  { name: 'Equator',             lat: 0,        cls: 'eq' },
  { name: 'Tropic of Cancer',    lat: 23.4365,  cls: 'trop' },
  { name: 'Tropic of Capricorn', lat: -23.4365, cls: 'trop' },
  { name: 'Arctic Circle',       lat: 66.5635,  cls: 'polar' },
  { name: 'Antarctic Circle',    lat: -66.5635, cls: 'polar' }
];

function latLines() {
  const feats = [];
  LAT_LINES.forEach(L => {
    for (let x0 = -180; x0 < 180; x0 += 30) {
      const pts = [];
      for (let x = x0; x <= x0 + 30; x += 2) pts.push([x, L.lat]);
      feats.push(ln(pts, { name: L.name, cls: L.cls }));
    }
  });
  return fc(feats);
}

/* ── graticule labels ─────────────────────────────────────────
   The lines are useless if you cannot tell which is which. These ride along the
   left edge of the *visible* map, so they stay put as the map is panned. */
const GRAT_LABELS = [
  { name: 'Tropic of Cancer', lat: 23.4365 },
  { name: 'Equator', lat: 0 },
  { name: 'Tropic of Capricorn', lat: -23.4365 }
];

function setGratLabels(on) {
  gratMarkers.forEach(g => g.marker.remove());
  gratMarkers = [];
  if (!on || !map) return;
  GRAT_LABELS.forEach(g => {
    const el = document.createElement('div');
    el.innerHTML = '<span class="plabel grat"></span>';
    el.firstChild.textContent = g.name;
    el.style.pointerEvents = 'none';
    gratMarkers.push({ lat: g.lat,      // anchor left, or the text runs back under the panel
      marker: new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat([0, g.lat]).addTo(map) });
  });
  positionGratLabels();
}

function positionGratLabels() {
  if (!gratMarkers.length || !map) return;
  const h = map.getCanvas().clientHeight;
  const lng = map.unproject([camPad().left + 20, h / 2]).lng;    // just inside the exposed map
  gratMarkers.forEach(g => g.marker.setLngLat([lng, g.lat]));
}

/* Place names for steps that sit too close in for the reader to recognise where they are.
   Driven by an optional "places":[{name, at:[lon,lat]}] on the narrative step. */
function setPlaceLabels(places) {
  placeMarkers.forEach(m => m.remove());
  placeMarkers = [];
  (places || []).forEach(p => {
    const el = document.createElement('div');           // MapLibre owns this element's transform,
    el.innerHTML = `<span class="plabel"></span>`;      // so the offset lives on the inner span
    el.firstChild.textContent = p.name;
    el.style.pointerEvents = 'none';
    placeMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(p.at).addTo(map));
  });
}

/* ── popups ───────────────────────────────────────────────── */
function showPopup(f, lngLat) {
  const p = f.properties;
  let html = '<div class="pop">';
  const title = p.name || p.label || '';
  html += `<h5>${esc(title)}</h5>`;
  if (p.when) html += `<div class="when">${esc(p.when)}</div>`;
  else if (p.year && p.kind !== 'plant') html += `<div class="when">${esc(fmtYear(+p.year))}</div>`;

  if (p.kind === 'plant') {
    html += `<div class="when">Sugar introduced ${esc(fmtYear(+p.intro))} · peak ${esc(p.peak)}</div>`;
    if (p.note) html += `<p>${esc(p.note)}</p>`;
    if (p.flag) html += `<div class="warn"><b>Check this.</b> ${esc(p.flag)}</div>`;
  } else if (p.kind === 'st-dest' || p.kind === 'st-emb') {
    if (p.figure) html += `<div class="fig">${esc(p.figure)}</div>`;
    if (p.text) html += `<p>${esc(p.text)}</p>`;
  } else if (p.kind === 'sph-flow') {
    html += `<p>${esc(p.cargo)}</p>`;
  } else if (p.kind === 'ind-arc') {
    if (p.inBook === false || p.inBook === 'false')
      html += `<p>A major indenture route, but <b>not named in this book</b> — shown dashed so the pattern is complete.</p>`;
    else html += `<p>An indenture route named in the book.</p>`;
  } else {
    if (p.text) html += `<p>${esc(p.text)}</p>`;
    if (p.label && p.kind === 'diff-arc') html += `<p>${esc(p.label)}</p>`;
  }
  if (p.p && p.p !== '—') html += `<div class="cite">Sugar Changed the World, p. ${esc(p.p)}</div>`;
  html += '</div>';

  if (popup) popup.remove();
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', offset: 12 })
    .setLngLat(lngLat).setHTML(html).addTo(map);
}

/* ── story ────────────────────────────────────────────────── */
function buildStory() {
  const host = document.getElementById('story');
  host.innerHTML = DATA.steps.map(s => {
    const c = ACT_COLOR[s.act];
    let h = `<section class="step" id="step-${s.id}" data-step="${s.id}" style="--act:${c}">`;
    h += `<p class="kicker">${esc(s.kicker)}</p><h2>${esc(s.title)}</h2>`;
    h += `<div class="body">${s.body}</div>`;
    if (s.quote) h += `<blockquote><p>${esc(s.quote)}</p><cite>${esc(s.quoteAttr || '')}</cite></blockquote>`;
    if (s.chart) h += chartHTML(s.chart);
    if (s.sources && s.sources.length) {
      h += '<div class="thumbs">' + s.sources.map(id => {
        const src = DATA.sources.find(x => x.id === id);
        if (!src) return '';
        if (src.kind === 'missing')
          return `<button class="thumb nopic" data-src="${id}" title="${esc(src.title)}">image not<br>obtainable</button>`;
        return `<button class="thumb" data-src="${id}" title="${esc(src.title)}">
                  <img src="img/thumb/${id}.jpg" alt="${esc(src.title)}" loading="lazy"></button>`;
      }).join('') + '</div>';
      h += `<p class="thumbs-note">Click a source to open it with its analysis prompt.</p>`;
    }
    return h + '</section>';
  }).join('');

  host.addEventListener('click', e => {
    const b = e.target.closest('[data-src]');
    if (b) openSheet(b.dataset.src);
  });

  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      document.querySelectorAll('.step').forEach(s => s.classList.remove('on'));
      en.target.classList.add('on');
      goStep(en.target.dataset.step);
    });
  }, { root: document.getElementById('panel'), rootMargin: '-42% 0px -42% 0px', threshold: 0 });
  document.querySelectorAll('.step').forEach(s => io.observe(s));
}

function chartHTML(kind) {
  if (kind === 'consumption') {
    const rows = [
      ['England, early 1700s', 4], ['England, 1800', 18], ['Russia, 1894', 8],
      ['England, 1900', 90], ['USA today, cane only', 40], ['USA today, all sweeteners', 140]
    ];
    const max = 140;
    return `<div class="chart"><h5>Sugar eaten per person, per year (pounds)</h5>` +
      rows.map(([l, v]) => `<div class="bar"><span class="lb">${esc(l)}</span>
        <span class="tr"><span class="fl" style="width:${(v / max * 100).toFixed(1)}%"></span></span>
        <span class="vl">${v}</span></div>`).join('') +
      `<p style="font-size:11.5px;color:#7a6d5e;margin:8px 0 0">Sugar Changed the World, pp. 65–69, 116.</p></div>`;
  }
  if (kind === 'beet') {
    const rows = [['Beet share of world sugar, 1854', 11], ['Beet share of world sugar, 1899', 65]];
    return `<div class="chart"><h5>Beet sugar takes over</h5>` +
      rows.map(([l, v]) => `<div class="bar"><span class="lb">${esc(l)}</span>
        <span class="tr"><span class="fl" style="width:${v}%;background:#5d4e86"></span></span>
        <span class="vl">${v}%</span></div>`).join('') +
      `<p style="font-size:11.5px;color:#7a6d5e;margin:8px 0 0">Sugar Changed the World, p. 117.</p></div>`;
  }
  return '';
}

function goStep(id) {
  const s = DATA.steps.find(x => x.id === id);
  if (!s || !map) return;
  activeLayers = new Set(s.layers || []);
  if (s.year) curYear = s.year;
  if (s.diffusionYear) curYear = s.diffusionYear;
  if (s.era) curEra = s.era;
  /* Projection first, then the camera — but on separate ticks. setProjection kicks off
     its own transition, and a camera command issued in the same tick gets swallowed by
     it, which left the map a whole step behind the text. */
  setGlobe(!!s.globe);
  const fly = () => {
    if (curStep !== s.id) return;                 // a faster scroll already moved on
    /* "fit" frames a bounding box instead of a fixed centre/zoom, so every point stays
       on screen whatever the window size. */
    if (s.fit) map.fitBounds(s.fit, { bearing: 0, pitch: 0, duration: 1500, padding: camPad() });
    else map.easeTo({ center: s.camera.center, zoom: s.camera.zoom, bearing: 0, pitch: 0, duration: 1500, padding: camPad() });
  };
  curStep = s.id;
  setTimeout(fly, 0);
  setPlaceLabels(s.places);
  applyState(s.filterAct);
  const note = document.getElementById('mapnote');
  if (s.layers && s.layers.length) {
    note.hidden = false;
    note.innerHTML = `<b>On the map:</b> ${[...activeLayers].map(layerLabel).join(' · ')}`;
  } else note.hidden = true;
  document.getElementById('timebar').hidden = !(activeLayers.has('plantations') || activeLayers.has('diffusion'));
  syncSlider();
}
const layerLabel = k => ({
  diffusion: 'the spread of sugar', plantations: 'plantations', slavetrade: 'the Atlantic slave trade',
  spherical: 'the spherical trade', freedom: 'resistance & abolition',
  indenture: 'Indian indenture', sources: 'primary sources', science: 'the Age of Science'
}[k] || k);

/* ── state → map ──────────────────────────────────────────── */
const GROUPS = {
  diffusion: ['diff-arc', 'diff-node'],
  plantations: ['plant-halo', 'plant-c'],
  slavetrade: ['st-arc', 'st-emb', 'st-dest'],
  spherical: ['sph-flow', 'sph-node'],
  freedom: ['free-c'],
  indenture: ['ind-arc', 'ind-arc2', 'ind-o', 'ind-d'],
  science: ['sci-c']
};

function applyState(filterAct, tries = 0) {
  /* Retry on a timer rather than map.once('idle') — while the globe is turning the map
     never goes idle, and an 'idle' wait there would never fire. */
  if (!map) return;
  if (!map.isStyleLoaded()) {
    if (tries < 60) setTimeout(() => applyState(filterAct, tries + 1), 100);
    return;
  }
  Object.entries(GROUPS).forEach(([k, ids]) => {
    const on = activeLayers.has(k);
    ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  });
  const yf = ['<=', ['coalesce', ['get', 'year'], -9999], curYear];
  ['diff-arc', 'diff-node', 'plant-halo', 'plant-c'].forEach(id => map.getLayer(id) && map.setFilter(id, yf));

  const showSrc = activeLayers.has('sources');
  srcMarkers.forEach(m => {
    const vis = showSrc && (filterAct == null || m.act === filterAct || m.act === 0);
    m.el.style.display = vis ? 'block' : 'none';
  });
  drawLegend();
}

function drawLegend() {
  const L = document.getElementById('legend'), B = document.getElementById('legend-body');
  const rows = [];
  const dot = (c, t) => `<div class="lg"><span class="sw" style="background:${c}"></span><span>${t}</span></div>`;
  const line = (c, t, d) => `<div class="lg"><span class="swl${d ? ' dash' : ''}" style="border-top-color:${c}"></span><span>${t}</span></div>`;
  if (activeLayers.has('diffusion')) { rows.push(dot('#b8791f', 'Where sugar arrived')); rows.push(line('#9c2f2a', '1493 — Columbus carries cane', true)); }
  if (activeLayers.has('plantations')) rows.push(dot('#9c2f2a', 'Sugar plantation region'));
  if (activeLayers.has('slavetrade')) { rows.push(dot('#5a2320', 'Taken from')); rows.push(dot('#c1544b', 'Taken to')); }
  if (activeLayers.has('spherical')) {
    rows.push(line('#9c2f2a', 'Enslaved people')); rows.push(line('#b8791f', 'Sugar, rum, molasses'));
    rows.push(line('#1f5f80', 'Cloth &amp; provisions')); rows.push(line('#5d4e86', 'Silver'));
  }
  if (activeLayers.has('freedom')) rows.push(dot('#1f5f80', 'Resistance &amp; abolition'));
  if (activeLayers.has('indenture')) { rows.push(dot('#2f4a25', 'Recruiting &amp; embarkation')); rows.push(dot('#4a6f3c', 'Destination')); rows.push(line('#4a6f3c', 'Route not named in the book', true)); }
  if (activeLayers.has('science')) rows.push(dot('#5d4e86', 'The Age of Science'));
  if (activeLayers.has('sources')) rows.push(`<div class="lg"><span class="sw" style="background:#3d3226;border-radius:2px;transform:rotate(45deg)"></span><span>Primary source</span></div>`);
  L.hidden = !rows.length; B.innerHTML = rows.join('');
}

/* ── slider ───────────────────────────────────────────────── */
function syncSlider() {
  const s = document.getElementById('slider'), o = document.getElementById('yearout');
  let i = EPOCHS.findIndex(y => y >= curYear); if (i < 0) i = EPOCHS.length - 1;
  curYear = EPOCHS[i];                       // keep readout and filter in agreement
  s.value = i; o.textContent = fmtYear(curYear);
  s.setAttribute('aria-valuetext', fmtYear(curYear));
}

/* ── source grid ──────────────────────────────────────────── */
function buildSourceGrid() {
  const F = document.getElementById('src-filters'), G = document.getElementById('src-grid');
  const acts = [['all', 'All 49'], [1, 'Magic to Spice'], [2, 'Hell'], [3, 'Freedom'], [4, 'New Workers']];
  F.innerHTML = acts.map((a, i) => `<button class="chip${i === 0 ? ' on' : ''}" data-act="${a[0]}">${esc(a[1])}</button>`).join('');
  const render = f => {
    const rows = DATA.sources.filter(s => f === 'all' || s.act === +f);
    if (!rows.length) { G.innerHTML = '<p class="lede">No sources in this part.</p>'; return; }
    G.innerHTML = rows.map(s => `
      <button class="card" data-src="${s.id}">
        ${s.kind === 'missing'
          ? '<div class="none">not obtainable</div>'
          : `<figure><img src="img/thumb/${s.id}.jpg" alt="${esc(s.title)}" loading="lazy"></figure>`}
        <span class="cap"><b>${esc(s.title)}</b><i>${esc(s.date)}${s.kind === 'map' ? ' · map' : ''}</i></span>
      </button>`).join('');
  };
  render('all');
  F.addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    F.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); c.classList.add('on');
    render(c.dataset.act);
  });
  G.addEventListener('click', e => {
    const c = e.target.closest('[data-src]'); if (c) openSheet(c.dataset.src);
  });
}

/* ── source sheet ─────────────────────────────────────────── */
let lastFocus = null;
function openSheet(id) {
  const s = DATA.sources.find(x => x.id === id); if (!s) return;
  lastFocus = document.activeElement;
  const sheet = document.getElementById('sheet');
  const pic = document.getElementById('sheet-pic');
  if (s.kind === 'missing') {
    pic.removeAttribute('src'); pic.alt = '';
    document.querySelector('.sheet-img').style.display = 'none';
  } else {
    document.querySelector('.sheet-img').style.display = 'flex';
    pic.src = `img/full/${id}.jpg`; pic.alt = s.title;
  }
  document.getElementById('sheet-kind').textContent =
    s.kind === 'map' ? 'Primary source · map' : s.kind === 'missing' ? 'Referenced — image not obtainable' : 'Primary source · image';
  document.getElementById('sheet-title').textContent = s.title;
  document.getElementById('sheet-meta').innerHTML =
    `${esc(s.creator)}, ${esc(s.date)}<br>${esc(s.place)} <span class="badge ${esc(s.certainty)}">${esc(s.certainty)}</span>`;
  document.getElementById('sheet-cap').textContent = s.caption;

  const flag = document.getElementById('sheet-flag');
  if (s.correction) { flag.hidden = false; flag.innerHTML = `<b>Correction.</b> ${esc(s.correction)}`; }
  else flag.hidden = true;

  const routine = s.prompt.startsWith('SCRAP')
      ? (s.kind === 'map' ? 'SCRAP · reading a map' : 'SCRAP · read this against the map')
      : s.prompt.startsWith('OPTIC') ? 'OPTIC · reading an image' : 'Think about it';
  document.getElementById('sheet-prompt').innerHTML =
    `<span class="tag">${esc(routine)}</span><p>${esc(s.prompt.replace(/^(OPTIC|SCRAP)\s*—\s*/, ''))}</p>`;

  document.getElementById('sheet-facts').innerHTML = `
    <div><dt>In the book</dt><dd>p. ${esc(s.bookPage)}</dd></div>
    <div><dt>Rights</dt><dd>${esc(s.rights)}</dd></div>
    <div><dt>Holder</dt><dd><a href="${esc(s.link)}" target="_blank" rel="noopener">view the record ↗</a></dd></div>`;

  sheet.hidden = false;
  setInert(true);
  document.getElementById('sheet-x').focus();
  if (map) { map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 4.6), duration: 1400, padding: camPad() }); }
}
function closeSheet() {
  document.getElementById('sheet').hidden = true;
  document.getElementById('sheet-pic').removeAttribute('src');
  setInert(false);
  lastFocus && lastFocus.focus();
}

/* Keep Tab inside an open dialog and out of the page behind it. */
function setInert(on) {
  ['.topbar', '.shell'].forEach(sel => {
    const el = document.querySelector(sel); if (!el) return;
    if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
  });
}
function trapTab(dialog, e) {
  if (e.key !== 'Tab') return;
  const f = [...dialog.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function stopPlay() {
  if (!playTimer) return;
  clearInterval(playTimer); playTimer = null;
  const b = document.getElementById('play'); if (b) b.textContent = '▶';
}

/* ── UI wiring ────────────────────────────────────────────── */
function wireUI() {
  const panes = { story: 'story', explore: 'explore', sources: 'sources' };
  const setMode = m => {
    mode = m;
    stopPlay();
    ['story', 'explore', 'sources'].forEach(k => {
      document.getElementById(panes[k]).hidden = k !== m;
      const b = document.getElementById('btn-' + k);
      b.classList.toggle('on', k === m); b.setAttribute('aria-selected', k === m);
    });
    document.getElementById('timebar').hidden = (m === 'story');
    document.getElementById('panel').scrollTop = 0;
    if (m !== 'story') {
      setGlobe(false);                       // the globe belongs to its own story step
      setPlaceLabels(null);
      activeLayers = new Set([...document.querySelectorAll('[data-layer]')]
        .filter(i => i.checked).map(i => i.dataset.layer));
      curYear = 1950; syncSlider(); applyState();
      document.getElementById('mapnote').hidden = true;
      map && map.easeTo({ center: [-25, 18], zoom: 1.35, duration: 900, padding: camPad() });
    } else {
      const on = document.querySelector('.step.on') || document.querySelector('.step');
      on && goStep(on.dataset.step);
    }
  };
  ['story', 'explore', 'sources'].forEach(k =>
    document.getElementById('btn-' + k).addEventListener('click', () => setMode(k)));

  document.querySelectorAll('[data-layer]').forEach(cb => cb.addEventListener('change', () => {
    activeLayers = new Set([...document.querySelectorAll('[data-layer]')]
      .filter(i => i.checked).map(i => i.dataset.layer));
    applyState();
  }));
  const setBase = (layers, on) => {
    [].concat(layers).forEach(l => {
      if (map && map.getLayer(l)) map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
    });
  };
  document.getElementById('tog-borders').addEventListener('change', e => setBase('ctry-l', e.target.checked));
  document.getElementById('tog-grat').addEventListener('change', e => {
    setBase(GRAT_LAYERS, e.target.checked);
    setGratLabels(e.target.checked);
  });

  const sl = document.getElementById('slider');
  sl.addEventListener('input', () => {
    curYear = EPOCHS[+sl.value];
    document.getElementById('yearout').textContent = fmtYear(curYear);
    sl.setAttribute('aria-valuetext', fmtYear(curYear));
    applyState();
  });
  document.getElementById('play').addEventListener('click', function () {
    if (playTimer) { stopPlay(); return; }
    this.textContent = '❚❚';
    if (+sl.value >= EPOCHS.length - 1) sl.value = 0;
    playTimer = setInterval(() => {
      if (+sl.value >= EPOCHS.length - 1) { stopPlay(); return; }
      sl.value = +sl.value + 1; sl.dispatchEvent(new Event('input'));
    }, 700);
  });

  let rt; window.addEventListener('resize', () => {
    clearTimeout(rt); rt = setTimeout(() => map && map.easeTo({ padding: camPad(), duration: 0 }), 200);
  });
  document.getElementById('sheet-x').addEventListener('click', closeSheet);
  document.getElementById('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
  const about = document.getElementById('about');
  const closeAbout = () => { about.hidden = true; setInert(false); document.getElementById('btn-about').focus(); };
  document.getElementById('btn-about').addEventListener('click', () => {
    about.hidden = false; setInert(true); document.getElementById('about-x').focus();
  });
  document.getElementById('about-x').addEventListener('click', closeAbout);
  about.addEventListener('click', e => { if (e.target.id === 'about') closeAbout(); });

  document.addEventListener('keydown', e => {
    const sheet = document.getElementById('sheet');
    if (!sheet.hidden) { trapTab(sheet.querySelector('.sheet-inner'), e); if (e.key === 'Escape') closeSheet(); return; }
    if (!about.hidden) { trapTab(about.querySelector('.sheet-inner'), e); if (e.key === 'Escape') closeAbout(); }
  });
}
