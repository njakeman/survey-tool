// The reference-mode parse: session.geojson bytes + the zip's entry names →
// { session, stations }, ready for a revisit to stand against. Reuses
// parseSessionExport's validation wholesale (every feature back through
// createObservation) but returns photo *filenames* verified against the
// entry list instead of photo bytes — the archive stays where it is and
// photos decode one at a time through referenceZip.js. Read-only by
// construction: nothing here can write, and nothing downstream ever writes
// to the reference.

import { parseCollection, sessionFrom, observationFrom } from './parseSessionExport.js';

const decoder = new TextDecoder();

export function parseReferenceExport(geojsonData, entryNames) {
  const collection = parseCollection(decoder.decode(geojsonData));

  if (collection.features.length === 0) {
    throw new Error('Could not load reference: the export has no observations to revisit');
  }

  const meta = sessionFrom(collection);
  const session = {
    // sessionFrom serves import, which mints its own id; a reference keeps
    // the original id so provenance can name it. Null for v1 exports, which
    // carried no survey_session member.
    id: collection.survey_session?.id ?? null,
    name: meta.name,
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
  };

  // Join by the photo property string(s), matched case-insensitively like
  // import does — never by assuming obs_id + '.jpg', because a retake mints
  // a fresh photo id. A claim with no backing entry is dropped, not trusted
  // (mirrors parseSessionExport's own "never claim a file the zip doesn't
  // contain").
  const entryByLowerName = new Map(entryNames.map((name) => [name.toLowerCase(), name]));
  const stations = collection.features.map((feature, index) => {
    const observation = observationFrom(feature, index, 'reference');
    // observationFrom already folded photos[] / legacy photo into ids on
    // observation.photos; the station instead needs the *filenames* as
    // claimed, in export order, so read the properties again here and join
    // against the entry list. Overwriting observation.photos (ids) with the
    // filename list below is fine — stations are UI-only objects that never
    // re-enter createObservation.
    const props = feature?.properties ?? {};
    // Filenames only. observationFrom above has already refused a claim that
    // isn't a string, by name — this guard is what keeps that true of the
    // read here too, rather than trusting the property a second time.
    const claimed = (
      Array.isArray(props.photos) ? props.photos.map((entry) => entry?.photo) : [props.photo]
    ).filter((filename) => typeof filename === 'string' && filename);
    const photos = claimed.flatMap((filename) => {
      const entryName = entryByLowerName.get(`photos/${filename}`.toLowerCase()) ?? null;
      return entryName ? [{ filename, entryName }] : [];
    });
    return { ...observation, photos };
  });

  return { session, stations };
}
