/**
 * Git Panel — Plugin wrapper around the existing GitSidebar component.
 *
 * Maps PanelProps to GitSidebarProps, connecting the plugin system
 * to the existing UI component without modifying it.
 */

import { useCallback } from 'react';
import { GitSidebar } from '../../components/git-sidebar';
import type { PanelProps } from '../types';

export function GitPanel({ context, width, onResize, onClose }: PanelProps) {
  const { workspace, openFile, editorFilePath } = context;
  const git = workspace.git;

  const handleFileSelect = useCallback(
    (relativePath: string, commitHash?: string) => {
      if (!git) return;
      const absolutePath = `${git.projectRoot}/${relativePath}`;
      if (commitHash) {
        openFile(absolutePath, true, { commit: commitHash });
      } else {
        openFile(absolutePath, true, 'git-head');
      }
    },
    [git, openFile]
  );

  // Should not render if git context is unavailable (guarded by SidebarHost)
  if (!git) return null;

  return (
    <GitSidebar
      gitStatus={git.status}
      commits={git.commits}
      projectRoot={git.projectRoot}
      width={width}
      selectedPath={editorFilePath}
      onResize={onResize}
      onFileSelect={handleFileSelect}
      onClose={onClose}
    />
  );
}
