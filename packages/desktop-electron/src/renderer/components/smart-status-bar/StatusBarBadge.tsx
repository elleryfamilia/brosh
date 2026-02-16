/**
 * StatusBarBadge Component
 *
 * Generic badge component for the Smart Status Bar.
 * Supports various visual states and click interactions.
 */

import type { StatusBarBadgeProps } from './types';

export function StatusBarBadge({
  label,
  icon,
  variant = 'default',
  active = false,
  pulsing = false,
  onClick,
  title,
  className = '',
}: StatusBarBadgeProps) {
  const classes = [
    'status-bar-badge',
    `status-bar-badge--${variant}`,
    active ? 'status-bar-badge--active' : '',
    pulsing ? 'status-bar-badge--pulsing' : '',
    onClick ? 'status-bar-badge--clickable' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {icon && <span className="status-bar-badge__icon">{icon}</span>}
      <span className="status-bar-badge__label">{label}</span>
      {pulsing && <span className="status-bar-badge__pulse" />}
    </>
  );

  if (onClick) {
    return (
      <button
        className={classes}
        onClick={onClick}
        title={title}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <span className={classes} title={title}>
      {content}
    </span>
  );
}
