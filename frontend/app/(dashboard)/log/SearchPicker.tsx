'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import styles from './log.module.css';

export interface PickerItem { id: string; name: string }

interface Props {
  items: PickerItem[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  /** Text of the "nothing selected" option and the empty-box hint, e.g. "All journeys". */
  allLabel?: string;
  /** Show ids as "#id" (journeys) or plain (nodes). */
  idPrefix?: string;
  /** Sort newest id first (numeric ids) or keep the given order. */
  sortByIdDesc?: boolean;
  noun?: string;
}

const MAX_SHOWN = 60;

/** Searchable picker: type part of the name or the id; arrows + Enter to choose. */
export default function SearchPicker({ items, value, onChange, label = 'Journey', allLabel = 'All journeys', idPrefix = '#', sortByIdDesc = true, noun = 'journey' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = items.find(j => j.id === value) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    const sorted = sortByIdDesc ? [...items].sort((a, b) => Number(b.id) - Number(a.id)) : items;
    if (!q) return sorted.slice(0, MAX_SHOWN);
    return sorted.filter(j => j.id.toLowerCase().includes(q) || j.name.toLowerCase().includes(q)).slice(0, MAX_SHOWN);
  }, [items, query, sortByIdDesc]);

  // Highlight follows the typed text: reset it whenever the list changes.
  const [activeKey, setActiveKey] = useState('');
  const listKey = `${open}|${query}`;
  if (activeKey !== listKey) { setActiveKey(listKey); setActive(0); }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const choose = (id: string) => { onChange(id); setQuery(''); setOpen(false); };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (open && matches[active]) { e.preventDefault(); choose(matches[active].id); } }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    else if (e.key === 'Backspace' && !query && value) { onChange(''); }
  };

  return (
    <div className={styles.pickerWrap} ref={wrapRef}>
      <span className={styles.selectLabel}>{label}</span>
      <div className={styles.picker} data-open={open || undefined}>
        <input
          ref={inputRef}
          className={styles.pickerInput}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
          placeholder={selected ? (selected.name && selected.name !== selected.id ? `${idPrefix}${selected.id} · ${selected.name}` : `${idPrefix}${selected.id}`) : `${allLabel} — type to search`}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          data-selected={selected ? 'true' : undefined}
        />
        {selected && !query ? (
          <button type="button" className={styles.pickerClear} aria-label={`Clear ${noun}`} onClick={() => { onChange(''); inputRef.current?.focus(); }}>
            <X size={13} />
          </button>
        ) : (
          <ChevronDown size={14} className={styles.pickerChev} aria-hidden="true" />
        )}
        {open && (
          <ul id={listId} role="listbox" className={styles.pickerList} aria-label={`${label} options`}>
            {!query && (
              <li role="option" aria-selected={!value} className={!value ? styles.pickerOptOn : styles.pickerOpt} onMouseDown={e => { e.preventDefault(); choose(''); }}>
                {allLabel}
              </li>
            )}
            {matches.length === 0 && <li className={styles.pickerEmpty}>No {noun} matches “{query.trim()}”</li>}
            {matches.map((j, i) => (
              <li
                key={j.id}
                id={`${listId}-${j.id}`}
                role="option"
                aria-selected={j.id === value}
                className={i === active ? styles.pickerOptActive : j.id === value ? styles.pickerOptOn : styles.pickerOpt}
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => { e.preventDefault(); choose(j.id); }}
              >
                <span className={styles.pickerId}>{idPrefix}{j.id}</span> {j.name !== j.id ? j.name : ''}
              </li>
            ))}
            {items.length > MAX_SHOWN && matches.length === MAX_SHOWN && (
              <li className={styles.pickerEmpty}>Showing the newest {MAX_SHOWN} — keep typing to narrow down</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
