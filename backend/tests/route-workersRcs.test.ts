import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { JourneySendJobData } from '../src/types/queueJobs.js';

type Processor = (job: Job<JourneySendJobData>) => Promise<void>;

const { processors, mockQuery, sendRCS } = vi.hoisted(() => ({
  processors: new Map<string, Processor>(),
  mockQuery: vi.fn(),
  sendRCS: vi.fn(),
}));

vi.mock('bullmq', () => {
  class Worker {
    constructor(name: string, fn: Processor) { processors.set(name, fn); }
    on(): this { return this; }
    close(): Promise<void> { return Promise.resolve(); }
  }
  return { Worker };
});
vi.mock('../src/services/queue/index.js', () => ({ getConnection: vi.fn(() => ({})) }));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));
vi.mock('../src/services/GupshupService.js', () => ({ default: { sendRCS } }));
vi.mock('../src/services/EmailRenderer.js', () => ({ default: {} }));
vi.mock('../src/services/ChatHeadV1Service.js', () => ({ default: {} }));
vi.mock('../src/services/affinityVars.js', () => ({ getAffinityVars: vi.fn(), usesAffinity: vi.fn(() => false), fillAffinityVars: vi.fn() }));
vi.mock('../src/services/channels/ChatheadEmailChannel.js', () => ({ ChatheadEmailChannel: {} }));
vi.mock('../src/services/channels/JourneyEmailSender.js', () => ({ sendJourneyEmail: vi.fn() }));
vi.mock('../src/services/JourneyService.js', () => ({ default: { calculateNextFireAt: vi.fn(), processJourney: vi.fn() }, getOrGenerateNodeEmail: vi.fn() }));
vi.mock('../src/services/SendTrackService.js', () => ({ SendTrackService: {} }));
vi.mock('../src/services/WelcomeEmailService.js', () => ({ default: {} }));
vi.mock('../src/services/GtmJourneyService.js', () => ({ default: {} }));
vi.mock('../src/utils/emailFrequencyCap.js', () => ({ reserveSend: vi.fn(), releaseSend: vi.fn(), reserveWaSend: vi.fn(), releaseWaSend: vi.fn() }));
vi.mock('ioredis', () => ({ default: class { on(): this { return this; } } }));

let processRCS: Processor;

beforeAll(async () => {
  vi.stubEnv('JOURNEY_RCS_ENABLED', 'true');
  const { startWorkers } = await import('../src/services/queue/workers.js');
  startWorkers();
  processRCS = processors.get('journey-rcs')!;
});

const job = (over: Partial<JourneySendJobData> = {}): Job<JourneySendJobData> => ({
  data: { entryId: 1, customerId: 'c1', journeyId: 'j1', nodeId: 'n1', channel: 'rcs', templateId: 'T1', phone: '+971500000000', edges: [], nodes: {}, ...over },
} as unknown as Job<JourneySendJobData>);

function contactIs(row: { wa_unsubscribe: string | null; email_unsubscribe: string | null }): void {
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes('wa_unsubscribe, email_unsubscribe')) return Promise.resolve({ rows: [row] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}
const loggedEvent = (): { type: unknown; details: unknown } => {
  const call = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO journey_events'));
  const p = (call?.[1] ?? []) as unknown[];
  return { type: p[2], details: JSON.parse(String(p[4] ?? '{}')) as unknown };
};

beforeEach(() => { mockQuery.mockReset(); sendRCS.mockReset().mockResolvedValue({ success: true, provider: 'gupshup-rcs' }); });

describe('processRCS unsubscribe check', () => {
  it('registered the enabled RCS processor', () => { expect(typeof processRCS).toBe('function'); });

  it.each(['Yes', 'yes', 'YES', 'Y', ' y '])('blocks when wa_unsubscribe=%j', async (v) => {
    contactIs({ wa_unsubscribe: v, email_unsubscribe: null });
    await processRCS(job());
    expect(sendRCS).not.toHaveBeenCalled();
    expect(loggedEvent()).toEqual({ type: 'action_blocked', details: { reason: 'unsubscribed' } });
  });

  it.each([null, 'No', '', 'n'])('sends when wa_unsubscribe=%j', async (v) => {
    contactIs({ wa_unsubscribe: v, email_unsubscribe: null });
    await processRCS(job());
    expect(sendRCS).toHaveBeenCalledTimes(1);
    expect(loggedEvent().type).toBe('action_sent');
  });

  it('sends when the contact row does not exist', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await processRCS(job());
    expect(sendRCS).toHaveBeenCalledTimes(1);
  });

  it('blocks with no_phone before any contact lookup', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await processRCS(job({ phone: null }));
    expect(mockQuery.mock.calls.some(c => String(c[0]).includes('wa_unsubscribe'))).toBe(false);
    expect(loggedEvent().details).toEqual({ reason: 'no_phone' });
  });

  it('uses a parameterised lookup for the customer id', async () => {
    contactIs({ wa_unsubscribe: 'yes', email_unsubscribe: null });
    await processRCS(job({ customerId: "1; DROP TABLE x" }));
    const call = mockQuery.mock.calls.find(c => String(c[0]).includes('wa_unsubscribe'));
    expect(call?.[1]).toEqual(['1; DROP TABLE x']);
  });
});
