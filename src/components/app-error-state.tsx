"use client";

import { useEffect, useRef } from "react";

export function AppErrorState({
  onRetry,
  onReload = () => window.location.reload(),
}: {
  onRetry: () => void;
  onReload?: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main className="fatal-error-shell" role="alert">
      <div className="fatal-error-card">
        <span className="brand-mark fatal-error-mark" aria-hidden="true">
          <svg viewBox="0 0 36 36" focusable="false">
            <rect
              className="brand-desk"
              x="5"
              y="6"
              width="26"
              height="12"
              rx="4"
            />
            <rect
              className="brand-screen"
              x="11"
              y="9"
              width="14"
              height="6"
              rx="2"
            />
            <rect
              className="brand-chair"
              x="12"
              y="20"
              width="12"
              height="4"
              rx="2"
            />
            <circle className="brand-agent" cx="18" cy="29" r="5" />
          </svg>
        </span>
        <p className="fatal-error-eyebrow">Coffice</p>
        <h1 ref={headingRef} tabIndex={-1}>
          The local workspace hit an unexpected error
        </h1>
        <p>
          No task content is shown here. Try the view again, or reload Coffice
          if the problem continues.
        </p>
        <div className="fatal-error-actions">
          <button type="button" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="secondary" onClick={onReload}>
            Reload Coffice
          </button>
        </div>
      </div>
    </main>
  );
}
