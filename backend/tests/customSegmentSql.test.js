import { describe, it, expect } from 'vitest';
import CustomSegmentService from '../src/services/CustomSegmentService.js';

// Audit S-B3: `joinOp` from the request body was concatenated straight into the WHERE clause.
describe('CustomSegmentService.buildSegmentSQL — joinOp injection (S-B3)', () => {
  const cond = (extra = {}) => ({ field: 'name', value: 'ali', ...extra });

  it('joins conditions with AND by default', () => {
    const { sql } = CustomSegmentService.buildSegmentSQL([cond(), cond()]);
    expect(sql).toMatch(/uc\.name ILIKE \$1 AND uc\.name ILIKE \$2/);
  });

  it('accepts OR in any case', () => {
    const { sql } = CustomSegmentService.buildSegmentSQL([cond({ joinOp: 'or' }), cond()]);
    expect(sql).toMatch(/\$1 OR uc\.name/);
  });

  it('never puts an attacker-supplied joinOp into the SQL', () => {
    const evil = "AND 1=1; DROP TABLE unified_contacts; --";
    const { sql } = CustomSegmentService.buildSegmentSQL([cond({ joinOp: evil }), cond()]);
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('1=1');
    expect(sql).toMatch(/\$1 AND uc\.name/);
  });

  it('keeps user values out of the SQL text (parameterised)', () => {
    const { sql, params } = CustomSegmentService.buildSegmentSQL([cond({ value: "x' OR '1'='1" })]);
    expect(sql).not.toContain("'1'='1");
    expect(params).toContain("%x' OR '1'='1%");
  });
});
