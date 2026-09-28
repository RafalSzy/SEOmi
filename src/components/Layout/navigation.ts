import type { ElementType } from 'react';
import {
  BarChart3,
  Bot,
  Bookmark,
  Cpu,
  Database,
  Gauge,
  Globe2,
  History,
  Layers,
  LayoutDashboard,
  Link2,
  MessageSquare,
  Search,
  Settings2,
  Sparkles,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import type { TabType } from '@/types';

/**
 * The single source of truth for the workspace information architecture.
 * Sidebar and command palette deliberately consume the same ordered contract
 * so a new workflow cannot silently appear in one navigation surface only.
 */
export interface WorkspaceNavItemDefinition {
  key: string;
  labelKey: string;
  keywords: string;
  icon: ElementType;
  tab?: TabType;
  action?: 'semantic-map' | 'new-project' | 'history' | 'settings' | 'ai-assistant' | 'ai-connection';
}

export interface WorkspaceNavSectionDefinition {
  key: string;
  titleKey: string;
  items: readonly WorkspaceNavItemDefinition[];
}

export const WORKSPACE_NAVIGATION: readonly WorkspaceNavSectionDefinition[] = [
  {
    key: 'audit-workspace',
    titleKey: 'sidebar.auditWorkspace',
    
    items: [
      { key: 'overview', labelKey: 'sidebar.overview', keywords: 'audit meta title headings', icon: LayoutDashboard, tab: 'overview' },
      { key: 'site-audit', labelKey: 'sidebar.siteAudit', keywords: 'crawl technical sitemap robots', icon: Globe2, tab: 'site-audit' },
      { key: 'semantic-map', labelKey: 'sidebar.semanticMap', keywords: 'crawl map clusters graph content', icon: Layers, tab: 'site-audit', action: 'semantic-map' },
    ],
  },
  {
    key: 'keyword-research',
    titleKey: 'sidebar.keywordWorkflows',
    items: [
      { key: 'keyword-research', labelKey: 'sidebar.keywordResearch', keywords: 'keyword research phrases', icon: Search, tab: 'keyword-research' },
      { key: 'saved-keywords', labelKey: 'sidebar.savedKeywords', keywords: 'keyword saved', icon: Bookmark, tab: 'saved-keywords' },
      { key: 'keyword-clustering', labelKey: 'sidebar.keywordClustering', keywords: 'keyword clusters SERP', icon: Layers, tab: 'keyword-clustering' },
      { key: 'rank-tracking', labelKey: 'sidebar.rankTracking', keywords: 'keyword rank tracking SERP', icon: TrendingUp, tab: 'rank-tracking' },
    ],
  },
  {
    key: 'domain-research',
    titleKey: 'sidebar.domainResearch',
    items: [
      { key: 'domain-overview', labelKey: 'sidebar.domainOverview', keywords: 'domain competitors organic', icon: Globe2, tab: 'domain-overview' },
      { key: 'backlink-checker', labelKey: 'sidebar.backlinkChecker', keywords: 'domain backlinks anchors gap', icon: Link2, tab: 'backlink-checker' },
    ],
  },
  {
    key: 'performance',
    titleKey: 'sidebar.performanceResearch',
    items: [
      { key: 'core-web-vitals', labelKey: 'sidebar.coreWebVitals', keywords: 'performance UX Lighthouse CrUX', icon: Gauge, tab: 'core-web-vitals' },
    ],
  },
  {
    key: 'google-data',
    titleKey: 'sidebar.googleData',
    items: [
      { key: 'search-console', labelKey: 'sidebar.searchConsole', keywords: 'Google data GSC queries pages', icon: Database, tab: 'search-console' },
      { key: 'dataforseo', labelKey: 'sidebar.dataforseo', keywords: 'Google data SERP keyword backlink domain API', icon: BarChart3, tab: 'dataforseo' },
    ],
  },
  {
    key: 'ai-visibility',
    titleKey: 'sidebar.aiVisibilityGeo',
    items: [
      { key: 'ai-brand-visibility', labelKey: 'sidebar.aiBrandVisibility', keywords: 'AI GEO brand citations', icon: Bot, tab: 'ai-brand-visibility' },
      { key: 'ai-search-prompts', labelKey: 'sidebar.aiSearchPrompts', keywords: 'AI prompt models answers', icon: MessageSquare, tab: 'ai-search-prompts' },
    ],
  },
  {
    key: 'agent-workflows',
    titleKey: 'sidebar.agentWorkflows',
    items: [
      { key: 'mcp-hub', labelKey: 'sidebar.mcpHub', keywords: 'agents MCP DataForSEO', icon: Cpu, tab: 'mcp-hub' },
    ],
  },
  {
    key: 'seo-tools',
    titleKey: 'sidebar.seoTools',
    items: [
      { key: 'seo-tools', labelKey: 'sidebar.seoToolsEntry', keywords: 'competitor domain age keyword generator serp simulator spam traffic', icon: Wrench, tab: 'seo-tools' },
    ],
  },
  {
    key: 'workspace-tools',
    titleKey: 'sidebar.workspaceTools',
    items: [
      { key: 'ai-assistant', labelKey: 'sidebar.aiAssistant', keywords: 'AI schema metadata', icon: Sparkles, action: 'ai-assistant' },
      { key: 'ai-connection', labelKey: 'sidebar.aiConnection', keywords: 'AI Claude Codex Gemini connection', icon: Link2, action: 'ai-connection' },
      { key: 'history', labelKey: 'sidebar.history', keywords: 'history audit run historia', icon: History, action: 'history' },
      { key: 'settings', labelKey: 'sidebar.settings', keywords: 'settings integrations dataforseo google', icon: Settings2, action: 'settings' },
    ],
  },
];
