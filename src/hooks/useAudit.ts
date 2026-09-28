import { useAuditStore } from '@/stores/auditStore';

export const useAudit = () => {
  const currentAudit = useAuditStore((s) => s.currentAudit);
  const isLoading = useAuditStore((s) => s.isLoading);
  const error = useAuditStore((s) => s.error);
  const activeTab = useAuditStore((s) => s.activeTab);
  const history = useAuditStore((s) => s.history);
  const startAudit = useAuditStore((s) => s.startAudit);
  const setActiveTab = useAuditStore((s) => s.setActiveTab);
  const clearAudit = useAuditStore((s) => s.clearAudit);

  return {
    audit: currentAudit,
    isLoading,
    error,
    activeTab,
    history,
    startAudit,
    setActiveTab,
    clearAudit,
  };
};
