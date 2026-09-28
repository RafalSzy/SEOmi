import { invokeTauriCommand, isTauriEnvironment } from '@/services/tauri';

export interface AuditQueueSnapshot {
  items: unknown[];
  run: unknown;
}

export interface NativeAuditQueueLoad {
  available: boolean;
  snapshot: unknown | null;
}

/** Load the native project queue without treating an IPC failure as an empty queue. */
export const loadNativeAuditQueue = async (projectId: string): Promise<NativeAuditQueueLoad> => {
  if (!isTauriEnvironment()) return { available: false, snapshot: null };
  try {
    return { available: true, snapshot: await invokeTauriCommand<unknown>('load_project_audit_queue', { projectId }) };
  } catch {
    // The Web Storage mirror remains authoritative when the native store is
    // unavailable; never replace a real queue with fabricated emptiness.
    return { available: false, snapshot: null };
  }
};

/** Persist a bounded, secret-free queue snapshot in the native project folder. */
export const saveNativeAuditQueue = async (projectId: string, snapshot: AuditQueueSnapshot): Promise<boolean> => {
  if (!isTauriEnvironment()) return false;
  try {
    await invokeTauriCommand('save_project_audit_queue', { projectId, snapshot });
    return true;
  } catch {
    return false;
  }
};

export const deleteNativeAuditQueue = async (projectId: string): Promise<boolean> => {
  if (!isTauriEnvironment()) return false;
  try {
    await invokeTauriCommand('delete_project_audit_queue', { projectId });
    return true;
  } catch {
    return false;
  }
};

export const loadNativeAuditQueueExecutions = async (projectId: string): Promise<unknown[]> => {
  if (!isTauriEnvironment()) return [];
  try {
    const value = await invokeTauriCommand<unknown>('list_project_audit_queue_executions', { projectId });
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export const loadNativeAuditQueueResults = async (projectId: string): Promise<unknown[]> => {
  if (!isTauriEnvironment()) return [];
  try {
    const value = await invokeTauriCommand<unknown>('list_project_audit_queue_results', { projectId });
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export const acknowledgeNativeAuditQueueExecution = async (projectId: string, runId: string): Promise<void> => {
  if (!isTauriEnvironment()) return;
  await invokeTauriCommand('acknowledge_project_audit_queue_execution', { projectId, runId });
};

export const acknowledgeNativeAuditQueueResult = async (
  projectId: string,
  runId: string,
  itemId: string,
): Promise<void> => {
  if (!isTauriEnvironment()) return;
  await invokeTauriCommand('acknowledge_project_audit_queue_result', { projectId, runId, itemId });
};
