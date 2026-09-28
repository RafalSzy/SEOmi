import { beforeEach, describe, expect, it } from 'vitest';
import {
  addScheduledAudit,
  applyScheduledExecution,
  claimDueScheduledAudit,
  finishScheduledAudit,
  loadScheduledAudits,
  removeScheduledAudit,
  runScheduledAuditNow,
  setScheduledAuditEnabled,
} from '@/services/auditSchedule';
import i18n from '@/i18n';

describe('project-local scheduled audits', () => {
  const start = Date.UTC(2026, 8, 23, 9, 0, 0);

  beforeEach(() => localStorage.clear());

  it('validates URLs and stores duplicate-free schedules per project', () => {
    const schedule = addScheduledAudit('project-a', 'https://example.com/page#section', 24, start);
    expect(schedule.url).toBe('https://example.com/page#section');
    expect(Date.parse(schedule.nextRunAt)).toBe(start + 24 * 60 * 60 * 1000);
    expect(loadScheduledAudits('project-a')).toHaveLength(1);
    expect(loadScheduledAudits('project-b')).toEqual([]);
    expect(() => addScheduledAudit('project-a', 'https://example.com/page#section', 24, start)).toThrow(/already|już/i);
    expect(() => addScheduledAudit('project-a', 'file:///etc/passwd', 24, start)).toThrow(/HTTP/i);
    expect(() => addScheduledAudit('project-a', 'https://user:secret@example.com/', 24, start)).toThrow(i18n.t('runtimeErrors.schedules.urlPublicOnly'));
  });

  it('claims due work once and schedules the next run after a recorded outcome', () => {
    const schedule = addScheduledAudit('project-a', 'https://example.com/', 6, start);
    const dueTime = start + 6 * 60 * 60 * 1000;
    expect(claimDueScheduledAudit('project-a', dueTime - 1)).toBeNull();

    const claimed = claimDueScheduledAudit('project-a', dueTime);
    expect(claimed).toMatchObject({ id: schedule.id, status: 'running' });
    expect(claimDueScheduledAudit('project-a', dueTime)).toBeNull();

    const completedAt = dueTime + 30_000;
    finishScheduledAudit('project-a', schedule.id, true, undefined, completedAt);
    const saved = loadScheduledAudits('project-a')[0];
    expect(saved.status).toBe('completed');
    expect(saved.lastRunAt).toBe(new Date(completedAt).toISOString());
    expect(Date.parse(saved.nextRunAt)).toBe(completedAt + 6 * 60 * 60 * 1000);
  });

  it('resumes stale interrupted work, preserves failures, and allows pause/removal', () => {
    const schedule = addScheduledAudit('project-a', 'https://example.com/', 12, start);
    const dueTime = start + 12 * 60 * 60 * 1000;
    const staleRunning = { ...schedule, status: 'running' as const, lastStartedAt: new Date(dueTime - 6 * 60 * 1000).toISOString() };
    localStorage.setItem('seomi_project_project-a_audit_schedules_v1', JSON.stringify([staleRunning]));

    expect(claimDueScheduledAudit('project-a', dueTime)).toMatchObject({ id: schedule.id, status: 'running' });
    finishScheduledAudit('project-a', schedule.id, false, 'HTTP 503', dueTime + 1000);
    expect(loadScheduledAudits('project-a')[0]).toMatchObject({ status: 'failed', lastError: 'HTTP 503' });

    const paused = setScheduledAuditEnabled('project-a', schedule.id, false, dueTime + 2000);
    expect(paused[0].status).toBe('paused');
    expect(claimDueScheduledAudit('project-a', dueTime + 1_000_000)).toBeNull();
    expect(removeScheduledAudit('project-a', schedule.id)).toEqual([]);
  });

  it('makes an enabled schedule due without changing its recurring interval', () => {
    const schedule = addScheduledAudit('project-a', 'https://example.com/', 24, start);
    const manualRunAt = start + 90 * 60 * 1000;

    runScheduledAuditNow('project-a', schedule.id, manualRunAt);

    expect(loadScheduledAudits('project-a')[0]).toMatchObject({
      status: 'scheduled',
      nextRunAt: new Date(manualRunAt).toISOString(),
    });
    expect(loadScheduledAudits('project-a')[0].intervalHours).toBe(24);
    expect(claimDueScheduledAudit('project-a', manualRunAt)?.id).toBe(schedule.id);
    finishScheduledAudit('project-a', schedule.id, true, undefined, manualRunAt + 1_000);
  });

  it('stores a multi-page crawl task with its non-secret config and execution history', () => {
    const schedule = addScheduledAudit('project-a', 'https://example.com/', 24, start, {
      taskType: 'site-crawl',
      crawlLimit: 80,
      crawlConfig: { maxDepth: 3, respectRobots: true, includePatterns: ['/docs/'] },
    });
    expect(schedule).toMatchObject({
      taskType: 'site-crawl',
      crawlLimit: 80,
      crawlConfig: { maxDepth: 3, includePatterns: ['/docs/'] },
    });

    const dueTime = start + 24 * 60 * 60 * 1000 + 1;
    expect(claimDueScheduledAudit('project-a', dueTime)).toMatchObject({ taskType: 'site-crawl', status: 'running' });
    finishScheduledAudit('project-a', schedule.id, false, 'quota exceeded', dueTime + 1_000);
    const saved = loadScheduledAudits('project-a')[0];
    expect(saved.runHistory).toHaveLength(1);
    expect(saved.runHistory?.[0]).toMatchObject({ succeeded: false, error: 'quota exceeded' });
  });

  it('claims the schedule requested by a desktop wake-up instead of another due schedule', () => {
    const first = addScheduledAudit('project-a', 'https://example.com/first', 24, start);
    const second = addScheduledAudit('project-a', 'https://example.com/second', 24, start + 1);
    const dueTime = start + 24 * 60 * 60 * 1000 + 1;

    const claimed = claimDueScheduledAudit('project-a', dueTime, second.id);

    expect(claimed?.id).toBe(second.id);
    expect(loadScheduledAudits('project-a').find((item) => item.id === first.id)?.status).toBe('scheduled');
    finishScheduledAudit('project-a', second.id, true, undefined, dueTime + 1_000);
  });

  it('keeps legacy schedules as page-audit tasks', () => {
    localStorage.setItem('seomi_project_project-a_audit_schedules_v1', JSON.stringify([{
      id: 'legacy', url: 'https://example.com/', intervalHours: 24, enabled: true,
      status: 'scheduled', createdAt: new Date(start).toISOString(), nextRunAt: new Date(start + 1).toISOString(),
    }]));
    expect(loadScheduledAudits('project-a')[0].taskType).toBe('page-audit');
  });

  it('does not duplicate a native handoff when reconciliation is retried', () => {
    const schedule = addScheduledAudit('project-a', 'https://example.com/', 24, start);
    const handoff = {
      projectId: 'project-a',
      scheduleId: schedule.id,
      taskType: 'site-crawl',
      startedAt: '2026-09-24T10:00:00.000Z',
      completedAt: '2026-09-24T10:01:00.000Z',
      succeeded: true,
      nextRunAt: '2026-09-25T10:01:00.000Z',
    } as const;

    applyScheduledExecution('project-a', handoff);
    applyScheduledExecution('project-a', handoff);

    const saved = loadScheduledAudits('project-a')[0];
    expect(saved.runHistory).toHaveLength(1);
    expect(saved.runHistory?.[0]).toMatchObject({
      startedAt: handoff.startedAt,
      completedAt: handoff.completedAt,
      succeeded: true,
    });
  });
});
