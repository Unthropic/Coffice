"use client";

import { AppErrorState } from "../components/app-error-state";

export default function GlobalErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <AppErrorState onRetry={reset} />
      </body>
    </html>
  );
}
