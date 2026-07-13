'use client';

import { useState, useEffect } from 'react';

export interface UiConfig {
  swipe_mode: 'FULL' | 'HYBRID' | 'BAR';
  program_mode: 'FULL' | 'IDEATION';
}

const DEFAULTS: UiConfig = { swipe_mode: 'FULL', program_mode: 'FULL' };

// Module-level cache: all consumers share a single /api/ui-config fetch.
let cached: UiConfig | null = null;
let inflight: Promise<UiConfig> | null = null;

function fetchConfig(): Promise<UiConfig> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch('/api/ui-config')
      .then(res => (res.ok ? res.json() : DEFAULTS))
      .then((data: Partial<UiConfig>) => {
        cached = { ...DEFAULTS, ...data };
        return cached;
      })
      .catch(() => DEFAULTS);
  }
  return inflight;
}

export function useUiConfig(): UiConfig {
  const [config, setConfig] = useState<UiConfig>(cached ?? DEFAULTS);

  useEffect(() => {
    let mounted = true;
    fetchConfig().then(c => {
      if (mounted) setConfig(c);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return config;
}
