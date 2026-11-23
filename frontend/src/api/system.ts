import { apiRequest } from './client';

export interface Health {
  status: 'ok';
  assistant: { configured: boolean; model: string | null; circuit: 'closed' | 'open' | 'half_open'; relevanceThreshold: number; forceToolFailure: boolean };
}

export const systemApi = {
  health: (signal?: AbortSignal) => apiRequest<Health>('/api/health', { signal, timeoutMs: 5000 }),
};
