/** One column of a period pivot (week/month/day) as built by the chatLeads route. */
export interface Period {
  /** 'YYYY-MM-DD HH:MM:SS' (local) */
  start: string;
  end: string;
  label: string;
  sublabel: string | null;
  partial: boolean;
}

export type PeriodUnit = 'day' | 'week' | 'month';
export type Granularity = 'day' | 'week' | 'month';
export type RegistrationSource = 'guestuser' | 'agent' | 'affiliate';

export interface DepartmentPeriodsArgs {
  table: string;
  dateCol: string;
  leadCol: string;
  departmentJoin: string;
  receiverCol: string;
  poolName: string;
  periods: Period[];
}

export interface DepartmentUser {
  wa_id: string;
  wa_name: string | null;
  first_msg: string | null;
  first_msg_at: string | Date | null;
  is_new: boolean;
}

export interface DepartmentGroupInput {
  name?: string;
  departments?: Array<{ receiver: string | number; name?: string | null }>;
}
