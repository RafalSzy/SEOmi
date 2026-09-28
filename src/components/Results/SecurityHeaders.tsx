import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, CheckCircle2, XCircle, Info, AlertTriangle, EyeOff, Server } from 'lucide-react';
import { PageAuditData } from '@/types';
import { useAuditStore } from '@/stores/auditStore';

interface SecurityHeadersProps {
  audit: PageAuditData;
}

interface HeaderSpec {
  key: string;
  title: string;
  value: string | undefined;
  importance: 'Critical' | 'High' | 'Medium';
  expected: string;
  remediation: string;
}

export const SecurityHeaders: React.FC<SecurityHeadersProps> = ({ audit }) => {
  const { t } = useTranslation();
  const { security_headers, technical } = audit;
  const showOnlyProblems = useAuditStore((state) => state.showOnlyProblems);

  const headerSpecs: HeaderSpec[] = [
    {
      key: 'strict-transport-security',
      title: t('security.hstsTitle'),
      value: security_headers.strict_transport_security,
      importance: 'Critical',
      expected: 'max-age=31536000; includeSubDomains; preload',
      remediation: t('legacyUi.security.hstsRemediation'),
    },
    {
      key: 'content-security-policy',
      title: t('security.cspTitle'),
      value: security_headers.content_security_policy,
      importance: 'Critical',
      expected: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';",
      remediation: t('legacyUi.security.cspRemediation'),
    },
    {
      key: 'x-frame-options',
      title: t('security.xfoTitle'),
      value: security_headers.x_frame_options,
      importance: 'High',
      expected: 'DENY or SAMEORIGIN',
      remediation: t('legacyUi.security.xfoRemediation'),
    },
    {
      key: 'x-content-type-options',
      title: t('security.xxpTitle'),
      value: security_headers.x_content_type_options,
      importance: 'High',
      expected: 'nosniff',
      remediation: t('legacyUi.security.xctoRemediation'),
    },
    {
      key: 'referrer-policy',
      title: t('security.referrerTitle'),
      value: security_headers.referrer_policy,
      importance: 'Medium',
      expected: 'strict-origin-when-cross-origin',
      remediation: t('legacyUi.security.referrerRemediation'),
    },
    {
      key: 'permissions-policy',
      title: t('security.permissionsTitle'),
      value: security_headers.permissions_policy,
      importance: 'Medium',
      expected: 'camera=(), microphone=(), geolocation=()',
      remediation: t('legacyUi.security.permissionsRemediation'),
    },
    {
      key: 'cross-origin-opener-policy',
      title: t('security.coopTitle'),
      value: security_headers.cross_origin_opener_policy,
      importance: 'Medium',
      expected: 'same-origin',
      remediation: t('legacyUi.security.coopRemediation'),
    },
    {
      key: 'cross-origin-resource-policy',
      title: t('security.corpTitle'),
      value: security_headers.cross_origin_resource_policy,
      importance: 'Medium',
      expected: 'same-origin',
      remediation: t('legacyUi.security.corpRemediation'),
    },
  ];

  const score = security_headers.score;
  const scoreColor =
    score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-rose-400';
  const scoreBg =
    score >= 80
      ? 'bg-emerald-500/10 border-emerald-500/20'
      : score >= 50
      ? 'bg-amber-500/10 border-amber-500/20'
      : 'bg-rose-500/10 border-rose-500/20';

  const serverHeader = security_headers.server || technical?.server;
  const hasServerVersionLeak =
    serverHeader &&
    serverHeader.split('/').length > 1 &&
    serverHeader.split('/')[1].split('').some((c) => !isNaN(parseInt(c, 10)));

  const xPoweredBy = security_headers.x_powered_by;
  const visibleHeaderSpecs = showOnlyProblems ? headerSpecs.filter((spec) => !spec.value) : headerSpecs;
  const transport = audit.transport_security;

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6 animate-in fade-in duration-200">
      {/* Top Banner: Overall Scorecard */}
      <div className={`p-6 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4 ${scoreBg}`}>
        <div className="flex items-center space-x-4">
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 shrink-0">
            <ShieldCheck className={`w-8 h-8 ${scoreColor}`} />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {t('security.securityScore')}
            </span>
            <h3 className="text-xl font-bold text-white mt-0.5">
              {score >= 80
                ? t('legacyUi.security.hardened')
                : score >= 50
                ? t('legacyUi.security.moderate')
                : t('legacyUi.security.vulnerable')}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {t('legacyUi.security.evaluated')}
            </p>
          </div>
        </div>

        <div className="text-center sm:text-right">
          <span className={`text-4xl font-black font-mono ${scoreColor}`}>{score}%</span>
        </div>
      </div>

      {transport && <section aria-label={t('legacyUi.security.transportAria')} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white">{t('legacyUi.security.transportCookies')}</h4>
          <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${transport.https ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/25 bg-rose-500/10 text-rose-300'}`}>{transport.scheme.toUpperCase()} · {transport.https ? t('legacyUi.security.https') : t('legacyUi.security.withoutHttps')}</span>
        </div>
        {transport.mixed_content_urls.length > 0 ? <div className="border-b border-slate-800 p-4">
          <p className="text-xs font-semibold text-rose-200">{t('legacyUi.security.mixedHttp', { count: transport.mixed_content_urls.length })}</p>
          <ul className="mt-2 space-y-1">{transport.mixed_content_urls.map((url) => <li key={url} className="break-all font-mono text-[10px] text-rose-100">{url}</li>)}</ul>
        </div> : <p className="border-b border-slate-800 px-4 py-3 text-xs text-slate-400">{t('legacyUi.security.noMixedHttp')}</p>}
        {transport.cookies.length > 0 ? <div className="divide-y divide-slate-800/80">
          <p className="px-4 pt-3 text-[10px] text-slate-500">{t('legacyUi.security.cookieNote')}</p>
          {transport.cookies.map((cookie) => <div key={cookie.name} className="flex flex-wrap items-center gap-2 px-4 py-3 text-[10px]">
            <span className="mr-auto font-mono text-slate-100">{cookie.name}</span>
            <span className={cookie.secure ? 'text-emerald-300' : 'text-amber-300'}>{t('legacyUi.security.secure')} {cookie.secure ? '✓' : t('legacyUi.security.none')}</span>
            <span className={cookie.http_only ? 'text-emerald-300' : 'text-amber-300'}>{t('legacyUi.security.httpOnly')} {cookie.http_only ? '✓' : t('legacyUi.security.none')}</span>
            <span className={cookie.same_site ? 'text-emerald-300' : 'text-amber-300'}>{t('uiUnits.sameSite')} {cookie.same_site || t('legacyUi.security.none')}</span>
          </div>)}
        </div> : <p className="border-b border-slate-800 px-4 py-3 text-xs text-slate-400">{t('legacyUi.security.noCookies')}</p>}
        <p className="px-4 py-3 text-[10px] leading-4 text-slate-500">{transport.tls_coverage}. {t('legacyUi.security.staticMixed')}</p>
      </section>}

      {/* Information Disclosure Vector Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Server Version Disclosure */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <Server className="w-4 h-4 text-slate-400" />
              <h4 className="text-xs font-semibold text-white">{t('legacyUi.security.serverHeader')}</h4>
            </div>
            {hasServerVersionLeak ? (
              <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 flex items-center space-x-1">
                <AlertTriangle className="w-3 h-3" />
                <span>{t('legacyUi.security.versionLeaked')}</span>
              </span>
            ) : serverHeader ? (
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                {t('legacyUi.security.bannerHardened')}
              </span>
            ) : (
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                {t('legacyUi.security.hiddenSuppressed')}
              </span>
            )}
          </div>
          <div className="bg-slate-950 p-2 rounded border border-slate-800 font-mono text-xs text-slate-300">
            {serverHeader ? serverHeader : <span className="text-slate-500 italic">{t('legacyUi.security.noServer')}</span>}
          </div>
          {hasServerVersionLeak && (
            <p className="text-[11px] text-amber-400 mt-2">
              {t('legacyUi.security.serverWarning')}
            </p>
          )}
        </div>

        {/* X-Powered-By Disclosure */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <EyeOff className="w-4 h-4 text-slate-400" />
              <h4 className="text-xs font-semibold text-white">{t('legacyUi.security.poweredByHeader')}</h4>
            </div>
            {xPoweredBy ? (
              <span className="text-[10px] font-semibold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 flex items-center space-x-1">
                <AlertTriangle className="w-3 h-3" />
                <span>{t('legacyUi.security.stackLeaked')}</span>
              </span>
            ) : (
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                {t('legacyUi.security.safeNotExposed')}
              </span>
            )}
          </div>
          <div className="bg-slate-950 p-2 rounded border border-slate-800 font-mono text-xs text-slate-300">
            {xPoweredBy ? (
              <span className="text-rose-300">{xPoweredBy}</span>
            ) : (
              <span className="text-emerald-400 italic">{t('legacyUi.security.noPoweredBy')}</span>
            )}
          </div>
          {xPoweredBy && (
            <p className="text-[11px] text-rose-400 mt-2">
              {t('legacyUi.security.poweredByWarning')}
            </p>
          )}
        </div>
      </div>

      {/* 8 Core Security Headers Grid */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {t('legacyUi.security.defenseHeaders', { count: headerSpecs.length })}
        </h4>

        {visibleHeaderSpecs.map((spec) => {
          const isPresent = Boolean(spec.value);

          return (
            <div
              key={spec.key}
              className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div className="flex items-center space-x-2.5">
                  {isPresent ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <h4 className="text-sm font-semibold text-white">{spec.title}</h4>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold uppercase ${
                      spec.importance === 'Critical'
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {spec.importance === 'Critical' ? t('legacyUi.security.critical') : spec.importance === 'High' ? t('legacyUi.security.high') : t('legacyUi.security.medium')}
                  </span>
                </div>

                <span
                  className={`text-xs font-semibold px-2.5 py-0.5 rounded-full inline-flex items-center self-start sm:self-auto ${
                    isPresent
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  }`}
                >
                  {isPresent ? t('legacyUi.security.present') : t('legacyUi.security.missing')}
                </span>
              </div>

              {/* Header Value */}
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs break-all mb-2">
                {spec.value ? (
                  <span className="text-emerald-300">{spec.value}</span>
                ) : (
                  <span className="text-slate-500 italic">{t('legacyUi.security.headerNotReturned')}</span>
                )}
              </div>

              {/* Remediation note */}
              <div className="flex items-start space-x-2 text-xs text-slate-400">
                <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                <p>
                  <span className="text-slate-300 font-medium">{t('legacyUi.security.recommended')}</span>
                  <code className="text-slate-200 bg-slate-800 px-1 rounded">{spec.expected}</code> —{' '}
                  {spec.remediation}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
