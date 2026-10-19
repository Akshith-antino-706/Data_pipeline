import { describe, it, expect } from 'vitest';
import { friendlyError } from '@/lib/friendlyError';

describe('friendlyError', () => {
  it.each([
    ['Invalid login: 535 Incorrect authentication data', 'Email server login failed'],
    ['550 5.1.1 User unknown', 'Email address does not exist'],
    ['452 Too many recipients, try again later', 'Sending was temporarily limited'],
    ['554 Message rejected: spam detected', "Blocked by the recipient's email provider"],
    ['connect ETIMEDOUT 1.2.3.4:587', 'Could not reach the sending service'],
    ['Invalid number', 'Phone number is not valid'],
    ['Template not approved', 'Message template is not approved'],
    ['HTTP 200', 'Email service did not confirm the send'],
    ['HTTP 401', 'Sending service refused our login'],
    ['HTTP 404', 'Sending service address is wrong'],
    ['HTTP 429', 'Sending was temporarily limited'],
    ['HTTP 400', 'Sending service rejected the request'],
    ['HTTP 503', 'Sending service had a problem'],
    ['Day-3 send failed: HTTP 502 ', 'Sending service had a problem'],
    ['something completely new', 'Sending failed'],
  ])('%s → %s', (raw, reason) => {
    expect(friendlyError(raw)?.reason).toBe(reason);
    expect(friendlyError(raw)?.action.length).toBeGreaterThan(10);
  });
  it('returns null for no error', () => {
    expect(friendlyError(null)).toBeNull();
    expect(friendlyError('  ')).toBeNull();
  });
});
