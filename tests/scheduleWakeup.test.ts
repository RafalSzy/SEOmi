import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invokeTauriCommand: vi.fn(),
}));

vi.mock('@/services/tauri', () => ({
  isTauriEnvironment: () => true,
  invokeTauriCommand: mocks.invokeTauriCommand,
}));

import { removeAuditWakeup, syncAuditWakeup } from '@/services/scheduleWakeup';
import type { ScheduledAudit } from '@/services/auditSchedule';

const schedule = (overrides: Partial<ScheduledAudit> = {}): ScheduledAudit => ({
  id: 'schedule-race',
  url: 'https://example.com/',
  taskType: 'page-audit',
  intervalHours: 24,
  enabled: true,
  status: 'scheduled',
  createdAt: '2026-09-26T08:00:00.000Z',
  nextRunAt: '2026-09-27T08:00:00.000Z',
  runHistory: [],
  ...overrides,
});

const commands = (): string[] => mocks.invokeTauriCommand.mock.calls.map(([command]) => command as string);

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('schedule wake-up write ordering', () => {
  beforeEach(() => {
    mocks.invokeTauriCommand.mockReset();
    mocks.invokeTauriCommand.mockResolvedValue(undefined);
  });

  it('serializes an update before a remove for the same schedule', async () => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    mocks.invokeTauriCommand.mockImplementation((command: string) => command === 'save_scheduled_task' ? saveGate : Promise.resolve());

    const update = syncAuditWakeup('project-race', schedule());
    await flushMicrotasks();
    expect(commands()).toEqual(['save_scheduled_task']);

    const remove = removeAuditWakeup('project-race', 'schedule-race');
    await flushMicrotasks();
    expect(commands()).toEqual(['save_scheduled_task']);

    releaseSave();
    await Promise.all([update, remove]);
    expect(commands()).toEqual([
      'save_scheduled_task',
      'register_audit_wakeup',
      'delete_scheduled_task',
      'unregister_audit_wakeup',
    ]);
  });

  it('continues with the newest operation after an older native write fails', async () => {
    mocks.invokeTauriCommand
      .mockRejectedValueOnce(new Error('stale save failed'))
      .mockResolvedValue(undefined);

    await expect(syncAuditWakeup('project-race', schedule())).rejects.toThrow('stale save failed');
    await expect(removeAuditWakeup('project-race', 'schedule-race')).resolves.toBeUndefined();
    expect(commands()).toEqual([
      'save_scheduled_task',
      'delete_scheduled_task',
      'unregister_audit_wakeup',
    ]);
  });
});
