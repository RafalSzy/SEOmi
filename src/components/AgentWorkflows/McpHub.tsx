import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Copy,
  Database,
  Globe2,
  Layers,
  Search,
  Shield,
  Terminal,
  TrendingUp,
  Check,
} from 'lucide-react';
import { useToolsStore } from '@/stores/toolsStore';
import { useProjectStore } from '@/stores/projectStore';
import { invokeTauriCommand, isTauriEnvironment, saveTextFile } from '@/services/tauri';
import { readStorage, removeStorage, writeStorage } from '@/services/storage';
import { copyText } from '@/services/clipboard';

interface DiscoveredMcpTool { name: string; description: string | null; inputSchema: Record<string, unknown>; }
interface McpDiscoveryResult { serverName: string; serverVersion: string; tools: DiscoveredMcpTool[]; }
export const McpHub: React.FC = () => {
  const { t } = useTranslation();
  const mcpClientTab = useToolsStore((s) => s.mcpClientTab);
  const setMcpClientTab = useToolsStore((s) => s.setMcpClientTab);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const [copiedConfig, setCopiedConfig] = useState(false);
  const [exportedConfig, setExportedConfig] = useState(false);
  const [exportingConfig, setExportingConfig] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [serverPath, setServerPath] = useState('');
  const [selectedToolId, setSelectedToolId] = useState('seomi_audit_url');
  const [discovery, setDiscovery] = useState<McpDiscoveryResult | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const discoveryRequestToken = useRef(0);

  useEffect(() => {
    discoveryRequestToken.current += 1;
    setServerPath(activeProjectId ? readStorage(`seomi_project_${activeProjectId}_mcp_server_path_v1`) || '' : '');
    setDiscovery(null);
    setDiscoveryError('');
    setExportError(false);
    setDiscovering(false);
  }, [activeProjectId]);

  const normalizedServerPath = serverPath.trim();
  const absoluteServerPath = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(normalizedServerPath)
    && normalizedServerPath.toLocaleLowerCase().endsWith('.js');
  const claudeConfig = {
    mcpServers: {
      seomi: {
        command: 'node',
        args: [serverPath.trim()],
      },
    },
  };

  const cursorConfig = {
    mcpServers: {
      'seomi-assistant': {
        type: 'stdio',
        command: 'node',
        args: [serverPath.trim()],
      },
    },
  };

  const codexConfig = `[mcp_servers.seomi]\ncommand = "node"\nargs = [${JSON.stringify(serverPath.trim())}]`;
  const geminiConfig = {
    mcpServers: {
      seomi: {
        command: 'node',
        args: [serverPath.trim()],
      },
    },
  };

  const activeConfigString =
    mcpClientTab === 'claude'
      ? JSON.stringify(claudeConfig, null, 2)
      : mcpClientTab === 'cursor'
      ? JSON.stringify(cursorConfig, null, 2)
      : mcpClientTab === 'gemini'
      ? JSON.stringify(geminiConfig, null, 2)
      : codexConfig;

  const configExtension = mcpClientTab === 'codex' ? 'toml' : 'json';
  const configFilename = `seomi-mcp-${mcpClientTab}.${configExtension}`;

  const handleCopyConfig = async () => {
    const copied = await copyText(activeConfigString);
    if (!copied) return;
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  };

  const handleExportConfig = async () => {
    if (!absoluteServerPath) return;
    setExportingConfig(true);
    try {
      const result = await saveTextFile({
        defaultPath: configFilename,
        contents: activeConfigString,
        extension: configExtension,
        filterName: configExtension === 'json' ? t('mcp.jsonFileType') : t('mcp.tomlFileType'),
      });
      if (result === 'cancelled') {
        setExportError(false);
        return;
      }
      setExportError(false);
      setExportedConfig(true);
      setTimeout(() => setExportedConfig(false), 2000);
    } catch {
      setExportedConfig(false);
      setExportError(true);
    } finally {
      setExportingConfig(false);
    }
  };

  const updateServerPath = (value: string) => {
    discoveryRequestToken.current += 1;
    setServerPath(value);
    setDiscovery(null);
    setDiscoveryError('');
    setExportError(false);
    if (!activeProjectId) return;
    if (value.trim()) writeStorage(`seomi_project_${activeProjectId}_mcp_server_path_v1`, value.trim());
    else removeStorage(`seomi_project_${activeProjectId}_mcp_server_path_v1`);
  };

  const discoverTools = async () => {
    if (!absoluteServerPath || !isTauriEnvironment()) return;
    const projectId = activeProjectId;
    const requestToken = ++discoveryRequestToken.current;
    setDiscovering(true);
    setDiscoveryError('');
    try {
      const result = await invokeTauriCommand<McpDiscoveryResult>('discover_mcp_tools', { serverPath: serverPath.trim() });
      if (useProjectStore.getState().activeProjectId !== projectId || discoveryRequestToken.current !== requestToken) return;
      setDiscovery(result);
      setSelectedToolId((current) => result.tools.some((tool) => tool.name === current) ? current : result.tools[0]?.name ?? '');
    } catch (error) {
      if (useProjectStore.getState().activeProjectId !== projectId || discoveryRequestToken.current !== requestToken) return;
      setDiscovery(null);
      setDiscoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      if (useProjectStore.getState().activeProjectId === projectId && discoveryRequestToken.current === requestToken) setDiscovering(false);
    }
  };

  const builtInTools = [
    {
      id: 'seomi_gsc_search_analytics',
      name: 'seomi_gsc_search_analytics',
      description: t('mcp.toolDesc_seomi_gsc_search_analytics'),
      input: 'site_url, start_date, end_date, dimensions?, type?, row_limit?, start_row?',
      icon: Database,
    },
    {
      id: 'seomi_gsc_url_inspection',
      name: 'seomi_gsc_url_inspection',
      description: t('mcp.toolDesc_seomi_gsc_url_inspection'),
      input: 'inspection_url, site_url, language_code?',
      icon: Database,
    },
    {
      id: 'seomi_research_keywords',
      name: 'seomi_research_keywords',
      description: t('mcp.toolDesc_seomi_research_keywords'),
      input: 'keyword, location_code?, language_code?',
      icon: Search,
    },
    {
      id: 'seomi_research_keyword_suggestions',
      name: 'seomi_research_keyword_suggestions',
      description: t('mcp.toolDesc_seomi_research_keyword_suggestions'),
      input: 'seed, location_code?, language_code?',
      icon: Search,
    },
    {
      id: 'seomi_research_serp',
      name: 'seomi_research_serp',
      description: t('mcp.toolDesc_seomi_research_serp'),
      input: 'keyword, location_code?, language_code?, depth?',
      icon: Search,
    },
    {
      id: 'seomi_track_rank',
      name: 'seomi_track_rank',
      description: t('mcp.toolDesc_seomi_track_rank'),
      input: 'keyword, target, location_code?, language_code?, depth?',
      icon: TrendingUp,
    },
    {
      id: 'seomi_research_backlinks',
      name: 'seomi_research_backlinks',
      description: t('mcp.toolDesc_seomi_research_backlinks'),
      input: 'target',
      icon: Shield,
    },
    {
      id: 'seomi_research_backlink_anchors',
      name: 'seomi_research_backlink_anchors',
      description: t('mcp.toolDesc_seomi_research_backlink_anchors'),
      input: 'target, offset?, limit?',
      icon: Shield,
    },
    {
      id: 'seomi_research_backlink_pages',
      name: 'seomi_research_backlink_pages',
      description: t('mcp.toolDesc_seomi_research_backlink_pages'),
      input: 'target, offset?, limit?',
      icon: Shield,
    },
    {
      id: 'seomi_research_backlink_gap',
      name: 'seomi_research_backlink_gap',
      description: t('mcp.toolDesc_seomi_research_backlink_gap'),
      input: 'target, competitors, include_subdomains?, offset?, limit?',
      icon: Shield,
    },
    {
      id: 'seomi_research_domain_overview',
      name: 'seomi_research_domain_overview',
      description: t('mcp.toolDesc_seomi_research_domain_overview'),
      input: 'target, location_code?, language_code?',
      icon: Globe2,
    },
    {
      id: 'seomi_research_top_pages',
      name: 'seomi_research_top_pages',
      description: t('mcp.toolDesc_seomi_research_top_pages'),
      input: 'target, location_code?, language_code?, limit?',
      icon: Globe2,
    },
    {
      id: 'seomi_research_ranked_keywords',
      name: 'seomi_research_ranked_keywords',
      description: t('mcp.toolDesc_seomi_research_ranked_keywords'),
      input: 'target, location_code?, language_code?, limit?',
      icon: Globe2,
    },
    {
      id: 'seomi_research_domain_competitors',
      name: 'seomi_research_domain_competitors',
      description: t('mcp.toolDesc_seomi_research_domain_competitors'),
      input: 'target, location_code?, language_code?, limit?',
      icon: Globe2,
    },
    {
      id: 'seomi_audit_url',
      name: 'seomi_audit_url',
      description: t('mcp.toolDesc_seomi_audit_url'),
      input: 'url, timeout_ms?',
      icon: Layers,
    },
    {
      id: 'seomi_crawl_site',
      name: 'seomi_crawl_site',
      description: t('mcp.toolDesc_seomi_crawl_site'),
      input: 'start_url, max_pages?, max_depth?, timeout_ms?, scope_host?, allow_subdomains?',
      icon: Layers,
    },
    {
      id: 'seomi_pagespeed_insights',
      name: 'seomi_pagespeed_insights',
      description: t('mcp.toolDesc_seomi_pagespeed_insights'),
      input: 'url, strategy?, categories?',
      icon: TrendingUp,
    },
    {
      id: 'seomi_crux',
      name: 'seomi_crux',
      description: t('mcp.toolDesc_seomi_crux'),
      input: 'url, form_factor?',
      icon: TrendingUp,
    },
  ];
  const toolsList = discovery
    ? discovery.tools.map((tool) => ({
      ...tool,
      id: tool.name,
      input: Object.keys((tool.inputSchema.properties as Record<string, unknown> | undefined) ?? {}).join(', ') || t('mcp.noArguments'),
      icon: tool.name.includes('backlink') ? Shield : tool.name.includes('audit') ? Layers : Search,
    }))
    : builtInTools.map((tool) => ({ ...tool, inputSchema: { type: 'object', properties: {} } }));

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              {t('mcp.badge')}
            </span>
            <span className="text-xs text-slate-400 font-mono">{t('mcp.protocol')}</span>
          </div>
          <h1 className="text-2xl font-bold text-white mt-1">{t('mcp.title')}</h1>
          <p className="text-sm text-slate-400">
            {t('mcp.description')}
          </p>
        </div>

        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{discovery ? t('mcp.discoveredSummary', { count: discovery.tools.length, server: discovery.serverName, version: discovery.serverVersion }) : t('mcp.builtInSummary', { count: builtInTools.length })}</span>
        </div>
      </div>

      {/* Client Configuration Block */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-white text-sm">{t('mcp.clientConfig')}</h3>
          </div>

          {/* Client Selector Tabs */}
          <div className="flex items-center space-x-2">
            {(['claude', 'cursor', 'codex', 'gemini'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setMcpClientTab(tab);
                  setExportedConfig(false);
                  setExportingConfig(false);
                  setExportError(false);
                }}
                className={`text-xs px-3 py-1.5 rounded-lg transition font-medium ${
                  mcpClientTab === tab
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent'
                }`}
              >
                {tab === 'claude' ? t('mcp.clientClaude') : tab === 'cursor' ? t('mcp.clientCursor') : tab === 'gemini' ? t('mcp.clientGemini') : t('mcp.clientCodex')}
              </button>
            ))}
          </div>
        </div>

        <label className="block text-xs text-slate-300">{t('mcp.serverPathLabel')}
          <input aria-label={t('mcp.serverPathAria')} value={serverPath} onChange={(event) => updateServerPath(event.target.value)} placeholder={navigator.platform.toLocaleLowerCase().includes('win') ? t('mcp.serverPathWindows') : t('mcp.serverPathMac')} className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 font-mono text-xs text-white outline-none focus:border-emerald-400" />
        </label>

        <div className="relative">
          <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs text-emerald-400 font-mono overflow-x-auto leading-relaxed">
            {absoluteServerPath ? activeConfigString : t('mcp.configMissing')}
          </pre>

          <div className="absolute top-3 right-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExportConfig()}
              disabled={!absoluteServerPath || exportingConfig}
              className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>{exportingConfig ? t('mcp.exportingConfig') : exportedConfig ? t('mcp.exportedConfig') : t('mcp.exportConfig')}</span>
            </button>
            <button
              type="button"
              onClick={handleCopyConfig}
              disabled={!absoluteServerPath}
              className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copiedConfig ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t('mcp.copied')}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>{t('mcp.copyConfig')}</span>
                </>
              )}
            </button>
          </div>
        </div>
        {exportError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-xs text-rose-100">{t('mcp.exportError')}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void discoverTools()} disabled={!absoluteServerPath || !isTauriEnvironment() || discovering} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-sky-400/30 bg-sky-400/10 px-3 text-xs font-medium text-sky-100 outline-none transition hover:bg-sky-400/15 focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-50">
            <Search className="h-3.5 w-3.5" aria-hidden="true" />{discovering ? t('mcp.discovering') : t('mcp.discover')}
          </button>
          <span className="text-[11px] text-slate-500">{t('mcp.discoverNotice')}</span>
        </div>
        {discoveryError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-xs text-rose-100">{t('mcp.discoveryError')}: {discoveryError}</p>}
        {!isTauriEnvironment() && <p role="status" className="text-[11px] text-amber-200">{t('mcp.desktopRequired')}</p>}

        <p className="text-xs text-slate-400">
          {mcpClientTab === 'claude' &&
            t('mcp.instructionsClaude')}
          {mcpClientTab === 'cursor' &&
            t('mcp.instructionsCursor')}
          {mcpClientTab === 'codex' &&
            t('mcp.instructionsCodex')}
          {mcpClientTab === 'gemini' &&
            t('mcp.instructionsGemini')}
        </p>
        {!absoluteServerPath && <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('mcp.buildRequired')}</p>}
        <p className="text-[11px] text-slate-500">{t('mcp.nodeRequired')}</p>
        <p role="note" className="text-[11px] text-slate-500">{t('mcp.exportConfigNotice')}</p>
      </div>

      {/* Exposed tools and request format */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Available Tools Catalog */}
        <div className="space-y-4">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Code2 className="w-4 h-4 text-emerald-400" />
            <span>{t('mcp.toolsTitle')}</span>
          </h3>

          <div className="space-y-3">
            {toolsList.map((tool) => {
              const Icon = tool.icon;
              const isSelected = selectedToolId === tool.id;
              return (
                <div
                  key={tool.id}
                  onClick={() => setSelectedToolId(tool.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedToolId(tool.id); } }}
                  className={`p-4 rounded-xl border transition cursor-pointer flex items-start space-x-3 ${
                    isSelected
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div
                    className={`p-2 rounded-lg ${
                      isSelected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-sm text-white">{tool.name}</span>
                      {isSelected && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">
                          {t('mcp.selected')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">{tool.description}</p>
                    <p className="mt-2 font-mono text-[10px] text-slate-500">{t('mcp.arguments')}: {tool.input}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: truthful invocation and prerequisites */}
        <div className="space-y-4">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span>{t('mcp.invocationTitle')}</span>
          </h3>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-md">
            <p className="font-mono text-sm font-semibold text-emerald-200">{toolsList.find((tool) => tool.id === selectedToolId)?.name}</p>
            <p className="text-xs leading-5 text-slate-300">{toolsList.find((tool) => tool.id === selectedToolId)?.description}</p>
            <p className="text-xs leading-5 text-slate-400">{t('mcp.arguments')}: <code className="font-mono text-slate-300">{toolsList.find((tool) => tool.id === selectedToolId)?.input}</code></p>
            {discovery && <details className="rounded-lg border border-slate-800 bg-slate-950/50">
              <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-slate-300">{t('mcp.inputSchema')}</summary>
              <pre className="max-h-64 overflow-auto border-t border-slate-800 p-3 text-[10px] leading-relaxed text-sky-100">{JSON.stringify(toolsList.find((tool) => tool.id === selectedToolId)?.inputSchema ?? {}, null, 2)}</pre>
            </details>}
            {['seomi_audit_url', 'seomi_crawl_site'].includes(selectedToolId)
              ? <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-100">{t('mcp.localToolNotice')}</p>
              : ['seomi_gsc_search_analytics', 'seomi_gsc_url_inspection'].includes(selectedToolId)
                ? <p className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 text-xs text-sky-100">{t('mcp.gscToolNotice')}</p>
                : <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-100">{t('mcp.dataforseoToolNotice')}</p>}
            <p className="text-[11px] text-slate-500">{t('mcp.clientOnlyNotice')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
