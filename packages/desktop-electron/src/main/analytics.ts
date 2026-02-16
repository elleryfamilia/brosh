/**
 * Analytics Module
 *
 * PostHog client wrapper for anonymous usage tracking and error reporting.
 * Runs only in the main process. Renderer proxies events via IPC.
 */

import { PostHog } from 'posthog-node';
import { app } from 'electron';
import {
  getAnalyticsEnabled,
  setAnalyticsEnabled as setStoreAnalyticsEnabled,
  getDistinctId,
} from './analytics-store.js';

// PostHog configuration
const POSTHOG_API_KEY = 'phc_v51aTKGdPqjojb3ve2Ohz6zIyCSZjYxNnS24L2ppm4J';
const POSTHOG_HOST = 'https://app.posthog.com';

// Singleton PostHog client
let posthogClient: PostHog | null = null;

// Track session start time for duration calculation
let sessionStartTime: number | null = null;

/**
 * Initialize the PostHog client if consent is given
 */
export function initAnalytics(): void {
  if (!getAnalyticsEnabled()) {
    console.log('[analytics] Analytics disabled by user preference');
    return;
  }

  if (posthogClient) {
    console.log('[analytics] Already initialized');
    return;
  }

  try {
    posthogClient = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      flushAt: 10,
      flushInterval: 30000, // 30 seconds
    });

    sessionStartTime = Date.now();
    console.log('[analytics] PostHog initialized');

    // Track app opened
    track('app_opened', {
      platform: process.platform,
      version: app.getVersion(),
      arch: process.arch,
      node_version: process.versions.node,
      electron_version: process.versions.electron,
    });
  } catch (err) {
    console.error('[analytics] Failed to initialize PostHog:', err);
  }
}

/**
 * Track an event (consent-aware)
 */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!getAnalyticsEnabled() || !posthogClient) {
    return;
  }

  try {
    posthogClient.capture({
      distinctId: getDistinctId(),
      event,
      properties: {
        ...properties,
        app_version: app.getVersion(),
      },
    });
  } catch (err) {
    console.error('[analytics] Failed to track event:', err);
  }
}

/**
 * Set analytics consent and reinitialize if enabled
 */
export function setConsentAndReinitialize(enabled: boolean): void {
  setStoreAnalyticsEnabled(enabled);

  if (enabled) {
    // Initialize if not already
    if (!posthogClient) {
      initAnalytics();
    }
  } else {
    // Shutdown and clear client
    if (posthogClient) {
      posthogClient.shutdown().catch(console.error);
      posthogClient = null;
    }
  }
}

/**
 * Track session end and shutdown PostHog
 * Call this before app quit
 */
export async function shutdown(): Promise<void> {
  if (!posthogClient) {
    return;
  }

  try {
    // Track session end with duration
    if (sessionStartTime) {
      const durationSeconds = Math.round((Date.now() - sessionStartTime) / 1000);
      track('session_ended', { duration_seconds: durationSeconds });
    }

    // Flush and shutdown
    await posthogClient.shutdown();
    posthogClient = null;
    console.log('[analytics] PostHog shutdown complete');
  } catch (err) {
    console.error('[analytics] Error during shutdown:', err);
  }
}

/**
 * Submit user feedback
 * This works even if analytics is disabled (feedback is explicit user action)
 */
export async function submitFeedback(
  category: string,
  message: string,
  email?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Create a temporary client if needed (for users with analytics disabled)
    const client = posthogClient || new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      flushAt: 1,
    });

    client.capture({
      distinctId: getDistinctId(),
      event: 'feedback_submitted',
      properties: {
        category,
        message,
        email: email || undefined,
        app_version: app.getVersion(),
        platform: process.platform,
      },
    });

    // If we created a temporary client, flush and shutdown
    if (!posthogClient) {
      await client.shutdown();
    }

    return { success: true };
  } catch (err) {
    console.error('[analytics] Failed to submit feedback:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
