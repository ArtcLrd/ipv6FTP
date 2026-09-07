import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { apiClearTokens, apiGet, apiPost, apiSetTokens, getOrCreateWebInstallation } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState("");
  const [activePrompt, setActivePrompt] = useState(null);
  const sseListenersRef = useRef(new Set());

  const bootstrapGuest = useCallback(async () => {
    const res = await apiPost("/api/v1/auth/guest/bootstrap", {
      installation: getOrCreateWebInstallation(),
    });
    if (!res.ok) {
      setBootstrapError((await res.text()).trim() || "Could not start guest session.");
      setUser(null);
      return null;
    }
    const data = await res.json();
    apiSetTokens(data.access_token, data.refresh_token);
    setBootstrapError("");
    setUser(data.user);
    return data.user;
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const res = await apiGet("/api/v1/auth/me");
      if (res.ok) {
        const nextUser = await res.json();
        setUser(nextUser);
        setBootstrapError("");
      } else {
        await bootstrapGuest();
      }
    } catch {
      await bootstrapGuest();
    } finally {
      setLoading(false);
    }
  }, [bootstrapGuest]);

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
      if (user.account_type === "guest") return;
      const accessToken = localStorage.getItem("ipv6ftp_access_token");
      eventSource = new EventSource(`/api/events?access_token=${encodeURIComponent(accessToken || "")}`);

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

  useEffect(() => {
    const prompt = user?.pending_prompts?.find((item) => item.reason === "weekly_benefits_reminder");
    if (user?.account_type === "guest" && prompt) {
      setActivePrompt({
        code: prompt.code,
        reason: "weekly_benefits_reminder",
        trigger_period_key: prompt.trigger_period_key || "default",
      });
    }
  }, [user]);

  const login = async (username, password) => {
    const res = await apiPost("/api/v1/auth/login", {
      username,
      password,
      guest_principal_id: user?.account_type === "guest" ? user.id : undefined,
      installation: getOrCreateWebInstallation(),
    });
    if (res.ok) {
      const data = await res.json();
      apiSetTokens(data.access_token, data.refresh_token);
      setActivePrompt(null);
      setUser(data.user);
      return { ok: true };
    }
    const err = await res.text();
    return { ok: false, error: err.trim() };
  };

  const register = async (username, password) => {
    const res = await apiPost("/api/v1/auth/register", {
      username,
      password,
      guest_principal_id: user?.account_type === "guest" ? user.id : undefined,
      installation: getOrCreateWebInstallation(),
    });
    if (res.ok) {
      const data = await res.json();
      apiSetTokens(data.access_token, data.refresh_token);
      setActivePrompt(null);
      setUser(data.user);
      return { ok: true };
    }
    const err = await res.text();
    return { ok: false, error: err.trim() };
  };

  const logout = async () => {
    await apiPost("/api/v1/auth/logout");
    apiClearTokens();
    setActivePrompt(null);
    await bootstrapGuest();
  };

  const recordPromptAction = async (prompt, action) => {
    if (!prompt) return;
    try {
      await apiPost("/api/v1/prompts/actions", {
        code: prompt.code,
        trigger_period_key: prompt.trigger_period_key || "default",
        action,
      });
    } catch {
      // Prompt state is server-authoritative, but the UI should still close if this fails.
    }
  };

  const showGuestPrompt = (prompt) => setActivePrompt(prompt);

  const dismissPrompt = async () => {
    await recordPromptAction(activePrompt, "snoozed");
    setActivePrompt(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      bootstrapError,
      login,
      register,
      logout,
      refreshMe,
      bootstrapGuest,
      addSSEListener,
      activePrompt,
      showGuestPrompt,
      clearGuestPrompt: () => setActivePrompt(null),
      dismissPrompt,
      recordPromptAction,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
