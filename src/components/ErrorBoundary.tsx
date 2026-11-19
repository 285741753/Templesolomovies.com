import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  sectionName?: string;
  compact?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected rendering error.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.sectionName ? `: ${this.props.sectionName}` : ''}]`, error, info);
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { sectionName, compact } = this.props;

    if (compact) {
      return (
        <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5A93B]/40 bg-[#111114] px-4 py-3 text-xs">
            <div className="flex items-center gap-2 text-[#D4D4D8] min-w-0">
              <AlertTriangle className="h-4 w-4 text-[#E5A93B] shrink-0" aria-hidden="true" />
              <span className="truncate">
                {sectionName ? `${sectionName} encountered a display issue.` : 'A section encountered an issue.'}
              </span>
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-[#E5A93B] px-3 py-1.5 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-[260px] w-full flex items-center justify-center p-6 bg-[#09090B] text-[#FAFAFA]">
        <div className="max-w-md w-full rounded-2xl border border-[#E5A93B]/40 bg-[#111114] p-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[#E5A93B]/40 bg-[#E5A93B]/10 text-[#E5A93B]">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-[#FAFAFA]">
              {sectionName ? `${sectionName} could not load` : 'Something went wrong'}
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-1 break-words">
              {this.state.errorMessage || 'A temporary error interrupted this view.'}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={this.handleReset}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#E5A93B] px-4 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>Try Again</span>
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[44px] rounded-xl border border-[#27272A] bg-[#18181B] px-4 py-2 text-xs font-semibold text-[#FAFAFA] hover:border-[#E5A93B] cursor-pointer"
            >
              Reload App
            </button>
          </div>
        </div>
      </div>
    );
  }
}
