/**
 * FeedbackModal Component
 *
 * Modal for collecting user feedback.
 * Supports bug reports, feature requests, and general feedback.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

type FeedbackCategory = 'bug' | 'feature' | 'general';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitSuccess?: () => void;
}

export function FeedbackModal({ isOpen, onClose, onSubmitSuccess }: FeedbackModalProps) {
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setCategory('general');
      setMessage('');
      setEmail('');
      setSubmitError(null);
      setIsSubmitting(false);

      // Focus textarea after a short delay
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      // Cmd/Ctrl + Enter to submit
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && message.trim()) {
        e.preventDefault();
        handleSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, message, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await window.terminalAPI.analyticsSubmitFeedback(
        category,
        message.trim(),
        email.trim() || undefined
      );

      if (result.success) {
        onSubmitSuccess?.();
        onClose();
      } else {
        setSubmitError(result.error || 'Failed to submit feedback');
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setIsSubmitting(false);
    }
  }, [category, message, email, isSubmitting, onClose, onSubmitSuccess]);

  if (!isOpen) return null;

  const categoryLabels: Record<FeedbackCategory, string> = {
    bug: 'Bug Report',
    feature: 'Feature Request',
    general: 'General',
  };

  return (
    <div className="feedback-modal-overlay" onClick={onClose}>
      <div
        className="feedback-modal"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="feedback-modal-header">
          <h2>Send Feedback</h2>
          <button
            className="feedback-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div className="feedback-modal-content">
          <div className="feedback-form-group">
            <label className="feedback-form-label">Category</label>
            <div className="feedback-category-buttons">
              {(['bug', 'feature', 'general'] as FeedbackCategory[]).map((cat) => (
                <button
                  key={cat}
                  className={`feedback-category-btn ${category === cat ? 'active' : ''}`}
                  onClick={() => setCategory(cat)}
                >
                  {categoryLabels[cat]}
                </button>
              ))}
            </div>
          </div>

          <div className="feedback-form-group">
            <label className="feedback-form-label">Message</label>
            <textarea
              ref={textareaRef}
              className="feedback-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                category === 'bug'
                  ? "Describe what happened and what you expected..."
                  : category === 'feature'
                  ? "Describe the feature you'd like to see..."
                  : "Share your thoughts..."
              }
            />
          </div>

          <div className="feedback-form-group">
            <label className="feedback-form-label optional">Email</label>
            <input
              type="email"
              className="feedback-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com (for follow-up)"
            />
          </div>

          {submitError && (
            <div className="feedback-form-group">
              <p style={{ color: 'var(--status-error)', fontSize: '12px', margin: 0 }}>
                {submitError}
              </p>
            </div>
          )}
        </div>

        <div className="feedback-modal-footer">
          <button className="feedback-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="feedback-submit-btn"
            onClick={handleSubmit}
            disabled={!message.trim() || isSubmitting}
          >
            {isSubmitting ? 'Sending...' : 'Send Feedback'}
          </button>
        </div>
      </div>
    </div>
  );
}
