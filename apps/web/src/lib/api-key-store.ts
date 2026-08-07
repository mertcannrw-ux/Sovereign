'use client';

import { create } from 'zustand';
import type { AIProvider } from '@app-builder/shared';

export interface StoredApiKey {
  id: string;
  provider: AIProvider;
  label: string;
  maskedKey: string;
  baseUrl?: string;
  configured: boolean;
}

export interface ProviderModels {
  provider: AIProvider;
  models: string[];
  lastFetched: number;
}

interface ApiKeyStore {
  keys: StoredApiKey[];
  models: ProviderModels[];
  setKeys: (keys: StoredApiKey[]) => void;
  addKey: (key: StoredApiKey) => void;
  removeKey: (provider: AIProvider) => void;
  setModels: (provider: AIProvider, models: string[]) => void;
  getModels: (provider: AIProvider) => string[];
}

export const useApiKeyStore = create<ApiKeyStore>((set, get) => ({
  keys: [],
  models: [],

  setKeys: (keys) => set({ keys }),

  addKey: (key) =>
    set((s) => ({
      keys: [...s.keys.filter((k) => k.provider !== key.provider), key],
    })),

  removeKey: (provider) =>
    set((s) => ({
      keys: s.keys.filter((k) => k.provider !== provider),
      models: s.models.filter((m) => m.provider !== provider),
    })),

  setModels: (provider, models) =>
    set((s) => ({
      models: [
        ...s.models.filter((m) => m.provider !== provider),
        { provider, models, lastFetched: Date.now() },
      ],
    })),

  getModels: (provider) => {
    const entry = get().models.find((m) => m.provider === provider);
    return entry?.models ?? [];
  },
}));
