// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NumberField } from '../src/ui/controls';
afterEach(cleanup);
it('rejected model changes restore the actual value and indicate invalid input', () => {
  const onCommit = vi.fn(() => ({ ok: false }));
  const ui = render(<NumberField value={7} onCommit={onCommit} ariaLabel="Anello" />);
  const input = ui.getByLabelText('Anello') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '10' } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith(10);
  expect(input.value).toBe('7');
  expect(input.getAttribute('aria-invalid')).toBe('true');
});
it('accepts decimal commas and clamps to the engineering interval', () => {
  const onCommit = vi.fn();
  const ui = render(<NumberField value={7} onCommit={onCommit} min={6} max={12} ariaLabel="Anello" />);
  const input = ui.getByLabelText('Anello');
  fireEvent.change(input, { target: { value: '8,25' } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenLastCalledWith(8.25);
  fireEvent.change(input, { target: { value: '30' } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenLastCalledWith(12);
});
