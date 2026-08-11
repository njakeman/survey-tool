import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { FeatureSheet } from './FeatureSheet.js';

const FEATURE = {
  layerId: 'parcels',
  layerName: 'Field parcels',
  featureId: 'P-42',
  title: 'SU1408 3921',
  fields: [
    { key: 'ref', value: 'SU1408 3921' },
    { key: 'area_ha', value: '4.2' },
  ],
};

function renderSheet(overrides = {}) {
  const props = {
    feature: FEATURE,
    canRecord: true,
    onRecord: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(html`<${FeatureSheet} ...${props} />`);
  return props;
}

describe('FeatureSheet', () => {
  test('renders nothing when no feature is selected', () => {
    const { container } = render(
      html`<${FeatureSheet}
        feature=${null}
        canRecord=${true}
        onRecord=${vi.fn()}
        onDismiss=${vi.fn()}
      />`,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test('titles the feature and names the layer it came from', () => {
    renderSheet();

    // By role, not text: the title is usually one of the attributes too —
    // here `ref` — so a bare text query matches twice.
    expect(screen.getByRole('heading', { name: 'SU1408 3921' })).toBeInTheDocument();
    expect(screen.getByText('Field parcels')).toBeInTheDocument();
  });

  test('lists every attribute as a labelled value, not a bare row of text', () => {
    renderSheet();

    // A description list, so each value is programmatically tied to its key
    // rather than merely sitting next to it.
    expect(screen.getByText('area_ha').tagName).toBe('DT');
    expect(screen.getByText('4.2').tagName).toBe('DD');
  });

  test('says so rather than showing an empty list when a feature has no attributes', () => {
    renderSheet({ feature: { ...FEATURE, fields: [] } });

    expect(screen.getByText(/no attributes/i)).toBeInTheDocument();
  });

  test('Record here passes the feature back', () => {
    const { onRecord } = renderSheet();

    fireEvent.click(screen.getByRole('button', { name: /record here/i }));

    expect(onRecord).toHaveBeenCalledWith(FEATURE);
  });

  test('Record here is absent when there is nothing to record into', () => {
    // No open session, or no fix yet. Offering a control that cannot work is
    // worse than not offering it — the surveyor taps and nothing happens.
    renderSheet({ canRecord: false });

    expect(screen.queryByRole('button', { name: /record here/i })).not.toBeInTheDocument();
    // The attributes are still worth reading, which is why the sheet stays.
    expect(screen.getByRole('heading', { name: 'SU1408 3921' })).toBeInTheDocument();
  });

  test('can be dismissed', () => {
    const { onDismiss } = renderSheet();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onDismiss).toHaveBeenCalled();
  });

  test('is announced, since it appears from a tap on a canvas with no focusable target', () => {
    renderSheet();

    expect(screen.getByRole('status')).toHaveTextContent('SU1408 3921');
  });
});
