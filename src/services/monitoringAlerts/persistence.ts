import { readJsonStorage, writeJsonStorage } from '@/services/storage';
import { normalizeMonitoringSettings, monitoringHistoryKey, monitoringSettingsKey, MONITORING_HISTORY_LIMIT, validAlert, validMonitoringProject, frequencyWindowMs } from './policy';
import type { MonitoringAlert, MonitoringAlertSettings } from './types';

const pending = new Set<string>();
export const readMonitoringSettings = (projectId: string): MonitoringAlertSettings =>
  normalizeMonitoringSettings(readJsonStorage(monitoringSettingsKey(projectId), null));
export const saveMonitoringSettings = (projectId: string, value: unknown): boolean =>
  validMonitoringProject(projectId) && writeJsonStorage(monitoringSettingsKey(projectId), normalizeMonitoringSettings(value));
export const readMonitoringHistory = (projectId: string): MonitoringAlert[] => {
  if (!validMonitoringProject(projectId)) return [];
  const value = readJsonStorage(monitoringHistoryKey(projectId), []);
  return (Array.isArray(value) ? value.filter(validAlert) : []).slice(-MONITORING_HISTORY_LIMIT);
};

export interface MonitoringReservation { duplicate: boolean; finish: (delivered: boolean) => boolean; }
export const reserveMonitoringAlert = (projectId: string, alert: MonitoringAlert, settings = readMonitoringSettings(projectId)): MonitoringReservation | null => {
  if (!validMonitoringProject(projectId) || !settings.enabled || !settings.types[alert.type]) return null;
  const history = readMonitoringHistory(projectId);
  const cutoff = Date.now() - frequencyWindowMs(settings.frequency);
  const duplicate = pending.has(alert.fingerprint) || history.some((item) => item.fingerprint === alert.fingerprint
    || (settings.frequency !== 'run' && item.type === alert.type && Date.parse(item.occurredAt) >= cutoff));
  if (duplicate) return { duplicate: true, finish: () => false };
  pending.add(alert.fingerprint);
  return {
    duplicate: false,
    finish: (delivered) => {
      pending.delete(alert.fingerprint);
      if (!delivered) return false;
      const current = readMonitoringHistory(projectId);
      if (current.some((item) => item.fingerprint === alert.fingerprint)) return true;
      return writeJsonStorage(monitoringHistoryKey(projectId), [...current, alert].slice(-MONITORING_HISTORY_LIMIT));
    },
  };
};
