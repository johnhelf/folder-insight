import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children?: ReactNode;
  t?: (key: string) => string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    const t = this.props.t || ((key: string) => key);
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center bg-white dark:bg-gray-900 rounded-xl border border-red-200 dark:border-red-900/30">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4 text-red-500">
            <AlertTriangle size={32} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {t('renderError') !== 'renderError' ? t('renderError') : "Something went wrong rendering this component"}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-md">
            {this.state.error?.message || (t('unknownError') !== 'unknownError' ? t('unknownError') : "Unknown error")}
          </p>
          <button
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            {t('tryAgain') !== 'tryAgain' ? t('tryAgain') : "Try Again"}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
