import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceHash,
  parseWorkspaceHash,
  WORKSPACE_DEEP_LINK_TABS,
} from '@/services/workspaceDeepLink';

describe('workspace deep links', () => {
  it('round-trips every supported workspace tab', () => {
    for (const tab of WORKSPACE_DEEP_LINK_TABS) {
      const hash = buildWorkspaceHash({ projectId: 'project-a', tab });
      expect(parseWorkspaceHash(hash)).toEqual({ projectId: 'project-a', tab });
    }
  });

  it('rejects malformed, unknown, and unsafe destinations', () => {
    expect(parseWorkspaceHash('#other?project=project-a&tab=overview')).toBeNull();
    expect(parseWorkspaceHash('#workspace?project=missing%2Fslash&tab=overview')).toBeNull();
    expect(parseWorkspaceHash('#workspace?project=project-a&tab=unknown')).toBeNull();
    expect(buildWorkspaceHash({ projectId: 'project/a', tab: 'overview' })).toBe('');
  });

  it('decodes encoded project identifiers without accepting extra fields', () => {
    const hash = buildWorkspaceHash({ projectId: 'project-a', tab: 'site-audit' });
    expect(parseWorkspaceHash(`${hash}&unexpected=ignored`)).toEqual({
      projectId: 'project-a',
      tab: 'site-audit',
    });
  });
});

