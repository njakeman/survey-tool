import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatDuration } from './format.js';

// The playback row a voice note earns once it exists (design pass 4, 5c
// states 3 and 4 + 7b): one component, used by the compose field
// (VoiceNoteField, with delete) and the saved row (ObservationsList,
// without). 44px play/pause, sixteen bars, elapsed/total, optional ✕.
//
// The bars are a fixed, repeating pattern — deliberately NOT a waveform of
// the recording (user decision, 2026-08-14): playback position is the bars
// darkening left to right, so the same sixteen carry position for every
// note, old or new. Delete is withheld mid-playback rather than moved — a
// spacer keeps the row from changing width under a thumb.
//
// `createAudio` is injectable for tests; the default binds the real
// constructor. Owning play/pause instead of <audio controls> is the cost 5c
// priced in — no scrubber, because the drawing has none.
export const TRANSPORT_BAR_HEIGHTS = [6, 12, 20, 9, 16, 22, 11, 18, 7, 14, 21, 10, 17, 8, 13, 6];

export function VoiceTransport({
  src,
  durationMs = null,
  onDelete = null,
  createAudio = (url) => new Audio(url),
}) {
  const [playing, setPlaying] = useState(false);
  const [positionS, setPositionS] = useState(0);
  const [metadataS, setMetadataS] = useState(null);
  const audioRef = useRef(null);

  // Created eagerly (not on first play) so a legacy note without a stored
  // durationMs can still show its length from loadedmetadata.
  useEffect(() => {
    const audio = createAudio(src);
    audioRef.current = audio;
    const onTime = () => setPositionS(audio.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setPositionS(0);
    };
    const onMetadata = () => {
      if (Number.isFinite(audio.duration)) setMetadataS(audio.duration);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onMetadata);
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audioRef.current = null;
    };
    // createAudio is a stable injection; re-creating the element on every
    // render identity change would restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      // A failed play (decode, revoked URL) just stays at rest — the row is
      // read-only chrome, not a place for an error banner.
    }
  }

  const totalS = metadataS ?? (durationMs !== null ? durationMs / 1000 : null);
  const filled =
    totalS > 0 ? Math.min(TRANSPORT_BAR_HEIGHTS.length, Math.floor((positionS / totalS) * 16)) : 0;
  const showElapsed = playing || positionS > 0;

  return html`
    <span class="voice-transport">
      <button
        type="button"
        class="voice-transport-toggle"
        aria-label=${playing ? 'Pause voice note' : 'Play voice note'}
        onClick=${toggle}
      >
        ${
          playing
            ? html`<span class="glyph-pause" aria-hidden="true"><span></span><span></span></span>`
            : html`<svg viewBox="0 0 14 16" width="13" height="15" aria-hidden="true">
                <polygon points="2,1 13,8 2,15" fill="currentColor" />
              </svg>`
        }
      </button>
      <span class="voice-transport-bars" aria-hidden="true">
        ${TRANSPORT_BAR_HEIGHTS.map(
          (height, index) =>
            html`<span
              class="voice-transport-bar ${index < filled ? 'voice-transport-bar-played' : ''}"
              style="height:${height}px"
            ></span>`,
        )}
      </span>
      <span class="voice-transport-time">
        ${
          showElapsed
            ? html`<strong>${formatDuration(positionS * 1000)}</strong
                ><span class="voice-transport-total">
                  / ${totalS !== null ? formatDuration(totalS * 1000) : '–:––'}</span
                >`
            : html`<strong>${totalS !== null ? formatDuration(totalS * 1000) : ''}</strong>`
        }
      </span>
      ${
        onDelete
          ? playing
            ? html`<span class="voice-transport-spacer" aria-hidden="true"></span>`
            : html`<button
                type="button"
                class="voice-transport-delete"
                aria-label="Delete voice note"
                onClick=${onDelete}
              >
                <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
                  <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <line x1="2" y1="2" x2="12" y2="12" />
                    <line x1="12" y1="2" x2="2" y2="12" />
                  </g>
                </svg>
              </button>`
          : null
      }
    </span>
  `;
}
