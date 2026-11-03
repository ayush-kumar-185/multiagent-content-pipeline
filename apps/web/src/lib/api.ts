import { RunRecord, RunConfig } from '@/lib/types';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getAuthHeaders(userId?: string): HeadersInit {
  let uid = userId;
  if (!uid && typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('citewriter_user');
      if (stored) {
        uid = JSON.parse(stored).id;
      }
    } catch {
      // Ignore
    }
  }

  return {
    'Content-Type': 'application/json',
    'x-user-id': uid || 'demo-user-1',
  };
}

export interface CreateRunInput {
  topic: string;
  sourceUrl?: string;
  config?: Partial<RunConfig>;
}

export async function createRun(input: CreateRunInput, userId?: string): Promise<RunRecord> {
  const res = await fetch(`${API_BASE_URL}/runs`, {
    method: 'POST',
    headers: getAuthHeaders(userId),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function listRuns(userId?: string): Promise<RunRecord[]> {
  const res = await fetch(`${API_BASE_URL}/runs`, {
    method: 'GET',
    headers: getAuthHeaders(userId),
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to fetch runs (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.runs || [];
}

export async function getRun(id: string, userId?: string): Promise<RunRecord> {
  const res = await fetch(`${API_BASE_URL}/runs/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(userId),
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to fetch run ${id} (HTTP ${res.status})`);
  }

  return res.json();
}

export interface ResumeRunInput {
  action: 'approve' | 'edit' | 'reject';
  feedback?: string;
  editedDraft?: string;
}

export async function resumeRun(
  id: string,
  input: ResumeRunInput,
  userId?: string,
): Promise<{ status: string; runId: string; decision: string }> {
  const res = await fetch(`${API_BASE_URL}/runs/${id}/resume`, {
    method: 'POST',
    headers: getAuthHeaders(userId),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to resume run (HTTP ${res.status})`);
  }

  return res.json();
}

export async function cancelRun(
  id: string,
  userId?: string,
): Promise<{ status: string; runId: string }> {
  const res = await fetch(`${API_BASE_URL}/runs/${id}/cancel`, {
    method: 'POST',
    headers: getAuthHeaders(userId),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to cancel run (HTTP ${res.status})`);
  }

  return res.json();
}

export function getEventsStreamUrl(id: string, lastEventId?: number): string {
  const url = new URL(`${API_BASE_URL}/runs/${id}/events`);
  if (lastEventId !== undefined && lastEventId > 0) {
    url.searchParams.set('lastEventId', String(lastEventId));
  }
  return url.toString();
}
