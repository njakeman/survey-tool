// Revisit-mode derivations, all pure. A "station" is one observation of the
// reference survey, and its state is derived, never stamped (the isExported
// idiom): DONE is the existence of a paired observation in this session,
// skip and no-access are explicit surveyor claims read from the
// revisitStations store, and everything else is to-do. Deriving means the
// pairing and the state can never disagree, and undoing a save honestly
// reverts the station to to-do with zero extra writes.

import { distanceM, bearingDeg } from '../geo/distance.js';

// The station's display name: the first clause of the reference note — the
// words that identify the place — or a number when the note has none.
// Numbered from 1, because surveyors count from one.
export function stationName(note, index) {
  const first = (note ?? '').split(/[.,;·—\n]/)[0].trim();
  return first || `Station ${index + 1}`;
}

// Precedence when signals coexist: done > noAccess > skipped > todo. A saved
// observation resolves any stale claim; a no-access claim is the stronger of
// the two claims because it is the one that lands in the export as a
// statement about the world.
function winningClaim(claims, record) {
  if (!claims) return record;
  if (claims.state === 'skipped' && record.state === 'noAccess') return record;
  return claims;
}

export function deriveStations(refStations, observations, stateRecords) {
  const doneIds = new Set(observations.map((obs) => obs.referenceObservationId).filter(Boolean));
  const claims = new Map();
  for (const record of stateRecords) {
    claims.set(record.refObsId, winningClaim(claims.get(record.refObsId), record));
  }

  return refStations.map((station, index) => {
    const claim = claims.get(station.id) ?? null;
    const state = doneIds.has(station.id) ? 'done' : (claim?.state ?? 'todo');
    return {
      ...station,
      index,
      name: stationName(station.note, index),
      state,
      reason: claim && state === claim.state ? (claim.reason ?? null) : null,
    };
  });
}

// The "am I in the right place" list, and the source of the default current
// station. No fix yet means no list — never a guess.
export function nearestStations(stations, position, count = 3) {
  if (!position) return [];
  return stations
    .map((station) => ({
      station,
      distanceM: distanceM(position, station),
      bearingDeg: bearingDeg(position, station),
    }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, count);
}

export function revisitProgress(stations) {
  return {
    done: stations.filter((station) => station.state === 'done').length,
    total: stations.length,
  };
}

// The four outcomes shown together at session end — the only place they are.
export function revisitSummary(stations, observations) {
  const count = (state) => stations.filter((station) => station.state === state).length;
  return {
    total: stations.length,
    done: count('done'),
    skipped: count('skipped'),
    noAccess: count('noAccess'),
    remaining: count('todo'),
    newCount: observations.filter((obs) => !obs.referenceObservationId).length,
  };
}

const EXPORT_STATE = {
  done: 'done',
  skipped: 'skipped',
  noAccess: 'no_access',
  todo: 'not_visited',
};

// Every station travels in the export with its state (survey_revisit's
// stations member, geojson.js). Sorted by id with plain < — never
// localeCompare — because this feeds canonicalStringify's byte guarantee.
export function stationsForExport(stations) {
  return stations
    .map((station) => ({
      ref_obs_id: station.id,
      state: EXPORT_STATE[station.state],
      reason: station.reason ?? null,
    }))
    .sort((a, b) => (a.ref_obs_id < b.ref_obs_id ? -1 : a.ref_obs_id > b.ref_obs_id ? 1 : 0));
}
