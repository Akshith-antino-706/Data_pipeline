import { describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import DailyBillingSync, { mapRow } from '../../src/services/DailyBillingSync.js';
import type { BillingApiRecord } from '../../src/types/syncC.js';

// Shape of one record from getallyesterdaybookingdatedata (values made up).
const apiRecord: BillingApiRecord = {
  BillSerial: 1, BillNo: 'B-1', BillType: 'Tours', IsB2B: 1, ServiceId: 10,
  TravelDate: '2026-11-10T00:00:00', TravelEndDate: '2026-11-13T00:00:00',
  ServiceName: 'Desert Safari', SellingPrice: '150.50', IsCancel: 0,
  Guest_Name: 'Test Guest', Nationality: 'IN', Guest_Contact: '+971500000000',
  Guest_Email: 'guest@example.com', Guest_Age: 30, BookingDate: '2026-11-09',
  BusinessProviderCategory: 'Online B2B UAE', ProfitCenterName: 'B2B Dubai',
};

describe('DailyBillingSync — travel_end_date, customer_type, booking_source', () => {
  it('maps TravelEndDate, BusinessProviderCategory and ProfitCenterName', () => {
    const row = mapRow(apiRecord);
    expect(row.travel_end_date).toBe('2026-11-13');
    expect(row.customer_type).toBe('Online B2B UAE');
    expect(row.booking_source).toBe('B2B Dubai');
    expect(row.travel_date).toBe('2026-11-10');
  });

  it('blank or bad values become null, never an empty string', () => {
    const row = mapRow({ ...apiRecord, TravelEndDate: 'not a date', BusinessProviderCategory: '  ', ProfitCenterName: null });
    expect(row.travel_end_date).toBeNull();
    expect(row.customer_type).toBeNull();
    expect(row.booking_source).toBeNull();
    const missing = mapRow({ BillSerial: 2, ServiceId: 11, SellingPrice: '0' });
    expect(missing.travel_end_date).toBeNull();
    expect(missing.customer_type).toBeNull();
  });

  it('upsert writes the 3 columns and keeps existing values when the API sends a blank', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const client = { async query(sql: string, params: unknown[]) { calls.push({ sql, params }); return { rows: [] }; } } as unknown as PoolClient;
    await DailyBillingSync.upsertBatch(client, 'rayna_tours', [mapRow(apiRecord)]);
    const { sql, params } = calls[0];
    expect(sql).toMatch(/travel_end_date, customer_type, booking_source\)/);
    expect(sql).toMatch(/travel_end_date = COALESCE\(EXCLUDED\.travel_end_date, rayna_tours\.travel_end_date\)/);
    expect(sql).toMatch(/customer_type = COALESCE\(EXCLUDED\.customer_type, rayna_tours\.customer_type\)/);
    expect(sql).toMatch(/booking_source = COALESCE\(EXCLUDED\.booking_source, rayna_tours\.booking_source\)/);
    expect(sql).toMatch(/guest_name = EXCLUDED\.guest_name/);   // other columns still overwrite as before
    expect(params.slice(-3)).toEqual(['2026-11-13', 'Online B2B UAE', 'B2B Dubai']);
  });
});
