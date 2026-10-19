'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { getSegments, getTemplates, previewTemplate, sendTemplate } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/PageHeader';
import styles from './wizard.module.css';

/*
 * "Send a message" wizard.
 *
 * Sending is NOT connected: the only one-off send path (POST /api/v2/campaigns +
 * /:id/execute) targets the legacy `customer_segments` table by segment_label, while
 * the segments listed here come from the v3 engine (segment_definitions /
 * segment_customers). It also swaps the template's subject/body for a per-segment config,
 * so what is previewed here is not what it would send. Until the backend has a correct
 * path, the last step stays disabled.
 */
const NOT_CONNECTED_NOTE = "Sending from here isn't connected yet";

interface SegmentOption {
  id: string;
  name: string;
  stage: string;
  count: number | null;
}

interface TemplateOption {
  id: number;
  name: string;
  subject: string;
  updatedAt: string | null;
}

interface Preview { html: string; subject: string }

const STEPS = ['Audience', 'Message', 'Preview & test', 'Check & send'] as const;

const errText = (e: unknown): string => (e instanceof Error ? e.message : 'Request failed');
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const toCount = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const fmt = (n: number | null): string => (n === null ? 'Unknown' : n.toLocaleString('en-US'));
const fmtDate = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

function toSegments(rows: Record<string, unknown>[]): SegmentOption[] {
  return rows
    .map(r => ({
      id: str(r.segment_id),
      name: str(r.segment_name),
      stage: str(r.stage_name),
      count: toCount(r.customer_count),
    }))
    .filter(s => s.id !== '' && s.name !== '');
}

function toTemplates(res: unknown): TemplateOption[] {
  const data = (res && typeof res === 'object' && 'data' in res) ? (res as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return [];
  return data.flatMap((r: unknown): TemplateOption[] => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    const id = toCount(o.id);
    const name = str(o.name);
    if (id === null || !name || o.status !== 'approved' || o.channel !== 'email') return [];
    return [{ id, name, subject: str(o.subject), updatedAt: str(o.approved_at) || str(o.updated_at) || null }];
  });
}

export default function SendWizardPage() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);

  const [segments, setSegments] = useState<SegmentOption[] | null>(null);
  const [segErr, setSegErr] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  const [tplErr, setTplErr] = useState<string | null>(null);

  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<number | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [testErr, setTestErr] = useState<string | null>(null);

  const loadSegments = useCallback(() => {
    setSegErr(null); setSegments(null);
    getSegments()
      .then(rows => setSegments(toSegments(rows)))
      .catch((e: unknown) => setSegErr(errText(e)));
  }, []);
  const loadTemplates = useCallback(() => {
    setTplErr(null); setTemplates(null);
    getTemplates({ status: 'approved', channel: 'email', limit: 200 })
      .then(res => setTemplates(toTemplates(res)))
      .catch((e: unknown) => setTplErr(errText(e)));
  }, []);

  useEffect(() => { loadSegments(); loadTemplates(); }, [loadSegments, loadTemplates]);

  const segment = segments?.find(s => s.id === segmentId) ?? null;
  const template = templates?.find(t => t.id === templateId) ?? null;

  // Load the server-rendered preview whenever the chosen template changes.
  useEffect(() => {
    setPreview(null); setPreviewErr(null); setTestState('idle'); setTestErr(null);
    if (templateId === null) return;
    let live = true;
    setPreviewLoading(true);
    (previewTemplate(templateId) as Promise<{ data?: { html?: unknown; subject?: unknown } }>)
      .then(res => {
        if (!live) return;
        const html = str(res?.data?.html);
        if (!html) { setPreviewErr('The server returned an empty preview.'); return; }
        setPreview({ html, subject: str(res?.data?.subject) });
      })
      .catch((e: unknown) => { if (live) setPreviewErr(errText(e)); })
      .finally(() => { if (live) setPreviewLoading(false); });
    return () => { live = false; };
  }, [templateId]);

  const myEmail = user?.email ?? '';
  const sendTest = (): void => {
    if (templateId === null || !myEmail) return;
    setTestState('sending'); setTestErr(null);
    (sendTemplate(templateId, [myEmail]) as Promise<{ success?: boolean; error?: unknown }>)
      .then(res => {
        if (res && res.success === false) { setTestState('error'); setTestErr(str(res.error) || 'Test send failed'); return; }
        setTestState('sent');
      })
      .catch((e: unknown) => { setTestState('error'); setTestErr(errText(e)); });
  };

  const blockNote = [
    segment ? '' : 'Choose a segment to continue',
    template ? '' : 'Choose a template to continue',
    preview ? '' : 'The preview must load before you continue',
  ][step] ?? '';
  const canNext = step < STEPS.length - 1 && !blockNote;

  const testLabel = testState === 'sent' ? `Sent to ${myEmail}` : 'Not sent';

  return (
    <div className={styles.page}>
      <PageHeader
        title="Send a message"
        breadcrumbs={[{ label: 'Home', href: '/dashboard' }, { label: 'Send a message' }]}
        description="Nothing is sent from this page until the last step."
      />

      <ol className={styles.steps} aria-label="Steps">
        {STEPS.map((name, i) => (
          <li
            key={name}
            className={[styles.step, i === step ? styles.stepOn : '', i < step ? styles.stepDone : ''].filter(Boolean).join(' ')}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className={styles.mark} aria-hidden="true">{i < step ? <Check size={14} /> : i + 1}</span>
            {name}
          </li>
        ))}
      </ol>

      <div className={styles.layout}>
        <div className={styles.body}>
          {step === 0 && (
            <Card>
              <h2 className={styles.h2}>Who should receive it?</h2>
              <p className={styles.note}>Choose a segment. The size shown is the number of contacts currently in it.</p>
              <div style={{ marginTop: 12 }}>
                {segErr ? (
                  <ErrorState title="Couldn't load segments" details={segErr} action={<Button onClick={loadSegments}>Try again</Button>} />
                ) : segments === null ? (
                  <div aria-label="Loading segments"><Skeleton height={56} /></div>
                ) : segments.length === 0 ? (
                  <EmptyState title="No segments yet" description="Create a segment first." action={<Link href="/segmentation" className={buttonClass('secondary')}>Go to Segments</Link>} />
                ) : (
                  <div className={styles.opts} role="radiogroup" aria-label="Segment">
                    {segments.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={s.id === segmentId}
                        className={[styles.opt, s.id === segmentId ? styles.optOn : ''].filter(Boolean).join(' ')}
                        onClick={() => setSegmentId(s.id)}
                      >
                        <span className={styles.optTitle}>{s.name}</span>
                        <span className={`${styles.optMeta} ${styles.num}`}>
                          {s.stage ? `${s.stage} · ` : ''}{fmt(s.count)} contacts
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {step === 1 && (
            <Card>
              <h2 className={styles.h2}>What do you want to send?</h2>
              <p className={styles.note}>Email only. Only approved templates are listed.</p>
              <div style={{ marginTop: 12 }}>
                {tplErr ? (
                  <ErrorState title="Couldn't load templates" details={tplErr} action={<Button onClick={loadTemplates}>Try again</Button>} />
                ) : templates === null ? (
                  <div aria-label="Loading templates"><Skeleton height={56} /></div>
                ) : templates.length === 0 ? (
                  <EmptyState title="No approved email templates" description="Approve a template first." action={<Link href="/content" className={buttonClass('secondary')}>Go to Templates</Link>} />
                ) : (
                  <div className={styles.opts} role="radiogroup" aria-label="Template">
                    {templates.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={t.id === templateId}
                        className={[styles.opt, t.id === templateId ? styles.optOn : ''].filter(Boolean).join(' ')}
                        onClick={() => setTemplateId(t.id)}
                      >
                        <span className={styles.optTitle}>{t.name}</span>
                        {t.subject && <span className={styles.optMeta}>{t.subject}</span>}
                        <span><Chip tone="ok">Approved{fmtDate(t.updatedAt) ? ` · ${fmtDate(t.updatedAt)}` : ''}</Chip></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {step === 2 && (
            <>
              <Card>
                <h2 className={styles.h2}>Preview and test</h2>
                <p className={styles.note}>Rendered by the server with sample data.</p>
                <div style={{ marginTop: 12 }}>
                  {previewErr ? (
                    <ErrorState title="Couldn't load the preview" details={previewErr} />
                  ) : previewLoading || !preview ? (
                    <div aria-label="Loading preview"><Skeleton height={320} /></div>
                  ) : (
                    <>
                      {preview.subject && <p className={styles.subject}>Subject: <b>{preview.subject}</b></p>}
                      <iframe title="Email preview" className={styles.frame} sandbox="" srcDoc={preview.html} />
                    </>
                  )}
                </div>
              </Card>
              <Card title="Send a test to me">
                {myEmail ? (
                  <div className={styles.row}>
                    <span className={styles.note}>Sends this template to <b>{myEmail}</b> only.</span>
                    <Button onClick={sendTest} disabled={testState === 'sending' || templateId === null}>
                      {testState === 'sending' ? 'Sending test…' : testState === 'sent' ? 'Send again' : 'Send test'}
                    </Button>
                    {testState === 'sent' && <span className={styles.ok} role="status">Test sent to {myEmail}</span>}
                    {testState === 'error' && <span className={styles.bad} role="alert">Test failed: {testErr}</span>}
                  </div>
                ) : (
                  <p className={styles.note}>Your account has no email address, so a test can&apos;t be sent.</p>
                )}
              </Card>
            </>
          )}

          {step === 3 && (
            <Card>
              <h2 className={styles.h2}>Check and send</h2>
              <p className={styles.note}>This is the last step. Read it once more.</p>
              <dl className={styles.dl} style={{ marginTop: 12 }}>
                <dt>Who</dt><dd>{segment?.name ?? ''}</dd>
                <dt>Audience size</dt><dd className={styles.num}>{fmt(segment?.count ?? null)} contacts in the segment</dd>
                <dt>What</dt><dd>Email · {template?.name ?? ''}</dd>
                {preview?.subject && (<><dt>Subject</dt><dd>{preview.subject}</dd></>)}
                <dt>Test</dt><dd>{testLabel}</dd>
                <dt>When</dt><dd>Now</dd>
              </dl>
              <p className={styles.warnBox} style={{ marginTop: 12 }}>
                {NOT_CONNECTED_NOTE}. There is no backend path yet that sends an approved template to these segments exactly as previewed.
              </p>
            </Card>
          )}

          <div className={styles.footer}>
            <Button variant="ghost" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>Back</Button>
            <div className={styles.footRight}>
              {step < STEPS.length - 1 && blockNote && <span className={styles.block}>{blockNote}</span>}
              {step < STEPS.length - 1 ? (
                <Button variant="primary" disabled={!canNext} onClick={() => setStep(s => s + 1)}>Next: {STEPS[step + 1]}</Button>
              ) : (
                <>
                  <span className={styles.block}>{NOT_CONNECTED_NOTE}</span>
                  <Button variant="primary" disabled title={NOT_CONNECTED_NOTE}>
                    Send to {fmt(segment?.count ?? null)} contacts
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        <aside className={styles.aside}>
          <Card title="This send">
            <dl className={styles.dl}>
              <dt>Audience</dt><dd>{segment?.name ?? 'Not chosen'}</dd>
              <dt>In segment</dt><dd className={styles.num}>{segment ? fmt(segment.count) : '—'}</dd>
              <dt>Channel</dt><dd>Email</dd>
              <dt>Template</dt><dd>{template?.name ?? 'Not chosen'}</dd>
              <dt>Test</dt><dd>{testLabel}</dd>
              <dt>When</dt><dd>Now</dd>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}
