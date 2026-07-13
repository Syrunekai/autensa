'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

interface FetchErrorProps {
  /** HTTP status code, or a short label for non-HTTP failures (e.g. "network"). */
  code: number | string;
  onRetry: () => void;
}

/**
 * Error state for failed data fetches. Rendered in place of a list's normal
 * empty state so a backend failure is not mistaken for "no data".
 */
export function FetchError({ code, onRetry }: FetchErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-3 text-center">
      <AlertTriangle className="w-8 h-8 text-red-400" />
      <div>
        <p className="text-sm font-medium text-mc-text">Backend request failed ({code})</p>
        <p className="text-xs text-mc-text-secondary mt-1">
          The server may be restarting or unreachable. Check the server, then try again.
        </p>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-mc-accent/20 text-mc-accent hover:bg-mc-accent/30 text-sm font-medium transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        Refresh
      </button>
    </div>
  );
}
