import { Map as MapLibreMap, addProtocol, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { PMTiles, Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrayBufferSource } from './pmtilesSource.js';
import { buildStyle } from './style.js';
import {
  accuracyRadiusExpression,
  observationsFeatureCollection,
  observationShapesCollection,
  positionFeature,
  observationPaint,
  positionPaint,
  accuracyPaint,
  pickedPointPaint,
  traceShapeLayers,
  activeTraceData,
  activeTraceLayer,
  OBSERVATION_SHAPES_SOURCE_ID,
  ACTIVE_TRACE_SOURCE_ID,
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
import { initialZoomFromHeader, maxBoundsFromHeader, minZoomFromHeader } from './viewport.js';

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
  onUserPan,
  onFeatureTap,
  onError,
}) {
  // `online` (an onlineImagery.js region) is the alternative to
  // `archiveBuffer`: a tile URL template instead of an archive, so there is
  // no protocol registration, no header, and nothing to release on destroy.
  // Construction touches no network either way — for the online map only the
  // tile fetches themselves can fail, which MapLibre reports as error events
  // (routed to onError below, never a throw) over a map that keeps working.
  // Everything from the load handler down is identical: overlays, feature
  // layers and picking neither know nor care where the basemap pixels come
  // from.
  let archiveKey = null;
  let header = null;
  if (!online) {
    ensureProtocol();
    archiveCounter += 1;
    archiveKey = `basemap-${archiveCounter}`;
    const archive = new PMTiles(new ArrayBufferSource(archiveBuffer, archiveKey));
    protocol.add(archive);
    header = await archive.getHeader();
  }

  const viewport = online
    ? // No bounds and no zoom floor: the imagery covers the world, and a
      // whole-world maxBounds is exactly what MapLibre cannot accept
      // (viewport.js). Opens at survey zoom over the provider's fixed centre
      // — the same open-at-a-centre-then-follow behaviour an archive has —
      // and the first fix centres it on the surveyor.
      { center: [online.centre.lon, online.centre.lat], zoom: SURVEY_ZOOM }
    : {
        center: [header.centerLon, header.centerLat],
        zoom: initialZoomFromHeader(header, SURVEY_ZOOM),
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
    style: online
      ? buildStyle({
          glyphsUrl,
          tileType: 'online-raster',
          tiles: online.tiles,
          tileSize: online.tileSize,
          maxzoom: online.maxzoom,
          attribution: online.attribution,
        })
      : buildStyle({ glyphsUrl, archiveKey, tileType, tileSize, attribution }),
    ...viewport,
    // A survey map that spins under a gloved hand is worse than useless.
    dragRotate: false,
    pitchWithRotate: false,
    // Standard gestures: one finger pans, pinch zooms. Cooperative gestures
    // (one finger scrolls the page, two fingers pan) were tried first and
    // failed in the field — two-finger pan is unwieldy in gloves, and the
    // stray second touch pinch-zoomed the interface instead of the map. The
    // page scrolls from outside the map panel.
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

  function featureLayersBefore() {
    // beforeId only once the target layers exist. During the initial load
    // they do not yet, and MapLibre throws on an unknown beforeId.
    if (map.getLayer(FEATURE_LAYERS_END_AT)) return FEATURE_LAYERS_END_AT;
    if (map.getLayer(MARKERS_START_AT)) return MARKERS_START_AT;
    return undefined;
  }

  function addFeatureLayer(layer) {
    map.addSource(featureLayerSourceId(layer.id), featureLayerSource(layer));
    for (const definition of featureLayerLayers(layer)) {
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
      map.addLayer(activeTraceLayer());

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
      map.addLayer({
        id: 'position-dot',
        type: 'circle',
        source: 'position',
        paint: positionPaint(),
      });

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
      // Last, so the accuracy ring's paint is applied over a layer stack that
      // is already complete.
      if (pendingPosition !== undefined) {
        setPosition(pendingPosition);
        pendingPosition = undefined;
      }

      container.dataset.mapLoaded = 'true';
      resolve();
    });
  });

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

  // The walk in progress, as a bare coordinates array (or null). Rendered
  // only from two vertices — a dot is not a line (overlays.js).
  function setActiveTrace(coordinates) {
    if (!styleLoaded) {
      pendingActiveTrace = coordinates;
      return;
    }
    map.getSource(ACTIVE_TRACE_SOURCE_ID)?.setData(activeTraceData(coordinates));
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
    getPointAtFraction,
    getZoom,
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
    hasSource,
    whenIdle,
    getArchiveKey: () => archiveKey,
  };
}
