import { useEffect, useState } from 'react';
import axios from 'axios';
import { useAppState } from './useAppState';

interface Ipv6Status {
  hasIpv6: boolean;
  ipAddress: string | null;
}

let cache: { result: Ipv6Status | null; fetchedAt: number } = {
  result: null,
  fetchedAt: 0,
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function useIpv6Status() {
  const [status, setStatus] = useState<Ipv6Status>(
    cache.result ?? { hasIpv6: false, ipAddress: null }
  );
  const [loading, setLoading] = useState(!cache.result);
  const { isForeground } = useAppState();

  const fetchIpv6 = async (force = false) => {
    const now = Date.now();
    if (!force && cache.result && now - cache.fetchedAt < CACHE_TTL_MS) {
      setStatus(cache.result);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await axios.get('https://api64.ipify.org?format=json', {
        timeout: 5000,
      });
      const ip = response.data?.ip;
      const hasIpv6 = typeof ip === 'string' && ip.includes(':');
      const newStatus = { hasIpv6, ipAddress: ip || null };
      cache = { result: newStatus, fetchedAt: now };
      setStatus(newStatus);
    } catch (error) {
      const newStatus = { hasIpv6: false, ipAddress: null };
      setStatus(newStatus);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIpv6();
  }, []);

  useEffect(() => {
    if (isForeground) {
      const now = Date.now();
      if (now - cache.fetchedAt >= CACHE_TTL_MS) {
        fetchIpv6(true);
      }
    }
  }, [isForeground]);

  return {
    ...status,
    loading,
    refetch: () => fetchIpv6(true),
  };
}
