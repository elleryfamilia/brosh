/**
 * Analytics Store
 *
 * Persistent storage for analytics consent and distinctId.
 * This store is separate from settings-store to ensure consent
 * and identity persist even when settings are reset.
 */

import Store from 'electron-store';
import { randomUUID } from 'crypto';

/**
 * Analytics store schema
 */
interface AnalyticsStoreSchema {
  /**
   * Whether the user has seen the welcome modal
   */
  hasSeenWelcome: boolean;

  /**
   * Whether analytics are enabled (consent given)
   * Default: true (opt-in by default, user can uncheck)
   */
  analyticsEnabled: boolean;

  /**
   * Anonymous distinct ID for PostHog
   * Generated once and persisted forever
   */
  distinctId: string;
}

/**
 * Analytics store instance
 */
const store = new Store<AnalyticsStoreSchema>({
  name: 'analytics',
  defaults: {
    hasSeenWelcome: false,
    analyticsEnabled: true, // Opt-in by default
    distinctId: randomUUID(), // Generate on first access
  },
});

/**
 * Check if user has seen the welcome modal
 */
export function hasSeenWelcome(): boolean {
  return store.get('hasSeenWelcome');
}

/**
 * Mark the welcome modal as seen
 */
export function markWelcomeSeen(): void {
  store.set('hasSeenWelcome', true);
}

/**
 * Get analytics enabled state
 */
export function getAnalyticsEnabled(): boolean {
  return store.get('analyticsEnabled');
}

/**
 * Set analytics enabled state
 */
export function setAnalyticsEnabled(enabled: boolean): void {
  store.set('analyticsEnabled', enabled);
}

/**
 * Get the anonymous distinct ID
 * This is generated once and persisted forever
 */
export function getDistinctId(): string {
  return store.get('distinctId');
}
