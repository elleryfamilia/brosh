export function PlansIcon({ size = 16 }: { size?: number }) {
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
    >
      {/* Row 1: checkmark + line */}
      <polyline points="2,4 3.5,5.5 5.5,3" />
      <line x1="8" y1="4" x2="14" y2="4" />
      {/* Row 2: circle + line */}
      <circle cx="3.75" cy="8" r="1.25" fill="currentColor" stroke="none" />
      <line x1="8" y1="8" x2="14" y2="8" />
      {/* Row 3: circle + line */}
      <circle cx="3.75" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <line x1="8" y1="12" x2="14" y2="12" />
    </svg>
  );
}
