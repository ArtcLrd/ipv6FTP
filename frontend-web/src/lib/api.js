/**
 * apiFetch is a wrapper around fetch that handles credentials (cookies)
 * and automatic token refreshing.
 */
export async function apiFetch(path, opts = {}) {
  const options = {
    ...opts,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
  };

  let response = await fetch(path, options);

  // If unauthorized, attempt to refresh the token
  if (response.status === 401 && !path.includes("/api/auth/refresh")) {
    const refreshRes = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });

    if (refreshRes.ok) {
      // Retry the original request
      response = await fetch(path, options);
    } else {
      // Refresh failed, session likely expired
      // We don't throw here, the caller handles response.status
    }
  }

  return response;
}

export const apiGet = (path) => apiFetch(path, { method: "GET" });
export const apiPost = (path, body) =>
  apiFetch(path, {
    method: "POST",
    ...(body !== undefined && body !== null ? { body: JSON.stringify(body) } : {}),
  });
export const apiDelete = (path) => apiFetch(path, { method: "DELETE" });
