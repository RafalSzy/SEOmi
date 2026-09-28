import React from "react";

interface RouteErrorBoundaryProps {
  title: string;
  description: string;
  retryLabel: string;
  backLabel: string;
  onBack: () => void;
  children: React.ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

/**
 * Keeps a single broken workflow from taking down the whole desktop SPA.
 * The boundary is remounted by MainContent when the active tab changes, so a
 * navigation action always gets a fresh render attempt.
 */
export class RouteErrorBoundary extends React.Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Keep the user-facing fallback deterministic while retaining diagnostics
    // in the desktop console for local troubleshooting.
    console.error("route-render-failed", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <section
        role="alert"
        className="mx-auto flex min-h-[48vh] max-w-xl flex-col items-center justify-center px-8 text-center"
      >
        <h2 className="text-lg font-semibold text-slate-100">
          {this.props.title}
        </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {this.props.description}
          </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {this.props.retryLabel}
          </button>
          <button
            type="button"
            onClick={this.props.onBack}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {this.props.backLabel}
          </button>
        </div>
      </section>
    );
  }
}
