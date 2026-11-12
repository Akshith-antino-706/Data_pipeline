'use client';

/**
 * Global search — the top bar search box and its ⌘K / Ctrl+K dialog.
 *
 * Searches the real lists the app already serves, each as its own group so a slow list
 * never holds up a fast one:
 *   Pages      menu entries (instant, no request)
 *   Journeys   name, segment or #id          (follows the audience switch)
 *   Templates  name / subject
 *   Segments   custom segments by name
 *   Contacts   name, email or phone          (follows the audience switch; the slowest)
 *
 * Typing is debounced and every in-flight request is cancelled when the query changes,
 * so an older answer can never overwrite a newer one.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, FileText, GitBranch, LayoutGrid, Loader2, Search, Target, User, X } from 'lucide-react';
import { useBusinessType } from '@/context/BusinessTypeContext';
import { globalSearchContacts, globalSearchJourneys, globalSearchSegments, globalSearchTemplates } from '@/lib/api';
import {
  MIN_QUERY_LENGTH, allContactsResult, contactResult, journeyResult, matchPages, segmentResult, templateResult,
} from '@/lib/globalSearch';
import type { SearchGroupKey, SearchGroupState, SearchPage, SearchResult } from '@/types/globalSearch';

const DEBOUNCE_MS = 300;
type RemoteGroup = Exclude<SearchGroupKey, 'pages'>;
const REMOTE_GROUPS: RemoteGroup[] = ['journeys', 'templates', 'segments', 'contacts'];

const GROUP_META: Record<SearchGroupKey, { label: string; icon: LucideIcon; loading: string }> = {
  pages:     { label: 'Pages',     icon: LayoutGrid, loading: '' },
  journeys:  { label: 'Journeys',  icon: GitBranch,  loading: 'Searching journeys…' },
  templates: { label: 'Templates', icon: FileText,   loading: 'Searching templates…' },
  segments:  { label: 'Segments',  icon: Target,     loading: 'Searching segments…' },
  contacts:  { label: 'Contacts',  icon: User,       loading: 'Searching contacts… this can take a few seconds' },
};
const GROUP_ORDER: SearchGroupKey[] = ['pages', 'journeys', 'templates', 'segments', 'contacts'];

/** A finished group answer, tagged with the search it answers (`${scope}|${query}`). */
interface GroupAnswer { search: string; state: SearchGroupState }
const IDLE: SearchGroupState = { status: 'idle' };
const LOADING: SearchGroupState = { status: 'loading' };

const toTotal = (v: number | string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** One search per group; resolves to that group's finished state. */
async function runGroup(group: RemoteGroup, q: string, scope: string, signal: AbortSignal): Promise<SearchGroupState> {
  if (group === 'journeys') {
    const res = await globalSearchJourneys(q, scope, signal);
    const rows = res?.data ?? [];
    return { status: 'done', results: rows.map(journeyResult), total: toTotal(res?.total, rows.length) };
  }
  if (group === 'templates') {
    const res = await globalSearchTemplates(q, signal);
    const rows = res?.data ?? [];
    return { status: 'done', results: rows.map(templateResult), total: toTotal(res?.total, rows.length) };
  }
  if (group === 'segments') {
    const res = await globalSearchSegments(q, signal);
    const rows = res?.data ?? [];
    return { status: 'done', results: rows.map(segmentResult), total: toTotal(res?.total, rows.length) };
  }
  const res = await globalSearchContacts(q, scope, signal);
  const rows = res?.data ?? [];
  const total = toTotal(res?.total, rows.length);
  const results = rows.map(contactResult);
  if (total > rows.length) results.push(allContactsResult(q, total));
  return { status: 'done', results, total };
}

const noSubscribe = (): (() => void) => () => {};
/** "⌘K" on Apple devices, "Ctrl K" elsewhere ("⌘K" during server render). */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'),
    () => '⌘K',
  );
}

export function GlobalSearch({ pages }: { pages: SearchPage[] }) {
  const [open, setOpen] = useState(false);
  const shortcut = useShortcutLabel();

  // ⌘K / Ctrl+K opens the search from anywhere; pressing it again closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="shell-search"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Search contacts, journeys, templates and segments (${shortcut})`}
      >
        <Search size={16} aria-hidden="true" />
        <span className="shell-search-text">Search contacts, journeys, templates…</span>
        <span className="shell-kbd" aria-hidden="true">{shortcut}</span>
      </button>
      {open && <SearchDialog pages={pages} onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchDialog({ pages, onClose }: { pages: SearchPage[]; onClose: () => void }) {
  const router = useRouter();
  const { businessType, setBusinessType } = useBusinessType();
  const [query, setQuery] = useState('');
  const [answers, setAnswers] = useState<Partial<Record<RemoteGroup, GroupAnswer>>>({});
  // The highlight remembers which query it belongs to, so a new query starts at the top.
  const [highlight, setHighlight] = useState<{ q: string; i: number }>({ q: '', i: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const listId = useId();

  const q = query.trim();
  const searching = q.length >= MIN_QUERY_LENGTH;
  const narrowed = businessType !== 'All';
  const searchKey = `${businessType}|${q}`;

  // Each group shows its answer only when it answers THIS search; otherwise it is still loading.
  const groups = useMemo<Record<RemoteGroup, SearchGroupState>>(() => {
    const stateOf = (g: RemoteGroup): SearchGroupState => {
      if (!searching) return IDLE;
      const a = answers[g];
      return a && a.search === searchKey ? a.state : LOADING;
    };
    return { journeys: stateOf('journeys'), templates: stateOf('templates'), segments: stateOf('segments'), contacts: stateOf('contacts') };
  }, [answers, searching, searchKey]);

  // Focus the input on open; give focus back to whatever had it on close.
  useEffect(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => { restoreFocus.current?.focus(); };
  }, []);

  // Remote search: debounced, all groups in parallel, every request cancelled on change.
  useEffect(() => {
    if (!searching) return undefined;
    const ctrl = new AbortController();
    const save = (g: RemoteGroup, state: SearchGroupState) => {
      if (!ctrl.signal.aborted) setAnswers(prev => ({ ...prev, [g]: { search: searchKey, state } }));
    };
    const timer = setTimeout(() => {
      for (const g of REMOTE_GROUPS) {
        runGroup(g, q, businessType, ctrl.signal)
          .then(state => save(g, state))
          .catch(() => save(g, { status: 'error' }));
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q, searching, businessType, searchKey]);

  const pageResults = useMemo(() => matchPages(pages, q), [pages, q]);

  // Everything selectable, in on-screen order — the keyboard walks this list.
  const flat = useMemo<SearchResult[]>(() => {
    const out: SearchResult[] = [...pageResults];
    if (searching) {
      for (const g of REMOTE_GROUPS) {
        const s = groups[g];
        if (s.status === 'done') out.push(...s.results);
      }
    }
    return out;
  }, [pageResults, groups, searching]);

  const active = highlight.q === q && flat.length ? Math.min(highlight.i, flat.length - 1) : 0;
  const setActive = (i: number) => setHighlight({ q, i });

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const go = useCallback((r: SearchResult | undefined) => {
    if (!r) return;
    onClose();
    router.push(r.href);
  }, [onClose, router]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) setActive((active + 1) % flat.length); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) setActive((active - 1 + flat.length) % flat.length); return; }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); go(flat[active]); }
  };

  const anyLoading = searching && REMOTE_GROUPS.some(g => groups[g].status === 'loading');
  const nothingFound = searching && !anyLoading && flat.length === 0;
  const activeId = flat[active] ? `${listId}-${active}` : undefined;

  const indexOf = new Map(flat.map((r, i) => [r.key, i]));
  const renderRow = (r: SearchResult): ReactNode => {
    const i = indexOf.get(r.key) ?? -1;
    const Icon = r.key === 'contacts:all' ? ArrowRight : GROUP_META[r.group].icon;
    return (
      <div
        key={r.key}
        id={`${listId}-${i}`}
        data-index={i}
        role="option"
        aria-selected={i === active}
        className={`gs-row${i === active ? ' is-active' : ''}${r.key === 'contacts:all' ? ' gs-row--more' : ''}`}
        onMouseMove={() => { if (i !== active) setActive(i); }}
        onMouseDown={e => e.preventDefault()}   // keep focus in the input
        onClick={() => go(r)}
      >
        <Icon size={16} aria-hidden="true" className="gs-row-icon" />
        <span className="gs-row-text">
          <span className="gs-row-title">{r.title}</span>
          {r.meta && <span className="gs-row-meta">{r.meta}</span>}
        </span>
        {r.tag && <span className="gs-row-tag">{r.tag}</span>}
      </div>
    );
  };

  return (
    <div className="gs-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gs-panel" role="dialog" aria-modal="true" aria-label="Search">
        <div className="gs-input-row">
          <Search size={18} aria-hidden="true" className="gs-input-icon" />
          <input
            ref={inputRef}
            className="gs-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search contacts, journeys, templates, segments or pages"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          {anyLoading && <Loader2 size={16} aria-label="Searching" className="gs-spin" />}
          {query && (
            <button type="button" className="gs-icon-btn" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
              <X size={16} />
            </button>
          )}
        </div>

        {searching && narrowed && (
          <div className="gs-scope">
            <span>Contacts and journeys are limited to <b>{businessType}</b>.</span>
            <button type="button" className="gs-link" onClick={() => setBusinessType('All')}>Search all audiences</button>
          </div>
        )}

        <div className="gs-results" id={listId} role="listbox" ref={listRef} aria-label="Search results">
          {!searching && q.length > 0 && (
            <p className="gs-hint">Type at least {MIN_QUERY_LENGTH} characters to search contacts, journeys, templates and segments.</p>
          )}
          {GROUP_ORDER.map(g => {
            if (g === 'pages') {
              if (!pageResults.length) return null;
              return (
                <section key={g} className="gs-group" aria-label={searching ? 'Pages' : 'Go to'}>
                  <h3 className="gs-group-label">{searching ? 'Pages' : 'Go to'}</h3>
                  {pageResults.map(renderRow)}
                </section>
              );
            }
            if (!searching) return null;
            const s = groups[g];
            if (s.status === 'idle') return null;
            if (s.status === 'done' && !s.results.length) return null;
            return (
              <section key={g} className="gs-group" aria-label={GROUP_META[g].label}>
                <h3 className="gs-group-label">
                  {GROUP_META[g].label}
                  {s.status === 'done' && typeof s.total === 'number' && s.total > s.results.filter(r => r.key !== 'contacts:all').length && (
                    <span className="gs-group-count">{s.total.toLocaleString('en-US')} matches</span>
                  )}
                </h3>
                {s.status === 'loading' && <p className="gs-status">{GROUP_META[g].loading}</p>}
                {s.status === 'error' && <p className="gs-status gs-status--error">Couldn’t search {GROUP_META[g].label.toLowerCase()}. Try again.</p>}
                {s.status === 'done' && s.results.map(renderRow)}
              </section>
            );
          })}
          {nothingFound && (
            <p className="gs-empty">
              Nothing matches “{q}”.
              {narrowed && <> Only {businessType} contacts and journeys were searched.</>}
            </p>
          )}
        </div>

        <div className="gs-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>Enter</kbd> to open</span>
          <span><kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}

export default GlobalSearch;
