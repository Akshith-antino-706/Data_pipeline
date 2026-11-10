import { test } from 'node:test';
import assert from 'node:assert/strict';
import DailyBillingSync, { mapRow } from '../../src/services/DailyBillingSync.js';

// Shape of one record from getallyesterdaybookingdatedata (values made up).
const apiRecord = {
  BillSerial: 1, BillNo: 'B-1', BillType: 'Tours', IsB2B: 1, ServiceId: 10,
  TravelDate: '2026-11-10T00:00:00', TravelEndDate: '2026-11-13T00:00:00',
  ServiceName: 'Desert Safari', SellingPrice: '150.50', IsCancel: 0,
  Guest_Name: 'Test Guest', Nationality: 'IN', Guest_Contact: '+971500000000',
  Guest_Email: 'guest@example.com', Guest_Age: 30, BookingDate: '2026-11-09',
  BusinessProviderCategory: 'Online B2B UAE', ProfitCenterName: 'B2B Dubai',
};

test('maps TravelEndDate, BusinessProviderCategory and ProfitCenterName', () => {
  const row = mapRow(apiRecord);
  assert.equal(row.travel_end_date, '2026-11-13');
  assert.equal(row.customer_type, 'Online B2B UAE');
  assert.equal(row.booking_source, 'B2B Dubai');
  assert.equal(row.travel_date, '2026-11-10');
});

test('blank or bad values become null, never an empty string', () => {
  const row = mapRow({ ...apiRecord, TravelEndDate: 'not a date', BusinessProviderCategory: '  ', ProfitCenterName: null });
  assert.equal(row.travel_end_date, null);
  assert.equal(row.customer_type, null);
  assert.equal(row.booking_source, null);
  const missing = mapRow({ BillSerial: 2, ServiceId: 11 });
  assert.equal(missing.travel_end_date, null);
  assert.equal(missing.customer_type, null);
});

test('upsert writes the 3 columns and keeps existing values when the API sends a blank', async () => {
  const calls = [];
  const client = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
  await DailyBillingSync.upsertBatch(client, 'rayna_tours', [mapRow(apiRecord)]);
  const { sql, params } = calls[0];
  assert.match(sql, /travel_end_date, customer_type, booking_source\)/);
  assert.match(sql, /travel_end_date = COALESCE\(EXCLUDED\.travel_end_date, rayna_tours\.travel_end_date\)/);
  assert.match(sql, /customer_type = COALESCE\(EXCLUDED\.customer_type, rayna_tours\.customer_type\)/);
  assert.match(sql, /booking_source = COALESCE\(EXCLUDED\.booking_source, rayna_tours\.booking_source\)/);
  assert.match(sql, /guest_name = EXCLUDED\.guest_name/);   // other columns still overwrite as before
  assert.deepEqual(params.slice(-3), ['2026-11-13', 'Online B2B UAE', 'B2B Dubai']);
});
