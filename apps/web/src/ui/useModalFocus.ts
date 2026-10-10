import { useEffect, type RefObject } from 'react';

/** Own keyboard focus for the lifetime of a modal and restore its opener. */
export function useModalFocus(open: boolean, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const modal = root.current;
    if (!open || !modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const candidates = () => [...modal.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    (modal.querySelector<HTMLElement>('[data-initial-focus]') ?? candidates()[0] ?? modal).focus();
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = candidates(), first = elements[0], last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); modal.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    modal.addEventListener('keydown', key);
    return () => { modal.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, [open, root]);
}
