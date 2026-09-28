import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CRAWL_REPORT_TEMPLATE,
  deleteCrawlReportTemplate,
  loadCrawlReportTemplates,
  loadSelectedCrawlReportTemplateId,
  saveCrawlReportTemplate,
  saveSelectedCrawlReportTemplateId,
} from '@/services/reportTemplates';

describe('project-local crawl report templates', () => {
  beforeEach(() => localStorage.clear());

  it('always provides a deterministic full-report template without creating project data', () => {
    expect(loadCrawlReportTemplates(null)).toEqual([DEFAULT_CRAWL_REPORT_TEMPLATE]);
    expect(localStorage.length).toBe(0);
  });

  it('persists a custom template and its selected sections only in the project', () => {
    const template = saveCrawlReportTemplate('project-one', {
      name: 'Technical QA',
      sections: ['summary', 'configuration', 'issues', 'semantic', 'issues'],
    });

    expect(template.name).toBe('Technical QA');
    expect(template.sections).toEqual(['summary', 'configuration', 'issues', 'semantic']);
    saveSelectedCrawlReportTemplateId('project-one', template.id);
    expect(loadSelectedCrawlReportTemplateId('project-one')).toBe(template.id);
    expect(loadSelectedCrawlReportTemplateId('project-two')).toBe(DEFAULT_CRAWL_REPORT_TEMPLATE.id);
    expect(loadCrawlReportTemplates('project-two')).toEqual([DEFAULT_CRAWL_REPORT_TEMPLATE]);
  });

  it('rejects empty templates and deletes custom templates without deleting the built-in one', () => {
    expect(() => saveCrawlReportTemplate('project-one', { name: ' ', sections: ['issues'] })).toThrow();
    expect(() => saveCrawlReportTemplate('project-one', { name: 'No sections', sections: [] })).toThrow();
    const template = saveCrawlReportTemplate('project-one', { name: 'Disposable', sections: ['issues'] });
    deleteCrawlReportTemplate('project-one', template.id);
    expect(loadCrawlReportTemplates('project-one')).toEqual([DEFAULT_CRAWL_REPORT_TEMPLATE]);
    deleteCrawlReportTemplate('project-one', DEFAULT_CRAWL_REPORT_TEMPLATE.id);
    expect(loadCrawlReportTemplates('project-one')).toEqual([DEFAULT_CRAWL_REPORT_TEMPLATE]);
  });
});

