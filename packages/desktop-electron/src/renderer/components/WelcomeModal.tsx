/**
 * WelcomeModal Component
 *
 * Shown on first launch to welcome the user and collect analytics consent.
 * Opt-in by default (checkbox pre-checked), user can uncheck to disable.
 */

import { useState, useEffect, useRef } from 'react';
import broshLogo from '../assets/brosh_logo.svg';

interface WelcomeModalProps {
  isOpen: boolean;
  onComplete: (analyticsEnabled: boolean) => void;
}

export function WelcomeModal({ isOpen, onComplete }: WelcomeModalProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [logoVisible, setLogoVisible] = useState(false);
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

  // Focus dialog and handle keyboard
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onComplete(analyticsEnabled);
      }
    };

    // Focus dialog
    setTimeout(() => {
      dialogRef.current?.focus();
    }, 100);

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, analyticsEnabled, onComplete]);

  if (!isOpen) return null;

  return (
    <div className="welcome-modal-overlay">
      <div className={`welcome-logo-container ${logoVisible ? 'visible' : ''}`}>
        <img src={broshLogo} alt="brosh" className="welcome-logo" />
        <p className="welcome-logo-tagline">Your MCP-Enabled Sandboxed Terminal</p>
      </div>
      <div className="welcome-dialog" tabIndex={-1} ref={dialogRef}>
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
            onClick={() => onComplete(analyticsEnabled)}
          >
            Get Started
          </button>
          <span className="welcome-hint">Press Enter to continue</span>
        </div>
      </div>
    </div>
  );
}
