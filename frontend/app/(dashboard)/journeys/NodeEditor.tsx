'use client';

import { useId, useState, type ComponentType, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  Send, Clock, GitBranch, Target, Mail, MessageCircle, Smartphone, Radio, Zap, Eye, Pencil, Trash2,
  ChevronUp, ChevronDown, Plus, Sparkles, type LucideIcon,
} from 'lucide-react';
import { Button, Chip, Field, Input } from '@/components/ui';
import type { NodeForm, TplId } from '@/types/f1Journeys';
import WhatsAppTemplatePicker from './WhatsAppTemplatePicker';
import RcsTemplatePicker from './RcsTemplatePicker';
import {
  CHANNEL_NAMES, CONDITION_LABELS, GOAL_LABELS, defaultNodeName, isGeneratedName, missingTemplateError,
  nodeDetail, pluralSteps, sendHourText, uniqueName, waitUnitOf, waitValueOf, type NodeNameContext,
} from './nodeNames';
import styles from './NodeEditor.module.css';

export interface EditorTemplate { id: number | string; name?: string; subject?: string; wa_template_name?: string }

export interface TemplateSelectProps {
  templates: EditorTemplate[];
  value: TplId | undefined;
  onChange: (v: number | null) => void;
  channel?: string;
  placeholder?: string;
  error?: boolean | string | null;
}

export interface NodeEditorProps {
  nodes: NodeForm[];
  setNodes: Dispatch<SetStateAction<NodeForm[]>>;
  /** The "add a node" form is open (owned by the page so the wizard can block leaving the step). */
  addOpen: boolean;
  setAddOpen: (open: boolean) => void;
  /** Index of the node being edited inline, or null. */
  editIdx: number | null;
  setEditIdx: (idx: number | null) => void;
  continuous: boolean;
  /** Second line of the entry-trigger row, e.g. "Segment: VIP travellers". */
  triggerDetail: string;
  emailTemplates: EditorTemplate[];
  smsTemplates: EditorTemplate[];
  dynamicSections: Record<string | number, string[]>;
  getCustomVars: (templateId: TplId | undefined, channel: string) => string[];
  /** Lazy-load the template lists the first time the form opens. */
  onNeedTemplates: () => void;
  onPreview: (node: NodeForm) => void;
  TemplateSelect: ComponentType<TemplateSelectProps>;
}

export const BLANK_NODE: NodeForm = {
  label: '', type: 'action', channel: 'email', waitDays: 1, condition: 'booked', goalType: 'booking',
  emailTemplateId: null, whatsappTemplateId: null, smsTemplateId: null, restChannel: 'email', restTemplateId: null,
  waChannelId: null, waChannelName: null, waTemplateId: null, waTemplateName: null,
  rcsTemplateCode: null, rcsTemplateName: null, rcsTemplateType: null, sendHour: null, templateVariables: {},
};

// Switching the type resets the type-specific fields exactly like the old form did.
const TYPE_DEFAULTS: Partial<NodeForm> = { channel: 'email', waitDays: 1, condition: 'booked', goalType: 'booking' };

export const NODE_TYPES: { key: string; title: string; desc: string; icon: LucideIcon }[] = [
  { key: 'action', title: 'Send message', desc: 'Email, WhatsApp, SMS or RCS', icon: Send },
  { key: 'wait', title: 'Wait / Delay', desc: 'Pause before the next step', icon: Clock },
  { key: 'condition', title: 'Branch', desc: 'Split on what the contact did', icon: GitBranch },
  { key: 'goal', title: 'Conversion goal', desc: 'Count a booking, enquiry or sign-up', icon: Target },
];
// Branch and Conversion goal are not in use, so they can't be added any more. Existing journeys
// that already have them still show and edit normally (the type picker only appears when adding).
const ADDABLE_TYPES = NODE_TYPES.filter(t => t.key === 'action' || t.key === 'wait');
const TYPE_ICON: Record<string, LucideIcon> = { trigger: Zap, action: Send, wait: Clock, condition: GitBranch, goal: Target };
const TYPE_TONE: Record<string, string> = { action: styles.toneAction, wait: styles.toneWait, condition: styles.toneWait, goal: styles.toneGoal };

const CHANNELS: { key: string; icon: LucideIcon }[] = [
  { key: 'email', icon: Mail }, { key: 'whatsapp', icon: MessageCircle }, { key: 'sms', icon: Smartphone }, { key: 'rcs', icon: Radio },
];

const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ');

interface Draft {
  form: NodeForm;
  /** The user typed their own name — never overwrite it. */
  named: boolean;
  /** The user pressed Add / Save at least once. */
  attempted: boolean;
  touched: Record<string, boolean>;
}
const freshDraft = (form: NodeForm, named = false): Draft => ({ form, named, attempted: false, touched: {} });

export default function NodeEditor(props: NodeEditorProps) {
  const {
    nodes, setNodes, addOpen, setAddOpen, editIdx, setEditIdx, continuous, triggerDetail,
    emailTemplates, smsTemplates, onNeedTemplates, onPreview,
  } = props;
  const [draft, setDraft] = useState<Draft>(() => freshDraft({ ...BLANK_NODE }));
  const [editDraft, setEditDraft] = useState<Draft>(() => freshDraft({ ...BLANK_NODE }));
  const ctx: NodeNameContext = { emailTemplates, smsTemplates, continuous };

  const takenExcept = (idx: number | null): string[] => nodes.filter((_, i) => i !== idx).map(n => n.label);
  const nameFor = (d: Draft, idx: number | null): string => (d.named ? d.form.label : uniqueName(defaultNodeName(d.form, ctx), takenExcept(idx)));
  const errorsFor = (d: Draft, idx: number | null): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!nameFor(d, idx).trim()) e.name = 'Give this node a name.';
    const tpl = missingTemplateError(d.form);
    if (tpl) e.template = tpl;
    return e;
  };
  const visibleErrors = (d: Draft, idx: number | null): Record<string, string> => {
    const all = errorsFor(d, idx);
    const shown: Record<string, string> = {};
    for (const k of Object.keys(all)) if (d.attempted || d.touched[k]) shown[k] = all[k];
    return shown;
  };

  const openAdd = () => { onNeedTemplates(); setDraft(freshDraft({ ...BLANK_NODE })); setAddOpen(true); };
  const submitAdd = () => {
    if (Object.keys(errorsFor(draft, null)).length) { setDraft(d => ({ ...d, attempted: true })); return; }
    const label = nameFor(draft, null);
    setNodes(ns => [...ns, { ...draft.form, label }]);
    setDraft(freshDraft({ ...BLANK_NODE }));
    setAddOpen(false);
  };

  const toggleEdit = (idx: number) => {
    onNeedTemplates();
    if (editIdx === idx) { setEditIdx(null); return; }
    const n = nodes[idx];
    setEditDraft(freshDraft({ ...n }, !isGeneratedName(n.label, n, ctx)));
    setEditIdx(idx);
  };
  const submitEdit = (idx: number) => {
    if (Object.keys(errorsFor(editDraft, idx)).length) { setEditDraft(d => ({ ...d, attempted: true })); return; }
    const label = nameFor(editDraft, idx);
    setNodes(ns => ns.map((node, i) => (i === idx ? { ...editDraft.form, label } : node)));
    setEditIdx(null);
  };

  const remove = (idx: number) => {
    setNodes(ns => ns.filter((_, i) => i !== idx));
    if (editIdx === idx) setEditIdx(null);
    else if (editIdx !== null && editIdx > idx) setEditIdx(editIdx - 1);
  };
  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= nodes.length) return;
    setNodes(ns => { const copy = [...ns]; [copy[idx], copy[to]] = [copy[to], copy[idx]]; return copy; });
  };

  return (
    <div className={styles.editor}>
      <div className={styles.head}>
        <span className={styles.headTitle}>Steps in this journey</span>
        <Chip tone="mute">{pluralSteps(nodes.length)}</Chip>
      </div>

      <ol className={styles.timeline} aria-label="Steps in this journey">
        <li className={styles.item}>
          <span className={cx(styles.icon, styles.toneTrigger)} aria-hidden="true"><Zap size={16} /></span>
          <div className={styles.itemBody}>
            <div className={styles.itemRow}>
              <div className={styles.itemText}>
                <b className={styles.itemName}>Entry trigger</b>
                <span className={styles.itemDetail}>{triggerDetail}</span>
              </div>
              <Chip tone="gold">Trigger</Chip>
            </div>
          </div>
        </li>
        {nodes.map((n, idx) => {
          const Icon = TYPE_ICON[n.type] || Send;
          const editing = editIdx === idx;
          const hasTemplate = n.type === 'action' && Boolean(n.emailTemplateId || n.whatsappTemplateId || n.smsTemplateId);
          return (
            <li key={idx} className={styles.item}>
              <span className={cx(styles.icon, TYPE_TONE[n.type])} aria-hidden="true"><Icon size={16} /></span>
              <div className={cx(styles.itemBody, editing && styles.itemEditing)}>
                <div className={styles.itemRow}>
                  <div className={styles.itemText}>
                    <b className={styles.itemName}>{n.label}</b>
                    <span className={styles.itemDetail}>{nodeDetail(n, ctx)}</span>
                  </div>
                  <div className={styles.itemActions}>
                    {hasTemplate && (
                      <Button size="sm" variant="ghost" icon aria-label={`Preview template for ${n.label}`} title="Preview template" onClick={() => onPreview(n)}>
                        <Eye size={14} aria-hidden="true" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" icon aria-label={`Move ${n.label} up`} title="Move up"
                      disabled={idx === 0 || editIdx !== null} onClick={() => move(idx, -1)}>
                      <ChevronUp size={14} aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" icon aria-label={`Move ${n.label} down`} title="Move down"
                      disabled={idx === nodes.length - 1 || editIdx !== null} onClick={() => move(idx, 1)}>
                      <ChevronDown size={14} aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" icon aria-label={`Edit ${n.label}`} title="Edit" aria-expanded={editing}
                      onClick={() => toggleEdit(idx)}>
                      <Pencil size={14} aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" icon aria-label={`Remove ${n.label}`} title="Remove" onClick={() => remove(idx)}>
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                {editing && (
                  <div className={styles.editPanel}>
                    <NodeFields {...props} mode="edit" draft={editDraft} setDraft={setEditDraft}
                      name={nameFor(editDraft, idx)} errors={visibleErrors(editDraft, idx)} />
                    <div className={styles.actions}>
                      <Button variant="primary" size="sm" onClick={() => submitEdit(idx)}>Save changes</Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditIdx(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {addOpen ? (
        <section className={styles.formCard} aria-label="New node">
          <h3 className={styles.formTitle}>New node</h3>
          <NodeFields {...props} mode="add" draft={draft} setDraft={setDraft}
            name={nameFor(draft, null)} errors={visibleErrors(draft, null)} />
          <div className={styles.actions}>
            <Button variant="primary" onClick={submitAdd}><Plus size={14} aria-hidden="true" /> Add node</Button>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
          </div>
        </section>
      ) : (
        <button type="button" className={styles.addBtn} onClick={openAdd}>
          <Plus size={16} aria-hidden="true" /> {nodes.length === 0 ? 'Add first node' : 'Add another node'}
        </button>
      )}
    </div>
  );
}

interface NodeFieldsProps extends NodeEditorProps {
  mode: 'add' | 'edit';
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  name: string;
  errors: Record<string, string>;
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      {children}
    </fieldset>
  );
}

function NodeFields(p: NodeFieldsProps) {
  const { mode, draft, setDraft, name, errors, continuous, emailTemplates, smsTemplates, dynamicSections, getCustomVars, TemplateSelect } = p;
  const f = draft.form;
  const uid = useId();
  const set = (fn: (n: NodeForm) => NodeForm, touch?: string) =>
    setDraft(d => ({ ...d, form: fn(d.form), touched: touch ? { ...d.touched, [touch]: true } : d.touched }));
  const setNodeForm: Dispatch<SetStateAction<NodeForm>> = v => setDraft(d => ({ ...d, form: typeof v === 'function' ? v(d.form) : v }));
  // The edit form always cleared template variables on a template change; the add form only did for email.
  const clearVars = mode === 'edit';

  const tplId = f.channel === 'email' ? f.emailTemplateId : f.channel === 'whatsapp' ? f.whatsappTemplateId : f.smsTemplateId;
  const vars = f.type === 'action' ? getCustomVars(tplId, f.channel) : [];
  const sections = f.channel === 'email' && f.emailTemplateId != null ? dynamicSections[String(f.emailTemplateId)] : undefined;
  const generated = !draft.named;
  const tplErr = errors.template;
  const errNode = (msg: string | undefined, id: string) => (msg ? <span id={id} className="ui-err" role="alert">{msg}</span> : null);

  return (
    <div className={styles.fields}>
      {mode === 'add' && (
        <div className="ui-field">
          <span className="ui-label" id={`${uid}-type`}>Node type</span>
          <div role="radiogroup" aria-labelledby={`${uid}-type`} className={styles.types}>
            {ADDABLE_TYPES.map(t => {
              const on = f.type === t.key;
              const Icon = t.icon;
              return (
                <button key={t.key} type="button" role="radio" aria-checked={on} title={t.desc}
                  className={cx(styles.typeCard, on && styles.typeOn)}
                  onClick={() => set(n => ({ ...n, type: t.key, ...TYPE_DEFAULTS }))}>
                  <Icon size={15} aria-hidden="true" className={styles.typeIcon} />
                  <span>{t.title}</span>
                </button>
              );
            })}
          </div>
          <span className="ui-help">{ADDABLE_TYPES.find(t => t.key === f.type)?.desc}</span>
        </div>
      )}

      {f.type === 'action' && (
        <Group legend="Message">
          <div className="ui-field">
            <span className="ui-label" id={`${uid}-ch`}>Channel</span>
            <div role="radiogroup" aria-labelledby={`${uid}-ch`} className={styles.chips}>
              {CHANNELS.map(c => {
                const on = f.channel === c.key;
                const Icon = c.icon;
                return (
                  <button key={c.key} type="button" role="radio" aria-checked={on}
                    className={cx(styles.chip, on && styles.chipOn)}
                    onClick={() => set(n => ({ ...n, channel: c.key }))}>
                    <Icon size={14} aria-hidden="true" /> {CHANNEL_NAMES[c.key]}
                  </button>
                );
              })}
            </div>
          </div>

          {f.channel === 'email' && (
            <div className="ui-field">
              <span className="ui-label" id={`${uid}-tpl`}>Email template <span className="ui-req" aria-hidden="true">*</span></span>
              <div role="group" aria-labelledby={`${uid}-tpl`} aria-describedby={tplErr ? `${uid}-tplerr` : `${uid}-tplhelp`}>
                <TemplateSelect templates={emailTemplates} channel="email" value={f.emailTemplateId} error={Boolean(tplErr)}
                  onChange={val => set(n => ({ ...n, emailTemplateId: val, templateVariables: {} }), 'template')} />
              </div>
              <span id={`${uid}-tplhelp`} className="ui-help">The email this step sends. Its name is used for the step name.</span>
              {errNode(tplErr, `${uid}-tplerr`)}
              {sections && (
                <div className={styles.aiBox}>
                  <span className={styles.aiTitle}><Sparkles size={13} aria-hidden="true" /> AI-ranked by Claude when the journey runs</span>
                  <div className={styles.chips}>
                    {sections.map(sec => <Chip key={sec} tone="info">{sec}</Chip>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {f.channel === 'whatsapp' && (
            <>
              <div className="ui-field" role="group" aria-label="WhatsApp template" aria-describedby={tplErr ? `${uid}-tplerr` : undefined}>
                <WhatsAppTemplatePicker
                  value={{ waChannelId: f.waChannelId, waTemplateId: f.whatsappTemplateId }}
                  onChange={m => set(n => ({
                    ...n, waChannelId: m.waChannelId, waChannelName: m.waChannelName, whatsappTemplateId: m.waTemplateId,
                    waTemplateId: m.waTemplateId, waTemplateName: m.waTemplateName, ...(clearVars ? { templateVariables: {} } : {}),
                  }), 'template')}
                />
                {errNode(tplErr, `${uid}-tplerr`)}
              </div>
              <div className={styles.subCard}>
                <span className="ui-label" id={`${uid}-rest`}>Rest-of-world fallback</span>
                <span className="ui-help">Contacts outside WhatsApp coverage get this instead.</span>
                <div role="radiogroup" aria-labelledby={`${uid}-rest`} className={styles.chips}>
                  {['email', 'sms'].map(ch => {
                    const on = f.restChannel === ch;
                    return (
                      <button key={ch} type="button" role="radio" aria-checked={on} className={cx(styles.chip, on && styles.chipOn)}
                        onClick={() => set(n => ({ ...n, restChannel: ch }))}>
                        {CHANNEL_NAMES[ch]}
                      </button>
                    );
                  })}
                </div>
                <div role="group" aria-label={`Fallback ${CHANNEL_NAMES[f.restChannel] || f.restChannel} template`}>
                  <TemplateSelect templates={f.restChannel === 'email' ? emailTemplates : smsTemplates} channel={f.restChannel} value={f.restTemplateId}
                    onChange={val => set(n => ({ ...n, restTemplateId: val, ...(clearVars ? { templateVariables: {} } : {}) }))} />
                </div>
              </div>
            </>
          )}

          {f.channel === 'sms' && (
            <div className="ui-field">
              <span className="ui-label" id={`${uid}-tpl`}>SMS template <span className="ui-req" aria-hidden="true">*</span></span>
              <div role="group" aria-labelledby={`${uid}-tpl`} aria-describedby={tplErr ? `${uid}-tplerr` : undefined}>
                <TemplateSelect templates={smsTemplates} channel="sms" value={f.smsTemplateId} error={Boolean(tplErr)}
                  onChange={val => set(n => ({ ...n, smsTemplateId: val, ...(clearVars ? { templateVariables: {} } : {}) }), 'template')} />
              </div>
              {errNode(tplErr, `${uid}-tplerr`)}
            </div>
          )}

          {f.channel === 'rcs' && (
            <div className="ui-field" role="group" aria-label="RCS template" aria-describedby={tplErr ? `${uid}-tplerr` : undefined}>
              <RcsTemplatePicker
                value={{ rcsTemplateCode: f.rcsTemplateCode }}
                onChange={m => set(n => ({
                  ...n, rcsTemplateCode: m.rcsTemplateCode, rcsTemplateName: m.rcsTemplateName, rcsTemplateType: m.rcsTemplateType,
                  ...(clearVars ? { templateVariables: {} } : {}),
                }), 'template')}
              />
              {errNode(tplErr, `${uid}-tplerr`)}
            </div>
          )}

          {vars.length > 0 && (
            <div className={styles.subCard}>
              <span className="ui-label">Template variables</span>
              <span className="ui-help">Filled into the template for every contact.</span>
              {vars.map(v => (
                <Field key={v} label={v.replace(/_/g, ' ')}>
                  {c => (
                    <Input {...c} placeholder={`Enter ${v.replace(/_/g, ' ')}…`} value={f.templateVariables?.[v] || ''}
                      onChange={e => { const val = e.target.value; set(n => ({ ...n, templateVariables: { ...(n.templateVariables || {}), [v]: val } })); }} />
                  )}
                </Field>
              ))}
            </div>
          )}

          <Field label="Send at (Dubai time)" help="Optional. UTC+4. Leave empty to send as soon as the contact reaches this step.">
            {c => (
              <div className={styles.inline}>
                <Input {...c} type="time" className={styles.time} value={sendHourText(f.sendHour) || ''}
                  onChange={e => { const val = e.target.value; set(n => ({ ...n, sendHour: val === '' ? null : val })); }} />
                <Button size="sm" variant="ghost" onClick={() => set(n => ({ ...n, sendHour: null }))} disabled={!sendHourText(f.sendHour)}>Any time</Button>
              </div>
            )}
          </Field>
        </Group>
      )}

      {f.type === 'wait' && (
        <Group legend="Timing">
          {continuous ? (
            <ContinuousDelay form={f} setForm={setNodeForm} />
          ) : (
            <Field label="Days to wait" help="Fixed journeys run on a schedule, so waits are whole days.">
              {c => (
                <div className={styles.inline}>
                  <Input {...c} type="number" min={1} className={styles.num} value={f.waitDays}
                    onChange={e => { const d = Math.max(1, parseInt(e.target.value) || 1); set(n => ({ ...n, waitDays: d })); }} />
                  <div className={styles.chips} role="group" aria-label="Quick picks">
                    {[1, 2, 3, 7].map(d => (
                      <button key={d} type="button" aria-pressed={f.waitDays === d} className={cx(styles.chip, f.waitDays === d && styles.chipOn)}
                        onClick={() => set(n => ({ ...n, waitDays: d }))}>
                        {d} {d === 1 ? 'day' : 'days'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Field>
          )}
        </Group>
      )}

      {f.type === 'condition' && (
        <Group legend="Branch on">
          <div role="radiogroup" aria-label="Condition" className={styles.chips}>
            {Object.entries(CONDITION_LABELS).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={f.condition === v} className={cx(styles.chip, f.condition === v && styles.chipOn)}
                onClick={() => set(n => ({ ...n, condition: v }))}>{l}</button>
            ))}
          </div>
          <span className="ui-help">Contacts who match go one way, everyone else the other.</span>
        </Group>
      )}

      {f.type === 'goal' && (
        <Group legend="Goal">
          <div role="radiogroup" aria-label="Goal type" className={styles.chips}>
            {Object.entries(GOAL_LABELS).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={f.goalType === v} className={cx(styles.chip, f.goalType === v && styles.chipOn)}
                onClick={() => set(n => ({ ...n, goalType: v }))}>{l}</button>
            ))}
          </div>
          <span className="ui-help">Counts as a conversion when the contact does this.</span>
        </Group>
      )}

      <Field label="Node name" required error={errors.name}
        help={generated ? 'Filled in from your choices. Type to use your own name.' : 'Your own name — it won’t change with your choices.'}>
        {c => (
          <Input {...c} type="text" value={name} placeholder="e.g. Send welcome email"
            onChange={e => { const val = e.target.value; setDraft(d => ({ ...d, named: true, form: { ...d.form, label: val }, touched: { ...d.touched, name: true } })); }} />
        )}
      </Field>
    </div>
  );
}

/** Relative "+N minutes / hours / days" delay for continuous journeys — same maths as the flow builder's input. */
function ContinuousDelay({ form, setForm }: { form: NodeForm; setForm: Dispatch<SetStateAction<NodeForm>> }) {
  const uid = useId();
  const unit = waitUnitOf(form, true);
  const toDays = (v: number, u: string) => (u === 'minutes' ? v / 1440 : u === 'hours' ? v / 24 : v);
  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={`${uid}-v`}>Delay before the next step</label>
      <div className={styles.inline}>
        <span className={styles.plus} aria-hidden="true">+</span>
        <Input id={`${uid}-v`} type="number" min={1} className={styles.num} value={waitValueOf(form, unit)} aria-describedby={`${uid}-h`}
          onChange={e => { const v = parseFloat(e.target.value) || 0; setForm(f => ({ ...f, waitDays: toDays(v, unit), waitUnit: unit })); }} />
        <select aria-label="Delay unit" className={`ui-input ${styles.unit}`} value={unit} onChange={e => { const u = e.target.value; setForm(f => ({ ...f, waitUnit: u })); }}>
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </div>
      <span id={`${uid}-h`} className="ui-help">Relative per-contact delay after the previous step — e.g. +30 minutes, +2 hours, +24 hours.</span>
    </div>
  );
}
