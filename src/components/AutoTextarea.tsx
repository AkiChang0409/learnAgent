import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';

/**
 * A textarea that grows with its content so editing feels like typing straight
 * into the document — no inner scrollbars, no fixed height. Core to the
 * click-to-edit WYSIWYG note surface.
 */
export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  minRows = 1,
  onKeyDown,
  autoFocus
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  minRows?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(resize, [value]);

  const style: CSSProperties = { minHeight: `${minRows * 1.6}em`, overflow: 'hidden', resize: 'none' };

  return (
    <textarea
      ref={ref}
      className={className}
      style={style}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
