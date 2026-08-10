import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// Choosing which offline map region the map panel shows. A full view rather
// than a control inside the 40vh panel: there can be several regions, each
// needing a size, a state and a download or remove action.
//
// Follows SessionHistoryPage's list shape — one button filling each row —
// with aria-current marking the region in use, which that page has no
// equivalent of.

function formatMegabytes(bytes) {
  if (!bytes) return null;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function describeProgress(progress) {
  if (!progress) return 'Downloading…';
  const { receivedBytes, totalBytes } = progress;
  if (!totalBytes) return `Downloading — ${formatMegabytes(receivedBytes) ?? '0 MB'}`;
  return `Downloading — ${Math.round((receivedBytes / totalBytes) * 100)}%`;
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
      <button type="button" onClick=${onBack}>Back to capture</button>
      <h2>Offline maps</h2>

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
        ${regions.map(
          (region) => html`
            <li key=${region.id}>
              <button
                type="button"
                aria-current=${region.id === activeId ? 'true' : undefined}
                disabled=${busyId === region.id || (!region.downloaded && !online)}
                onClick=${() => handleRow(region)}
              >
                <span class="basemap-picker-name">${region.name}</span>
                <span class="basemap-picker-size">${formatMegabytes(region.sizeBytes) ?? ''}</span>
                <span class="basemap-picker-state">
                  ${
                    busyId === region.id
                      ? describeProgress(progress)
                      : region.id === activeId
                        ? 'In use'
                        : region.downloaded
                          ? 'On this device'
                          : 'Not downloaded'
                  }
                </span>
              </button>
              ${
                errors[region.id]
                  ? html`<p class="basemap-picker-error">${errors[region.id]}</p>`
                  : null
              }
              ${
                region.downloaded && region.id !== activeId
                  ? html`<button type="button" onClick=${() => onRemove(region.id)}>
                      Remove ${region.name}
                    </button>`
                  : null
              }
            </li>
          `,
        )}
      </ul>
    </main>
  `;
}
