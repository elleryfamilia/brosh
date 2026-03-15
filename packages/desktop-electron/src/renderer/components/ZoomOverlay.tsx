/**
 * Zoom Level Overlay
 *
 * Shows a brief centered overlay with the current zoom percentage
 * when the user zooms in/out. Fades out automatically.
 */

interface ZoomOverlayProps {
  percent: number | null;
}

export function ZoomOverlay({ percent }: ZoomOverlayProps) {
  if (percent === null) return null;

  return (
    <div className="zoom-overlay">
      {percent}%
    </div>
  );
}
