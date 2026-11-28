/**
 * apiFetch is a wrapper around fetch that handles credentials (cookies)
 * and automatic token refreshing.
 */
export async function apiFetch(path, opts = {}) {
  const accessToken = localStorage.getItem("ipv6ftp_access_token");
  const options = {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...opts.headers,
    },
  };

  let response = await fetch(path, options);

  if (response.status === 401 && !path.includes("/api/v1/auth/refresh")) {
    const refreshToken = localStorage.getItem("ipv6ftp_refresh_token");
    if (!refreshToken) return response;

    const refreshRes = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (refreshRes.ok) {
      const data = await refreshRes.json();
      apiSetTokens(data.access_token, data.refresh_token);
      response = await fetch(path, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${data.access_token}`,
        },
      });
    }
  }

  return response;
}

export function apiSetTokens(accessToken, refreshToken) {
  if (accessToken) localStorage.setItem("ipv6ftp_access_token", accessToken);
  if (refreshToken) localStorage.setItem("ipv6ftp_refresh_token", refreshToken);
}

export function apiClearTokens() {
  localStorage.removeItem("ipv6ftp_access_token");
  localStorage.removeItem("ipv6ftp_refresh_token");
}

export function getOrCreateWebInstallation() {
  const key = "ipv6ftp_web_installation_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(key, id);
  }
  return {
    identifier_hash: id,
    app_instance_id: id,
    platform: "web",
  };
}

export const apiGet = (path) => apiFetch(path, { method: "GET" });
export const apiPost = (path, body) =>
  apiFetch(path, {
    method: "POST",
    ...(body !== undefined && body !== null ? { body: JSON.stringify(body) } : {}),
  });
export const apiDelete = (path) => apiFetch(path, { method: "DELETE" });
