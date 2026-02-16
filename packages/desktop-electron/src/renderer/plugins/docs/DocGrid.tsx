/**
 * DocGrid — Document browser grouped by directory
 *
 * Uses exact icons from Figma design:
 * - material-symbols-light:folder-rounded for directories
 * - ph:file-md (Phosphor) for markdown files
 */

import type { DocFile } from './useDocsData';

interface DocGridProps {
  files: DocFile[];
  selectedPath: string | null;
  onSelect: (relativePath: string) => void;
}

/** material-symbols-light:folder-rounded (from Figma) */
function FolderIcon() {
  return (
    <svg className="ctx-folder-icon" width="16" height="16" viewBox="0 0 150 150" fill="#FEBC2E" xmlns="http://www.w3.org/2000/svg">
      <path d="M28.85 118.75c-2.88 0-5.28-.96-7.21-2.89-1.92-1.92-2.89-4.33-2.89-7.21V41.35c0-2.88.96-5.28 2.89-7.21 1.93-1.92 4.33-2.89 7.21-2.89h26.93c1.35 0 2.66.27 3.93.81 1.27.55 2.36 1.28 3.26 2.18l9.51 9.51h48.68c2.88 0 5.28.96 7.21 2.89 1.93 1.93 2.89 4.33 2.89 7.21v54.81c0 2.88-.96 5.28-2.89 7.21-1.92 1.93-4.33 2.89-7.21 2.89H28.85z" />
    </svg>
  );
}

/** ph:file-md — Phosphor markdown file icon (from Figma) */
function MdFileIcon() {
  return (
    <svg className="ctx-mdfile-icon" width="14" height="14" viewBox="0 0 100 100" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M83.46 32.16L61.59 10.29C61.3 10 60.95.77 60.57.61 60.19.46 59.79.37 59.38.37H21.88C20.22.37 18.63 1.03 17.46 2.21 16.28 3.38 15.63 4.97 15.63 6.63V43.75c0 .83.33 1.62.92 2.21.59.59 1.38.92 2.21.92s1.62-.33 2.21-.92c.59-.59.92-1.38.92-2.21V15.63H56.25V34.38c0 .83.33 1.62.92 2.21.59.59 1.38.92 2.21.92h18.75V87.5c0 .83.33 1.62.92 2.21.59.59 1.38.92 2.21.92s1.62-.33 2.21-.92c.59-.59.92-1.38.92-2.21V34.38c0-.41-.08-.82-.24-1.2-.16-.38-.39-.72-.68-1.02zM62.5 20.04L73.71 31.25H62.5V20.04zM56.25 56.25H50c-.83 0-1.62.33-2.21.92-.59.59-.92 1.38-.92 2.21v21.88c0 .83.33 1.62.92 2.21.59.59 1.38.92 2.21.92h6.25c3.73 0 7.31-1.48 9.94-4.12 2.64-2.64 4.12-6.21 4.12-9.94s-1.48-7.31-4.12-9.94c-2.64-2.64-6.21-4.12-9.94-4.12zm0 21.88h-3.13V62.5h3.13c2.07 0 4.06.82 5.52 2.29 1.47 1.47 2.29 3.45 2.29 5.52s-.82 4.06-2.29 5.52c-1.47 1.47-3.45 2.29-5.52 2.29zm-15.63-18.75v21.88c0 .83-.33 1.62-.92 2.21-.59.59-1.38.92-2.21.92s-1.62-.33-2.21-.92c-.59-.59-.92-1.38-.92-2.21V69.29l-5.24 7.5c-.29.41-.67.75-1.12.98-.45.23-.94.35-1.44.35s-.99-.12-1.44-.35c-.45-.23-.83-.57-1.12-.98L18.75 69.29V81.25c0 .83-.33 1.62-.92 2.21-.59.59-1.38.92-2.21.92s-1.62-.33-2.21-.92c-.59-.59-.92-1.38-.92-2.21V59.38c0-.66.21-1.31.61-1.85.39-.54.94-.93 1.58-1.13.63-.2 1.31-.19 1.94.01.63.21 1.18.62 1.56 1.17l8.38 11.97 8.38-11.97c.38-.54.93-.96 1.56-1.17.63-.21 1.31-.22 1.94-.01.63.2 1.18.59 1.58 1.13.39.54.61 1.19.61 1.85z" />
    </svg>
  );
}

function groupByDirectory(files: DocFile[]): Map<string, DocFile[]> {
  const groups = new Map<string, DocFile[]>();
  for (const file of files) {
    const existing = groups.get(file.dir);
    if (existing) {
      existing.push(file);
    } else {
      groups.set(file.dir, [file]);
    }
  }
  return groups;
}

export function DocGrid({ files, selectedPath, onSelect }: DocGridProps) {
  const groups = groupByDirectory(files);

  if (files.length === 0) {
    return (
      <div className="docs-grid-empty">
        No markdown files found
      </div>
    );
  }

  // Sort directories: root first, then alphabetical
  const sortedDirs = [...groups.keys()].sort((a, b) => {
    if (a === '' && b !== '') return -1;
    if (a !== '' && b === '') return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="ctx-docgrid">
      {sortedDirs.map((dir) => {
        const dirFiles = groups.get(dir)!;
        return (
          <div key={dir} className="ctx-docgrid-group">
            <div className="ctx-docgrid-folder">
              <FolderIcon />
              <span className="ctx-docgrid-dirname">
                {dir === '' ? '/' : `${dir}/`}
              </span>
            </div>
            <div className="ctx-docgrid-files">
              {dirFiles.map((file) => (
                <button
                  key={file.relativePath}
                  className={`ctx-docgrid-file${
                    selectedPath === file.relativePath ? ' ctx-docgrid-file--selected' : ''
                  }`}
                  onClick={() => onSelect(file.relativePath)}
                  title={file.relativePath}
                  type="button"
                >
                  <MdFileIcon />
                  <span className="ctx-docgrid-filename">{file.name}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
