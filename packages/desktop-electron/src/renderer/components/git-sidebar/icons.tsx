/**
 * SVG Icon Components for Git Sidebar
 */

interface IconProps {
  size?: number;
  className?: string;
}

export function BranchIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "block" }}
    >
      <line x1="5" y1="3" x2="5" y2="10" />
      <circle cx="5" cy="12.5" r="1.5" />
      <circle cx="11" cy="5.5" r="1.5" />
      <path d="M11 7a5 5 0 0 1-5 5" />
    </svg>
  );
}

export function CheckIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "block" }}
    >
      <polyline points="3 8 6.5 11.5 13 5" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 12, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "block" }}
    >
      <polyline points="6 3 11 8 6 13" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "block" }}
    >
      <polyline points="3 6 8 11 13 6" />
    </svg>
  );
}

export function CloseIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className={className}
      style={{ display: "block" }}
    >
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

// File status indicator icons
export function FileStatusIcon({ status, size = 12 }: { status: string; size?: number }) {
  const color = getStatusColor(status);
  const label = status === '?' ? 'U' : status;
  return (
    <span
      className="file-status-icon"
      style={{ color, fontFamily: "monospace", fontSize: size, fontWeight: 600, width: size + 2, textAlign: "center", display: "inline-block" }}
    >
      {label}
    </span>
  );
}

export function CommitIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "block" }}
    >
      <circle cx="8" cy="8" r="3" />
      <line x1="8" y1="1" x2="8" y2="5" />
      <line x1="8" y1="11" x2="8" y2="15" />
    </svg>
  );
}

export function SnapshotIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "block" }}
    >
      <circle cx="8" cy="8" r="6.5" />
      <polyline points="8 4 8 8 11 10" />
    </svg>
  );
}

export function SparkleIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      style={{ display: "block" }}
    >
      <path d="M8 1l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z" />
    </svg>
  );
}

export function DiskIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "block" }}
    >
      <path d="M4 2h8l2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M10 2v4H6V2" />
      <rect x="5" y="9" width="6" height="3" rx="0.5" />
    </svg>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'A': return 'var(--status-success)';
    case 'M': return 'var(--status-warning)';
    case 'D': return 'var(--status-error)';
    case 'R': return 'var(--accent)';
    case '?': return 'var(--fg-secondary, #888)';
    case 'U': return 'var(--status-error)';
    default: return 'var(--fg-secondary, #888)';
  }
}
