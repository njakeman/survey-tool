import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { formatSize } from './format.js';

// The surveyor's own GIS data, listed as toggles. Sits under the region list
// in the same view, because "which map am I looking at" and "what is drawn on
// it" are one question in the field, and a fourth top-level view would cost a
// tap on a screen that is mostly map.
//
// Unlike a region, a layer is not a choice between alternatives — any number
// can be on at once — so these are two-state toggles carrying aria-pressed,
// not an aria-current list.
//
// There is no progress track here on purpose. A region is tens of megabytes;
// a layer is tens of kilobytes, and a progress bar for a 34 kB fetch is
// furniture that appears and vanishes before it can be read.

// "12 features · Polygon · 34 kB". Every part is optional: offline,
// listAvailable() falls back to what is on the device, where an older record
// may carry no count or geometry.
function describeLayer(layer) {
  const count = layer.featureCount == null ? null : `${layer.featureCount} features`;
  const geometry = layer.geometryTypes?.length ? layer.geometryTypes.join('+') : null;
  return [count, geometry, formatSize(layer.sizeBytes)].filter(Boolean).join(' · ');
}

export function FeatureLayerPanel({
  layers,
  manifestAvailable,
  online,
  onEnable,
  onDisable,
  onRemove,
}) {
  const [busyId, setBusyId] = useState(null);
  const [errors, setErrors] = useState({});

  async function handleToggle(layer) {
    if (layer.enabled) {
      await onDisable(layer.id);
      return;
    }
    setBusyId(layer.id);
    setErrors((current) => ({ ...current, [layer.id]: null }));
    try {
      await onEnable(layer.id);
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [layer.id]: error.message || 'Could not add that layer',
      }));
    } finally {
      setBusyId(null);
    }
  }

  return html`
    <section class="feature-layer-panel">
      <h3 class="field-label">Feature layers</h3>

      ${
        !manifestAvailable
          ? html`<p class="basemap-picker-note">
              The published list could not be checked — showing the layers already on this device.
            </p>`
          : null
      }
      ${
        layers.length === 0 && manifestAvailable
          ? html`<p class="basemap-picker-empty">
              No feature layers are published yet. See the README on adding one.
            </p>`
          : null
      }

      <ul class="feature-layer-list">
        ${layers.map((layer) => {
          const busy = busyId === layer.id;
          // Only *adding* a layer needs the network. One already on the
          // device switches back on locally, which is the entire reason
          // disable keeps the data.
          const needsNetwork = !layer.stored && !online;
          const state = layer.enabled ? 'Shown' : layer.stored ? 'Hidden' : 'Not added';
          return html`
            <li key=${layer.id}>
              <button
                type="button"
                class="feature-layer-row"
                aria-pressed=${layer.enabled ? 'true' : 'false'}
                disabled=${busy || needsNetwork}
                onClick=${() => handleToggle(layer)}
              >
                <span
                  class=${`feature-layer-swatch${layer.enabled ? ' is-on' : ''}`}
                  style=${`--layer-colour: ${layer.style?.colour ?? 'currentColor'}`}
                  aria-hidden="true"
                ></span>
                <span class="feature-layer-body">
                  <span class="feature-layer-name">${layer.name}</span>
                  <span class="feature-layer-meta">${describeLayer(layer)}</span>
                </span>
                ${
                  // The word, not only the swatch: the swatch is the layer's
                  // own colour, so it cannot also carry on/off legibly.
                  html`<span class="feature-layer-state">${busy ? 'Adding…' : state}</span>`
                }
              </button>
              ${
                errors[layer.id]
                  ? html`<p class="basemap-picker-error panel-danger" role="alert">
                      ${errors[layer.id]}
                    </p>`
                  : null
              }
              ${
                // Removing the layer you are currently looking at is a way to
                // lose your bearings mid-observation. Switch it off first.
                layer.stored && !layer.enabled
                  ? html`<button
                      type="button"
                      class="button-outline basemap-picker-remove"
                      onClick=${() => onRemove(layer.id)}
                    >
                      Remove ${layer.name}
                    </button>`
                  : null
              }
            </li>
          `;
        })}
      </ul>
    </section>
  `;
}
