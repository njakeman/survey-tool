import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

// `capture="environment"` opens the rear camera directly rather than a
// custom camera UI, per the brief. `photos` is a strip, not a single slot —
// each thumb owns its own object URL (PhotoThumb, below), so no caller can
// leak one and no thumb needs to wait on its siblings' blobs.
export function PhotoField({
  photos = [],
  busy = false,
  error,
  atCap = false,
  onSelect,
  onRemove,
}) {
  const disabled = busy || atCap;

  function handleChange(event) {
    const file = event.target.files?.[0];
    // Clearing the value is what lets the same file be picked twice — a
    // repeated selection otherwise fires no change event.
    event.target.value = '';
    if (file) onSelect?.(file);
  }

  return html`
    <div class="photo-field">
      <label
        class="photo-field-button${atCap ? ' photo-field-button-capped' : ''}"
        aria-disabled=${disabled ? 'true' : undefined}
      >
        ${
          // Drawn in CSS — a bordered rectangle with an inner circle. No icon
          // set and no SVG file, because every asset has to be local and
          // precached, and this one need not exist as a file at all.
          html`<span class="glyph-camera" aria-hidden="true"></span>`
        }
        Photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled=${disabled}
          onChange=${handleChange}
        />
      </label>
      ${busy ? html`<p class="photo-field-busy">Processing photo…</p>` : null}
      ${error ? html`<p class="photo-field-error">${error}</p>` : null}
      ${atCap ? html`<p class="photo-field-cap">10 photos — the most one record holds</p>` : null}
      ${
        photos.length > 0
          ? html`
              <ul class="photo-field-strip">
                ${photos.map(
                  (photo, index) => html`
                    <${PhotoThumb}
                      key=${photo.key}
                      photo=${photo}
                      index=${index}
                      total=${photos.length}
                      onRemove=${onRemove}
                    />
                  `,
                )}
              </ul>
            `
          : null
      }
    </div>
  `;
}

// One thumb, one object URL — created and revoked here so removing or
// reordering a sibling can never touch a URL it doesn't own.
function PhotoThumb({ photo, index, total, onRemove }) {
  const [objectUrl, setObjectUrl] = useState(null);

  useEffect(() => {
    if (!photo?.blob) {
      setObjectUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(photo.blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo?.blob]);

  if (!objectUrl) return null;

  const label = `Photo ${index + 1} of ${total}`;

  return html`
    <li class="photo-field-thumb">
      <img src=${objectUrl} alt=${label} />
      <button
        type="button"
        class="photo-field-thumb-remove"
        aria-label="Remove ${label.toLowerCase()}"
        onClick=${() => onRemove?.(photo.key)}
      />
    </li>
  `;
}
