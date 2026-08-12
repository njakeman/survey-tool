import { featureLayerSourceId } from './featureLayerStyle.js';

// Reduces a MapLibre queryRenderedFeatures result to the one thing the
// surveyor tapped, described well enough for a sheet to render it and for an
// observation to link back to it.
//
// Pure, and separate from mapAdapter.js, because all the judgement is here —
// which hit wins, what counts as the feature's identity, which attributes are
// worth showing and in what order. None of that is observable from a test
// that can only assert a map was clicked.

// Attributes an export pipeline left behind: row ids, internal keys. Never
// what the surveyor came to read.
const INTERNAL_KEY = /^_/;

function isEmpty(value) {
  // Zero and false are values. Only null, undefined and the empty string are
  // absences — a field showing "0 ha" matters, a field showing nothing does not.
  return value === null || value === undefined || value === '';
}

function asString(value) {
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function orderFields(properties, fieldOrder) {
  const declared = fieldOrder ?? [];
  const keys = Object.keys(properties)
    .filter((key) => !INTERNAL_KEY.test(key) && !isEmpty(properties[key]))
    .sort((a, b) => {
      const aRank = declared.indexOf(a);
      const bRank = declared.indexOf(b);
      // Declared keys first in their declared order; everything else falls in
      // behind them alphabetically.
      if (aRank !== -1 && bRank !== -1) return aRank - bRank;
      if (aRank !== -1) return -1;
      if (bRank !== -1) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });

  return keys.map((key) => ({ key, value: asString(properties[key]) }));
}

export function describeTappedFeature(features, layers) {
  // Topmost first, which is how MapLibre orders them and what the surveyor
  // actually saw under their thumb.
  const feature = (features ?? [])[0];
  if (!feature) return null;

  // Resolved through the source rather than by unpicking the layer id: the
  // source is one value per feature layer, where layer ids are per geometry.
  const layer = (layers ?? []).find(
    (candidate) => featureLayerSourceId(candidate.id) === feature.source,
  );
  // A layer switched off between the tap and the query resolving.
  if (!layer) return null;

  const style = layer.style ?? {};
  const properties = feature.properties ?? {};

  const declaredId = style.idProperty ? properties[style.idProperty] : undefined;
  const rawId = !isEmpty(declaredId) ? declaredId : feature.id;
  // A GeoJSON feature need carry no id at all. Fabricating one would put a
  // meaningless value on a saved observation — worse than an honest absence.
  const featureId = isEmpty(rawId) ? null : asString(rawId);

  const declaredTitle = style.titleProperty ? properties[style.titleProperty] : undefined;

  return {
    layerId: layer.id,
    layerName: layer.name,
    featureId,
    title: !isEmpty(declaredTitle) ? asString(declaredTitle) : (featureId ?? layer.name),
    fields: orderFields(properties, style.fieldOrder),
    geometry: sourceGeometry(layer, style, featureId) ?? feature.geometry ?? null,
  };
}

// The feature's whole geometry, from the layer's stored GeoJSON.
// queryRenderedFeatures returns geometry clipped to tile boundaries — half a
// parcel, for a parcel that crosses one — so the rendered shape is only the
// fallback for features nothing identifies.
function sourceGeometry(layer, style, featureId) {
  if (featureId === null) return null;
  const features = layer.geojson?.features ?? [];
  const match = features.find((candidate) => {
    const id = style.idProperty ? candidate.properties?.[style.idProperty] : candidate.id;
    return !isEmpty(id) && asString(id) === featureId;
  });
  return match?.geometry ?? null;
}
