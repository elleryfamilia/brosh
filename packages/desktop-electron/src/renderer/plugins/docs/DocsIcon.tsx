export function DocsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 1h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
      <line x1="5.5" y1="5" x2="10.5" y2="5" />
      <line x1="5.5" y1="8" x2="10.5" y2="8" />
      <line x1="5.5" y1="11" x2="8.5" y2="11" />
    </svg>
  );
}
