import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { FeatureLayerPanel } from './FeatureLayerPanel.js';

// The map settings view: which offline region the map panel shows, and which
// feature layers are drawn over it. A full view rather than a control inside
// the map panel — there can be several regions, each needing a size, a state
// and a download or remove action.
//
// Regions and layers share a screen because in the field they are one
// question ("what am I looking at"), and because the map panel is 236px tall
// and has no room for a second control.
//
// This is the one screen where picking the wrong row costs a multi-megabyte
// download over a field connection, so the in-use region is marked four
// times over — aria-current, a filled glyph, a left border and the word
// itself. That redundancy is deliberate, not belt-and-braces.

function formatMegabytes(bytes) {
  if (!bytes) return null;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

// "24 MB · vector · z5–15". Every part is optional: offline, listAvailable()
// falls back to what is on the device, and an older download may have no
// recorded type or zoom range. Blanks are omitted rather than printed.
function describeRegion(region) {
  const zooms =
    region.minZoom != null && region.maxZoom != null
      ? `z${region.minZoom}–${region.maxZoom}`
      : null;
  return [formatMegabytes(region.sizeBytes), region.tileType, zooms].filter(Boolean).join(' · ');
}

function describeProgress(progress) {
  if (!progress) return 'Downloading…';
  const { receivedBytes, totalBytes } = progress;
  if (!totalBytes) return `Downloading — ${formatMegabytes(receivedBytes) ?? '0 MB'}`;
  return `Downloading — ${Math.round((receivedBytes / totalBytes) * 100)}%`;
}

function progressFraction(progress) {
  if (!progress?.totalBytes) return null;
  return Math.min(1, progress.receivedBytes / progress.totalBytes);
}

export function BasemapPicker({
  regions,
  manifestAvailable,
  activeId,
  onSelect,
  onDownload,
  onRemove,
  onBack,
  online,
  featureLayers,
  featureLayersAvailable,
  onEnableLayer,
  onDisableLayer,
  onRemoveLayer,
}) {
  const [busyId, setBusyId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [errors, setErrors] = useState({});

  async function handleRow(region) {
    if (region.downloaded) {
      await onSelect(region.id);
      onBack();
      return;
    }
    setBusyId(region.id);
    setProgress(null);
    setErrors((current) => ({ ...current, [region.id]: null }));
    try {
      await onDownload(region.id, (update) => setProgress(update));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [region.id]: error.message || 'Could not download that region',
      }));
    } finally {
      setBusyId(null);
      setProgress(null);
    }
  }

  return html`
    <main class="basemap-picker">
      <div class="page-header">
        <button type="button" class="button-outline" onClick=${onBack}>← Back to capture</button>
        <h2>Maps and layers</h2>
      </div>

      <h3 class="field-label">Offline maps</h3>

      ${
        !manifestAvailable
          ? html`<p class="basemap-picker-note">
              The published list could not be checked — showing the regions already on this device.
            </p>`
          : null
      }
      ${
        regions.length === 0 && manifestAvailable
          ? html`<p class="basemap-picker-empty">
              No offline maps are published yet. See the README on adding a region.
            </p>`
          : null
      }
      ${!online ? html`<p class="basemap-picker-note">Connect to download a new region.</p>` : null}

      <ul class="basemap-picker-list">
        ${regions.map((region) => {
          const downloading = busyId === region.id;
          const inUse = region.id === activeId;
          // Filled for in use, solid outline for on the device, dotted for
          // absent — the state is a shape before it is a colour.
          const glyph = inUse ? 'filled' : region.downloaded ? 'solid' : 'dotted';
          return html`
            <li key=${region.id}>
              <button
                type="button"
                class=${`basemap-picker-row${!region.downloaded && !online ? ' is-unavailable' : ''}`}
                aria-current=${inUse ? 'true' : undefined}
                disabled=${downloading || (!region.downloaded && !online)}
                onClick=${() => handleRow(region)}
              >
                <span class=${`basemap-picker-glyph glyph-${glyph}`} aria-hidden="true"></span>
                <span class="basemap-picker-body">
                  <span class="basemap-picker-name">${region.name}</span>
                  <span class="basemap-picker-size">${describeRegion(region)}</span>
                  ${
                    downloading
                      ? html`<span
                          class="basemap-picker-progress"
                          style=${`--progress: ${(progressFraction(progress) ?? 0) * 100}%`}
                        ></span>`
                      : null
                  }
                </span>
                <span class="basemap-picker-state">
                  ${
                    downloading
                      ? describeProgress(progress)
                      : inUse
                        ? html`<span class="chip badge-in-use">In use</span>`
                        : region.downloaded
                          ? 'On this device'
                          : 'Not downloaded'
                  }
                </span>
              </button>
              ${
                errors[region.id]
                  ? html`<p class="basemap-picker-error panel-danger" role="alert">
                      ${errors[region.id]}
                    </p>`
                  : null
              }
              ${
                region.downloaded && !inUse
                  ? html`<button
                      type="button"
                      class="button-outline basemap-picker-remove"
                      onClick=${() => onRemove(region.id)}
                    >
                      Remove ${region.name}
                    </button>`
                  : null
              }
            </li>
          `;
        })}
      </ul>

      <${FeatureLayerPanel}
        layers=${featureLayers ?? []}
        manifestAvailable=${featureLayersAvailable ?? true}
        online=${online}
        onEnable=${onEnableLayer}
        onDisable=${onDisableLayer}
        onRemove=${onRemoveLayer}
      />
    </main>
  `;
}
