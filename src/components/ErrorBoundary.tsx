import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LearnAgent renderer crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="error-screen" role="alert">
        <CircleAlert size={30} />
        <h1>LearnAgent 暂时无法显示</h1>
        <p>{this.state.error.message || '界面发生了未知错误，请重新加载。'}</p>
        <button className="primary-action" type="button" onClick={() => window.location.reload()}>
          <RotateCcw size={16} />
          重新加载
        </button>
      </main>
    );
  }
}
