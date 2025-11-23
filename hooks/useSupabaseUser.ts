"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

export function useSupabaseUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Supabase client not configured';
      setError(message);
      setLoading(false);
      return null;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    if (!supabase) return null;
    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase.auth.getUser();
      if (fetchError) {
        setError(fetchError.message);
        setUser(null);
        return null;
      }
      setUser(data.user ?? null);
      setError(null);
      return data.user ?? null;
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;

    refreshUser();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      data?.subscription.unsubscribe();
    };
  }, [supabase, refreshUser]);

  return { user, loading, error, refreshUser, supabase };
}
