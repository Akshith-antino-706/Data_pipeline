import type { NodeForm, TplId } from '@/types/f1Journeys';

/** A template as the node form already loads it (email / SMS lists from getTemplates). */
export interface NamedTemplate { id: number | string; name?: string }

export interface NodeNameContext {
  emailTemplates: NamedTemplate[];
  smsTemplates: NamedTemplate[];
  /** Continuous journeys use a relative +N minutes/hours/days delay; fixed ones count days. */
  continuous: boolean;
}

export const CHANNEL_NAMES: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', rcs: 'RCS' };

export const CONDITION_LABELS: Record<string, string> = {
  booked: 'Has booked?', opened_email: 'Opened email?', clicked_link: 'Clicked link?',
};

export const GOAL_LABELS: Record<string, string> = { booking: 'Booking', enquiry: 'Enquiry', registration: 'Registration' };

/** "1 step", "2 steps". */
export const pluralSteps = (n: number): string => `${n} step${n === 1 ? '' : 's'}`;

const templateName = (list: NamedTemplate[], id: TplId | undefined): string | null => {
  if (id === null || id === undefined || id === '') return null;
  const t = list.find(x => String(x.id) === String(id));
  return t?.name?.trim() || null;
};

/** The template name of a message node, from the lists the form loads (or what the WhatsApp / RCS pickers saved). */
export function nodeTemplateName(n: NodeForm, ctx: NodeNameContext): string | null {
  if (n.channel === 'email') return templateName(ctx.emailTemplates, n.emailTemplateId);
  if (n.channel === 'sms') return templateName(ctx.smsTemplates, n.smsTemplateId);
  if (n.channel === 'whatsapp') return n.waTemplateName?.trim() || null;
  if (n.channel === 'rcs') return n.rcsTemplateName?.trim() || n.rcsTemplateCode?.trim() || null;
  return null;
}

/** Unit the wait is expressed in — same rule the delay input uses. */
export function waitUnitOf(n: NodeForm, continuous: boolean): 'minutes' | 'hours' | 'days' {
  if (!continuous) return 'days';
  if (n.waitUnit === 'minutes' || n.waitUnit === 'hours' || n.waitUnit === 'days') return n.waitUnit;
  const wd = parseFloat(String(n.waitDays)) || 0;
  return wd < 1 / 24 ? 'minutes' : wd < 1 ? 'hours' : 'days';
}

/** The number shown in the delay input for that unit. */
export function waitValueOf(n: NodeForm, unit: 'minutes' | 'hours' | 'days'): number {
  const wd = parseFloat(String(n.waitDays)) || 0;
  if (unit === 'minutes') return Math.round(wd * 1440);
  if (unit === 'hours') return +(wd * 24).toFixed(2);
  return +wd.toFixed(2);
}

/** "2 days", "1 hour", "30 minutes". */
export function waitText(n: NodeForm, continuous: boolean): string {
  const unit = waitUnitOf(n, continuous);
  const v = waitValueOf(n, unit);
  const singular = unit.slice(0, -1);
  return `${v} ${v === 1 ? singular : unit}`;
}

/** Send hour (null | legacy integer | "HH:MM") as "HH:MM", or null when unset. */
export function sendHourText(v: NodeForm['sendHour']): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return `${String(v).padStart(2, '0')}:00`;
  return v;
}

/** The name a node gets when the user hasn't typed one. */
export function defaultNodeName(n: NodeForm, ctx: NodeNameContext): string {
  if (n.type === 'action') {
    const ch = CHANNEL_NAMES[n.channel] || n.channel || 'Message';
    const tpl = nodeTemplateName(n, ctx);
    return tpl ? `${ch}: ${tpl}` : `Send ${ch === 'Email' ? 'email' : ch}`;
  }
  if (n.type === 'wait') {
    // Waits ignore send hour (only message steps use it), so the name reflects the wait length only.
    return `Wait ${waitText(n, ctx.continuous)}`;
  }
  if (n.type === 'condition') {
    const c = CONDITION_LABELS[n.condition];
    return c ? `Branch: ${c}` : 'Branch';
  }
  if (n.type === 'goal') {
    const g = GOAL_LABELS[n.goalType];
    return g ? `Goal: ${g}` : 'Conversion goal';
  }
  return n.type;
}

/** Adds " (2)", " (3)"… when the name is already used by another step. */
export function uniqueName(base: string, taken: string[]): string {
  const used = new Set(taken.map(t => t.trim().toLowerCase()));
  if (!used.has(base.trim().toLowerCase())) return base;
  let i = 2;
  while (used.has(`${base} (${i})`.toLowerCase())) i++;
  return `${base} (${i})`;
}

/** True when a saved name is (a numbered copy of) the generated default — it keeps following the choices when edited. */
export function isGeneratedName(label: string, n: NodeForm, ctx: NodeNameContext): boolean {
  const base = defaultNodeName(n, ctx);
  if (label === base) return true;
  return label.startsWith(`${base} (`) && /^ \(\d+\)$/.test(label.slice(base.length));
}

/** Short detail line for the steps timeline. */
export function nodeDetail(n: NodeForm, ctx: NodeNameContext): string {
  if (n.type === 'action') {
    const ch = CHANNEL_NAMES[n.channel] || n.channel || 'Message';
    const tpl = nodeTemplateName(n, ctx);
    const hour = sendHourText(n.sendHour);
    return [ch, tpl || 'No template', hour ? `at ${hour} Dubai` : 'any time'].join(' · ');
  }
  if (n.type === 'wait') return `Wait ${waitText(n, ctx.continuous)} before the next step`;
  if (n.type === 'condition') return CONDITION_LABELS[n.condition] || n.condition || 'Condition';
  if (n.type === 'goal') return `Goal: ${GOAL_LABELS[n.goalType] || n.goalType || 'Booking'}`;
  return '';
}

/** The template required for a message step, or null when it's set (or not a message). */
export function missingTemplateError(n: NodeForm): string | null {
  if (n.type !== 'action') return null;
  const missing = (n.channel === 'email' && !n.emailTemplateId)
    || (n.channel === 'whatsapp' && !n.whatsappTemplateId)
    || (n.channel === 'sms' && !n.smsTemplateId)
    || (n.channel === 'rcs' && !n.rcsTemplateCode);
  return missing ? `${CHANNEL_NAMES[n.channel] || n.channel} template is required` : null;
}

/** "Test Contacts — B2C (4) (4)" → "Test Contacts — B2C (4)" (segment names that already carry their count). */
export function cleanSegmentLabel(label: string): string {
  return label.replace(/\s*\(([\d,]+)\)\s*\(\1\)\s*$/, ' ($1)');
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-20T13:41" (Dubai wall time) → "Tue, 20 Oct 2026 · 1:41 PM (Dubai)". */
export function formatDubaiStart(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
  if (!m) return v;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const date = `${wd}, ${d} ${MONTHS[mo - 1]} ${y}`;
  if (m[4] === undefined) return `${date} (Dubai)`;
  const h = Number(m[4]);
  const time = `${h % 12 === 0 ? 12 : h % 12}:${m[5]} ${h < 12 ? 'AM' : 'PM'}`;
  return `${date} · ${time} (Dubai)`;
}
