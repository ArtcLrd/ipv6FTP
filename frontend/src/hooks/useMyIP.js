import { useState, useEffect } from "react";

/**
 * useMyIP — fetches the client's IP address from the Go backend.
 * The backend reads r.RemoteAddr (same mechanism as whatsmyip.com).
 * Returns the real temporary IPv6 if the client has global IPv6.
 */
export function useMyIP() {
  const [ip, setIp] = useState(null);
  const [isIPv6, setIsIPv6] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/myip", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setIp(data.ip);
        setIsIPv6(data.isIPv6);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  return { ip, isIPv6, loading, error };
}
