/**
 * Git Modal Component
 *
 * Shows git status details - informational only, no action buttons.
 */

import { StatusBarModal } from '../StatusBarModal';
import type { GitStatus, GitFileChange } from '../types';
import { BranchIcon, CheckIcon } from '../../git-sidebar/icons';

interface GitModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: GitStatus;
}

// Get display label for file status
function getStatusLabel(status: GitFileChange['status']): string {
  switch (status) {
    case 'A': return 'A';  // Added
    case 'M': return 'M';  // Modified
    case 'D': return 'D';  // Deleted
    case 'R': return 'R';  // Renamed
    case '?': return '?';  // Untracked
    case 'U': return 'U';  // Unmerged
    default: return '?';
  }
}

// Get CSS class for file status
function getStatusClass(status: GitFileChange['status']): string {
  switch (status) {
    case 'A': return 'git-modal__file--added';
    case 'M': return 'git-modal__file--modified';
    case 'D': return 'git-modal__file--deleted';
    case 'R': return 'git-modal__file--renamed';
    case '?': return 'git-modal__file--untracked';
    case 'U': return 'git-modal__file--unmerged';
    default: return '';
  }
}

export function GitModal({ isOpen, onClose, status }: GitModalProps) {
  const { branch, dirty, ahead, behind, files } = status;

  return (
    <StatusBarModal isOpen={isOpen} onClose={onClose} title="Git Status" width={400}>
      <div className="git-modal">
        {/* Branch info */}
        <div className="git-modal__branch">
          <span className="git-modal__branch-icon"><BranchIcon size={16} /></span>
          <span className="git-modal__branch-name">{branch}</span>
        </div>

        {/* Sync status */}
        {(ahead > 0 || behind > 0) && (
          <div className="git-modal__sync">
            {ahead > 0 && (
              <span className="git-modal__sync-ahead">
                {'\u2191'} {ahead} ahead
              </span>
            )}
            {behind > 0 && (
              <span className="git-modal__sync-behind">
                {'\u2193'} {behind} behind
              </span>
            )}
          </div>
        )}

        {/* File list */}
        {dirty && files.length > 0 && (
          <div className="git-modal__files">
            <div className="git-modal__files-header">
              Changes ({files.length} file{files.length !== 1 ? 's' : ''})
            </div>
            <div className="git-modal__files-list">
              {files.map((file) => (
                <div
                  key={file.path}
                  className={`git-modal__file ${getStatusClass(file.status)}`}
                >
                  <span className="git-modal__file-status">
                    {getStatusLabel(file.status)}
                  </span>
                  <span className="git-modal__file-path" title={file.path}>
                    {file.path}
                  </span>
                  {(file.additions > 0 || file.deletions > 0) && (
                    <span className="git-modal__file-stats">
                      {file.additions > 0 && (
                        <span className="git-modal__file-additions">+{file.additions}</span>
                      )}
                      {file.deletions > 0 && (
                        <span className="git-modal__file-deletions">-{file.deletions}</span>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!dirty && (
          <div className="git-modal__clean">
            <span className="git-modal__clean-icon"><CheckIcon size={16} /></span>
            <span>Working tree clean</span>
          </div>
        )}
      </div>
    </StatusBarModal>
  );
}
