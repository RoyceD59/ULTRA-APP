import { Component, type PropsWithChildren, type ErrorInfo } from "react";
import { projecthubReporter } from "../lib/runtime-diagnostics";

export class RuntimeErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { projecthubReporter("render", error); }
  render() {
    return this.state.failed ? <main role="alert" className="p-8">
      <h1 className="text-xl font-semibold">ProjectHub couldn’t display this page</h1>
      <p className="my-4">Reload the page to try again. No entered content is included in diagnostics.</p>
      <button className="rounded border p-3" onClick={() => window.location.reload()}>Reload page</button>
    </main> : this.props.children;
  }
}