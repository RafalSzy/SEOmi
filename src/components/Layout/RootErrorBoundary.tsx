import React from "react";

interface RootErrorBoundaryProps {
  title: string;
  description: string;
  retryLabel: string;
  reloadLabel: string;
  children: React.ReactNode;
}

interface RootErrorBoundaryState {
  error: Error | null;
}

export class RootErrorBoundary extends React.Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("root-render-failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main
        role="alert"
        className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100"
      >
        <section className="w-full max-w-xl rounded-2xl border border-rose-500/30 bg-slate-900 p-8 text-center shadow-2xl">
          <h1 className="text-xl font-semibold">{this.props.title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {this.props.description}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              {this.props.retryLabel}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              {this.props.reloadLabel}
            </button>
          </div>
          <details className="mt-6 text-left text-xs text-slate-500">
            <summary className="cursor-pointer select-text">{this.props.description}</summary>
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-rose-200">
              {this.state.error.message}
            </pre>
          </details>
        </section>
      </main>
    );
  }
}
