import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { html } from 'htm/preact';
import { CapturePage } from './CapturePage.js';
import { SaveButton } from './SaveButton.js';
import { ObservationsList } from './ObservationsList.js';

// Nothing in this app is announced today: there is not one role= or
// aria-live= outside a single aria-current. Everything that appears without
// the surveyor doing anything — a failed save, a settled offline check, a
// region suggestion from a GPS tick — arrives silently.

const OPEN_SESSION = {
  id: 'sess-1',
  name: 'Ashton Keynes',
  status: 'open',
  startedAt: '2026-08-06T09:00:00.000Z',
};
const POSITION = {
  lat: 51.5,
  lon: -0.14,
  accuracyM: 8.2,
  altitudeM: null,
  altitudeAccuracyM: null,
  fixAt: 'x',
  fixAtMs: Date.now(),
};

function createFakeService({ observations = [] } = {}) {
  return {
    getOpenSession: vi.fn().mockResolvedValue(OPEN_SESSION),
    startSession: vi.fn(),
    endSession: vi.fn(),
    saveObservation: vi.fn().mockRejectedValue(new Error('disk full')),
    countObservations: vi.fn().mockResolvedValue(observations.length),
    listObservations: vi.fn().mockResolvedValue(observations),
    deleteObservation: vi.fn(),
    getTraceDraft: vi.fn().mockResolvedValue(null),
  };
}

function fakeSensors() {
  let handlers = null;
  return {
    sensors: {
      watchPosition: (h) => {
        handlers = h;
        return vi.fn();
      },
      watchHeading: () => vi.fn(),
      requestHeadingPermission: vi.fn().mockResolvedValue('granted'),
    },
    push: (reading) => handlers?.onReading(reading),
  };
}

function renderCapture(overrides = {}) {
  const service = overrides.service ?? createFakeService();
  const { sensors, push } = fakeSensors();
  render(
    html`<${CapturePage}
      service=${service}
      sensors=${sensors}
      downscale=${vi.fn()}
      statusKnown=${true}
      activeRegionId=${null}
      createMap=${vi.fn()}
      visible=${true}
      offlineStatus=${overrides.offlineStatus}
    />`,
  );
  return { service, push };
}

describe('announcements', () => {
  test('a failed save is announced, not just printed', async () => {
    const { push } = renderCapture();
    await screen.findByText('Ashton Keynes');
    push(POSITION);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save observation/i })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/disk full/);
  });

  test('the offline warning is announced when the check settles after first paint', async () => {
    // It appears with no user action at all, once subscribeOfflineStatus
    // reports — silence means the surveyor never learns the app cannot work
    // offline.
    renderCapture({ offlineStatus: { precachedCount: 0, offlineReady: false } });

    const warning = await screen.findByText(/no offline cache/i);
    expect(warning).toHaveAttribute('role', 'status');
  });
});

describe('SaveButton', () => {
  test('associates its disabled reason with the button, rather than leaving it adrift', () => {
    render(
      html`<${SaveButton}
        disabled=${true}
        disabledReason="waiting for GPS fix"
        onClick=${vi.fn()}
      />`,
    );

    const button = screen.getByRole('button', { name: /save observation/i });
    const reason = screen.getByText('waiting for GPS fix');
    expect(button.getAttribute('aria-describedby')).toBe(reason.id);
    expect(reason.id).toBeTruthy();
  });
});

describe('ObservationsList', () => {
  const observation = {
    id: 'obs-1',
    recordedAt: '2026-08-06T10:00:00.000Z',
    lat: 51.5,
    lon: -0.14,
    gpsAccuracyM: 8,
    headingDeg: null,
    note: 'a note that runs on well past the forty character preview limit used here',
    photos: [{ id: 'obs-1', referencePhoto: null }],
  };

  // These three assertions were written against the six-column table. The
  // table is gone, but what each was protecting is not, so they are rewritten
  // against the card list rather than deleted with it.

  test('exposes one list item per observation, so it can be navigated as a list', () => {
    render(html`<${ObservationsList} observations=${[observation]} />`);

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  test('the photo indicator says it has a photo rather than relying on a bare glyph', () => {
    render(html`<${ObservationsList} observations=${[observation]} />`);

    // The camera is aria-hidden CSS, so the word has to carry the meaning.
    expect(screen.getByText(/photo/i)).toBeInTheDocument();
  });

  test('the full note is reachable without a hover tooltip, which touch has no way to show', () => {
    render(html`<${ObservationsList} observations=${[observation]} />`);

    // The full text must be in the document, not only in a title attribute.
    expect(screen.getByText(observation.note)).toBeInTheDocument();
  });
});
