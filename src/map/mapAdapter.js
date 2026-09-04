import { Map as MapLibreMap, Marker, addProtocol, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { PMTiles, Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrayBufferSource } from './pmtilesSource.js';
import { buildOfflineFallbackStyle, buildStyle, prepareRemoteStyle } from './style.js';
import {
  accuracyRadiusExpression,
  observationsFeatureCollection,
  observationShapesCollection,
  positionFeature,
  observationPaint,
  accuracyPaint,
  pickedPointPaint,
  traceShapeLayers,
  activeTraceData,
  activeTraceLayers,
  traceCasingColor,
  stationsCollection,
  stationLayers,
  stationDiamondImage,
  OBSERVATION_SHAPES_SOURCE_ID,
  ACTIVE_TRACE_SOURCE_ID,
  STATIONS_SOURCE_ID,
  STATION_ICONS,
} from './overlays.js';
import {
  featureLayerIds,
  featureLayerLayers,
  featureLayerSource,
  featureLayerSourceId,
  HIGHLIGHT_SOURCE_ID,
  highlightLayers,
  highlightSourceData,
} from './featureLayerStyle.js';
import { describeTappedFeature } from './featureQuery.js';
import { LOCATOR_SVG, accumulateRotation, beamPath, locatorView } from './locator.js';
import {
  fitViewport,
  initialZoomFromHeader,
  maxBoundsFromHeader,
  minZoomFromHeader,
} from './viewport.js';

// The one module that touches MapLibre. Everything above it (style, overlays,
// follow mode) is pure and node-tested; everything below it (CaptureMap) sees
// only the handle returned here. main.js is the sole importer, loading it
// dynamically so ~800 KB of renderer stays out of the startup path — same
// rule as photo/encode.js.
//
// MapLibre 6 loads its worker from a separate file resolved against
// import.meta.url, which does not survive bundling: production and offline
// would both break with no dev-mode warning. Vite's ?worker&url emits the
// worker as a hashed asset (covered by the precache glob) and setWorkerUrl
// points MapLibre at it.
setWorkerUrl(workerUrl);

// One protocol for the page, but a unique archive key per map.
//
// The scheme has to be exactly `pmtiles`: the library parses tile URLs with a
// hardcoded /pmtiles:\/\//  regex and reads the archive key as url.substr(10),
// so any other scheme makes it treat the key as a remote URL and try to fetch
// it. Uniqueness therefore lives in the key, not the scheme — otherwise two
// regions collide on the shared key and the second silently replaces the
// first underneath a live map.
//
// Protocol exposes no remove, so `destroy` deletes from its `tiles` map
// directly. That reaches past the documented surface, but the alternative is
// pinning every archive ever opened in memory at tens of megabytes each.
const protocol = new Protocol();
let protocolRegistered = false;
let archiveCounter = 0;

function ensureProtocol() {
  if (protocolRegistered) return;
  addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

// How many archives the protocol is holding. Exported so the browser tier can
// prove teardown actually releases them rather than trusting the comment.
export function registeredArchiveCount() {
  return protocol.tiles.size;
}

const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

// Close enough to read field boundaries and gate posts.
const SURVEY_ZOOM = 16;

// Feature layers are inserted before this, so nothing the surveyor's own GIS
// data draws can ever cover the live fix or a saved observation.
const MARKERS_START_AT = 'position-accuracy';

// …and before this first, so the selection highlight always draws *over* the
// layer it highlights while itself staying under the markers.
const FEATURE_LAYERS_END_AT = `${HIGHLIGHT_SOURCE_ID}-fill`;

// A tap is a box, not a point. One pixel of tolerance is unusable through a
// glove on a wet screen, and a boundary line is two pixels wide.
const TAP_TOLERANCE_PX = 10;

export async function createMapAdapter({
  container,
  archiveBuffer,
  online,
  glyphsUrl,
  tileType = 'vector',
  tileSize,
  attribution,
  fit = null,
  view = null,
  onUserPan,
  onFeatureTap,
  onError,
}) {
  // `online` (an onlineBasemaps.js region) is the alternative to
  // `archiveBuffer`: no protocol registration, no header, and nothing to
  // release on destroy. Two online kinds, told apart by their fields — a
  // `tiles` template (imagery) has its style built locally, so construction
  // touches no network and only the tile fetches can fail, as error events
  // (routed to onError below, never a throw) over a map that keeps working.
  // A `styleUrl` region (the OpenFreeMap styles) is the one case where the
  // basemap *style itself* lives on the network — handing MapLibre the URL
  // would mean a failed fetch stops `load` ever firing, losing every queued
  // setter (the fix marker included). So the style JSON is fetched here,
  // before construction, and a failed fetch falls back to a local blank
  // ground: the map always constructs from a style already in hand.
  // Everything from the load handler down is identical: overlays, feature
  // layers and picking neither know nor care where the basemap pixels come
  // from.
  let archiveKey = null;
  let header = null;
  // Whether the provider's remote style is actually driving the map — its
  // glyph server replaces ours, so feature-layer labels must switch stacks.
  let remoteStyleLoaded = false;
  let style;
  if (online?.styleUrl) {
    try {
      const response = await fetch(online.styleUrl, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`style fetch failed: ${response.status}`);
      const styleJson = await response.json();
      style = prepareRemoteStyle(styleJson, { attribution: online.attribution });
      remoteStyleLoaded = true;
    } catch {
      style = buildOfflineFallbackStyle({ glyphsUrl });
    }
  } else if (online) {
    style = buildStyle({
      glyphsUrl,
      tileType: 'online-raster',
      tiles: online.tiles,
      tileSize: online.tileSize,
      maxzoom: online.maxzoom,
      attribution: online.attribution,
    });
  } else {
    ensureProtocol();
    archiveCounter += 1;
    archiveKey = `basemap-${archiveCounter}`;
    const archive = new PMTiles(new ArrayBufferSource(archiveBuffer, archiveKey));
    protocol.add(archive);
    header = await archive.getHeader();
    style = buildStyle({ glyphsUrl, archiveKey, tileType, tileSize, attribution });
  }

  // undefined falls back to the vendored stack inside featureLayerLayers.
  const labelFontStack = remoteStyleLoaded ? online.featureFontStack : undefined;

  // Two callers can override the opening centre/zoom, in precedence order:
  // `fit` (the history map, framing a past session's observations — bounds,
  // zoom decided by fitViewport) then `view` (CaptureMap's region switch,
  // carrying the outgoing map's exact { center: [lon, lat], zoom } so the
  // ground doesn't move under the surveyor). Both are applied at
  // construction, not as a post-load call, so the map never visibly jumps
  // from the region default. In the archive branch minZoom/maxBounds still
  // apply over either, so an out-of-coverage fit or view clamps to the
  // archive edge — honest, and on the checklist.
  const fitted = fitViewport(fit, { maxZoom: SURVEY_ZOOM });
  const viewport = online
    ? // No bounds and no zoom floor: the imagery covers the world, and a
      // whole-world maxBounds is exactly what MapLibre cannot accept
      // (viewport.js). Opens at survey zoom over the provider's fixed centre
      // — the same open-at-a-centre-then-follow behaviour an archive has —
      // and the first fix centres it on the surveyor.
      (fitted ?? view ?? { center: [online.centre.lon, online.centre.lat], zoom: SURVEY_ZOOM })
    : {
        ...(fitted ??
          view ?? {
            center: [header.centerLon, header.centerLat],
            zoom: initialZoomFromHeader(header, SURVEY_ZOOM),
          }),
        // A floor only where the archive has one: below its lowest tile zoom
        // there is nothing to draw. maxZoom stays unset so overzoom past the
        // deepest tile still works — blurry beats blank; clamping the map to
        // the archive's tile zooms would stop the surveyor zooming in, and a
        // degenerate range (min === max) breaks MapLibre's viewport maths
        // outright.
        ...(minZoomFromHeader(header) === null ? {} : { minZoom: minZoomFromHeader(header) }),
        // Panning is clamped to what the archive covers — beyond it there
        // are no tiles, and a blank grey void reads as a broken app. null
        // for a world-covering archive, which MapLibre cannot accept
        // (viewport.js).
        maxBounds: maxBoundsFromHeader(header) ?? undefined,
      };

  const map = new MapLibreMap({
    container,
    style,
    ...viewport,
    // A survey map that spins under a gloved hand is worse than useless.
    dragRotate: false,
    pitchWithRotate: false,
    // Standard gestures: one finger pans, pinch zooms. Cooperative gestures
    // (one finger scrolls the page, two fingers pan) were tried first and
    // failed in the field — two-finger pan is unwieldy in gloves, and the
    // stray second touch pinch-zoomed the interface instead of the map. The
    // page scrolls from outside the map panel.
    // Compact: the ⓘ toggle, not the full-width bar. It still starts itself
    // expanded on load; the load handler below collapses it.
    attributionControl: { compact: true },
    fadeDuration: 0,
  });

  map.touchZoomRotate.disableRotation();

  if (onError) map.on('error', (event) => onError(event?.error ?? event));
  // dragstart only fires for user gestures; programmatic easeTo/jumpTo does
  // not, so follow mode can recentre without cancelling itself.
  if (onUserPan) map.on('dragstart', () => onUserPan());

  // The feature layers currently on the map, as the objects they were set
  // from. Held because removal needs to know what was added, and because a
  // tap has to resolve a source id back to the layer's name and style.
  let featureLayers = [];
  let styleLoaded = false;

  // Everything below arrives before MapLibre's load event at least sometimes,
  // and the position routinely: createMapAdapter resolves as soon as the
  // archive header is read, CaptureMap wires its effects up on that, and a
  // ~1Hz GPS watch lands a fix in the gap. Until `load`, the sources and
  // layers added there do not exist, and the two ways of touching them fail
  // differently — getSource() returns undefined, so setData quietly does
  // nothing, while setPaintProperty throws "Style is not done loading" and,
  // being called straight from an effect, reaches window.onerror and puts the
  // fatal-error banner over a working app.
  //
  // So each setter stashes rather than acting, and the load handler replays
  // the latest value. Only the latest: these are all last-write-wins, and
  // replaying a queue of superseded GPS fixes would be worse than useless.
  let pendingFeatureLayers = null;
  let pendingPosition;
  let pendingObservations;
  let pendingPickedPoint;
  let pendingHighlight;
  let pendingActiveTrace;
  let pendingNightMode;
  let pendingStations;

  function featureLayersBefore() {
    // beforeId only once the target layers exist. During the initial load
    // they do not yet, and MapLibre throws on an unknown beforeId.
    if (map.getLayer(FEATURE_LAYERS_END_AT)) return FEATURE_LAYERS_END_AT;
    if (map.getLayer(MARKERS_START_AT)) return MARKERS_START_AT;
    return undefined;
  }

  function addFeatureLayer(layer) {
    map.addSource(featureLayerSourceId(layer.id), featureLayerSource(layer));
    for (const definition of featureLayerLayers(layer, { fontStack: labelFontStack })) {
      map.addLayer(definition, featureLayersBefore());
    }
  }

  function removeFeatureLayer(layer) {
    const sourceId = featureLayerSourceId(layer.id);
    // By prefix rather than by recomputing the ids from the layer object: if
    // the style changed between add and remove (a label property gained or
    // lost), the recomputed set would not match what is actually on the map
    // and would strand a layer behind.
    for (const mapLayer of map.getStyle().layers) {
      if (mapLayer.id.startsWith(`${sourceId}-`)) map.removeLayer(mapLayer.id);
    }
    // The source too: left behind, addSource throws the next time the same
    // layer is switched back on.
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }

  function applyFeatureLayers(next) {
    for (const current of featureLayers) {
      // Rebuilt rather than mutated when the object differs: paint, filters
      // and the label layer's very existence all come from the style, and
      // there is no setPaintProperty-shaped way to change whether a layer
      // exists. Toggling is rare enough that the cost is irrelevant.
      if (!next.includes(current)) removeFeatureLayer(current);
    }
    for (const layer of next) {
      if (!featureLayers.includes(layer)) addFeatureLayer(layer);
    }
    featureLayers = next;
  }

  function setFeatureLayers(layers) {
    const next = layers ?? [];
    if (!styleLoaded) {
      pendingFeatureLayers = next;
      return;
    }
    applyFeatureLayers(next);
  }

  // The shared path behind both the click handler and the browser tier's
  // assertions. All the judgement about *which* feature and *what to show*
  // lives in featureQuery.js, node-tested; this only widens the target.
  function queryFeatureAt(point) {
    const ids = featureLayers.flatMap(featureLayerIds).filter((id) => map.getLayer(id));
    if (ids.length === 0) return null;
    const box = [
      [point.x - TAP_TOLERANCE_PX, point.y - TAP_TOLERANCE_PX],
      [point.x + TAP_TOLERANCE_PX, point.y + TAP_TOLERANCE_PX],
    ];
    return describeTappedFeature(map.queryRenderedFeatures(box, { layers: ids }), featureLayers);
  }

  // Reports null for a tap that hit nothing, which is what dismisses the
  // sheet — the surveyor tapping the map to put it away.
  if (onFeatureTap) map.on('click', (event) => onFeatureTap(queryFeatureAt(event.point)));

  const ready = new Promise((resolve) => {
    map.on('load', () => {
      map.addSource('position', { type: 'geojson', data: EMPTY_COLLECTION });
      map.addSource('observations', { type: 'geojson', data: EMPTY_COLLECTION });
      map.addSource('picked', { type: 'geojson', data: EMPTY_COLLECTION });

      // The selection highlight, added before the marker layers so it stays
      // beneath them; feature layers are in turn inserted before its first
      // layer (FEATURE_LAYERS_END_AT), completing the order basemap →
      // feature layers → highlight → markers.
      map.addSource(HIGHLIGHT_SOURCE_ID, { type: 'geojson', data: highlightSourceData(null) });
      for (const definition of highlightLayers()) {
        map.addLayer(definition);
      }

      // Saved traces and the walk in progress, above the highlight and
      // below every marker: a boundary is ground shape, never allowed to
      // cover the live fix or a marker dot.
      map.addSource(OBSERVATION_SHAPES_SOURCE_ID, { type: 'geojson', data: EMPTY_COLLECTION });
      for (const definition of traceShapeLayers()) {
        map.addLayer(definition);
      }
      map.addSource(ACTIVE_TRACE_SOURCE_ID, { type: 'geojson', data: activeTraceData(null) });
      for (const definition of activeTraceLayers()) {
        map.addLayer(definition);
      }

      // Revisit stations: targets on the ground, above the walked shapes,
      // below the accuracy ring and markers (nothing may cover the fix).
      // The three diamond images are rasterised at runtime (overlays.js) —
      // no sprite files, nothing new to precache.
      for (const [variant, name] of Object.entries(STATION_ICONS)) {
        const image = stationDiamondImage(variant);
        map.addImage(name, image, { pixelRatio: image.pixelRatio });
      }
      map.addSource(STATIONS_SOURCE_ID, { type: 'geojson', data: stationsCollection(null, null) });
      for (const definition of stationLayers()) {
        map.addLayer(definition);
      }

      // The paint lives in overlays.js with the rest of the pure marker
      // logic, so the pending/synced distinction is node-testable rather
      // than only visible on a real map.
      map.addLayer({
        id: 'position-accuracy',
        type: 'circle',
        source: 'position',
        paint: accuracyPaint(),
      });
      map.addLayer({
        id: 'observations-markers',
        type: 'circle',
        source: 'observations',
        paint: observationPaint(),
      });
      // Above the saved observations so a fresh mark is not lost among them,
      // but below the live fix, which must never be hidden by anything.
      map.addLayer({
        id: 'picked-point',
        type: 'circle',
        source: 'picked',
        paint: pickedPointPaint(),
      });
      // The live fix itself is the locator DOM marker (locator.js), not a
      // circle layer: it needs a dashed stale ring, a rotating gradient
      // beam and per-mode CSS tokens, none of which a circle layer can
      // express. As a DOM element it sits above every canvas layer — the
      // "nothing may ever cover the fix" guarantee holds by construction.
      // It takes the night tokens directly only because style.css puts the
      // night filter on the canvas element itself: Marker.addTo appends
      // into the canvas container, so a filter on that container would
      // dim the marker with the tiles. Created on the first fix, in
      // setPosition below.

      // Set before the replays below, so each setter takes its normal path.
      styleLoaded = true;
      if (pendingFeatureLayers) {
        applyFeatureLayers(pendingFeatureLayers);
        pendingFeatureLayers = null;
      }
      if (pendingObservations !== undefined) {
        setObservations(pendingObservations);
        pendingObservations = undefined;
      }
      if (pendingPickedPoint !== undefined) {
        setPickedPoint(pendingPickedPoint);
        pendingPickedPoint = undefined;
      }
      if (pendingHighlight !== undefined) {
        setHighlight(pendingHighlight);
        pendingHighlight = undefined;
      }
      if (pendingActiveTrace !== undefined) {
        setActiveTrace(pendingActiveTrace);
        pendingActiveTrace = undefined;
      }
      if (pendingStations !== undefined) {
        setStations(pendingStations);
        pendingStations = undefined;
      }
      if (pendingNightMode !== undefined) {
        setNightMode(pendingNightMode);
        pendingNightMode = undefined;
      }
      // Last, so the accuracy ring's paint is applied over a layer stack that
      // is already complete.
      if (pendingPosition !== undefined) {
        setPosition(pendingPosition);
        pendingPosition = undefined;
      }

      // MapLibre's compact attribution opens itself on load (_updateCompact).
      // Collapse it to its toggle: on a phone-sized map the expanded pill
      // covers the bottom corner of the ground. Mirrors the control's own
      // collapse branch (open set, compact-show removed), so the toggle keeps
      // working. Once maplibregl-compact is present, later attribution
      // updates never re-add compact-show, so once is enough.
      const attrib = container.querySelector('.maplibregl-ctrl-attrib');
      if (attrib) {
        attrib.setAttribute('open', '');
        attrib.classList.remove('maplibregl-compact-show');
      }

      container.dataset.mapLoaded = 'true';
      resolve();
    });
  });

  // The locator marker: created on the first fix, moved on every one after.
  // Its beam and stale state arrive separately through setLocator — heading
  // ticks and GPS ticks are different streams at different rates.
  let locatorMarker = null;
  let locatorElement = null;
  // Cumulative, so the CSS-transitioned beam turns 2° at the 359→1 wrap
  // instead of spinning 358° the long way round.
  let locatorRotation = null;
  let locatorState = { heading: null, stale: false };

  function applyLocator() {
    if (!locatorElement) return;
    const view = locatorView(locatorState);
    locatorElement.dataset.stale = String(view.stale);
    const beam = locatorElement.querySelector('#locator-beam');
    const path = locatorElement.querySelector('#locator-beam-path');
    if (!view.beam) {
      // Absent entirely — the honest representation of not knowing; the
      // readings panel says "Position only — no compass" in words.
      beam.style.display = 'none';
      return;
    }
    beam.style.display = '';
    beam.style.opacity = String(view.beam.opacity);
    path.setAttribute('d', beamPath(view.beam.arcDeg));
    locatorRotation = accumulateRotation(locatorRotation, view.beam.rotationDeg);
    beam.style.transform = `rotate(${locatorRotation}deg)`;
  }

  function setLocator(state) {
    locatorState = state;
    applyLocator();
  }

  function setPosition(reading) {
    // Stashed as the reading, not as the feature: `undefined` means "nothing
    // set yet" and null means "explicitly cleared", and a fix that arrived
    // and was then cleared before load must stay cleared.
    if (!styleLoaded) {
      pendingPosition = reading;
      return;
    }
    const feature = positionFeature(reading);
    map
      .getSource('position')
      ?.setData(feature ? { type: 'FeatureCollection', features: [feature] } : EMPTY_COLLECTION);
    if (feature) {
      map.setPaintProperty('position-accuracy', 'circle-radius', accuracyRadiusExpression(reading));
      if (!locatorMarker) {
        locatorElement = container.ownerDocument.createElement('div');
        locatorElement.className = 'locator';
        locatorElement.innerHTML = LOCATOR_SVG;
        applyLocator();
        locatorMarker = new Marker({ element: locatorElement, anchor: 'center' });
        locatorMarker.setLngLat([reading.lon, reading.lat]).addTo(map);
      } else {
        locatorMarker.setLngLat([reading.lon, reading.lat]);
      }
    } else if (locatorMarker) {
      locatorMarker.remove();
      locatorMarker = null;
      locatorElement = null;
    }
  }

  function setObservations(observations) {
    if (!styleLoaded) {
      pendingObservations = observations;
      return;
    }
    // One call feeds both: every observation a marker at its representative
    // point, and the traced ones their walked shape underneath.
    map.getSource('observations')?.setData(observationsFeatureCollection(observations));
    map.getSource(OBSERVATION_SHAPES_SOURCE_ID)?.setData(observationShapesCollection(observations));
  }

  // Revisit stations, as { stations, currentId } or null. One setData feeds
  // the whole set — the current target is baked into each feature's icon by
  // stationsCollection, so there is no second pending slot to race.
  function setStations(state) {
    if (!styleLoaded) {
      pendingStations = state;
      return;
    }
    map
      .getSource(STATIONS_SOURCE_ID)
      ?.setData(stationsCollection(state?.stations, state?.currentId ?? null));
  }

  // The walk in progress: { coordinates, gaps } (or a bare coordinates
  // array, or null). Rendered only from two vertices — a dot is not a line
  // (overlays.js); `gaps` are the segment indices the app inferred rather
  // than measured, drawn dotted mid-walk.
  function setActiveTrace(trace) {
    if (!styleLoaded) {
      pendingActiveTrace = trace;
      return;
    }
    const coordinates = Array.isArray(trace) ? trace : (trace?.coordinates ?? null);
    const gaps = Array.isArray(trace) ? null : (trace?.gaps ?? null);
    map.getSource(ACTIVE_TRACE_SOURCE_ID)?.setData(activeTraceData(coordinates, gaps));
  }

  // Night mode reaches the canvas as one flipped colour: the CSS filter dims
  // everything canvas-drawn, and against that ground the trace-line casings
  // need to go dark instead of pale (overlays.js traceCasingColor). The
  // layer structure is untouched — one paint property per casing.
  function setNightMode(night) {
    if (!styleLoaded) {
      pendingNightMode = night;
      return;
    }
    for (const id of [
      'trace-line-exported-casing',
      'trace-line-pending-casing',
      'trace-line-inferred-casing',
      'active-trace-line-casing',
      'active-trace-inferred-casing',
    ]) {
      map.setPaintProperty(id, 'line-color', traceCasingColor(Boolean(night)));
    }
  }

  // The provisional mark. Same stash-until-loaded discipline as the others.
  function setPickedPoint(point) {
    if (!styleLoaded) {
      pendingPickedPoint = point;
      return;
    }
    map.getSource('picked')?.setData(
      point
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
                properties: {},
              },
            ],
          }
        : EMPTY_COLLECTION,
    );
  }

  // The selection: a described tap result (featureQuery.js) or null. Only
  // its geometry is drawn — the highlight is a shape, not a marker.
  function setHighlight(feature) {
    if (!styleLoaded) {
      pendingHighlight = feature;
      return;
    }
    map.getSource(HIGHLIGHT_SOURCE_ID)?.setData(highlightSourceData(feature?.geometry ?? null));
  }

  // What is on the ground under a given fraction of the canvas. Read on
  // demand rather than pushed, because the map moves under the surveyor's
  // thumb far faster than any state update should follow.
  //
  // Fractions rather than a bare getCentre(), because the picking crosshair
  // is deliberately *not* at the centre — the confirm panel covers the bottom
  // of the map, so the reticle sits a third of the way down. The caller owns
  // that fraction and uses the same value to position the crosshair, so the
  // thing being aimed at and the thing being recorded cannot drift apart. At
  // z17 a pixel is about 0.9 m, so an unnoticed 50px disagreement would be a
  // 45 m error in the saved coordinates with nothing on screen to show it.
  function getPointAtFraction({ x = 0.5, y = 0.5 } = {}) {
    const canvas = map.getCanvas();
    const { lat, lng } = map.unproject([canvas.clientWidth * x, canvas.clientHeight * y]);
    return { lat, lon: lng };
  }

  function getZoom() {
    return map.getZoom();
  }

  function getCenter() {
    const { lat, lng } = map.getCenter();
    return { lat, lon: lng };
  }

  // Movement, for as long as the caller wants it; returns an unsubscribe.
  // Subscribed only while the picking crosshair is open, deliberately: the
  // readout has to be live under a moving thumb, but a standing subscription
  // would re-render the panel on every follow-mode recentre — about once a
  // second, for a readout nobody is looking at.
  function onMove(handler) {
    map.on('move', handler);
    return () => map.off('move', handler);
  }

  function centreOn(reading) {
    if (!reading) return;
    map.easeTo({ center: [reading.lon, reading.lat], duration: 300 });
  }

  function resize() {
    map.resize();
  }

  function destroy() {
    locatorMarker?.remove();
    map.remove();
    // Releases this archive's PMTiles and its buffer; without it, switching
    // regions accumulates them for the life of the page. An online map
    // registered nothing.
    if (archiveKey) protocol.tiles.delete(archiveKey);
    delete container.dataset.mapLoaded;
  }

  // Read-throughs the CaptureMap never calls; they exist so the browser tier
  // can assert what actually reached the renderer.
  function getMaxBounds() {
    return map.getMaxBounds();
  }

  function isRotationEnabled() {
    return map.dragRotate.isEnabled();
  }

  function isSingleFingerPanEnabled() {
    return map.dragPan.isEnabled() && !map.cooperativeGestures.isEnabled();
  }

  async function getSourceFeatureCount(sourceId) {
    const source = map.getSource(sourceId);
    if (!source) return 0;
    const data = await source.getData();
    return data?.features?.length ?? 0;
  }

  function getLayerOrder() {
    return map.getStyle().layers.map((layer) => layer.id);
  }

  function getLayerLayoutProperty(layerId, name) {
    return map.getLayoutProperty(layerId, name);
  }

  function hasSource(sourceId) {
    return Boolean(map.getSource(sourceId));
  }

  // Rendering has settled. Only the browser tier needs it: a
  // queryRenderedFeatures before the first paint finds nothing, however
  // correct the layers are.
  function whenIdle() {
    return new Promise((resolve) => map.once('idle', resolve));
  }

  return {
    container,
    ready,
    setPosition,
    setObservations,
    setFeatureLayers,
    setPickedPoint,
    setHighlight,
    setActiveTrace,
    setStations,
    setNightMode,
    setLocator,
    // The browser tier's read-through: whether the DOM marker is on the map.
    hasLocator: () => Boolean(locatorMarker),
    getPointAtFraction,
    getZoom,
    getCenter,
    onMove,
    queryFeatureAt,
    centreOn,
    resize,
    destroy,
    getMaxBounds,
    isRotationEnabled,
    isSingleFingerPanEnabled,
    getSourceFeatureCount,
    getLayerOrder,
    getLayerLayoutProperty,
    hasSource,
    whenIdle,
    getArchiveKey: () => archiveKey,
  };
}
