"use client";

import { AppErrorState } from "../components/app-error-state";

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppErrorState onRetry={reset} />;
}
