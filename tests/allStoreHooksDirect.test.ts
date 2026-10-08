import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { initialModelState } from '@/stores/auth/models';
import { useAuditStore } from '@/stores/auditStore';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToolsStore } from '@/stores/toolsStore';
import { useUIStore } from '@/stores/uiStore';
import { useWorkspaceIndicatorsStore } from '@/stores/workspaceIndicatorsStore';

describe('all store hooks and models direct call assertions', () => {
  it('initialModelState returns idle status and model maps', () => {
    const state = initialModelState();
    expect(state.modelListStatus.openai).toBe('idle');
    expect(state.availableModels).toBeDefined();
  });

  it('useAuditStore hook initializes and returns state via direct hook invocation', () => {
    const { result, unmount } = renderHook(() => useAuditStore());
    expect(result.current).toBeDefined();
    unmount();
  });

  it('useAuthStore hook initializes and returns state via direct hook invocation', () => {
    const { result, unmount } = renderHook(() => useAuthStore());
    expect(result.current).toBeDefined();
    unmount();
  });

  it('useProjectStore hook initializes and returns state via direct hook invocation', () => {
    const { result, unmount } = renderHook(() => useProjectStore());
    expect(result.current).toBeDefined();
    unmount();
  });

  it('useSettingsStore hook initializes and returns state via direct hook invocation', () => {
    const { result, unmount } = renderHook(() => useSettingsStore());
    expect(result.current).toBeDefined();
    unmount();
  });

  it('useToolsStore hook initializes and returns state via direct hook invocation', () => {
    const { result, unmount } = renderHook(() => useToolsStore());
    expect(result.current).toBeDefined();
    unmount();
  });

  it('useUIStore hook initializes and returns state via direct hook invocation', () => {
    const { result, unmount } = renderHook(() => useUIStore());
    expect(result.current).toBeDefined();
    unmount();
  });

  it('useWorkspaceIndicatorsStore hook initializes and returns state via direct hook invocation', () => {
    const { result, unmount } = renderHook(() => useWorkspaceIndicatorsStore());
    expect(result.current).toBeDefined();
    unmount();
  });
});
