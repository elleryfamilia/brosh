/**
 * ErrorBoundary Component
 *
 * Catches React rendering errors and shows a crash reporter modal
 * allowing users to review and optionally send error reports.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { CrashReporterModal } from './CrashReporterModal';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
  showReporter: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showReporter: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, showReporter: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({
      errorInfo: errorInfo.componentStack || null,
    });
  }

  handleClose = (): void => {
    this.setState({ showReporter: false });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <>
          {/* Show a minimal fallback UI behind the modal */}
          <div className="error-boundary">
            <div className="error-boundary-content">
              <div className="error-boundary-icon">!</div>
              <h2>Something went wrong</h2>
            </div>
          </div>

          {/* Crash reporter modal */}
          <CrashReporterModal
            isOpen={this.state.showReporter}
            error={this.state.error}
            errorInfo={this.state.errorInfo || undefined}
            onClose={this.handleClose}
            onReload={this.handleReload}
          />
        </>
      );
    }

    return this.props.children;
  }
}
