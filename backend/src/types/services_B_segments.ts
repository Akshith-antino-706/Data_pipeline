/** Types for CustomSegmentService (custom segment conditions + rows). */

export type SegmentScalar = string | number | boolean | null;

export interface SegmentCondition {
  type?: string;
  field?: string;
  operator?: string;
  value?: SegmentScalar | SegmentScalar[];
  exclude?: boolean;
  joinOp?: string;
  // gtm / giveaway count-based conditions
  gtmEvent?: string;
  giveawayType?: string;
  giveawayName?: string;
  windowDays?: string | number;
  countOp?: string;
  countValue?: SegmentScalar | SegmentScalar[];
}

export interface SegmentClauseItem {
  clause: string;
  joinOp: 'AND' | 'OR';
}

export interface SegmentInput {
  name?: string;
  description?: string | null;
  color?: string;
  icon?: string;
  conditions?: SegmentCondition[];
  status?: string;
  operator?: string;
}

export interface CustomSegmentRow {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  conditions: SegmentCondition[] | null;
  cached_count: number | null;
  cached_at: Date | null;
  status: string;
  condition_operator: string;
  created_at: Date;
  updated_at: Date;
}
