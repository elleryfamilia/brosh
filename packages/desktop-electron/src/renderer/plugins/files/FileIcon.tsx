/**
 * FileIcon — Maps filenames to Material-style file type icons
 *
 * Uses material-file-icons for rich SVG icons. Renders inline via
 * dangerouslySetInnerHTML. This is safe because the SVG content comes
 * exclusively from the bundled material-file-icons npm package (static
 * data compiled at build time), never from user input or external sources.
 */

import { useMemo } from 'react';
import { getIcon } from 'material-file-icons';

interface FileIconProps {
  filename: string;
  size?: number;
}

export function FileIcon({ filename, size = 16 }: FileIconProps) {
  // Safe: SVG comes from bundled material-file-icons package, not user input
  const svgHtml = useMemo(() => {
    const icon = getIcon(filename);
    return { __html: icon.svg };
  }, [filename]);

  return (
    <span
      className="files-icon"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={svgHtml}
    />
  );
}

/** Simple chevron SVG for directory expand/collapse */
export function ChevronIcon({ expanded, size = 14 }: { expanded: boolean; size?: number }) {
  return (
    <svg
      className={`files-tree-chevron ${expanded ? 'files-tree-chevron--expanded' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6,4 10,8 6,12" />
    </svg>
  );
}

/** Simple folder icon (open or closed) */
export function FolderIcon({ open, size = 16 }: { open?: boolean; size?: number }) {
  return (
    <svg
      className="files-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {open ? (
        <path d="M2 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5H13a1 1 0 0 1 1 1v1H5.5L3 12H2a1 1 0 0 1-1-1V4.5zM5.5 7l-2.5 6H12l2-6H5.5z" />
      ) : (
        <path d="M2 3.5h4.5l1.5 1.5H14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
      )}
    </svg>
  );
}
