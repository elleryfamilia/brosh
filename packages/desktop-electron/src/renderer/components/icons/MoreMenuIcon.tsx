/**
 * More Menu Icon (three horizontal dots)
 *
 * SVG icon matching solar:menu-dots-bold style.
 */

interface MoreMenuIconProps {
  size?: number;
  className?: string;
}

export function MoreMenuIcon({ size = 16, className = "" }: MoreMenuIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block" }}
    >
      <path d="M7 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0m7 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0m7 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0" />
    </svg>
  );
}
