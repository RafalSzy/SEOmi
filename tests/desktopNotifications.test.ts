import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageAuditData, SiteCrawlResult } from '@/types';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import {
  areAuditNotificationsEnabled,
  disableAuditNotifications,
  enableAuditNotifications,
  notifyAuditCompleted,
  notifyBatchCompleted,
  notifyCrawlCompleted,
  notifyScheduledAuditReminder,
} from '@/services/desktopNotifications';
import { addScheduledAudit } from '@/services/auditSchedule';
import i18n from '@/i18n';

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => 'granted'),
  sendNotification: vi.fn(),
}));

const audit = (score: number): PageAuditData => ({
  url: 'https://example.com',
  final_url: 'https://example.com/final',
  timestamp: new Date().toISOString(),
  http_status: 200,
  response_time_ms: 10,
  redirect_chain: [],
  meta_tags: { title_length: 0, description_length: 0, other_tags: [] },
  open_graph: { all_tags: [] },
  twitter_card: { all_tags: [] },
  headings: { h1_count: 0, h1_texts: [], hierarchy: [], has_valid_hierarchy: true, issues: [] },
  images: [],
  links: { total_links: 0, internal_links: 0, external_links: 0, nofollow_links: 0, links: [] },
  security_headers: { score: 0 },
  structured_data: [],
  technical: { hreflang_tags: [] },
  health_score: score,
  issues: [],
  content_stats: { word_count: 0, reading_time_minutes: 0, text_ratio_percent: 0, top_keywords: [] },
});

const crawl = (score: number): SiteCrawlResult => ({
  start_url: 'https://example.com/', pages_crawled: 3, health_score: score,
  critical_count: 0, warning_count: 0, notice_count: 0, duration_ms: 12,
  cancelled: false, timed_out: false, robots_txt_status: 'loaded', robots_blocked_count: 0,
  sitemap_status: 'loaded', sitemap_urls_discovered: 0, sitemap_urls: [], pages: [],
});

describe('project-scoped desktop audit notifications', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(isPermissionGranted).mockReset().mockResolvedValue(false);
    vi.mocked(requestPermission).mockReset().mockResolvedValue('granted');
    vi.mocked(sendNotification).mockReset();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  });

  it('requests permission on explicit opt-in and stores the preference per project', async () => {
    expect(await enableAuditNotifications('project-a')).toBe(true);
    expect(areAuditNotificationsEnabled('project-a')).toBe(true);
    expect(areAuditNotificationsEnabled('project-b')).toBe(false);
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it('does not enable notifications if system permission is denied', async () => {
    vi.mocked(requestPermission).mockResolvedValue('denied');
    expect(await enableAuditNotifications('project-a')).toBe(false);
    expect(areAuditNotificationsEnabled('project-a')).toBe(false);
  });

  it('sends only local completion/regression notices when enabled for the same project', async () => {
    localStorage.setItem('seomi_project_project-a_desktop_notifications_v1', 'true');
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    await notifyAuditCompleted('project-b', audit(80), 90);
    expect(sendNotification).not.toHaveBeenCalled();

    await notifyAuditCompleted('project-a', audit(80), 90);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: i18n.t('runtimeErrors.desktop.auditRegression'),
      body: i18n.t('runtimeErrors.desktop.auditRegressionBody', { host: 'example.com', delta: 10, previous: 90, current: 80 }),
    }));

    disableAuditNotifications('project-a');
    expect(areAuditNotificationsEnabled('project-a')).toBe(false);
  });

  it('sends a crawl completion/regression notice without exposing page data', async () => {
    localStorage.setItem('seomi_project_project-a_desktop_notifications_v1', 'true');
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    await notifyCrawlCompleted('project-a', crawl(70), 80);

    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: i18n.t('runtimeErrors.desktop.crawlRegression'),
      body: i18n.t('runtimeErrors.desktop.crawlRegressionBody', { host: 'example.com', delta: 10, previous: 80, current: 70, pages: 3 }),
    }));
  });

  it('reminds once for the nearest scheduled task within the next hour', async () => {
    localStorage.setItem('seomi_project_project-a_desktop_notifications_v1', 'true');
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    const now = Date.UTC(2026, 8, 24, 10, 0, 0);
    addScheduledAudit('project-a', 'https://example.com/', 6, now - (5.5 * 60 * 60 * 1000));

    await notifyScheduledAuditReminder('project-a', now);
    await notifyScheduledAuditReminder('project-a', now + 15_000);

    expect(sendNotification).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: i18n.t('runtimeErrors.desktop.reminderTitle'),
      body: i18n.t('runtimeErrors.desktop.reminderBody', { task: i18n.t('runtimeErrors.desktop.taskAudit'), host: 'example.com', delay: i18n.t('runtimeErrors.desktop.reminderInMinutes', { count: 30 }) }),
    }));
  });

  it('sends one bounded summary for a batch run instead of per-URL notices', async () => {
    localStorage.setItem('seomi_project_project-a_desktop_notifications_v1', 'true');
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    await notifyBatchCompleted('project-a', {
      completed: 8,
      failed: 2,
      queued: 1,
      regressionCount: 3,
      stopped: true,
    });

    expect(sendNotification).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledWith({
      title: i18n.t('runtimeErrors.desktop.queueStopped'),
      body: i18n.t('runtimeErrors.desktop.queueBody', { completed: 8, failed: 2, pending: i18n.t('runtimeErrors.desktop.pending', { count: 1 }), regression: i18n.t('runtimeErrors.desktop.regressions', { count: 3 }) }),
    });
  });
});
