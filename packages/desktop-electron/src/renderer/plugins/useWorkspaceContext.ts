/**
 * useWorkspaceContext Hook
 *
 * Reshapes existing App.tsx state into a WorkspaceContext object.
 * Does NOT introduce new data fetching — just reorganizes what App.tsx already has.
 */

import { useMemo } from 'react';
import type { WorkspaceContext } from './types';
import type { GitStatus, GitCommit } from '../components/smart-status-bar/types';

interface WorkspaceContextParams {
  gitStatus: GitStatus | null;
  gitCommits: GitCommit[] | null;
  projectRoot: string | null;
  focusedSessionId: string | null;
  cwd: string | null;
}

export function useWorkspaceContext(params: WorkspaceContextParams): WorkspaceContext {
  const { gitStatus, gitCommits, projectRoot, focusedSessionId, cwd } = params;

  return useMemo<WorkspaceContext>(() => {
    const git =
      gitStatus && projectRoot
        ? { status: gitStatus, commits: gitCommits, projectRoot }
        : null;

    return {
      git,
      focusedSessionId,
      cwd,
    };
  }, [gitStatus, gitCommits, projectRoot, focusedSessionId, cwd]);
}
