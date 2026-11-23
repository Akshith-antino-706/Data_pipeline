'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
}

export interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
}

export function Tabs<K extends string>({ items, value, onChange, label }: TabsProps<K>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = items.findIndex(t => t.key === value);
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    onChange(items[next].key);
    refs.current[next]?.focus();
  };
  return (
    <div className="ui-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {items.map((t, i) => (
        <button
          key={t.key}
          ref={el => { refs.current[i] = el; }}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={t.key === value}
          tabIndex={t.key === value ? 0 : -1}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
