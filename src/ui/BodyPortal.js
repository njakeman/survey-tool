import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

// A hand-rolled portal: renders its children into a container appended to
// document.body, so a position:fixed overlay can never be captured by an
// ancestor's filter/transform (design pass 4 §7c). Deliberately NOT
// preact/compat's createPortal — importing compat patches Preact's global
// options as a side effect (onChange re-aliasing among them), which broke
// the file inputs' change handlers app-wide when tried.
//
// Lifted verbatim from ObservationsList (the photo lightbox) when the
// revisit framing screen became its second consumer.
export function BodyPortal({ children }) {
  const containerRef = useRef(null);
  if (!containerRef.current) {
    containerRef.current = document.createElement('div');
  }
  useEffect(() => {
    const el = containerRef.current;
    document.body.appendChild(el);
    return () => {
      render(null, el);
      el.remove();
    };
  }, []);
  // No deps: the overlay's content closes over the parent's state, so it
  // must re-render with every parent render.
  useEffect(() => {
    render(children, containerRef.current);
  });
  return null;
}
