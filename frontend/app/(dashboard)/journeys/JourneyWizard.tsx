'use client';

import { useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Button, Chip, ConfirmDialog, Field, Input, Toggle } from '@/components/ui';
import type { CreateForm, NodeForm } from '@/types/f1Journeys';
import { cleanSegmentLabel, formatDubaiStart, pluralSteps } from './nodeNames';
import styles from './JourneyWizard.module.css';

export interface WizardSegment { value: string; label: string }

export interface JourneyWizardProps {
  form: CreateForm;
  setForm: Dispatch<SetStateAction<CreateForm>>;
  /** Steps (nodes) added so far — the editor itself is rendered by the page (nodesEditor). */
  nodes: NodeForm[];
  /** True while a node is being added or edited — the step can't be left half-done. */
  nodeEditorOpen: boolean;
  segments: WizardSegment[];
  segmentsLoading: boolean;
  creating: boolean;
  onCreate: () => void;
  /** Called once the user has really left (after the unsaved-changes confirm, if any). */
  onClose: () => void;
  dubaiClock: string;
  minScheduledStart: string;
  onScheduledStartChange: (value: string) => void;
  segmentPicker: ReactNode;
  triggerEventPicker: ReactNode;
  recommendationPicker: ReactNode;
  emailSenderPicker: ReactNode;
  nodesEditor: ReactNode;
}

export const WIZARD_STEPS = [
  { title: 'Basics', hint: 'Name and description' },
  { title: 'Who joins', hint: 'Segment or event trigger' },
  { title: 'Audience', hint: 'Pick the segment' },
  { title: 'Steps', hint: 'Messages and waits' },
  { title: 'Review', hint: 'Check and create' },
] as const;

export const GIVEAWAY_TYPES = ['participation', 'eligible', 'winner', 'loser'] as const;

const splitEvents = (v: string | undefined): string[] => (v || '').split(',').map(s => s.trim()).filter(Boolean);

/** Per-step validation. Returns the error message per field, empty when the step is valid. */
export function stepErrors(step: number, form: CreateForm, nodes: NodeForm[], nodeEditorOpen: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0 && !form.name.trim()) e.name = 'Give the journey a name.';
  if (step === 1 && form.journeyType === 'continuous' && form.triggerSource === 'giveaway' && splitEvents(form.triggerEvent).length === 0) {
    e.trigger = 'Pick at least one giveaway type.';
  }
  if (step === 2 && !form.segmentId) e.segment = 'Pick a segment.';
  if (step === 3) {
    if (nodeEditorOpen) e.nodes = 'Finish or cancel the step you are editing first.';
    else if (nodes.length === 0) e.nodes = 'Add at least one step after the entry trigger.';
  }
  return e;
}

/** Anything the user typed or changed. The start time is pre-filled automatically, so it doesn't count. */
export function isWizardDirty(form: CreateForm, nodes: NodeForm[]): boolean {
  return Boolean(
    form.name.trim() || form.description.trim() || form.segmentId || form.triggerEvent || form.triggerFromDate
    || form.journeyType !== 'fixed' || (form.triggerSource || 'gtm') !== 'gtm' || !form.exitOnConversion
    || form.recommendationType || (form.emailCredential || 'default') !== 'default' || nodes.length > 0,
  );
}

const nodeSummary = (n: NodeForm): string => {
  if (n.type === 'action') return n.channel ? n.channel.charAt(0).toUpperCase() + n.channel.slice(1) : 'Message';
  if (n.type === 'wait') return 'Wait';
  if (n.type === 'condition') return 'Check';
  if (n.type === 'goal') return 'Goal';
  return n.type;
};

export const formatStart = (v: string): string => (v ? formatDubaiStart(v) : 'About 10 minutes after creating');

export default function JourneyWizard(props: JourneyWizardProps) {
  const {
    form, setForm, nodes, nodeEditorOpen, segments, segmentsLoading, creating, onCreate, onClose,
    dubaiClock, minScheduledStart, onScheduledStartChange,
    segmentPicker, triggerEventPicker, recommendationPicker, emailSenderPicker, nodesEditor,
  } = props;
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const uid = useId();

  const errors = stepErrors(step, form, nodes, nodeEditorOpen);
  const dirty = isWizardDirty(form, nodes);
  const isLast = step === WIZARD_STEPS.length - 1;
  const segmentLabel = cleanSegmentLabel(segments.find(s => s.value === form.segmentId)?.label || form.segmentId);
  const continuous = form.journeyType === 'continuous';
  const giveaway = (form.triggerSource || 'gtm') === 'giveaway';
  const events = splitEvents(form.triggerEvent);

  // Move focus to the new step's heading so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  // Warn before a reload / tab close drops unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const canReach = (target: number): boolean => {
    for (let i = 0; i < target; i++) {
      if (Object.keys(stepErrors(i, form, nodes, nodeEditorOpen)).length) return false;
    }
    return true;
  };

  const goTo = (target: number) => {
    if (target === step || creating) return;
    if (target > step && !canReach(target)) { setShowErrors(true); return; }
    setShowErrors(false);
    setStep(target);
  };

  const next = () => {
    if (Object.keys(errors).length) { setShowErrors(true); return; }
    if (isLast) { onCreate(); return; }
    setShowErrors(false);
    setStep(s => s + 1);
  };
  const back = () => { setShowErrors(false); setStep(s => Math.max(0, s - 1)); };
  const requestClose = () => { if (creating) return; if (dirty) setConfirmClose(true); else onClose(); };

  const err = (k: string): string | undefined => (showErrors ? errors[k] : undefined);

  const actionNodes = nodes.filter(n => n.type === 'action');
  const channelCounts = actionNodes.reduce<Record<string, number>>((acc, n) => {
    const k = nodeSummary(n);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const messagesLabel = actionNodes.length
    ? Object.entries(channelCounts).map(([k, v]) => `${v} ${k}`).join(' · ')
    : 'None yet';
  const joinsLabel = continuous
    ? (giveaway ? 'Giveaway event' : 'GTM event')
    : 'Once, from a segment';
  const triggerLabel = continuous
    ? (events.length ? events.join(' / ') : (giveaway ? 'No giveaway type picked' : 'Any — one entry per segment user'))
    : 'Not used for fixed journeys';

  const typeOptions = [
    { key: 'fixed', title: 'Everyone in a segment, once', desc: 'Fixed (occasion / seasonal). Snapshots the segment once, sends on schedule, then ends — e.g. Diwali, Eid, holiday campaigns.' },
    { key: 'continuous', title: 'Whenever something happens', desc: 'Continuous (always-on). Segment users enter when they fire an event and move through the steps on their own.' },
  ];

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <div className={styles.topTitle}>
          <h1 className={styles.appTitle}>Create journey</h1>
          {form.name.trim() && <span className={styles.topName}>{form.name}</span>}
        </div>
        <Button variant="ghost" onClick={requestClose} disabled={creating}>Cancel</Button>
      </header>

      <nav aria-label="Wizard steps" className={styles.stepper}>
        <div className={styles.compact}>
          <span className={styles.compactText}>Step {step + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[step].title}</span>
          <div className={styles.progress} role="progressbar" aria-label="Wizard progress"
            aria-valuemin={1} aria-valuemax={WIZARD_STEPS.length} aria-valuenow={step + 1}
            aria-valuetext={`Step ${step + 1} of ${WIZARD_STEPS.length}: ${WIZARD_STEPS[step].title}`}>
            <span className={styles.progressFill} style={{ width: `${((step + 1) / WIZARD_STEPS.length) * 100}%` }} />
          </div>
        </div>
        <ol className={styles.stepList}>
          {WIZARD_STEPS.map((s, i) => {
            const cur = i === step;
            const done = i < step;
            const reachable = i <= step || canReach(i);
            return (
              <li key={s.title} className={[styles.stepItem, done ? styles.stepItemDone : ''].filter(Boolean).join(' ')} data-state={done ? 'done' : cur ? 'current' : 'todo'}>
                <button
                  type="button"
                  className={[styles.stepBtn, cur ? styles.stepCur : ''].filter(Boolean).join(' ')}
                  aria-current={cur ? 'step' : undefined}
                  disabled={!reachable || creating}
                  onClick={() => goTo(i)}
                >
                  <span className={[styles.dot, done ? styles.dotDone : '', cur ? styles.dotCur : ''].filter(Boolean).join(' ')} aria-hidden="true">
                    {done ? '✓' : i + 1}
                  </span>
                  <span className={styles.stepText}>
                    <b>{s.title}</b>
                    <span className={styles.help}>{s.hint}</span>
                  </span>
                  <span className={styles.srOnly}>{done ? ' (done)' : cur ? ' (current step)' : ''}</span>
                </button>
                {i < WIZARD_STEPS.length - 1 && <span className={styles.connector} aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className={styles.body}>
        <main className={styles.main}>
          <p className={styles.srOnly} aria-live="polite">Step {step + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[step].title}</p>

          {step === 0 && (
            <section className={styles.section} aria-labelledby={`${uid}-h`}>
              <div>
                <h2 id={`${uid}-h`} ref={headingRef} tabIndex={-1} className={styles.h}>What is this journey for?</h2>
                <p className={styles.note}>Give it a clear name your team will recognise.</p>
              </div>
              <Field label="Journey name" required error={err('name')} help="Only your team sees this.">
                {c => (
                  <Input {...c} type="text" placeholder="e.g., Welcome Series — New Customers" value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                )}
              </Field>
              <Field label="Description">
                {c => (
                  <textarea {...c} className={`ui-input ${styles.textarea}`} placeholder="Describe the purpose and target audience..."
                    value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                )}
              </Field>
            </section>
          )}

          {step === 1 && (
            <section className={styles.section} aria-labelledby={`${uid}-h`}>
              <div>
                <h2 id={`${uid}-h`} ref={headingRef} tabIndex={-1} className={styles.h}>How do people join?</h2>
                <p className={styles.note}>Either everyone in a segment at once, or segment members when they fire an event.</p>
              </div>
              <div role="radiogroup" aria-label="Journey type" className={styles.opts}>
                {typeOptions.map(o => {
                  const on = form.journeyType === o.key;
                  return (
                    <button key={o.key} type="button" role="radio" aria-checked={on}
                      className={[styles.opt, on ? styles.optOn : ''].filter(Boolean).join(' ')}
                      onClick={() => setForm(f => ({ ...f, journeyType: o.key }))}>
                      <span className={[styles.radio, on ? styles.radioOn : ''].filter(Boolean).join(' ')} aria-hidden="true" />
                      <span><b>{o.title}</b><br /><span className={styles.note}>{o.desc}</span></span>
                    </button>
                  );
                })}
              </div>

              {continuous && (
                <div className={styles.section}>
                  <div className="ui-field">
                    <span className="ui-label" id={`${uid}-src`}>Trigger source</span>
                    <div role="group" aria-labelledby={`${uid}-src`} className={styles.pills}>
                      {[{ k: 'gtm', label: 'GTM event' }, { k: 'giveaway', label: 'Giveaway' }].map(o => {
                        const on = (form.triggerSource || 'gtm') === o.k;
                        return (
                          <button key={o.k} type="button" aria-pressed={on}
                            className={[styles.pill, on ? styles.pillOn : ''].filter(Boolean).join(' ')}
                            onClick={() => setForm(f => ({ ...f, triggerSource: o.k, triggerEvent: '' }))}>
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {giveaway ? (
                    <div className="ui-field">
                      <span className="ui-label" id={`${uid}-gw`}>Giveaway type(s) <span className={styles.req} aria-hidden="true">*</span></span>
                      <div role="group" aria-labelledby={`${uid}-gw`} className={styles.pills}>
                        {GIVEAWAY_TYPES.map(t => {
                          const on = events.includes(t);
                          return (
                            <button key={t} type="button" aria-pressed={on}
                              className={[styles.pill, styles.cap, on ? styles.pillOn : ''].filter(Boolean).join(' ')}
                              onClick={() => {
                                const nextList = on ? events.filter(x => x !== t) : [...events, t];
                                setForm(f => ({ ...f, triggerEvent: nextList.join(',') }));
                              }}>
                              {on ? '✓ ' : ''}{t}
                            </button>
                          );
                        })}
                      </div>
                      <span className={styles.help}>
                        {events.length
                          ? <>A segment user who fires <b>{events.join(' / ')}</b> on the giveaway site enters — one entry per event.</>
                          : <>Only segment members who fire the selected type enter the journey.</>}
                      </span>
                      {err('trigger') && <span className="ui-err" role="alert">{err('trigger')}</span>}
                    </div>
                  ) : (
                    <div className="ui-field">
                      <span className="ui-label">Trigger GTM event(s) <span className={styles.optional}>(optional · one or more)</span></span>
                      {triggerEventPicker}
                      <span className={styles.help}>
                        {events.length
                          ? <>One prefilled email per distinct item each segment user triggered <b>{events.join(' / ')}</b> on.</>
                          : <>No event → one entry per segment user. Pick events to fan out per distinct item instead.</>}
                      </span>
                    </div>
                  )}

                  <Field label={<>Trigger only for events on or after <span className={styles.optional}>(optional)</span></>}
                    help="Dubai time. Leave blank to include every past trigger too.">
                    {c => (
                      <Input {...c} type="date" value={form.triggerFromDate}
                        onChange={e => setForm(f => ({ ...f, triggerFromDate: e.target.value }))} />
                    )}
                  </Field>
                </div>
              )}
            </section>
          )}

          {step === 2 && (
            <section className={styles.section} aria-labelledby={`${uid}-h`}>
              <div>
                <h2 id={`${uid}-h`} ref={headingRef} tabIndex={-1} className={styles.h}>Who should get it?</h2>
                <p className={styles.note}>Pick a standard or custom segment. Counts come from the live segment data.</p>
              </div>
              <div className="ui-field">
                <span className="ui-label" id={`${uid}-seg`}>
                  Segment <span className={styles.req} aria-hidden="true">*</span>
                  {segmentsLoading && <span className={styles.optional}> · Loading…</span>}
                </span>
                <div role="group" aria-labelledby={`${uid}-seg`}>{segmentPicker}</div>
                {err('segment') && <span className="ui-err" role="alert">{err('segment')}</span>}
              </div>
              <div className={styles.card}>
                <Toggle checked={form.exitOnConversion}
                  onChange={v => setForm(f => ({ ...f, exitOnConversion: v }))}
                  label={<span><b>Stop when the contact books</b><br />
                    <span className={styles.note}>{form.exitOnConversion ? 'Users who book exit the journey automatically.' : 'Awareness mode — everyone receives every message.'}</span></span>} />
              </div>
            </section>
          )}

          {step === 3 && (
            <section className={styles.section} aria-labelledby={`${uid}-h`}>
              <div>
                <h2 id={`${uid}-h`} ref={headingRef} tabIndex={-1} className={styles.h}>What happens, step by step?</h2>
                <p className={styles.note}>Add messages, waits and checks in order.</p>
              </div>
              <div className={styles.editor}>{nodesEditor}</div>
              {err('nodes') && <span className="ui-err" role="alert">{err('nodes')}</span>}
              <div className="ui-field">
                <span className="ui-label">AI recommendation type</span>
                {recommendationPicker}
                <span className={styles.help}>Templates with a {'{{#products}}'} block get personalised AI-picked products at send time.</span>
              </div>
              <div className="ui-field">
                <span className="ui-label">Email sender</span>
                {emailSenderPicker}
                <span className={styles.help}>Which mailbox email steps send from. WhatsApp, SMS, RCS and push are unaffected.</span>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className={styles.section} aria-labelledby={`${uid}-h`}>
              <div>
                <h2 id={`${uid}-h`} ref={headingRef} tabIndex={-1} className={styles.h}>Review and create</h2>
                <p className={styles.note}>Check everything once, then create the journey.</p>
              </div>
              <dl className={styles.review}>
                {[
                  { k: 'Name', v: form.name, go: 0 },
                  { k: 'Description', v: form.description.trim() || '—', go: 0 },
                  { k: 'Joins', v: joinsLabel, go: 1 },
                  { k: 'Trigger', v: triggerLabel, go: 1 },
                  ...(continuous && form.triggerFromDate ? [{ k: 'Events from', v: form.triggerFromDate, go: 1 }] : []),
                  { k: 'Segment', v: segmentLabel, go: 2 },
                  { k: 'Stop on booking', v: form.exitOnConversion ? 'Yes' : 'No — awareness mode', go: 2 },
                  { k: 'Steps', v: `${pluralSteps(nodes.length)}: ${nodes.map(n => n.label || nodeSummary(n)).join(' → ')}`, go: 3 },
                ].map(r => (
                  <div key={r.k} className={styles.reviewRow}>
                    <dt className={styles.help}>{r.k}</dt>
                    <dd>{r.v}</dd>
                    <Button size="sm" variant="ghost" onClick={() => goTo(r.go)} aria-label={`Change ${r.k.toLowerCase()}`}>Change</Button>
                  </div>
                ))}
              </dl>
              <div className="ui-field">
                <div className={styles.row}>
                  <label className="ui-label" htmlFor={`${uid}-start`}>Start date and time</label>
                  <Chip tone="gold">Dubai: {dubaiClock}</Chip>
                </div>
                <Input id={`${uid}-start`} type="datetime-local" value={form.scheduledStartAt} min={minScheduledStart}
                  onChange={e => onScheduledStartChange(e.target.value)} />
                <span className={styles.help}>
                  {form.scheduledStartAt ? `Auto-starts ${formatStart(form.scheduledStartAt)}.` : 'Defaults to 10 minutes from now if left empty.'}
                </span>
              </div>
            </section>
          )}

          <div className={styles.navBar}>
            <Button variant="ghost" onClick={back} disabled={step === 0 || creating}>Back</Button>
            <Button variant="primary" onClick={next} disabled={creating} aria-busy={creating || undefined}>
              {isLast ? (creating ? 'Creating…' : 'Create journey') : 'Next'}
            </Button>
          </div>
        </main>

        <aside aria-label="Summary" className={styles.aside}>
          <span className={styles.eyebrow}>Summary</span>
          <b className={styles.asideName}>{form.name.trim() || 'Untitled journey'}</b>
          <dl className={styles.summary}>
            <div className={styles.row}><dt className={styles.help}>Joins</dt><dd>{joinsLabel}</dd></div>
            <div className={styles.row}><dt className={styles.help}>Segment</dt><dd>{segmentLabel || 'Not picked yet'}</dd></div>
            <div className={styles.row}><dt className={styles.help}>Steps</dt><dd aria-live="polite">{pluralSteps(nodes.length)}</dd></div>
            {nodes.length > 0 && (
              <ol className={styles.summarySteps} aria-label="Steps so far">
                {nodes.map((n, i) => <li key={i}>{n.label || nodeSummary(n)}</li>)}
              </ol>
            )}
            <div className={styles.row}><dt className={styles.help}>Messages</dt><dd>{messagesLabel}</dd></div>
            <div className={styles.row}><dt className={styles.help}>Starts</dt><dd>{formatStart(form.scheduledStartAt)}</dd></div>
          </dl>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Discard this journey?"
        description="You have unsaved changes. If you leave now, they will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        onConfirm={() => { setConfirmClose(false); onClose(); }}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}
