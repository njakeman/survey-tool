import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { SaveButton } from './SaveButton.js';

describe('SaveButton', () => {
  test('enabled by default, calls onClick when tapped', () => {
    const onClick = vi.fn();
    render(html`<${SaveButton} onClick=${onClick} />`);

    fireEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('when disabled with a reason, shows the reason and does not call onClick', () => {
    const onClick = vi.fn();
    render(
      html`<${SaveButton}
        disabled=${true}
        disabledReason="waiting for GPS fix"
        onClick=${onClick}
      />`,
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(screen.getByText('waiting for GPS fix')).toBeInTheDocument();

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('while saving, disables the button and shows a saving indicator instead of the reason', () => {
    const onClick = vi.fn();
    render(
      html`<${SaveButton}
        saving=${true}
        disabledReason="waiting for GPS fix"
        onClick=${onClick}
      />`,
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/saving/i);
    expect(screen.queryByText('waiting for GPS fix')).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
