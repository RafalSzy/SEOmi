import { useEffect } from 'react';
import { useAuditStore } from '@/stores/auditStore';
import { useUIStore } from '@/stores/uiStore';
import { TabType } from '@/types';

const TAB_INDEX_MAP: Record<string, TabType> = {
  '1': 'overview',
  '2': 'social',
  '3': 'headings',
  '4': 'metadata',
  '5': 'images',
  '6': 'links',
  '7': 'security',
  '8': 'performance',
};

export const useKeyboardShortcuts = () => {
  const currentAudit = useAuditStore((s) => s.currentAudit);
  const startAudit = useAuditStore((s) => s.startAudit);
  const setActiveTab = useAuditStore((s) => s.setActiveTab);
  const openModal = useUIStore((s) => s.openModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const activeModal = useUIStore((s) => s.activeModal);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + K: Focus URL input
      if (isCmdOrCtrl && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = document.getElementById('url-input-field');
        input?.focus();
        return;
      }

      // Cmd/Ctrl + Shift + P: open project-aware workspace navigation.
      // Cmd/Ctrl + K remains reserved for the URL audit input.
      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      // Cmd/Ctrl + R: Re-run audit
      if (isCmdOrCtrl && e.key.toLowerCase() === 'r') {
        if (currentAudit?.url) {
          e.preventDefault();
          startAudit(currentAudit.url);
        }
        return;
      }

      // Cmd/Ctrl + ,: Open settings
      if (isCmdOrCtrl && e.key === ',') {
        e.preventDefault();
        openModal('settings');
        return;
      }

      // Cmd/Ctrl + I: Open AI assistant
      if (isCmdOrCtrl && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        openModal('ai');
        return;
      }

      // Esc: Dismiss active modal
      if (e.key === 'Escape') {
        if (activeModal) {
          e.preventDefault();
          closeModal();
        }
        return;
      }

      // Cmd/Ctrl + 1..8: Quick tab jump
      if (isCmdOrCtrl && TAB_INDEX_MAP[e.key]) {
        e.preventDefault();
        setActiveTab(TAB_INDEX_MAP[e.key]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentAudit, startAudit, setActiveTab, openModal, closeModal, openCommandPalette, activeModal]);
};
