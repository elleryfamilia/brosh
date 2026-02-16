/**
 * CrashReporterProvider
 *
 * Provides global error handling and shows the crash reporter modal
 * for uncaught errors outside of React's error boundary.
 */

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { CrashReporterModal } from './CrashReporterModal';

interface CrashReporterContextType {
  reportError: (error: Error, context?: string) => void;
}

const CrashReporterContext = createContext<CrashReporterContextType>({
  reportError: () => {},
});

export function useCrashReporter() {
  return useContext(CrashReporterContext);
}

interface CrashReporterProviderProps {
  children: ReactNode;
}

export function CrashReporterProvider({ children }: CrashReporterProviderProps) {
  const [error, setError] = useState<Error | null>(null);
  const [errorContext, setErrorContext] = useState<string | undefined>();
  const [isOpen, setIsOpen] = useState(false);

  const reportError = useCallback((err: Error, context?: string) => {
    console.error('[CrashReporter] Error reported:', err);
    setError(err);
    setErrorContext(context);
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setError(null);
    setErrorContext(undefined);
  }, []);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  // Known errors to suppress (these are benign and don't affect functionality)
  const isKnownBenignError = (error: Error | unknown): boolean => {
    if (error instanceof Error) {
      // Monaco DiffEditor model disposal race condition - known issue, doesn't break functionality
      if (error.message.includes('TextModel got disposed before DiffEditorWidget')) {
        console.warn('[CrashReporter] Suppressing known Monaco DiffEditor error');
        return true;
      }
    }
    return false;
  };

  // Global error handler for uncaught errors
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      // Don't show for errors that are already handled by React's error boundary
      if (event.error && !event.defaultPrevented) {
        // Skip known benign errors
        if (isKnownBenignError(event.error)) {
          event.preventDefault();
          return;
        }
        console.error('[CrashReporter] Uncaught error:', event.error);
        setError(event.error);
        setErrorContext('Uncaught exception');
        setIsOpen(true);
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Skip known benign errors
      if (isKnownBenignError(event.reason)) {
        event.preventDefault();
        return;
      }
      console.error('[CrashReporter] Unhandled rejection:', event.reason);
      let err: Error;
      if (event.reason instanceof Error) {
        err = event.reason;
      } else if (event.reason instanceof Event) {
        // Handle case where an Event object is thrown (e.g., load error events)
        const eventType = event.reason.type || 'unknown';
        const target = (event.reason as Event & { target?: { src?: string } }).target;
        const src = target?.src || 'unknown source';
        err = new Error(`Event error: ${eventType} from ${src}`);
      } else {
        err = new Error(String(event.reason));
      }
      setError(err);
      setErrorContext('Unhandled promise rejection');
      setIsOpen(true);
    };

    // Expose test function for development
    (window as unknown as { __testCrashReporter?: () => void }).__testCrashReporter = () => {
      setError(new Error('Test error: Crash reporter triggered manually'));
      setErrorContext('Manual test');
      setIsOpen(true);
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      delete (window as unknown as { __testCrashReporter?: () => void }).__testCrashReporter;
    };
  }, []);

  return (
    <CrashReporterContext.Provider value={{ reportError }}>
      {children}
      <CrashReporterModal
        isOpen={isOpen}
        error={error}
        errorInfo={errorContext}
        onClose={handleClose}
        onReload={handleReload}
      />
    </CrashReporterContext.Provider>
  );
}
