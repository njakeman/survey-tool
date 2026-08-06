import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { ReadingsPanel } from './ReadingsPanel.js';

const POSITION = {
  lat: 51.5,
  lon: -0.14,
  accuracyM: 8.2,
  altitudeM: null,
  altitudeAccuracyM: null,
};
const HEADING = { headingDeg: 247, headingAccuracyDeg: 5, source: 'webkit-compass' }; // 247deg -> WSW, per format.test.js

describe('ReadingsPanel — position', () => {
  test('shows a waiting message when there is no reading yet', () => {
    render(html`<${ReadingsPanel} position=${null} positionError=${null} headingStatus="idle" />`);
    expect(screen.getByText(/waiting for gps fix/i)).toBeInTheDocument();
  });

  test('renders lat/lon and accuracy in metres once a reading arrives', () => {
    render(
      html`<${ReadingsPanel} position=${POSITION} positionError=${null} headingStatus="idle" />`,
    );
    expect(screen.getByText(/51\.500000, -0\.140000/)).toBeInTheDocument();
    expect(screen.getByText(/±8 m/)).toBeInTheDocument();
  });

  test('shows a distinct message for permission-denied rather than the generic waiting message', () => {
    render(
      html`<${ReadingsPanel}
        position=${null}
        positionError=${{ code: 'permission-denied', message: 'x' }}
        headingStatus="idle"
      />`,
    );
    expect(screen.getByText(/location access denied/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for gps fix/i)).not.toBeInTheDocument();
  });
});

describe('ReadingsPanel — compass', () => {
  test('idle status shows an Enable compass button that calls onEnableCompass', () => {
    const onEnableCompass = vi.fn();
    render(
      html`<${ReadingsPanel}
        position=${null}
        positionError=${null}
        headingStatus="idle"
        onEnableCompass=${onEnableCompass}
      />`,
    );

    fireEvent.click(screen.getByRole('button', { name: /enable compass/i }));
    expect(onEnableCompass).toHaveBeenCalledTimes(1);
  });

  test.each(['denied', 'unavailable'])(
    '%s status shows an explicit position-only marking',
    (status) => {
      render(
        html`<${ReadingsPanel}
          position=${POSITION}
          positionError=${null}
          headingStatus=${status}
        />`,
      );
      expect(screen.getByText(/position only.*no compass/i)).toBeInTheDocument();
    },
  );

  test('active status with a reading shows the heading and compass point, no position-only marking', () => {
    render(
      html`<${ReadingsPanel}
        position=${POSITION}
        positionError=${null}
        heading=${HEADING}
        headingStatus="active"
      />`,
    );
    expect(screen.getByText(/247° WSW/)).toBeInTheDocument();
    expect(screen.queryByText(/position only/i)).not.toBeInTheDocument();
  });
});
