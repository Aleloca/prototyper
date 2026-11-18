import { Component, type ErrorInfo, type ReactNode } from "react";

/** Shows what went wrong instead of a blank window, with a way out. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | undefined }> {
  override state = { error: undefined as Error | undefined };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged to ~/Library/Logs/Prototyper/main.log by the main process.
    console.error(`UI error: ${error.stack ?? error.message}\n${info.componentStack ?? ""}`);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const it = navigator.language.toLowerCase().startsWith("it");
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-xl">
          <h1 className="text-[17px] font-semibold">{it ? "Qualcosa è andato storto nell'interfaccia" : "Something went wrong in the interface"}</h1>
          <p className="mt-2 text-muted">
            {it
              ? "I tuoi file e le demo non sono stati toccati. Ricarica la finestra per continuare. Il dettaglio è salvato in ~/Library/Logs/Prototyper/main.log."
              : "Your files and demos are untouched. Reload the window to continue. Details are saved in ~/Library/Logs/Prototyper/main.log."}
          </p>
          <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-black/5 p-3 font-mono text-[11px] whitespace-pre-wrap">{error.message}</pre>
          <button className="btn btn-primary mt-4" onClick={() => location.reload()}>
            {it ? "Ricarica" : "Reload"}
          </button>
        </div>
      </div>
    );
  }
}
