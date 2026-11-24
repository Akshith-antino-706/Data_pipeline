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
  // One giveaway by its producer id (giveaway_affiliate_events.giveaway_id) — picked from a list,
  // so it survives title edits and duplicate titles that the exact-name match cannot.
  giveawayId?: string;
  // Feed filter for giveaway/affiliate conditions: 'any' (or unset) counts both feeds.
  giveawaySource?: 'any' | 'GIVEAWAY' | 'AFFILIATE' | string;
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
