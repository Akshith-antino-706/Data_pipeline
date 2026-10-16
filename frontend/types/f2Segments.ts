import type { Id } from './api';

/** Value held by a custom-segment contact-property condition (shape depends on the field type). */
export type SegmentConditionValue = string | number | boolean | null | string[];

/** One row in the custom-segment builder (CreateSegmentModal). */
export interface SegmentCondition {
  type: string;
  field: string;
  operator: string;
  value: SegmentConditionValue;
  gtmEvent: string;
  giveawayType: string;
  giveawayName: string;
  exclude: boolean;
  joinOp: string;
  countOp?: string;
  countValue?: string | string[];
  windowDays?: string | number;
}

/** Existing custom segment passed to CreateSegmentModal in edit mode. */
export interface EditableCustomSegment {
  id: Id;
  name?: string | null;
  description?: string | null;
  conditions?: Partial<SegmentCondition>[] | null;
}
