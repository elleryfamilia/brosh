/**
 * Analytics Utilities for Renderer Process
 *
 * Helper functions for tracking events from the renderer.
 * All calls are proxied to the main process via IPC.
 */

/**
 * Track an analytics event
 * @param event - Event name (e.g., 'terminal_created', 'settings_changed')
 * @param properties - Optional event properties
 */
export function track(event: string, properties?: Record<string, unknown>): void {
  window.terminalAPI.analyticsTrack(event, properties).catch((err) => {
    console.error('[analytics] Failed to track event:', err);
  });
}

/**
 * Track a terminal creation event
 */
export function trackTerminalCreated(mode: 'direct' | 'sandbox', isSplit: boolean = false): void {
  track('terminal_created', { mode, is_split: isSplit });
}

/**
 * Track MCP attachment state change
 */
export function trackMcpAttachment(attached: boolean): void {
  track(attached ? 'mcp_attached' : 'mcp_detached');
}

/**
 * Track settings change
 */
export function trackSettingsChanged(section: string): void {
  track('settings_changed', { section });
}
