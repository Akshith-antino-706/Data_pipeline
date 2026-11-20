import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/database.js', () => ({ default: { connect: vi.fn(), query: vi.fn() } }));

import { archiveReport, archiveReportRecipients, sendArchiveReport, type ArchiveRunSummary } from '../src/services/JourneyArchiveService.js';

const empty = (): ArchiveRunSummary => ({ archived: [], failed: [], tooRecent: [], tooBig: [], backedOff: [], wouldArchive: [], templatesBackfilled: [] });
const NOW = new Date('2026-11-19T18:40:00Z');   // 22:40 Dubai

describe('journey archive nightly report', () => {
  it('recipients: comma list, trimmed, lower-cased, de-duplicated; unset = none', () => {
    expect(archiveReportRecipients({ JOURNEY_ARCHIVE_REPORT_EMAILS: ' A@x.com, a@x.com ,bad, b@y.com' })).toEqual(['a@x.com', 'b@y.com']);
    expect(archiveReportRecipients({})).toEqual([]);
  });

  it('a night that archived journeys is ✅ and lists them', () => {
    const r = archiveReport({ ...empty(), candidates: 65, alreadyArchived: 1, seconds: 120, archived: [{ journey_id: 245, month: '2026-07', seconds: 110 }] }, NOW);
    expect(r.ok).toBe(true);
    expect(r.subject).toBe('✅ Journey archive 2026-11-19: 1 archived, 0 failed, 64 still waiting');
    expect(r.html).toContain('#245 → 2026-07 in 110s');
  });

  it('failures, too-big skips and "nothing archived while journeys wait" are ⚠️', () => {
    const failed = archiveReport({ ...empty(), candidates: 3, failed: [{ journey_id: 242, error: 'canceling statement due to statement timeout' }] }, NOW);
    expect(failed.ok).toBe(false);
    expect(failed.subject.startsWith('⚠️')).toBe(true);
    expect(failed.html).toContain('#242: canceling statement due to statement timeout');

    const idle = archiveReport({ ...empty(), candidates: 5, tooBig: [{ journey_id: 242, emails: 5579502 }] }, NOW);
    expect(idle.ok).toBe(false);
    expect(idle.html).toContain('#242: 5,579,502 emails');
  });

  it('a crashed run is reported as not run', () => {
    const r = archiveReport({ ...empty(), skipped: 'crashed: S3 access denied' }, NOW);
    expect(r.ok).toBe(false);
    expect(r.subject).toContain('not run (crashed: S3 access denied)');
  });

  it('dry run says nothing was copied', () => {
    const r = archiveReport({ ...empty(), dryRun: true, candidates: 2, wouldArchive: [{ journey_id: 325, name: 'J13', last_sent_at: '2026-07-16T10:00:00Z', month: '2026-07', emails: 1200 }] }, NOW);
    expect(r.subject).toContain('dry run: nothing copied, 1 would be archived');
    expect(r.html).toContain('#325 J13: 1,200 emails, last send 2026-07-16');
  });

  it('sendArchiveReport: one email per recipient, never throws, nothing when unset', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('relay 500'));
    const log = { log: vi.fn(), warn: vi.fn() };
    const n = await sendArchiveReport(empty(), { send, env: { JOURNEY_ARCHIVE_REPORT_EMAILS: 'a@x.com,b@x.com' }, log });
    expect(n).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('relay 500'));

    const none = vi.fn();
    expect(await sendArchiveReport(empty(), { send: none, env: {}, log })).toBe(0);
    expect(none).not.toHaveBeenCalled();
  });
});
