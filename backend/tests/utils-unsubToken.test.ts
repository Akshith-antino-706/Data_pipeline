// Signed unsubscribe tokens (merged from main into TS) + the journey SMTP sender's one-click headers.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMail = vi.hoisted(() => vi.fn<(opts: Record<string, unknown>) => Promise<{ messageId: string }>>());
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));
vi.mock('../src/services/channels/ChatheadEmailChannel.js', () => ({ default: { send: vi.fn(async () => ({ success: true, provider: 'aws' })) } }));
vi.mock('../src/utils/emailAllowlist.js', () => ({ isEmailAllowed: () => true }));

import { signUnsubToken, verifyUnsubToken } from '../src/utils/unsubToken.js';
import { sendJourneyEmail } from '../src/services/channels/JourneyEmailSender.js';

describe('unsubToken', () => {
  it('round-trips a contact id', () => {
    expect(verifyUnsubToken(signUnsubToken(1462725))).toBe('1462725');
  });
  it('rejects missing, malformed and tampered tokens without throwing', () => {
    expect(verifyUnsubToken(undefined)).toBeNull();
    expect(verifyUnsubToken('no-dot')).toBeNull();
    const t = signUnsubToken(5);
    expect(verifyUnsubToken(`${t}x`)).toBeNull();                 // different length — used to 500
    expect(verifyUnsubToken(`${Buffer.from('6').toString('base64url')}.${t.split('.')[1]}`)).toBeNull();
  });
});

describe('sendJourneyEmail (SMTP credential)', () => {
  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({ messageId: 'm1' });
    process.env.GIVEAWAY_SMTP_HOST = 'smtp.test'; process.env.GIVEAWAY_SMTP_USER = 'u@test';
  });
  it('adds RFC 8058 one-click headers and a plain-text part when the contact is known', async () => {
    const r = await sendJourneyEmail({ emailCredential: 'giveaway', to: 'a@x.com', subject: 'Hi', html: '<p>Hello&nbsp;there</p><style>x{}</style>', unifiedId: 42 });
    expect(r.success).toBe(true);
    const opts = sendMail.mock.calls[0][0];
    const headers = opts.headers as Record<string, string>;
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const url = /<(.+)>/.exec(headers['List-Unsubscribe'])?.[1] ?? '';
    expect(url).toContain('/api/unsubscribe/confirm?t=');
    expect(verifyUnsubToken(decodeURIComponent(url.split('t=')[1]))).toBe('42');
    expect(opts.text).toBe('Hello there');
  });
  it('sends no half-formed header pair without a contact id', async () => {
    await sendJourneyEmail({ emailCredential: 'giveaway', to: 'a@x.com', subject: 'Hi', html: '<p>x</p>' });
    expect(sendMail.mock.calls[0][0].headers).toEqual({});
  });
});
