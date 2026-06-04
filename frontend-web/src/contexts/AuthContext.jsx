import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const sseListenersRef = useRef(new Set());

  const refreshMe = useCallback(async () => {
    try {
      const res = await apiGet("/api/auth/me");
      if (res.ok) {
        setUser(await res.json());
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // --- Single SSE connection for the whole app ---
  useEffect(() => {
    if (!user) return;

    let eventSource;
    let reconnectTimeout;
    let retryDelay = 1000;

    const connect = () => {
      eventSource = new EventSource("/api/events");

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Dispatch to all registered listeners
          sseListenersRef.current.forEach((fn) => fn(data));
          retryDelay = 1000;
        } catch (err) {
          console.error("SSE parse error", err);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        reconnectTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30000);
          connect();
        }, retryDelay);
      };
    };

    connect();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [user]);

  // Heartbeat for IP update
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      apiPost("/api/ip/update");
    }, 2 * 60 * 60 * 1000); // 2 hours
    return () => clearInterval(interval);
  }, [user]);

  const addSSEListener = useCallback((fn) => {
    sseListenersRef.current.add(fn);
    return () => sseListenersRef.current.delete(fn);
  }, []);

  const login = async (username, password) => {
    const res = await apiPost("/api/auth/login", { username, password });
    if (res.ok) {
      setUser(await res.json());
      return { ok: true };
    }
    const err = await res.text();
    return { ok: false, error: err.trim() };
  };

  const register = async (username, password) => {
    const res = await apiPost("/api/auth/register", { username, password });
    if (res.ok) {
      setUser(await res.json());
      return { ok: true };
    }
    const err = await res.text();
    return { ok: false, error: err.trim() };
  };

  const logout = async () => {
    await apiPost("/api/auth/logout");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshMe, addSSEListener }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
