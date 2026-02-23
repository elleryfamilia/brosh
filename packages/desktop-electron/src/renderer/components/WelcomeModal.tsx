/**
 * WelcomeModal Component
 *
 * Shown on first launch to welcome the user, collect analytics consent,
 * and check for Claude Code CLI installation.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import broshLogo from '../assets/brosh_logo.svg';

interface WelcomeModalProps {
  isOpen: boolean;
  onComplete: (analyticsEnabled: boolean) => void;
}

type Step = 'welcome' | 'claude-check';

export function WelcomeModal({ isOpen, onComplete }: WelcomeModalProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [logoVisible, setLogoVisible] = useState(false);
  const [step, setStep] = useState<Step>('welcome');
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Fade in logo when modal opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setLogoVisible(true);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setLogoVisible(false);
    }
  }, [isOpen]);

  const handleFinish = useCallback(() => {
    onComplete(analyticsEnabled);
  }, [onComplete, analyticsEnabled]);

  const handleContinueToClaudeCheck = useCallback(async () => {
    setStep('claude-check');
    setChecking(true);
    try {
      const status = await window.terminalAPI.getClaudeStatus();
      setClaudeInstalled(status.installed);
    } catch {
      // If check fails, assume not installed
      setClaudeInstalled(false);
    } finally {
      setChecking(false);
    }
  }, []);

  const handleInstallClaude = useCallback(() => {
    window.terminalAPI.openExternal('https://docs.anthropic.com/en/docs/claude-code/overview');
  }, []);

  // Focus dialog and handle keyboard
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (step === 'welcome') {
          handleContinueToClaudeCheck();
        } else {
          handleFinish();
        }
      }
    };

    // Focus dialog
    setTimeout(() => {
      dialogRef.current?.focus();
    }, 100);

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, step, handleContinueToClaudeCheck, handleFinish]);

  if (!isOpen) return null;

  return (
    <div className="welcome-modal-overlay">
      <div className={`welcome-logo-container ${logoVisible ? 'visible' : ''}`}>
        <img src={broshLogo} alt="brosh" className="welcome-logo" />
        <p className="welcome-logo-tagline">Your MCP-Enabled Sandboxed Terminal</p>
      </div>
      <div className="welcome-dialog" tabIndex={-1} ref={dialogRef}>
        {step === 'welcome' ? (
          <>
            <div className="welcome-content">
              <h1 className="welcome-title">Welcome to brosh</h1>
              <p className="welcome-subtitle">A terminal with AI superpowers</p>

              <div className="welcome-features">
                <div className="welcome-feature">
                  <span className="welcome-feature-icon">?</span>
                  <span className="welcome-feature-text">Type naturally - AI detects questions automatically</span>
                </div>
                <div className="welcome-feature">
                  <span className="welcome-feature-icon">!</span>
                  <span className="welcome-feature-text">Prefix with ! to force command mode</span>
                </div>
                <div className="welcome-feature">
                  <span className="welcome-feature-icon"></span>
                  <span className="welcome-feature-text">Connect AI agents via MCP</span>
                </div>
              </div>

              <div className="welcome-analytics">
                <label className="welcome-checkbox-label">
                  <input
                    type="checkbox"
                    checked={analyticsEnabled}
                    onChange={(e) => setAnalyticsEnabled(e.target.checked)}
                    className="welcome-checkbox"
                  />
                  <span className="welcome-checkbox-text">
                    Help improve brosh by sending anonymous usage data
                  </span>
                </label>
                <div className="welcome-analytics-details">
                  <p className="welcome-analytics-what">
                    <strong>What we collect:</strong> App usage patterns, errors, and feature usage
                  </p>
                  <p className="welcome-analytics-not">
                    <strong>Never collected:</strong> Terminal content, commands, file paths, or personal data
                  </p>
                  <p className="welcome-analytics-note">
                    You can change this anytime in Settings
                  </p>
                </div>
              </div>
            </div>

            <div className="welcome-footer">
              <button
                className="welcome-button"
                onClick={handleContinueToClaudeCheck}
              >
                Continue
              </button>
              <span className="welcome-hint">Press Enter to continue</span>
            </div>
          </>
        ) : (
          <>
            <div className="welcome-content">
              <h1 className="welcome-title">Claude Code</h1>
              <p className="welcome-subtitle">
                brosh is designed to work hand-in-hand with Claude Code
              </p>

              <div className="welcome-claude-info">
                <p className="welcome-claude-description">
                  Claude Code is Anthropic's AI coding assistant that runs in your terminal.
                  brosh depends on Claude Code to provide its full functionality.
                </p>
              </div>

              {checking ? (
                <div className="welcome-claude-status">
                  <span className="welcome-claude-status-icon checking"></span>
                  <span className="welcome-claude-status-text">Checking for Claude Code...</span>
                </div>
              ) : claudeInstalled ? (
                <div className="welcome-claude-status installed">
                  <span className="welcome-claude-status-icon installed"></span>
                  <span className="welcome-claude-status-text">Claude Code is installed</span>
                </div>
              ) : (
                <div className="welcome-claude-install">
                  <div className="welcome-claude-status not-installed">
                    <span className="welcome-claude-status-icon not-installed"></span>
                    <span className="welcome-claude-status-text">Claude Code is not installed</span>
                  </div>
                  <p className="welcome-claude-install-hint">
                    Install it to unlock AI-powered terminal features:
                  </p>
                  <div className="welcome-claude-install-cmd">
                    <code>npm install -g @anthropic-ai/claude-code</code>
                  </div>
                  <button
                    className="welcome-button-secondary"
                    onClick={handleInstallClaude}
                  >
                    View install instructions
                  </button>
                </div>
              )}
            </div>

            <div className="welcome-footer">
              <button
                className="welcome-button"
                onClick={handleFinish}
              >
                {claudeInstalled ? 'Get Started' : 'Skip for now'}
              </button>
              <span className="welcome-hint">Press Enter to continue</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
