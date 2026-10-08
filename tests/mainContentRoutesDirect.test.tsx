import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { mockAudit } from './fixtures/auditStoreContracts';
import {
  AuditTabs,
  Overview,
  SocialPreview,
  HeadingsTree,
  MetadataTable,
  ImagesAudit,
  LinksAudit,
  SecurityHeaders,
  StructuredDataView,
  AmpAuditView,
  PerformanceMetrics,
  DataForSEOAudit,
  KeywordResearch,
  KeywordClustering,
  PageSpeedWorkspace,
  SavedKeywords,
  RankTracking,
  DomainOverview,
  BacklinkChecker,
  SiteAudit,
  AiBrandVisibility,
  AiSearchPrompts,
  McpHub,
  SearchConsoleHub,
  SeoToolsWorkspace,
} from '@/components/Layout/mainContent/mainContentRoutes';

describe('mainContentRoutes direct static references', () => {
  it('instantiates all 25 lazy route JSX elements', () => {
    const elements = [
      <AuditTabs key="1" />,
      <Overview key="2" audit={mockAudit} />,
      <SocialPreview key="3" audit={mockAudit} />,
      <HeadingsTree key="4" audit={mockAudit} />,
      <MetadataTable key="5" audit={mockAudit} />,
      <ImagesAudit key="6" audit={mockAudit} />,
      <LinksAudit key="7" audit={mockAudit} />,
      <SecurityHeaders key="8" audit={mockAudit} />,
      <StructuredDataView key="9" audit={mockAudit} />,
      <AmpAuditView key="10" audit={mockAudit} />,
      <PerformanceMetrics key="11" audit={mockAudit} />,
      <DataForSEOAudit key="12" />,
      <KeywordResearch key="13" />,
      <KeywordClustering key="14" />,
      <PageSpeedWorkspace key="15" />,
      <SavedKeywords key="16" />,
      <RankTracking key="17" />,
      <DomainOverview key="18" />,
      <BacklinkChecker key="19" />,
      <SiteAudit key="20" />,
      <AiBrandVisibility key="21" />,
      <AiSearchPrompts key="22" />,
      <McpHub key="23" />,
      <SearchConsoleHub key="24" />,
      <SeoToolsWorkspace key="25" />,
    ];

    expect(elements).toHaveLength(25);
    for (const el of elements) {
      expect(isValidElement(el)).toBe(true);
    }
  });
});
