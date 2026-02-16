/**
 * StatusBarModal Component
 *
 * Modal wrapper for status bar badge details.
 * Positioned above the status bar with a pointer arrow.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { StatusBarModalProps } from './types';

export function StatusBarModal({
  isOpen,
  onClose,
  title,
  children,
  position = 'bottom-left',
  width = 320,
}: StatusBarModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, handleClickOutside, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="status-bar-modal-overlay">
      <div
        ref={modalRef}
        className={`status-bar-modal status-bar-modal--${position}`}
        style={{ width }}
      >
        <div className="status-bar-modal__header">
          <span className="status-bar-modal__title">{title}</span>
          <button
            className="status-bar-modal__close"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="status-bar-modal__content">{children}</div>
      </div>
    </div>
  );
}
