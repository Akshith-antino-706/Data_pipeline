// Types for the Leads workspace page (app/(dashboard)/leads/page.tsx).
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface LeadsTabConfig {
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
}

export interface LeadsChannelConfig extends LeadsTabConfig {
  volumeLabel: string;
  volumeKey: 'totalChats' | 'totalEmails';
  volumeField: string;
  volumeColumnLabel: string;
  getSummary: (from: string, to: string) => Promise<unknown>;
  getTrend: (from: string, to: string, granularity: string) => Promise<unknown>;
  getDeptPeriods: (unit: string, count: number) => Promise<unknown>;
}

export interface RegistrationSourceConfig { label: string; icon: LucideIcon }

export interface RegQuery { from: string; to: string; granularity: string }

export interface PeriodColumn { label: string; sublabel?: string; partial?: boolean }

export interface RegistrationSummary {
  counts?: Record<string, number>;
  points?: { period: string; registrations: number }[];
  total?: number;
  from: string;
  to: string;
  granularity: string;
}

export interface RegistrationPeriods {
  dimension: string;
  periods: PeriodColumn[];
  rows: { name: string; values: number[] }[];
  totals: number[];
}

export interface RegistrationRecord { source: string; recordId: string | number; data: Record<string, unknown> }

export interface RegistrationRecords { records: RegistrationRecord[]; total: number; columns: string[] }

export interface LeadsSummary {
  totalChats?: number;
  totalEmails?: number;
  totalLeads?: number;
  newUsers?: number | null;
  oldUsers?: number;
  from: string;
  to: string;
}

export interface LeadsTrendPoint { period: string; leads: number; newUsers?: number; oldUsers?: number }
export interface LeadsTrend { points?: LeadsTrendPoint[] }

export interface DeptPeriodValue { chats: number; newUsers: number; oldUsers: number }
export interface DeptRow { receiver: string; department?: string; values: DeptPeriodValue[] }
export interface DeptPeriodsResponse { periods?: PeriodColumn[]; rows?: DeptRow[] }

export interface DeptUser { wa_id: string; wa_name?: string; first_msg?: string; first_msg_at?: string }
export interface DeptUsersResponse { users?: DeptUser[]; has_more?: boolean }

export interface DeptGroup {
  id: string | number;
  name: string;
  departments: { receiver: string | number; name?: string }[];
}

export interface SkeletonBlockProps { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties }

export interface PillOption { value: number; label: string }
export interface PillGroupProps { options: PillOption[]; value: number; onChange: (v: number) => void }

export interface FilterBlockArgs {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  onLoad: () => void;
  isLoading: boolean;
  pickedMonth: string;
  onMonthPick: (v: string) => void;
  onPreset: (from: string, to: string) => void;
  showTrendToggle: boolean;
}
