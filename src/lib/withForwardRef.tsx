import * as React from "react";

/**
 * Utility to wrap any component to accept and safely discard refs.
 * This is needed for compatibility with lovable-tagger which injects refs.
 */
export function withForwardRef<T extends React.ComponentType<any>>(
  Component: T,
  displayName?: string
): T {
  const Wrapped = React.forwardRef<unknown, any>((props, _ref) => {
    return React.createElement(Component, props);
  });
  Wrapped.displayName = displayName || (Component as any).displayName || (Component as any).name || "ForwardRefComponent";
  return Wrapped as unknown as T;
}
