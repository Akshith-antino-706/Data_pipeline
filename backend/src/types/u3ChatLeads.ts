// Row / payload shapes used by routes/chatLeads.ts (type-only).
import type { RegistrationSource } from './routesChatLeads.js';

/** mysql row of queryDepartmentPeriods: receiver/department + dynamic p{i}_* aggregates. */
export interface DepartmentPeriodsRow {
  receiver: string;
  department: string | null;
  [key: string]: unknown;
}

export interface ChatSummaryRow {
  receiver: string;
  department: string | null;
  chats: number;
  leads: number;
}

export interface ChatTotalsRow {
  chats: number;
  leads: number;
}

export interface UserStatsRow {
  new_users: string | number | null;
  old_users: string | number | null;
}

export interface ChatTrendRow {
  period: Date | string;
  chats: number;
  leads: number;
  new_users: number | null;
  old_users: number | null;
}

export interface MailSummaryRow {
  receiver: string;
  department: string | null;
  emails: number;
  leads: number;
}

export interface MailTotalsRow {
  emails: number;
  leads: number;
}

export interface MailTrendRow {
  period: Date | string;
  emails: number;
  leads: number;
}

export type RegistrationCountsRow = Record<RegistrationSource, number>;

export interface RegistrationPointRow {
  period: string;
  registrations: number;
}

export type RegistrationPeriodsRow = { name: string } & Record<`p${number}`, number>;

export interface InfoSchemaColumnRow {
  table_name: string;
  column_name: string;
}

export interface RegistrationRecordRow {
  source: string;
  record_id: string;
  registration_date: string | null;
  data: unknown;
}

export type FilledColumnsRow = Record<`c${number}`, boolean | null>;

export interface ChatHeadFirstMsgResponse {
  status?: string;
  msg?: string | null;
}

export interface ChatTimestampsRow {
  first_msg_at: Date | null;
  last_msg_at: Date | null;
  msgs: number;
}

export interface DepartmentUserRow {
  wa_id: string;
  wa_name: string | null;
  first_at: Date | null;
  is_new: number | string | null;
}

export interface DepartmentCatalogRow {
  receiver: string;
  name: string | null;
}

export interface GroupMemberAssignmentRow {
  receiver: string;
  group_id: number;
  group_name: string;
}

export interface DepartmentGroupRow {
  id: number;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface DepartmentGroupMemberRow {
  group_id: number;
  receiver: string;
  department_name: string | null;
}

export interface GroupDepartmentEntry {
  receiver: string;
  name: string | null;
}

export interface TakenReceiverRow {
  receiver: string;
  group_name: string;
}
