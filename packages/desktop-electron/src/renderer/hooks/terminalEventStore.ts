/**
 * Terminal Event Store
 *
 * Centralizes terminal:message IPC handling into a single subscription.
 * Components subscribe by message type, so high-frequency "output" events
 * only dispatch to Terminal.tsx — not to every listener in the renderer.
 */

export type TerminalMessageType =
  | 'output'
  | 'session-closed'
  | 'cwd-changed'
  | 'process-changed'
  | 'title-changed'
  | 'command-mark'
  | 'error-detected'
  | 'error-dismissed'
  | 'resize';

type Listener = (msg: unknown) => void;

class TerminalEventStore {
  private listeners = new Map<TerminalMessageType, Set<Listener>>();
  private cleanup: (() => void) | null = null;

  /** Start the single global IPC subscription. Call once at app mount. */
  start(): void {
    if (this.cleanup) return;
    this.cleanup = window.terminalAPI.onMessage((message: unknown) => {
      const msg = message as { type?: string };
      if (!msg.type) return;
      const typeListeners = this.listeners.get(msg.type as TerminalMessageType);
      if (typeListeners) {
        for (const listener of typeListeners) {
          listener(message);
        }
      }
    });
  }

  /** Subscribe to a specific message type. Returns unsubscribe function. */
  subscribe(type: TerminalMessageType, listener: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  /** Subscribe to multiple message types with one listener. Returns unsubscribe function. */
  subscribeMany(types: TerminalMessageType[], listener: Listener): () => void {
    const cleanups = types.map((type) => this.subscribe(type, listener));
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }

  /** Stop the global subscription (e.g., on app unmount). */
  stop(): void {
    this.cleanup?.();
    this.cleanup = null;
  }
}

/** Singleton instance — import and use directly. */
export const terminalEvents = new TerminalEventStore();
