import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { PhotoField } from './PhotoField.js';

describe('PhotoField', () => {
  test('shows a clear "Take Photo" label, not the browser\'s raw "Choose File" input', () => {
    render(html`<${PhotoField} />`);
    expect(screen.getByText('Take Photo')).toBeInTheDocument();
    // still reachable via its accessible label, for a11y and for the tests below
    expect(screen.getByLabelText('Take Photo')).toHaveAttribute('type', 'file');
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

  test('busy shows a processing indicator and disables the input', () => {
    render(html`<${PhotoField} busy=${true} />`);
    expect(screen.getByText(/processing/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeDisabled();
  });

  test('shows an error message when provided', () => {
    render(html`<${PhotoField} error="could not process that photo" />`);
    expect(screen.getByText('could not process that photo')).toBeInTheDocument();
  });

  test('a photo shows a thumbnail and a Remove button that calls onClear', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const onClear = vi.fn();
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });

    render(html`<${PhotoField} photo=${{ blob, width: 800, height: 600 }} onClear=${onClear} />`);

    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:fake-url');
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onClear).toHaveBeenCalledTimes(1);

    URL.createObjectURL.mockRestore();
    URL.revokeObjectURL.mockRestore();
  });

  test('revokes the object URL on unmount', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });

    const { unmount } = render(html`<${PhotoField} photo=${{ blob }} />`);
    unmount();

    expect(revokeSpy).toHaveBeenCalledWith('blob:fake-url');

    URL.createObjectURL.mockRestore();
    URL.revokeObjectURL.mockRestore();
  });
});
