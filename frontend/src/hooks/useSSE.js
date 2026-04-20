import { useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";

/**
 * useSSE registers a listener on the shared SSE connection managed by AuthContext.
 * This avoids creating multiple EventSource connections for the same user.
 */
export function useSSE(onEvent) {
  const { addSSEListener } = useAuth();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!addSSEListener) return;
    const remove = addSSEListener((event) => onEventRef.current?.(event));
    return remove;
  }, [addSSEListener]);
}
