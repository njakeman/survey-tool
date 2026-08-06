import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

// `capture="environment"` opens the rear camera directly rather than a
// custom camera UI, per the brief. Owns the object URL for the thumbnail —
// created and revoked here, so no caller can leak one.
export function PhotoField({ photo, busy = false, error, onSelect, onClear }) {
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

  function handleChange(event) {
    const file = event.target.files?.[0];
    if (file) onSelect?.(file);
  }

  return html`
    <div class="photo-field">
      <label class="photo-field-button">
        Take Photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled=${busy}
          onChange=${handleChange}
        />
      </label>
      ${busy ? html`<p>Processing photo…</p>` : null}
      ${error ? html`<p class="photo-field-error">${error}</p>` : null}
      ${
        photo && objectUrl
          ? html`
              <div class="photo-field-preview">
                <img src=${objectUrl} alt="Captured observation" />
                <button type="button" onClick=${onClear}>Remove photo</button>
              </div>
            `
          : null
      }
    </div>
  `;
}
