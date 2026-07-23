import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',');

export function useModalFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusInitial = () => {
      const first = containerRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (initialFocusRef?.current || first || containerRef.current)?.focus();
    };
    const frame = window.requestAnimationFrame(focusInitial);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== 'Tab' || !containerRef.current) return;
      const items = [...containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((item) => !item.hidden && item.getAttribute('aria-hidden') !== 'true');
      if (!items.length) { event.preventDefault(); containerRef.current.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [containerRef, initialFocusRef, onEscape, open]);
}
