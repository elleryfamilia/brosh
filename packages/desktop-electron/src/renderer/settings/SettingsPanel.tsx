/**
 * Settings Panel Component
 *
 * Main settings UI panel with all configuration options.
 * Draggable panel with live preview for font settings.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSettings } from './useSettings';
import { SettingsSection } from './SettingsSection';
import {
  ToggleControl,
  SliderControl,
  ThemeSelector,
  FontSelector,
  CursorStyleSelector,
  SelectControl,
  LiveSelectControl,
  McpConfigControl,
} from './controls';
import {
  fontSizes,
  SCROLLBACK_MIN,
  SCROLLBACK_MAX,
  OPACITY_MIN,
  OPACITY_MAX,
} from './defaults';
import { trackSettingsChanged } from '../utils/analytics';
import type { UpdateStatus } from '../types/electron';

/**
 * Inline control for checking for updates in the Advanced section
 */
function UpdateCheckControl() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    window.terminalAPI.updaterGetStatus().then(setStatus).catch(() => {});
    const cleanup = window.terminalAPI.onUpdaterStatus((s) => {
      setStatus(s);
      if (s.state !== 'checking') setChecking(false);
    });
    return cleanup;
  }, []);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await window.terminalAPI.updaterCheck();
    } catch {
      setChecking(false);
    }
  };

  const version = status?.currentVersion || 'unknown';
  let statusText = `v${version}`;
  if (status?.state === 'available' || status?.state === 'downloaded') {
    statusText += ` → v${status.availableVersion}`;
  } else if (status?.state === 'not-available') {
    statusText += ' (up to date)';
  }

  return (
    <div className="settings-control" style={{ alignItems: 'center' }}>
      <div className="settings-control-info">
        <label className="settings-control-label">Version</label>
        <span className="settings-control-description">{statusText}</span>
      </div>
      <button
        type="button"
        className="settings-button"
        onClick={handleCheck}
        disabled={checking}
        style={{
          padding: '4px 12px',
          borderRadius: '4px',
          border: '1px solid var(--border)',
          background: 'var(--surface1)',
          color: 'var(--foreground)',
          cursor: checking ? 'wait' : 'pointer',
          fontSize: '12px',
          whiteSpace: 'nowrap',
        }}
      >
        {checking ? 'Checking...' : 'Check Now'}
      </button>
    </div>
  );
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { settings, updateSettings: baseUpdateSettings, resetSettings } = useSettings();
  const panelRef = useRef<HTMLDivElement>(null);

  // Wrap updateSettings to track changes
  const updateSettings = useCallback((updates: Parameters<typeof baseUpdateSettings>[0]) => {
    baseUpdateSettings(updates);
    // Track which section was changed
    const sections = Object.keys(updates);
    sections.forEach((section) => trackSettingsChanged(section));
  }, [baseUpdateSettings]);

  // Drag state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
  });

  // Check if Claude Code is installed
  const [claudeCodeInstalled, setClaudeCodeInstalled] = useState<boolean | null>(null);

  // Check Claude Code installation status when panel opens
  useEffect(() => {
    if (isOpen) {
      // @ts-expect-error - terminalAPI is injected by preload
      window.terminalAPI?.isClaudeCodeInstalled?.()
        .then((installed: boolean) => {
          setClaudeCodeInstalled(installed);
        })
        .catch((err: Error) => {
          console.error('Failed to check Claude Code status:', err);
          setClaudeCodeInstalled(false);
        });
    }
  }, [isOpen]);

  // Reset position when panel closes
  useEffect(() => {
    if (!isOpen) {
      setPosition(null);
    }
  }, [isOpen]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Mouse move handler for dragging
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const state = dragStateRef.current;
    if (!state.isDragging) return;

    const newX = e.clientX - state.offsetX;
    const newY = e.clientY - state.offsetY;

    setPosition({ x: newX, y: newY });
  }, []);

  // Mouse up handler to stop dragging
  const handleMouseUp = useCallback(() => {
    dragStateRef.current.isDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Set up global mouse listeners for dragging
  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isOpen, handleMouseMove, handleMouseUp]);

  // Start dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag on left click and on the header itself
    if (e.button !== 0) return;

    e.preventDefault();

    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();

    // Initialize position if not set (first drag)
    if (position === null) {
      setPosition({ x: rect.left, y: rect.top });
    }

    dragStateRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  if (!isOpen) return null;

  // Build font size options
  const fontSizeOptions = fontSizes.map((size) => ({
    value: String(size),
    label: `${size}px`,
  }));

  // Panel style - either positioned or centered
  const panelStyle: React.CSSProperties = position
    ? {
        position: 'fixed',
        left: position.x,
        top: position.y,
        transform: 'none',
      }
    : {};

  return (
    <div
      className={`settings-overlay ${position ? 'dragged' : ''}`}
      onClick={position ? undefined : onClose}
    >
      <div
        ref={panelRef}
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
        style={panelStyle}
      >
        <div
          className="settings-header"
          onMouseDown={handleMouseDown}
          style={{ cursor: dragStateRef.current.isDragging ? 'grabbing' : 'grab' }}
        >
          <h2 className="settings-title">Settings</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="Close settings"
            onMouseDown={(e) => e.stopPropagation()}
          >
            ×
          </button>
        </div>

        <div className="settings-content">
          {/* Appearance Section */}
          <SettingsSection title="Appearance" icon="🎨" defaultExpanded={true}>
            <ThemeSelector
              value={settings.appearance.theme}
              onChange={(theme) =>
                updateSettings({ appearance: { theme } })
              }
            />

            <FontSelector
              value={settings.appearance.fontFamily}
              onChange={(fontFamily) =>
                updateSettings({ appearance: { fontFamily } })
              }
            />

            <LiveSelectControl
              label="Font Size"
              value={String(settings.appearance.fontSize)}
              options={fontSizeOptions}
              onChange={(value) =>
                updateSettings({ appearance: { fontSize: Number(value) } })
              }
            />

            <ToggleControl
              label="Font Ligatures"
              description="Enable programming ligatures (e.g., =>, !=)"
              value={settings.appearance.fontLigatures}
              onChange={(fontLigatures) =>
                updateSettings({ appearance: { fontLigatures } })
              }
            />
          </SettingsSection>

          {/* Terminal Section */}
          <SettingsSection title="Terminal" icon="⌨️" defaultExpanded={true}>
            <CursorStyleSelector
              value={settings.terminal.cursorStyle}
              onChange={(cursorStyle) =>
                updateSettings({ terminal: { cursorStyle } })
              }
            />

            <ToggleControl
              label="Cursor Blink"
              description="Animate the cursor"
              value={settings.terminal.cursorBlink}
              onChange={(cursorBlink) =>
                updateSettings({ terminal: { cursorBlink } })
              }
            />

            <SliderControl
              label="Scrollback Lines"
              description="Number of lines to keep in history"
              value={settings.terminal.scrollbackLines}
              min={SCROLLBACK_MIN}
              max={SCROLLBACK_MAX}
              step={1000}
              onChange={(scrollbackLines) =>
                updateSettings({ terminal: { scrollbackLines } })
              }
            />

            <ToggleControl
              label="Bell Sound"
              description="Play sound on terminal bell"
              value={settings.terminal.bellSound}
              onChange={(bellSound) =>
                updateSettings({ terminal: { bellSound } })
              }
            />

            <ToggleControl
              label="Forward LC_CTYPE"
              description="Also set LC_CTYPE (in addition to LANG). May cause SSH locale errors on remote servers. Keep off to match iTerm2 behavior."
              value={settings.terminal.setLocaleEnv}
              onChange={(setLocaleEnv) =>
                updateSettings({ terminal: { setLocaleEnv } })
              }
            />

            <ToggleControl
              label="Always Ask Sandbox Mode"
              description="Prompt for direct or sandbox mode each time you open a new terminal. When off, new terminals reuse your last choice."
              value={settings.terminal.askModeForNewTerminals}
              onChange={(askModeForNewTerminals) =>
                updateSettings({ terminal: { askModeForNewTerminals } })
              }
            />
          </SettingsSection>

          {/* AI Assistant Section */}
          <SettingsSection title="AI Assistant (Claude Code)" icon="🤖" defaultExpanded={true}>
            {claudeCodeInstalled === false && (
              <div className="setting-warning">
                Claude Code CLI not installed. Install it with:<br />
                <code>npm install -g @anthropic-ai/claude-code</code>
              </div>
            )}

            <ToggleControl
              label="Enable AI Detection"
              description="Automatically detect natural language and invoke Claude Code"
              value={settings.ai?.enabled ?? true}
              onChange={(enabled) =>
                updateSettings({ ai: { enabled } })
              }
              disabled={claudeCodeInstalled === false}
            />

            <SelectControl
              label="Model"
              description="Claude model used for inline AI responses"
              value={settings.ai?.model ?? 'haiku'}
              options={[
                { value: 'haiku', label: 'Haiku', description: 'Fast and lightweight' },
                { value: 'sonnet', label: 'Sonnet', description: 'Balanced speed and quality' },
                { value: 'opus', label: 'Opus', description: 'Most capable' },
              ]}
              onChange={(model) => {
                updateSettings({ ai: { model } });
                window.terminalAPI.setClaudeModel(model);
              }}
              disabled={claudeCodeInstalled === false}
            />

            <ToggleControl
              label="Show AI Indicator"
              description="Display visual indicator when AI is responding"
              value={settings.ai?.showIndicator ?? true}
              onChange={(showIndicator) =>
                updateSettings({ ai: { showIndicator } })
              }
            />

            <ToggleControl
              label="Confirm Before Invoking"
              description="Ask for confirmation before sending to AI"
              value={settings.ai?.confirmBeforeInvoking ?? false}
              onChange={(confirmBeforeInvoking) =>
                updateSettings({ ai: { confirmBeforeInvoking } })
              }
            />

            <div className="setting-row">
              <div className="setting-label">
                <span className="setting-name">Denylist</span>
                <span className="setting-description">Commands to never interpret as natural language (comma-separated)</span>
              </div>
              <input
                type="text"
                className="setting-text-input"
                value={settings.ai?.denylist ?? ''}
                placeholder="e.g., gti, gco, dc"
                onChange={(e) =>
                  updateSettings({ ai: { denylist: e.target.value } })
                }
              />
            </div>

            <div className="setting-help">
              <strong>Usage tips:</strong>
              <ul>
                <li>Type naturally - AI detects questions automatically</li>
                <li>Prefix with <code>!</code> to force command mode: <code>!list files</code></li>
                <li>Prefix with <code>?</code> to force AI mode: <code>?git status</code></li>
                <li>Press <kbd>Ctrl+C</kbd> to cancel AI response</li>
                <li>Uses your Claude Pro/Max subscription - no extra API costs</li>
              </ul>
            </div>
          </SettingsSection>

          {/* Git Section */}
          <SettingsSection title="Git" icon="🔀" defaultExpanded={false}>
            <LiveSelectControl
              label="Close Diff on Directory Change"
              description="What to do with the diff panel when you cd to a different directory"
              value={settings.git?.closeDiffOnDirChange ?? 'ask'}
              options={[
                { value: 'ask', label: 'Ask me' },
                { value: 'close', label: 'Always close' },
                { value: 'keep', label: 'Always keep open' },
              ]}
              onChange={(value) => updateSettings({ git: { closeDiffOnDirChange: value as 'ask' | 'close' | 'keep' } })}
            />
          </SettingsSection>

          {/* Advanced Section */}
          <SettingsSection title="Advanced" icon="⚙️" defaultExpanded={false}>
            <ToggleControl
              label="GPU Acceleration"
              description="Use WebGL for faster rendering (restart terminal to apply)"
              value={settings.advanced.gpuAcceleration}
              onChange={(gpuAcceleration) =>
                updateSettings({ advanced: { gpuAcceleration } })
              }
            />

            <SliderControl
              label="Window Opacity"
              description="Transparency of the application window"
              value={settings.advanced.windowOpacity}
              min={OPACITY_MIN}
              max={OPACITY_MAX}
              unit="%"
              onChange={(windowOpacity) =>
                updateSettings({ advanced: { windowOpacity } })
              }
            />

            <ToggleControl
              label="Debug Mode"
              description="Show additional debugging information"
              value={settings.advanced.debugMode}
              onChange={(debugMode) =>
                updateSettings({ advanced: { debugMode } })
              }
            />

            <ToggleControl
              label="Auto Update"
              description="Automatically check for new versions on startup"
              value={settings.advanced.autoUpdate}
              onChange={(autoUpdate) =>
                updateSettings({ advanced: { autoUpdate } })
              }
            />

            <UpdateCheckControl />
          </SettingsSection>

          {/* MCP Configuration Section */}
          <SettingsSection title="MCP Configuration" icon="🔌" defaultExpanded={false}>
            <McpConfigControl />
          </SettingsSection>

          {/* Privacy Section */}
          <SettingsSection title="Privacy" icon="🔒" defaultExpanded={false}>
            <ToggleControl
              label="Analytics & Error Reporting"
              description="Help improve brosh by sending anonymous usage data and error reports"
              value={settings.privacy?.analyticsEnabled ?? true}
              onChange={(analyticsEnabled) => {
                updateSettings({ privacy: { analyticsEnabled } });
                // Sync to analytics store
                window.terminalAPI.analyticsSetConsent(analyticsEnabled).catch(console.error);
              }}
            />
            <div className="setting-help">
              <strong>What we collect:</strong>
              <ul>
                <li>App usage patterns (features used, session duration)</li>
                <li>Error reports (sanitized, no personal data)</li>
                <li>Platform info (OS, app version)</li>
              </ul>
              <strong>What we never collect:</strong>
              <ul>
                <li>Terminal content or commands</li>
                <li>File paths or working directories</li>
                <li>Personal data or credentials</li>
              </ul>
            </div>
          </SettingsSection>
        </div>

        <div className="settings-footer">
          <button
            type="button"
            className="settings-reset-btn"
            onClick={resetSettings}
          >
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
}
