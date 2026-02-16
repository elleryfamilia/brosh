/**
 * Git Icon Component
 *
 * Branch/git icon for git status indicator.
 */

interface GitIconProps {
  size?: number;
  className?: string;
}

export function GitIcon({ size = 14, className = "" }: GitIconProps) {
  return (
    <span className={`git-icon ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: "block" }}
      >
        {/* Git branch icon */}
        <line x1="4" y1="2" x2="4" y2="10" />
        <circle cx="12" cy="4" r="2" />
        <circle cx="4" cy="12" r="2" />
        <path d="M12 6a6 6 0 0 1-6 6" />
      </svg>
    </span>
  );
}
