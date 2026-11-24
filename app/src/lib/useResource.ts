import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import { local } from './storage';

type Resource<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True when showing cached data because the server could not be reached. */
  stale: boolean;
  refresh: () => Promise<void>;
  setData: (value: T) => void;
};

/**
 * Loads data when the screen gains focus. With `cacheKey`, the last good
 * response is saved so the screen still works on weak gym Wi-Fi.
 */
export function useResource<T>(fetcher: () => Promise<T>, cacheKey?: string): Resource<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const hasData = useRef(false);

  useEffect(() => {
    if (!cacheKey) return;
    void local.get<T>(cacheKey).then((cached) => {
      if (cached && !hasData.current) setDataState(cached);
    });
  }, [cacheKey]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await fetcherRef.current();
      hasData.current = true;
      setDataState(fresh);
      setError(null);
      setStale(false);
      if (cacheKey) await local.set(cacheKey, fresh);
    } catch (e) {
      const offline = e instanceof ApiError && e.network;
      setStale(offline);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cacheKey]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const setData = useCallback(
    (value: T) => {
      setDataState(value);
      if (cacheKey) void local.set(cacheKey, value);
    },
    [cacheKey],
  );

  return { data, error, loading, stale, refresh, setData };
}
