import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

interface State {
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("App crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ margin: 24, fontFamily: "monospace" }}>
          <h3 style={{ color: "#ff4d4f" }}>Super Redis crashed</h3>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{String(this.state.error?.stack || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
