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

let DATA = {}, map, srcMarkers = [], cubaMarkers = [], popup, activeLayers = new Set(), curYear = 1950,
    cubaPinned = false,   // the route stays on across story steps once asked for
    curEra = 'e2', mode = 'story', playTimer = null, placeMarkers = [],
    gratMarkers = [], globeOn = false, userTurning = false, spinRAF = null, curStep = null,
    musicMarkers = [];
const GRAT_LAYERS = ['grat-l', 'grat-polar', 'grat-trop', 'grat-eq'];
const LAND_SWAP = 5;            // zoom at which the 1:110m base hands over to 1:10m

/* The twelve numbered Commission stops sit within about two degrees of each other, so at
   any world view they collapse into one illegible stack of pins. They only earn their
   place once Cuba itself fills the view. Measured against the island's own bounding box
   rather than a fixed zoom, so the rule holds at any window size or map-pane width. */
const CUBA_BBOX = { w: -84.96, e: -74.13, s: 19.83, n: 23.28 };
const CUBA_FILL = 0.9;          // fraction of the map pane Cuba must span to earn the numbers

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
/* The year slider is centred along the bottom and the "On the map" note sits bottom-left;
   a long note ran straight into it. Flag the wrap so the note can lift clear. */
function setTimebar(on) {
  const t = document.getElementById('timebar');
  if (t) t.hidden = !on;
  document.querySelector('.mapwrap').classList.toggle('with-timebar', !!on);
}

function camPad() {
  if (window.innerWidth <= 900) return { top: 0, right: 0, bottom: 0, left: 0 };
  const el = document.getElementById('panel');
  const w = el ? el.getBoundingClientRect().width : 0;
  return { top: 20, right: 30, bottom: 20, left: Math.round(w) + 30 };
}
/* Centre and zoom that frame a [[w,s],[e,n]] box inside the map left uncovered by the
   story panel. Plain Web Mercator, so the answer never depends on the map's own state. */
function fitCamera([[w, s], [e, n]], maxZoom) {
  const pad = camPad(), cv = map.getCanvas();
  const availW = Math.max(80, cv.clientWidth - pad.left - pad.right);
  const availH = Math.max(80, cv.clientHeight - pad.top - pad.bottom);
  const my = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  const dx = (e - w) / 360;
  const y1 = 0.5 - my(n) / (2 * Math.PI), y2 = 0.5 - my(s) / (2 * Math.PI);
  const zoom = Math.min(Math.log2(availW / (dx * 512)), Math.log2(availH / ((y2 - y1) * 512)));
  const midY = (y1 + y2) / 2;
  const lat = Math.atan(Math.sinh((0.5 - midY) * 2 * Math.PI)) * 180 / Math.PI;
  /* maxZoom lets a step insist on staying wide enough for something to stay drawn —
     the country borders stop at 6.5, and a tall window would otherwise zoom past them. */
  return { center: [(w + e) / 2, lat], zoom: Math.max(0.6, Math.min(11, maxZoom || 11, zoom)) };
}

const fc = features => ({ type: 'FeatureCollection', features });
const pt = (lon, lat, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lon, lat] } });
const ln = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });

/* ── boot ─────────────────────────────────────────────────── */
Promise.all([
  fetch('data/sources.json').then(r => r.json()),
  fetch('data/layers.json').then(r => r.json()),
  fetch('data/narrative.json').then(r => r.json()),
  fetch('data/music.json').then(r => r.json()),
  fetch('data/china-cuba.json').then(r => r.json())
]).then(([s, l, n, mu, cc]) => {
  DATA = { sources: s.sources, ...l, ...n, music: mu.music, cuba: cc };
  // Build the readable site first so a map failure never costs the text and sources.
  buildStory();
  buildSourceGrid();
  wireUI();
  try { buildMap(); } catch (e) {
    document.getElementById('map').innerHTML =
      `<div style="padding:24px;max-width:34em;font-size:14px;line-height:1.6;color:#4b4036">
         <b>The map could not start.</b><br>${esc(e.message)}<br><br>
         This usually means the browser has WebGL disabled or unavailable.
         The story text and all 53 sources still work.</div>`;
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
  const clickable = ['diff-node', 'plant-c', 'st-emb', 'st-dest', 'sph-node', 'free-c', 'ind-o', 'ind-d', 'sci-c',
                     'cc-port', 'cc-origin', 'cc-call'];
  clickable.forEach(id => {
    map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', id, () => map.getCanvas().style.cursor = '');
    map.on('click', id, e => showPopup(e.features[0], e.lngLat));
  });
  /* Lines are registered after the points, so their handler fires last and its popup would
     win any overlap. That is the wrong way round: a stop sitting exactly on its own route —
     St Helena and Anjer both do — should open the stop, not the line it sits on. So a line
     stands down whenever a clickable point is under the same pixel. */
  ['diff-arc', 'sph-flow', 'ind-arc', 'ind-arc2', 'cc-arc', 'cc-route'].forEach(id => {
    map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', id, () => map.getCanvas().style.cursor = '');
    map.on('click', id, e => {
      const over = map.queryRenderedFeatures(e.point, { layers: clickable.filter(l => map.getLayer(l)) });
      if (over.length) return;
      showPopup(e.features[0], e.lngLat);
    });
  });

  buildSourceMarkers();
  buildMusicMarkers();
  buildCubaMarkers();
  wireGlobeSpin();
  map.on('move', positionGratLabels);
  map.on('move', updateCubaMarkers);
  updateCubaMarkers();          // the stops start hidden at the opening world view
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

  /* 6 · the China–Cuba Connection -------------------------------
     The 1874 Commission's route through Cuba, the ports the men were shipped from,
     and the home districts the depositions name. Drawn in the Part Four green so it
     reads as a sibling of the indenture layer, not a rival to it. */
  const CC = DATA.cuba, stops = CC.itinerary.stops;
  /* The route joins the stops in the order the Commissioners travelled. The last stop
     is the departure from Havana, which is the same point as the first — drawing to it
     would double a line back over itself, so the leg is left off and the pin says it. */
  const legs = stops.slice(0, -1).map(s => [s.lon, s.lat]);
  map.addSource('cc-route-s', { type: 'geojson',
    data: fc([ln(legs, { kind: 'cc-route', name: 'The Commission’s route, 1874' })]) });
  map.addSource('cc-port-s', { type: 'geojson', data: fc(CC.ports.map(p =>
    pt(p.lon, p.lat, { ...p, kind: 'cc-port' }))) });
  map.addSource('cc-origin-s', { type: 'geojson', data: fc(CC.origins.map(o =>
    pt(o.lon, o.lat, { ...o, kind: 'cc-origin' }))) });
  /* The passage. This used to be a single bent arc from each port straight to Havana,
     which drew a line across Central America — not a simplification but a falsehood, since
     no ship ever sailed it and the Pacific route to Cuba was rejected outright. The track
     below is the real one: west by the Sunda Strait, the Cape of Good Hope and the South
     Atlantic. Waypoints live in china-cuba.json and are a reconstruction of the standard
     course, not a page of the Report — the popup and the legend both say so.
     The trunk carries the common route; each departure port joins it by a short feeder to
     the nearest point on the track, so eight ports do not redraw the same ocean eight times. */
  const way = CC.passage.map(w => [w.lon, w.lat]);
  const joinPoint = p => {
    let best = way[0], bd = Infinity;
    way.forEach(w => {
      /* Rough equirectangular distance is plenty for picking a join — all the ports sit in
         the same corner of the map, and cos(lat) keeps longitude honest at 20°N. */
      const dx = (w[0] - p.lon) * Math.cos(p.lat * Math.PI / 180), dy = w[1] - p.lat;
      const dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = w; }
    });
    return best;
  };
  map.addSource('cc-arc-s', { type: 'geojson', data: fc([
    ln(way, { kind: 'cc-passage', trunk: 1, name: 'The passage to Havana' }),
    ...CC.ports.map(p => ln(arc([p.lon, p.lat], joinPoint(p), -0.1, 24),
      { kind: 'cc-arc', name: `${p.name} → the passage`, n: p.n || null, p: p.p }))
  ]) });
  /* The two victualling stops. Without them the track is just a line; these are why it
     bends where it does, and they are the only two places the men saw in five months. */
  map.addSource('cc-call-s', { type: 'geojson', data: fc(
    CC.passage.filter(w => w.stop).map(w => pt(w.lon, w.lat, { ...w, kind: 'cc-call' }))) });

  /* The trunk reads as the route; the feeders are deliberately lighter and thinner so the
     eye follows the ocean track rather than the eight short stubs on the China coast. */
  map.addLayer({ id: 'cc-arc', type: 'line', source: 'cc-arc-s',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#8a5a2b',
      /* The zoom interpolation has to be the outermost expression — MapLibre rejects a
         zoom curve nested inside a case, and rejects it by refusing to add the layer at
         all rather than by falling back, so the whole passage silently vanishes. */
      'line-width': ['interpolate', ['linear'], ['zoom'],
        1, ['case', ['==', ['coalesce', ['get', 'trunk'], 0], 1], 2.4,
                    ['>', ['coalesce', ['get', 'n'], 0], 50000], 2.0, 1.2],
        5, ['case', ['==', ['coalesce', ['get', 'trunk'], 0], 1], 3.6,
                    ['>', ['coalesce', ['get', 'n'], 0], 50000], 2.8, 1.8]],
      'line-opacity': ['case', ['==', ['coalesce', ['get', 'trunk'], 0], 1], 0.85, 0.5] } });
  map.addLayer({ id: 'cc-route', type: 'line', source: 'cc-route-s',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#7a2f6b', 'line-width': 2.4, 'line-opacity': 0.85 } });
  map.addLayer({ id: 'cc-origin', type: 'circle', source: 'cc-origin-s',
    layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 7],
      'circle-color': '#c08a3e', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fbf8f2' } });
  map.addLayer({ id: 'cc-port', type: 'circle', source: 'cc-port-s',
    layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5, 6, 11],
      'circle-color': '#8a5a2b', 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f2' } });
  /* Hollow, to read as a place touched in passing rather than a place men were shipped from. */
  map.addLayer({ id: 'cc-call', type: 'circle', source: 'cc-call-s',
    layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.5, 6, 8],
      'circle-color': '#fbf8f2', 'circle-stroke-width': 2.2, 'circle-stroke-color': '#8a5a2b' } });
  /* The twelve stops are HTML markers rather than a circle layer, because the number has
     to be readable and this style carries no glyphs endpoint — the same reason the place
     labels and graticule labels are HTML. */

  /* 7 · science -------------------------------------------------- */
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

/* ── China–Cuba itinerary markers (HTML) ──────────────────────
   Numbered so the order of the seven weeks reads off the map. Clicking one opens the
   stop, its sites, and whatever a man said there. */
function buildCubaMarkers() {
  DATA.cuba.itinerary.stops.forEach(s => {
    const el = document.createElement('button');
    el.className = 'pin ccstop';
    el.innerHTML = `<span class="ccn">${s.n}</span>`;
    el.title = `${s.n}. ${s.name} — ${s.dateLabel}`;
    el.addEventListener('click', ev => { ev.stopPropagation(); openCubaStop(s.id); });
    const mk = new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
    el.setAttribute('aria-label', `Commission stop ${s.n}: ${s.name}, ${s.dateLabel}`);
    cubaMarkers.push({ id: s.id, marker: mk, el });
  });
}

/* Does Cuba fill the map pane? Project the island's own corners and measure the box they
   make against the canvas. Width is what binds in practice — Cuba is about three times
   wider than it is tall — but height is checked too so the rule still reads correctly on
   a tall narrow window. On the globe the projection wraps and the measurement stops
   meaning anything, so the numbers stay down. */
function cubaFillsView() {
  if (!map || globeOn) return false;
  const c = map.getCanvas();
  const W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return false;
  let a, b;
  try {
    a = map.project([CUBA_BBOX.w, CUBA_BBOX.n]);
    b = map.project([CUBA_BBOX.e, CUBA_BBOX.s]);
  } catch (e) { return false; }
  const wpx = Math.abs(b.x - a.x), hpx = Math.abs(b.y - a.y);
  return wpx >= W * CUBA_FILL || hpx >= H * CUBA_FILL;
}

/* Cheap enough to run on every move frame: twelve style writes and no layout reads. */
function updateCubaMarkers() {
  const show = activeLayers.has('chinacuba') && cubaFillsView();
  cubaMarkers.forEach(m => { m.el.style.display = show ? 'block' : 'none'; });
}

/* A stop opens as a map popup rather than the full sheet — students are usually
   comparing several stops at once, and a modal each time would fight that. */
function openCubaStop(id) {
  const s = DATA.cuba.itinerary.stops.find(x => x.id === id); if (!s) return;
  let html = `<div class="pop cc"><h5>${s.n}. ${esc(s.name)}</h5>
    <div class="when">${esc(s.dateLabel)}</div>`;
  if (s.sites && s.sites.length)
    html += `<p class="ccsites">${s.sites.map(esc).join(' · ')}</p>`;
  html += `<p>${esc(s.text)}</p>`;
  [s.testimony, s.testimony2].filter(Boolean).forEach(t => {
    html += `<blockquote class="ccq"><p>${esc(t.text)}</p>
      <cite>${esc(t.who)}${t.hanzi ? ` <span class="hz">${esc(t.hanzi)}</span>` : ''} · p. ${esc(t.p)}</cite></blockquote>`;
  });
  html += `<div class="badge ${esc(s.certainty)}">${esc(s.certainty)}</div>`;
  /* Two page references are in play here — the itinerary and the deposition — so the
     footer names which is which rather than leaving a bare number to be guessed at. */
  html += `<div class="cite">Itinerary: <i>Cuba Commission Report</i>, pp. ${esc(DATA.cuba.itinerary.p)}${
    s.testimony ? '; the deposition, p. ' + esc(s.testimony.p) : ''}</div></div>`;
  if (popup) popup.remove();
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: '330px', offset: 14 })
    .setLngLat([s.lon, s.lat]).setHTML(html).addTo(map);
}

/* ── globe ────────────────────────────────────────────────────
   Steps marked "globe": true swap the flat map for a real 3-D globe and set it
   turning. Students can drag it, and the spin picks itself back up afterwards. */
const SPIN_DEG_PER_SEC = 12;                   // one full turn in half a minute

function setGlobe(on) {
  if (!map || typeof map.setProjection !== 'function') return;   // no globe before MapLibre 5
  if (on === globeOn) return;
  globeOn = on;
  map.setProjection({ type: on ? 'globe' : 'mercator' });
  document.getElementById('map').classList.toggle('globe', on);
  if (on) startSpin(); else stopSpin();
  updateCubaMarkers();          // the fill test means nothing under a globe projection
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

/* ── how the camera travels between steps ─────────────────────
   A straight glide is fine when you can still see where you are going. It fails when
   the camera has to cross a long distance while staying close to the ground: the map
   skims open sea with nothing recognisable in frame and the reader loses the thread.
   Antigua to Jamaica is 1,600 km at zoom 9.6 — six screenfuls apart even from the
   wider of the two viewpoints.

   So the test is not raw distance, it is whether both places could share a frame at
   the wider of the two views. If they could, glide. If they could not, fly: up, across,
   and back down. Measuring at the wider view is what keeps a plain descent — the globe
   dropping into Antigua — from being treated as a long haul when it is really a zoom. */
const ARC_SCREENS = 2.5;          // screenfuls apart, seen from the wider of the two views
const ARC_CURVE   = 1.6;          // how high the arc climbs; MapLibre's default is 1.42
const ARC_SPEED   = 0.85;         // van Wijk "screenfuls per second" — deliberate, not brisk
const ARC_MIN_MS  = 1800, ARC_MAX_MS = 3600;

function exposedWidth() {
  const pad = camPad(), cv = map.getCanvas();
  return Math.max(320, cv.clientWidth - pad.left - pad.right);
}

/* Normalised Web Mercator offset between the current centre and the target. */
function centreOffset(cam) {
  const c0 = map.getCenter();
  const my = l => 0.5 - Math.log(Math.tan(Math.PI / 4 + (l * Math.PI / 180) / 2)) / (2 * Math.PI);
  return Math.hypot((((cam.center[0] - c0.lng) + 540) % 360 - 180) / 360,
                    my(cam.center[1]) - my(c0.lat));
}

function gapAtWiderView(cam) {
  const wider = Math.min(map.getZoom(), cam.zoom);
  return centreOffset(cam) * 512 * Math.pow(2, wider) / exposedWidth();
}

/* van Wijk's flight length, so the duration can be clamped here. MapLibre's own
   maxDuration is not a cap: if the natural duration exceeds it the flight is set to
   zero and the map snaps — exactly wrong for the longest hauls. */
function arcDuration(cam) {
  const cv = map.getCanvas();
  const w0 = Math.max(cv.clientWidth, cv.clientHeight);
  const w1 = w0 / Math.pow(2, cam.zoom - map.getZoom());
  const u1 = centreOffset(cam) * 512 * Math.pow(2, map.getZoom());   // travel in the start frame
  const rho = ARC_CURVE, rho2 = rho * rho;
  let S;
  if (u1 < 1e-6) {
    S = Math.abs(Math.log(w1 / w0)) / rho;
  } else {
    const b = i => (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * u1 * u1)
                 / (2 * (i ? w1 : w0) * rho2 * u1);
    const r = i => { const bi = b(i); return Math.log(Math.sqrt(bi * bi + 1) - bi); };
    S = (r(1) - r(0)) / rho;
  }
  return Math.round(Math.min(ARC_MAX_MS, Math.max(ARC_MIN_MS, 1000 * S / ARC_SPEED)));
}

/* ── music ────────────────────────────────────────────────────
   Five traditions the book names on pp. 54-55. Public-domain jazz sides are served
   from this repo; everything else plays in the rights holder's own player, and no
   third-party request is made until a student actually asks to hear something. */
function buildMusicMarkers() {
  (DATA.music || []).forEach(m => {
    const el = document.createElement('button');
    el.className = 'pin listen';
    el.innerHTML = '<span class="dot"></span>';
    el.title = `${m.tradition} — ${m.place}`;
    el.addEventListener('click', ev => { ev.stopPropagation(); openMusic(m.id); });
    const mk = new maplibregl.Marker({ element: el }).setLngLat([m.lon, m.lat]).addTo(map);
    el.setAttribute('aria-label', `Music: ${m.tradition}, ${m.place}`);   // after addTo
    musicMarkers.push({ id: m.id, marker: mk, el });
  });
}

/* A play button that becomes the embed. Keeps the atlas request-free until asked, and
   uses youtube-nocookie so a classroom is not tracked for pressing play. */
function mediaBlock(x) {
  if (x.kind === 'audio') {
    return `<figure class="med">
      <figcaption><b>${esc(x.title)}</b><span>${x.credit}</span></figcaption>
      <audio controls preload="none" src="${esc(x.file)}"></audio>
      <p>${x.note}</p></figure>`;
  }
  if (x.kind === 'youtube') {
    return `<figure class="med">
      <figcaption><b>${esc(x.title)}</b><span>${x.credit}</span></figcaption>
      <div class="ytwrap"><button class="ytplay" data-yt="${esc(x.id)}">
        <span class="ytmark" aria-hidden="true">▶</span>
        <span>Play here<i>loads from YouTube when you press this</i></span></button></div>
      <p>${x.note} <a href="https://www.youtube.com/watch?v=${esc(x.id)}" target="_blank" rel="noopener">open on YouTube ↗</a></p></figure>`;
  }
  return `<figure class="med">
    <figcaption><b>${esc(x.title)}</b><span>${x.credit}</span></figcaption>
    <p>${x.note} <a href="${esc(x.url)}" target="_blank" rel="noopener">go to the recording ↗</a></p></figure>`;
}

function wireMediaPlayers(root) {
  root.querySelectorAll('.ytplay').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.yt, wrap = b.parentElement;
    wrap.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}?rel=0&autoplay=1"
      title="Video" loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write;
      encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }));
}

function openMusic(id) {
  const m = (DATA.music || []).find(x => x.id === id); if (!m) return;
  lastFocus = document.activeElement;
  document.getElementById('music-kind').textContent = 'Music · and how well the book’s claim holds up';
  document.getElementById('music-title').textContent = m.tradition;
  document.getElementById('music-place').innerHTML = `${esc(m.place)} <span class="badge listen">listen</span>`;
  document.getElementById('music-claim').innerHTML =
    `<p class="cc-claim"><b>The book says</b> (p. ${esc(m.bookPage)}) ${m.claim}</p>
     <p class="cc-verdict"><b>Checking it</b> — ${esc(m.verdict)}</p>
     <p class="cc-ev">${m.evidence}</p>`;
  const q = document.getElementById('music-quote');
  if (m.quote) { q.hidden = false; q.innerHTML = `<p>${esc(m.quote)}</p><cite>${m.quoteWho}</cite>`; }
  else q.hidden = true;
  const w = document.getElementById('music-watch');
  if (m.watchFor) { w.hidden = false; w.innerHTML = `<b>Watch for this.</b> ${m.watchFor}`; }
  else w.hidden = true;

  const box = document.getElementById('music-media');
  box.innerHTML = m.media.map(mediaBlock).join('');
  wireMediaPlayers(box);

  document.getElementById('music').hidden = false;
  setInert(true);
  document.getElementById('music-x').focus();
  if (map) map.flyTo({ center: [m.lon, m.lat], zoom: Math.max(map.getZoom(), 4.4), duration: 1400, padding: camPad() });
}

function closeMusic() {
  const box = document.getElementById('music-media');
  box.innerHTML = '';                       // stops any playing audio or embed dead
  document.getElementById('music').hidden = true;
  setInert(false);
  lastFocus && lastFocus.focus();
}

/* ── the China–Cuba Connection ────────────────────────────────
   A second primary source set against the book at five points in Part Four. The panel
   always runs the same way: what the book says, what the Report found, the workers'
   own words, then a comparison task. The order matters — students meet the evidence
   before they are asked to judge it. */
function openCuba(id) {
  const c = (DATA.cuba.connections || []).find(x => x.id === id); if (!c) return;
  const doc = DATA.cuba.document;
  lastFocus = document.activeElement;

  document.getElementById('cuba-kicker').textContent = c.kicker;
  document.getElementById('cuba-title').textContent = c.title;
  document.getElementById('cuba-lead').textContent = c.lead;

  document.getElementById('cuba-nums').innerHTML = (c.numbers || []).map(([big, lab, p]) =>
    `<div class="ccnum"><b>${esc(big)}</b><span>${esc(lab)}</span>
     ${p && p !== '—' ? `<i>Report, p. ${esc(p)}</i>` : ''}</div>`).join('');

  document.getElementById('cuba-claim').innerHTML =
    `<p class="cc-claim"><b>The book says</b> (p. ${esc(c.theBookP)}) ${c.theBook}</p>
     <p class="cc-verdict"><b>The Commission found</b> (Report, p. ${esc(c.theReportP)}) — ${c.theReport}</p>`;

  document.getElementById('cuba-testimony').innerHTML = c.testimony.map(t =>
    `<blockquote class="ccq"><p>${esc(t.text)}</p>
      <cite>${esc(t.who)}${t.hanzi ? ` <span class="hz">${esc(t.hanzi)}</span>` : ''}
      · <i>Cuba Commission Report</i>, p. ${esc(t.p)}</cite></blockquote>`).join('');

  const cmp = document.getElementById('cuba-compare');
  if (c.compare) { cmp.hidden = false; cmp.innerHTML = `<b>Put the two together.</b> ${esc(c.compare)}`; }
  else cmp.hidden = true;

  /* The route is the same object in every panel, so it gets one button rather than being
     repeated as prose five times. */
  document.getElementById('cuba-route').innerHTML =
    `<button class="hearbtn" id="cuba-showroute">
       <span class="ytmark" aria-hidden="true">◷</span>
       <span>Show the Commission’s route<i>twelve stops, 17 March – 8 May 1874 — click a number to read what was found there</i></span></button>`;
  document.getElementById('cuba-showroute').addEventListener('click', () => {
    closeCuba();
    cubaPinned = true;
    activeLayers.add('chinacuba');
    const box = document.querySelector('[data-layer="chinacuba"]'); if (box) box.checked = true;
    applyState();
    map && map.flyTo({ center: [-81.4, 22.9], zoom: 6.9, duration: 1600, padding: camPad() });
  });

  document.getElementById('cuba-facts').innerHTML = `
    <div><dt>Source</dt><dd><i>${esc(doc.title)}</i></dd></div>
    <div><dt>Compiled by</dt><dd>${esc(doc.creator)}</dd></div>
    <div><dt>Published</dt><dd>${esc(doc.imprint)}; despatched to the Tsungli Yamên ${esc(doc.despatched)}</dd></div>
    <div><dt>This copy</dt><dd>${esc(doc.copy)}</dd></div>
    <div><dt>Rights</dt><dd>${esc(doc.rights)}</dd></div>
    <div><dt>Read it</dt><dd><a href="${esc(doc.link)}" target="_blank" rel="noopener">the full 1876 volume ↗</a></dd></div>`;

  document.getElementById('cuba').hidden = false;
  setInert(true);
  document.getElementById('cuba-x').focus();
  document.querySelector('#cuba .sheet-inner').scrollTop = 0;
  if (map && c.camera) {
    activeLayers = new Set(c.layers || ['chinacuba']);
    const box = document.querySelector('[data-layer="chinacuba"]'); if (box) box.checked = true;
    applyState();
    map.flyTo({ center: c.camera.center, zoom: c.camera.zoom, duration: 1600, padding: camPad() });
  }
}

function closeCuba() {
  document.getElementById('cuba').hidden = true;
  setInert(false);
  lastFocus && lastFocus.focus();
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
  } else if (p.kind === 'cc-port') {
    if (p.n) html += `<div class="fig">${(+p.n).toLocaleString()} men shipped</div>`;
    if (p.text) html += `<p>${esc(p.text)}</p>`;
  } else if (p.kind === 'cc-origin') {
    html += `<p>A home district named by deponents in the Report${p.hanzi ? ` — <span class="hz">${esc(p.hanzi)}</span>` : ''}.</p>`;
  } else if (p.kind === 'cc-arc') {
    html += `<p>Where ships out of ${esc(p.name.replace(' → the passage', ''))} joined the passage${p.n ? ` — ${(+p.n).toLocaleString()} men shipped from here` : ''}.</p>`;
  } else if (p.kind === 'cc-passage') {
    html += `<p>The course to Havana: down the South China Sea, through the Sunda Strait, across the Indian Ocean below the equator, round the <b>Cape of Good Hope</b>, north on the Benguela Current, then west across the Atlantic to the Guianas and into the Caribbean between Trinidad and Barbados. Cuba was approached from underneath and entered round its western cape.</p>
      <p>Some 14,000–15,000 nautical miles, four to five months. Ships went <b>west, not east</b> — the Pacific and Cape Horn route was rejected as too cold and too dangerous for men carried with almost no clothing.</p>`;
  } else if (p.kind === 'cc-call') {
    html += `<p>${esc(p.note || 'A victualling stop on the passage.')}</p>`;
  } else if (p.kind === 'cc-route') {
    html += `<p>The route of the Chinese Commission through Cuba, 17 March – 8 May 1874. Click a numbered stop to see what was found there.</p>`;
  } else {
    if (p.text) html += `<p>${esc(p.text)}</p>`;
    if (p.label && p.kind === 'diff-arc') html += `<p>${esc(p.label)}</p>`;
  }
  /* Two books are cited on this map, so the pin has to say which one it came from. The
     passage and its two calls are a third case: they come from neither book. The Report
     recorded where the men embarked and landed, not the course steered, so the track is a
     reconstruction and must not borrow the Report's authority. */
  const ccKinds = ['cc-port', 'cc-origin', 'cc-arc', 'cc-route'];
  if (p.kind === 'cc-passage' || p.kind === 'cc-call')
    html += `<div class="cite">Reconstructed sailing route — outside the Report</div>`;
  else if (ccKinds.includes(p.kind))
    html += `<div class="cite">Cuba Commission Report${p.p ? `, p. ${esc(p.p)}` : ''}</div>`;
  else if (p.p && p.p !== '—') html += `<div class="cite">Sugar Changed the World, p. ${esc(p.p)}</div>`;
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
    /* A second primary source, running alongside the book rather than inside it. The
       button is deliberately quiet until pressed — the book's own argument comes first. */
    if (s.chinaCuba) {
      const cc = (DATA.cuba.connections || []).find(c => c.id === s.chinaCuba);
      if (cc) h += `<button class="ccbtn" data-cuba="${esc(cc.id)}">
        <span class="ccbtn-mark" aria-hidden="true">華</span>
        <span class="ccbtn-txt"><b>China–Cuba Connection</b>
        <i>${esc(cc.title)}</i></span></button>`;
    }
    /* A step can carry one picture inline, printed with its caption rather than shrunk
       to a thumbnail. Clicking it opens the full source and its prompt like any other. */
    if (s.figure) {
      const f = s.figure, src = DATA.sources.find(x => x.id === f.src);
      h += `<figure class="stepfig">
        <button class="stepfig-img" data-src="${esc(f.src)}" title="Open this source and its prompt">
          <img src="img/full/${esc(f.src)}.jpg" alt="${esc(f.alt || (src ? src.title : ''))}" loading="lazy">
        </button>
        <figcaption>${f.caption}${f.credit ? `<span class="stepfig-credit">${f.credit}</span>` : ''}</figcaption>
      </figure>`;
    }
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
    const c = e.target.closest('[data-cuba]');
    if (c) { openCuba(c.dataset.cuba); return; }
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
        <span class="tr"><span class="fl" style="width:${v}%"></span></span>
        <span class="vl">${v}%</span></div>`).join('') +
      `<p style="font-size:11.5px;color:#7a6d5e;margin:8px 0 0">Sugar Changed the World, p. 117.</p></div>`;
  }
  return '';
}

function goStep(id) {
  const s = DATA.steps.find(x => x.id === id);
  if (!s || !map) return;
  activeLayers = new Set(s.layers || []);
  if (cubaPinned) activeLayers.add('chinacuba');
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
       on screen whatever the window size. The centre and zoom are worked out here rather
       than handed to fitBounds, which resolves against whatever the map is doing at the
       time: arriving from the globe it read the longitude off a projection still
       unwinding, and landed the Atlantic step out in the Pacific. */
    const cam = s.fit ? fitCamera(s.fit, s.fitMax) : s.camera;
    const shot = { center: cam.center, zoom: cam.zoom, bearing: 0, pitch: 0, padding: camPad() };
    if (gapAtWiderView(cam) > ARC_SCREENS)
      map.flyTo({ ...shot, curve: ARC_CURVE, duration: arcDuration(cam) });   // up, over, and down
    else
      map.easeTo({ ...shot, duration: 1500 });
  };
  curStep = s.id;
  setTimeout(fly, 0);
  setPlaceLabels(s.places);
  applyState(s.filterAct);
  const note = document.getElementById('mapnote');
  if (activeLayers.size) {
    note.hidden = false;
    note.innerHTML = `<b>On the map:</b> ${[...activeLayers].map(layerLabel).join(' · ')}`;
  } else note.hidden = true;
  setTimebar(activeLayers.has('plantations') || activeLayers.has('diffusion'));
  syncSlider();
}
const layerLabel = k => ({
  diffusion: 'the spread of sugar', plantations: 'plantations', slavetrade: 'the Atlantic slave trade',
  spherical: 'the spherical trade', freedom: 'resistance & abolition',
  indenture: 'Indian indenture', sources: 'primary sources', science: 'the Age of Science',
  chinacuba: 'the China\u2013Cuba Connection'
}[k] || k);

/* ── state → map ──────────────────────────────────────────── */
const GROUPS = {
  diffusion: ['diff-arc', 'diff-node'],
  plantations: ['plant-halo', 'plant-c'],
  slavetrade: ['st-arc', 'st-emb', 'st-dest'],
  spherical: ['sph-flow', 'sph-node'],
  freedom: ['free-c'],
  indenture: ['ind-arc', 'ind-arc2', 'ind-o', 'ind-d'],
  chinacuba: ['cc-arc', 'cc-route', 'cc-port', 'cc-origin', 'cc-call'],
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

  const showMusic = activeLayers.has('music');
  musicMarkers.forEach(m => { m.el.style.display = showMusic ? 'block' : 'none'; });

  /* The numbered stops carry their own zoom rule on top of the layer toggle. */
  updateCubaMarkers();

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
  if (activeLayers.has('chinacuba')) {
    rows.push(dot('#7a2f6b', 'The Commission\u2019s route, 1874'));
    rows.push(line('#8a5a2b', 'The passage to Havana, by the Cape of Good Hope'));
    rows.push(dot('#8a5a2b', 'Port of embarkation'));
    rows.push(`<div class="lg"><span class="sw" style="background:#fbf8f2;box-shadow:inset 0 0 0 2px #8a5a2b"></span><span>Victualling stop &mdash; Anjer, St Helena</span></div>`);
    rows.push(dot('#c08a3e', 'Home district named in a deposition'));
  }
  if (activeLayers.has('science')) rows.push(dot('#5d4e86', 'The Age of Science'));
  if (activeLayers.has('music')) rows.push(`<div class="lg"><span class="sw" style="background:#0f6e63"></span><span>Music you can hear</span></div>`);
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
  /* Count comes from the data so it cannot go stale, and act 5 has a chip of its own —
     without it the Age of Science sources are in the grid but cannot be filtered to. */
  const acts = [['all', `All ${DATA.sources.length}`], [1, 'Magic to Spice'], [2, 'Hell'],
                [3, 'Freedom'], [4, 'New Workers'], [5, 'Age of Science']];
  F.innerHTML = acts.map((a, i) => `<button class="chip${i === 0 ? ' on' : ''}" data-act="${a[0]}">${esc(a[1])}</button>`).join('');
  const render = f => {
    const rows = DATA.sources.filter(s => f === 'all' || s.act === +f);
    if (!rows.length) { G.innerHTML = '<p class="lede">No sources in this part.</p>'; return; }
    G.innerHTML = rows.map(s => `
      <button class="card" data-src="${s.id}">
        ${s.kind === 'missing'
          ? '<div class="none">not obtainable</div>'
          : `<figure><img src="img/thumb/${s.id}.jpg" alt="${esc(s.title)}" loading="lazy"></figure>`}
        <span class="cap"><b>${esc(s.title)}</b><i>${esc(s.date)}${s.kind === 'map' ? ' · map' : s.kind === 'document' ? ' · document' : ''}</i></span>
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
    s.kind === 'map' ? 'Primary source · map'
    : s.kind === 'document' ? 'Primary source · document'
    : s.kind === 'missing' ? 'Referenced — image not obtainable' : 'Primary source · image';
  document.getElementById('sheet-title').textContent = s.title;
  document.getElementById('sheet-meta').innerHTML =
    `${esc(s.creator)}, ${esc(s.date)}<br>${esc(s.place)} <span class="badge ${esc(s.certainty)}">${esc(s.certainty)}</span>`;
  document.getElementById('sheet-cap').textContent = s.caption;

  const flag = document.getElementById('sheet-flag');
  if (s.correction) { flag.hidden = false; flag.innerHTML = `<b>Correction.</b> ${esc(s.correction)}`; }
  else flag.hidden = true;

  const routine = s.prompt.startsWith('SCRAP')
      ? (s.kind === 'map' ? 'SCRAP · reading a map' : 'SCRAP · read this against the map')
      : s.prompt.startsWith('OPTIC')
        ? (s.kind === 'document' ? 'OPTIC · reading a document' : 'OPTIC · reading an image')
        : 'Think about it';
  document.getElementById('sheet-prompt').innerHTML =
    `<span class="tag">${esc(routine)}</span><p>${esc(s.prompt.replace(/^(OPTIC|SCRAP)\s*—\s*/, ''))}</p>`;

  document.getElementById('sheet-facts').innerHTML = `
    <div><dt>In the book</dt><dd>p. ${esc(s.bookPage)}</dd></div>
    <div><dt>Rights</dt><dd>${esc(s.rights)}</dd></div>
    <div><dt>Holder</dt><dd><a href="${esc(s.link)}" target="_blank" rel="noopener">view the record ↗</a></dd></div>`;

  /* A few sources have a sound to go with the picture — the 1779 stick-fighting print
     and the 1962 field recordings of the same thing being done. */
  const hear = document.getElementById('sheet-hear');
  if (s.music && (DATA.music || []).some(m => m.id === s.music)) {
    const m = DATA.music.find(x => x.id === s.music);
    hear.hidden = false;
    hear.innerHTML = `<button class="hearbtn" data-music="${esc(s.music)}">
      <span class="ytmark" aria-hidden="true">▶</span>
      <span>Hear this<i>${esc(m.tradition)} — recordings, and how the claim holds up</i></span></button>`;
    hear.querySelector('button').addEventListener('click', () => { closeSheet(); openMusic(s.music); });
  } else if (s.id === 's53-cuba-commission') {
    /* Found from the Sources grid rather than from a story step — so offer the way in. */
    hear.hidden = false;
    hear.innerHTML = `<button class="hearbtn ccjump" data-cuba="cc-inbetween">
      <span class="ytmark" aria-hidden="true">華</span>
      <span>Open the China–Cuba Connection<i>what the Commission found, set against the book — five panels in Part Four</i></span></button>`;
    hear.querySelector('button').addEventListener('click', () => { closeSheet(); openCuba('cc-inbetween'); });
  } else hear.hidden = true;

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
    setTimebar(m !== 'story');
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
    if (cb.dataset.layer === 'chinacuba') cubaPinned = cb.checked;
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

  const musicSheet = document.getElementById('music');
  document.getElementById('music-x').addEventListener('click', closeMusic);
  musicSheet.addEventListener('click', e => { if (e.target.id === 'music') closeMusic(); });

  const cubaSheet = document.getElementById('cuba');
  document.getElementById('cuba-x').addEventListener('click', closeCuba);
  cubaSheet.addEventListener('click', e => { if (e.target.id === 'cuba') closeCuba(); });

  document.addEventListener('keydown', e => {
    const sheet = document.getElementById('sheet');
    if (!sheet.hidden) { trapTab(sheet.querySelector('.sheet-inner'), e); if (e.key === 'Escape') closeSheet(); return; }
    if (!musicSheet.hidden) { trapTab(musicSheet.querySelector('.sheet-inner'), e); if (e.key === 'Escape') closeMusic(); return; }
    if (!cubaSheet.hidden) { trapTab(cubaSheet.querySelector('.sheet-inner'), e); if (e.key === 'Escape') closeCuba(); return; }
    if (!about.hidden) { trapTab(about.querySelector('.sheet-inner'), e); if (e.key === 'Escape') closeAbout(); }
  });
}
