import { describe, expect, test } from 'vitest';
import {
  stationName,
  deriveStations,
  nearestStations,
  revisitProgress,
  revisitSummary,
  stationsForExport,
} from './revisit.js';

// Reference stations as parseReferenceExport returns them: the validated
// reference observations, in feature order. Only the fields the functions
// under test read are spelled out here.
const refStations = [
  { id: 'ref-1', note: 'Culvert head, east ditch. Shot upstream.', lat: 51.5001, lon: -0.14 },
  { id: 'ref-2', note: 'Stone stile, west boundary. Shot facing the oak.', lat: 51.5, lon: -0.141 },
  { id: 'ref-3', note: '', lat: 51.502, lon: -0.14 },
];

describe('stationName', () => {
  test('takes the first clause of the reference note — the words that identify the place', () => {
    expect(stationName('Stone stile, west boundary. Shot facing the oak.', 1)).toBe('Stone stile');
    expect(stationName('Culvert head. Silted since spring.', 0)).toBe('Culvert head');
    expect(stationName('Pond outfall · check grille', 0)).toBe('Pond outfall');
    expect(stationName('Lower gate — padlocked', 0)).toBe('Lower gate');
    expect(stationName('Field corner\nOak coppiced 2024', 0)).toBe('Field corner');
  });

  test('a note that is all one clause is the name as it stands', () => {
    expect(stationName('West stile', 0)).toBe('West stile');
  });

  test('falls back to a number when the note has no words', () => {
    // Numbered from 1: "Station 3" for index 2 — surveyors count from one.
    expect(stationName('', 2)).toBe('Station 3');
    expect(stationName(null, 0)).toBe('Station 1');
    expect(stationName('  · ', 4)).toBe('Station 5');
  });
});

describe('deriveStations', () => {
  test('every station starts as to-do, named, in reference order', () => {
    const stations = deriveStations(refStations, [], []);

    expect(stations.map((s) => s.state)).toEqual(['todo', 'todo', 'todo']);
    expect(stations.map((s) => s.name)).toEqual(['Culvert head', 'Stone stile', 'Station 3']);
    expect(stations.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(stations.map((s) => s.id)).toEqual(['ref-1', 'ref-2', 'ref-3']);
  });

  test('an observation paired to a station marks it done — derived, never stamped', () => {
    const stations = deriveStations(
      refStations,
      [{ id: 'obs-1', referenceObservationId: 'ref-2' }],
      [],
    );

    expect(stations[1].state).toBe('done');
    expect(stations[0].state).toBe('todo');
  });

  test('skip and no-access claims come from the state records, with their reason', () => {
    const stations = deriveStations(
      refStations,
      [],
      [
        { refObsId: 'ref-1', state: 'skipped', reason: null },
        { refObsId: 'ref-3', state: 'noAccess', reason: 'field flooded' },
      ],
    );

    expect(stations[0].state).toBe('skipped');
    expect(stations[2].state).toBe('noAccess');
    expect(stations[2].reason).toBe('field flooded');
    expect(stations[1].reason).toBeNull();
  });

  test('done outranks a stale claim — saving a skipped station honestly resolves it', () => {
    const stations = deriveStations(
      refStations,
      [{ id: 'obs-1', referenceObservationId: 'ref-1' }],
      [
        { refObsId: 'ref-1', state: 'skipped', reason: null },
        { refObsId: 'ref-2', state: 'noAccess', reason: null },
        { refObsId: 'ref-2', state: 'skipped', reason: null },
      ],
    );

    expect(stations[0].state).toBe('done');
    // ...and no-access outranks skipped when both claims somehow exist.
    expect(stations[1].state).toBe('noAccess');
  });

  test('an observation with no counterpart changes no station — it is simply new', () => {
    const stations = deriveStations(refStations, [{ id: 'obs-1' }], []);

    expect(stations.map((s) => s.state)).toEqual(['todo', 'todo', 'todo']);
  });
});

describe('nearestStations', () => {
  test('orders stations by distance from the surveyor, nearest first', () => {
    const position = { lat: 51.5, lon: -0.14 };
    const nearest = nearestStations(deriveStations(refStations, [], []), position, 3);

    expect(nearest.map((n) => n.station.id)).toEqual(['ref-1', 'ref-2', 'ref-3']);
    expect(nearest[0].distanceM).toBeGreaterThan(0);
    expect(nearest[0].distanceM).toBeLessThan(nearest[1].distanceM);
    expect(nearest[1].distanceM).toBeLessThan(nearest[2].distanceM);
    expect(nearest[0].bearingDeg).toBeGreaterThanOrEqual(0);
    expect(nearest[0].bearingDeg).toBeLessThan(360);
  });

  test('caps the list at the requested count', () => {
    const position = { lat: 51.5, lon: -0.14 };
    expect(nearestStations(deriveStations(refStations, [], []), position, 2)).toHaveLength(2);
  });

  test('no fix yet means no list — never a guess', () => {
    expect(nearestStations(deriveStations(refStations, [], []), null, 3)).toEqual([]);
  });
});

describe('revisitProgress / revisitSummary', () => {
  const observations = [
    { id: 'obs-1', referenceObservationId: 'ref-1' },
    { id: 'obs-2' }, // a new observation, no counterpart
  ];
  const claims = [{ refObsId: 'ref-3', state: 'noAccess', reason: null }];

  test('progress counts stations done of total', () => {
    const stations = deriveStations(refStations, observations, claims);

    expect(revisitProgress(stations)).toEqual({ done: 1, total: 3 });
  });

  test('the summary carries the four outcomes shown together at session end', () => {
    const stations = deriveStations(refStations, observations, claims);

    expect(revisitSummary(stations, observations)).toEqual({
      total: 3,
      done: 1,
      skipped: 0,
      noAccess: 1,
      remaining: 1,
      newCount: 1,
    });
  });
});

describe('stationsForExport', () => {
  test('every station travels with its state, sorted by id for deterministic bytes', () => {
    const stations = deriveStations(
      refStations,
      [{ id: 'obs-1', referenceObservationId: 'ref-2' }],
      [{ refObsId: 'ref-3', state: 'noAccess', reason: 'field flooded' }],
    );

    expect(stationsForExport(stations)).toEqual([
      { ref_obs_id: 'ref-1', state: 'not_visited', reason: null },
      { ref_obs_id: 'ref-2', state: 'done', reason: null },
      { ref_obs_id: 'ref-3', state: 'no_access', reason: 'field flooded' },
    ]);
  });

  test('skipped exports as skipped — a deliberate pass is not the same as never reached', () => {
    const stations = deriveStations(
      refStations,
      [],
      [{ refObsId: 'ref-1', state: 'skipped', reason: null }],
    );

    expect(stationsForExport(stations)[0]).toEqual({
      ref_obs_id: 'ref-1',
      state: 'skipped',
      reason: null,
    });
  });
});
