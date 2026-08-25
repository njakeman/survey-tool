import { describe, expect, test, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { PhotoField } from './PhotoField.js';

function photo(key, overrides = {}) {
  return {
    key,
    blob: new Blob(['bytes'], { type: 'image/jpeg' }),
    width: 800,
    height: 600,
    referencePhoto: null,
    ...overrides,
  };
}

describe('PhotoField', () => {
  test('shows a clear "Photo" label, not the browser\'s raw "Choose File" input', () => {
    render(html`<${PhotoField} />`);
    expect(screen.getByText('Photo')).toBeInTheDocument();
    // still reachable via its accessible label, for a11y and for the tests below
    expect(screen.getByLabelText('Photo')).toHaveAttribute('type', 'file');
  });

  test('the file input accepts images and requests the rear camera directly', () => {
    render(html`<${PhotoField} />`);
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
  });

  test('selecting a file calls onSelect with the file', () => {
    const onSelect = vi.fn();
    render(html`<${PhotoField} onSelect=${onSelect} />`);
    const input = document.querySelector('input[type="file"]');
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onSelect).toHaveBeenCalledWith(file);
  });

  test('clears the input value after a pick, so the same file can be chosen twice', () => {
    const onSelect = vi.fn();
    render(html`<${PhotoField} onSelect=${onSelect} />`);
    const input = document.querySelector('input[type="file"]');
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(input.value).toBe('');
  });

  test('busy shows a processing indicator and disables the input', () => {
    render(html`<${PhotoField} busy=${true} />`);
    expect(screen.getByText(/processing/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeDisabled();
  });

  test('shows an error message when provided', () => {
    render(html`<${PhotoField} error="could not process that photo" />`);
    expect(screen.getByText('could not process that photo')).toBeInTheDocument();
  });

  test('no input inside the strip — compose still finds the picker via input[type=file]', () => {
    render(html`<${PhotoField} photos=${[photo('a'), photo('b')]} />`);
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(document.querySelector('.photo-field-strip input')).toBeNull();
  });

  describe('with one photo', () => {
    test('shows a single thumbnail', () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      render(html`<${PhotoField} photos=${[photo('a')]} />`);

      const thumbs = screen.getAllByRole('img');
      expect(thumbs).toHaveLength(1);
      expect(thumbs[0]).toHaveAttribute('src', 'blob:fake-url');
      expect(thumbs[0]).toHaveAttribute('alt', 'Photo 1 of 1');

      URL.createObjectURL.mockRestore();
      URL.revokeObjectURL.mockRestore();
    });

    test('the "Photo" label still resolves via its accessible label with a thumb present', () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      render(html`<${PhotoField} photos=${[photo('a')]} />`);

      expect(screen.getByLabelText('Photo')).toHaveAttribute('type', 'file');

      URL.createObjectURL.mockRestore();
      URL.revokeObjectURL.mockRestore();
    });
  });

  describe('with three photos', () => {
    test('shows a thumbnail per photo, each numbered against the total', () => {
      let n = 0;
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake-url-${n++}`);
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      render(html`<${PhotoField} photos=${[photo('a'), photo('b'), photo('c')]} />`);

      const thumbs = screen.getAllByRole('img');
      expect(thumbs).toHaveLength(3);
      expect(thumbs.map((img) => img.getAttribute('alt'))).toEqual([
        'Photo 1 of 3',
        'Photo 2 of 3',
        'Photo 3 of 3',
      ]);

      URL.createObjectURL.mockRestore();
      URL.revokeObjectURL.mockRestore();
    });

    test('one createObjectURL call per thumb', () => {
      const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      render(html`<${PhotoField} photos=${[photo('a'), photo('b'), photo('c')]} />`);

      expect(createSpy).toHaveBeenCalledTimes(3);

      URL.createObjectURL.mockRestore();
      URL.revokeObjectURL.mockRestore();
    });

    test('each thumb revokes its own object URL on unmount', () => {
      let n = 0;
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake-url-${n++}`);
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const { unmount } = render(
        html`<${PhotoField} photos=${[photo('a'), photo('b'), photo('c')]} />`,
      );
      unmount();

      expect(revokeSpy).toHaveBeenCalledWith('blob:fake-url-0');
      expect(revokeSpy).toHaveBeenCalledWith('blob:fake-url-1');
      expect(revokeSpy).toHaveBeenCalledWith('blob:fake-url-2');
      expect(revokeSpy).toHaveBeenCalledTimes(3);

      URL.createObjectURL.mockRestore();
      URL.revokeObjectURL.mockRestore();
    });

    test("removing a thumb calls onRemove with that photo's key", () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const onRemove = vi.fn();

      render(
        html`<${PhotoField} photos=${[photo('a'), photo('b'), photo('c')]} onRemove=${onRemove} />`,
      );

      const thumbs = screen.getAllByRole('listitem');
      fireEvent.click(within(thumbs[1]).getByRole('button', { name: /remove photo 2 of 3/i }));

      expect(onRemove).toHaveBeenCalledWith('b');
      expect(onRemove).toHaveBeenCalledTimes(1);

      URL.createObjectURL.mockRestore();
      URL.revokeObjectURL.mockRestore();
    });
  });

  describe('at the cap', () => {
    test('disables the add control and shows the cap message', () => {
      render(html`<${PhotoField} atCap=${true} />`);

      const input = document.querySelector('input[type="file"]');
      expect(input).toBeDisabled();

      const label = document.querySelector('label.photo-field-button');
      expect(label).toHaveAttribute('aria-disabled', 'true');
      expect(label.className).toContain('photo-field-button-capped');

      expect(screen.getByText('10 photos — the most one record holds')).toBeInTheDocument();
    });

    test('does not show the cap message below the cap', () => {
      render(html`<${PhotoField} atCap=${false} />`);
      expect(screen.queryByText(/most one record holds/)).not.toBeInTheDocument();
    });
  });
});
