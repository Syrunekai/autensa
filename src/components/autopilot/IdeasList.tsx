'use client';

import { useState, useEffect } from 'react';
import { IdeaCard } from './IdeaCard';
import { FetchError } from '@/components/FetchError';
import type { Idea } from '@/lib/types';

interface IdeasListProps {
  productId: string;
}

export function IdeasList({ productId }: IdeasListProps) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<number | string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  // Two-tap delete guard: first tap arms the button, second tap deletes.
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);

  const handleDelete = async (ideaId: string) => {
    if (armedDeleteId !== ideaId) {
      setArmedDeleteId(ideaId);
      return;
    }
    setArmedDeleteId(null);
    try {
      const res = await fetch(`/api/products/${productId}/ideas/${ideaId}`, { method: 'DELETE' });
      if (res.ok) {
        setIdeas(prev => prev.filter(i => i.id !== ideaId));
      } else {
        console.error('Failed to delete idea:', res.status);
      }
    } catch (error) {
      console.error('Failed to delete idea:', error);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set('status', statusFilter);
        if (categoryFilter) params.set('category', categoryFilter);
        const res = await fetch(`/api/products/${productId}/ideas?${params}`);
        if (res.ok) {
          setIdeas(await res.json());
        } else {
          setLoadError(res.status);
        }
      } catch (error) {
        console.error('Failed to load ideas:', error);
        setLoadError('network');
      } finally {
        setLoading(false);
      }
    })();
  }, [productId, statusFilter, categoryFilter, reloadKey]);

  const statuses = ['', 'pending', 'approved', 'rejected', 'maybe', 'building', 'built', 'shipped', 'archived'];
  const categories = ['', 'feature', 'improvement', 'ux', 'performance', 'integration', 'infrastructure', 'content', 'growth', 'monetization', 'operations', 'security'];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-mc-bg-tertiary border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text"
        >
          {statuses.map(s => (
            <option key={s} value={s}>{s || 'All statuses'}</option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="bg-mc-bg-tertiary border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text"
        >
          {categories.map(c => (
            <option key={c} value={c}>{c || 'All categories'}</option>
          ))}
        </select>
        <span className="text-sm text-mc-text-secondary self-center">{ideas.length} ideas</span>
      </div>

      {loading ? (
        <div className="text-mc-text-secondary animate-pulse py-8 text-center">Loading ideas...</div>
      ) : loadError !== null ? (
        <FetchError code={loadError} onRetry={() => setReloadKey(k => k + 1)} />
      ) : ideas.length === 0 ? (
        <div className="text-center py-12 text-mc-text-secondary">No ideas found</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ideas.map(idea => (
            <div key={idea.id} className="space-y-2">
              <IdeaCard idea={idea} showActions={false} compact />
              {idea.status === 'archived' && (
                <button
                  onClick={() => handleDelete(idea.id)}
                  className={`w-full min-h-9 text-xs rounded-lg border transition-colors ${
                    armedDeleteId === idea.id
                      ? 'bg-red-500/30 border-red-500 text-red-300 font-semibold'
                      : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                  }`}
                >
                  {armedDeleteId === idea.id ? 'Tap again to permanently delete' : 'Delete'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
