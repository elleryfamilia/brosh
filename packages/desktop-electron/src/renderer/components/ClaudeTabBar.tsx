/**
 * Claude Tab Bar Component
 *
 * Horizontal tab strip for the Claude panel. Only rendered when
 * there are 2+ tabs. Shows tab labels, active indicator, close
 * buttons, and a "+" button with worktree picker.
 */

import type { ClaudeTab, GitWorktree } from "../types/claude-tab";
import { ClaudeWorktreePicker } from "./ClaudeWorktreePicker";

interface ClaudeTabBarProps {
  tabs: ClaudeTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: (worktree?: GitWorktree) => void;
}

export function ClaudeTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
}: ClaudeTabBarProps) {
  return (
    <div className="claude-panel-tab-bar" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`claude-panel-tab ${tab.id === activeTabId ? "active" : ""} ${tab.exited ? "exited" : ""}`}
          onClick={() => onSelectTab(tab.id)}
        >
          <span className="claude-panel-tab-label" title={tab.cwd}>
            {tab.worktreeName ? (
              <span className="claude-panel-tab-branch">{tab.worktreeName}</span>
            ) : (
              tab.label
            )}
          </span>
          <button
            className="claude-panel-tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            title="Close tab"
            type="button"
          >
            ×
          </button>
        </div>
      ))}
      <ClaudeWorktreePicker
        tabs={tabs}
        onAddTab={onAddTab}
        buttonClassName="claude-panel-tab-add"
        currentCwd={tabs.find((t) => t.id === activeTabId)?.cwd}
      />
    </div>
  );
}
