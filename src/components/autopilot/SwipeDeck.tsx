'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ListChecks, X } from 'lucide-react';
import { IdeaCard } from './IdeaCard';
import { UndoToast } from './UndoToast';
import { FetchError } from '@/components/FetchError';
import { useSwipe } from '@/hooks/useSwipe';
import { useUiConfig } from '@/hooks/useUiConfig';
import type { Idea, SwipeAction } from '@/lib/types';

/**
 * Deck interaction modes (SWIPE_MODE via /api/ui-config):
 * - FULL:   four-direction swipe decides; tap opens a scrollable detail view
 * - HYBRID: left/right swipe decides; card scrolls; action bar for all actions
 * - BAR:    left/right swipe navigates between cards; action bar decides
 */

interface SwipeDeckProps {
  productId: string;
}

interface LastSwipe {
  swipeId: string;
  ideaId: string;
  action: SwipeAction;
  idea: Idea;
  index: number; // position in deck when swiped
}

export function SwipeDeck({ productId }: SwipeDeckProps) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [animatingOut, setAnimatingOut] = useState<string | null>(null);
  const [sessionStats, setSessionStats] = useState({ approved: 0, rejected: 0, maybe: 0, fired: 0 });
  const [lastSwipe, setLastSwipe] = useState<LastSwipe | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [loadError, setLoadError] = useState<number | string | null>(null);
  const { swipe_mode: mode, program_mode } = useUiConfig();
  const allowFire = program_mode !== 'IDEATION';

  // Offsets the chat widget button above the fixed action bar on small screens.
  useEffect(() => {
    if (mode === 'FULL') return;
    document.documentElement.style.setProperty('--chat-fab-offset', '76px');
    return () => {
      document.documentElement.style.removeProperty('--chat-fab-offset');
    };
  }, [mode]);

  const loadDeck = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/products/${productId}/swipe/deck`);
      if (res.ok) {
        const data = await res.json();
        setIdeas(data);
        setCurrentIndex(0);
        setPendingCount(data.length);
      } else {
        setLoadError(res.status);
      }
    } catch (error) {
      console.error('Failed to load swipe deck:', error);
      setLoadError('network');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeck();
  }, [productId]);

  // Hydrate the decision counters from swipe history so they survive page
  // reloads. Counters are all-time per product, not per browser session.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/products/${productId}/swipe/stats`);
        if (!res.ok) return;
        const stats = await res.json();
        setSessionStats({
          approved: stats.approved || 0,
          rejected: stats.rejected || 0,
          maybe: stats.maybe || 0,
          fired: stats.fired || 0,
        });
      } catch (error) {
        console.error('Failed to load swipe stats:', error);
      }
    })();
  }, [productId]);

  // Optional decision note for the action bar (BAR/HYBRID). Cleared when the
  // current card changes so a note is only ever submitted with the card it
  // was written for. The field renders one line tall and expands to two
  // while focused or holding text.
  const [barNotes, setBarNotes] = useState('');
  const [barNotesFocused, setBarNotesFocused] = useState(false);

  useEffect(() => {
    setBarNotes('');
  }, [currentIndex]);

  const handleSwipe = useCallback(async (action: SwipeAction, notes?: string) => {
    const idea = ideas[currentIndex];
    if (!idea) return;

    // Clear any existing undo toast (new swipe supersedes previous undo)
    setLastSwipe(null);

    const directionMap: Record<string, string> = {
      approve: 'right',
      reject: 'left',
      fire: 'up',
      maybe: 'down',
    };
    setAnimatingOut(directionMap[action]);

    try {
      const res = await fetch(`/api/products/${productId}/swipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea_id: idea.id, action, notes }),
      });

      if (res.ok) {
        const result = await res.json();

        // Store for undo
        setLastSwipe({
          swipeId: result.swipeId,
          ideaId: idea.id,
          action,
          idea,
          index: currentIndex,
        });
      }

      setSessionStats(prev => ({
        ...prev,
        [action === 'fire' ? 'fired' : action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'maybe']:
          prev[action === 'fire' ? 'fired' : action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'maybe'] + 1,
      }));
    } catch (error) {
      console.error('Failed to record swipe:', error);
    }

    setBarNotes('');

    setTimeout(() => {
      setAnimatingOut(null);
      if (mode === 'BAR') {
        // BAR keeps the browsing position: remove the decided card and stay put.
        setIdeas(prev => prev.filter((_, i) => i !== currentIndex));
        setCurrentIndex(prev => Math.max(0, Math.min(prev, ideas.length - 2)));
      } else {
        setCurrentIndex(prev => prev + 1);
      }
    }, 300);
  }, [ideas, currentIndex, productId, mode]);

  const handleUndo = useCallback((restoredIdea: unknown) => {
    if (!lastSwipe) return;

    const idea = restoredIdea as Idea;
    const action = lastSwipe.action;

    // Insert the idea back at the position it was decided from.
    const restoreAt = mode === 'BAR' ? Math.min(lastSwipe.index, ideas.length) : currentIndex;
    setIdeas(prev => {
      const newIdeas = [...prev];
      newIdeas.splice(restoreAt, 0, idea);
      return newIdeas;
    });

    // Show the restored card.
    setCurrentIndex(mode === 'BAR' ? restoreAt : currentIndex);

    // Decrement the session stats
    setSessionStats(prev => ({
      ...prev,
      [action === 'fire' ? 'fired' : action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'maybe']:
        Math.max(0, prev[action === 'fire' ? 'fired' : action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'maybe'] - 1),
    }));

    setLastSwipe(null);
  }, [lastSwipe, currentIndex, mode, ideas.length]);

  const handleUndoExpire = useCallback(() => {
    setLastSwipe(null);
  }, []);

  const swipeDirectionToAction = useCallback((direction: string | null): SwipeAction | null => {
    switch (direction) {
      case 'right': return 'approve';
      case 'left': return 'reject';
      case 'up': return 'fire';
      case 'down': return 'maybe';
      default: return null;
    }
  }, []);

  const { offsetX, offsetY, direction, handlers } = useSwipe({
    axes: mode === 'FULL' ? 'all' : 'horizontal',
    // BAR swipes only navigate, so they trigger at 60% of the distance
    // required for decision gestures.
    threshold: mode === 'BAR' ? 48 : 80,
    onSwipe: (dir) => {
      if (mode === 'BAR') {
        // Swipes navigate: left advances, right goes back.
        if (dir === 'left') setCurrentIndex(i => Math.min(i + 1, ideas.length - 1));
        if (dir === 'right') setCurrentIndex(i => Math.max(i - 1, 0));
        return;
      }
      const action = swipeDirectionToAction(dir);
      if (!action) return;
      if (mode === 'HYBRID' && (action === 'fire' || action === 'maybe')) return;
      if (action === 'fire' && !allowFire) return;
      handleSwipe(action);
    },
  });

  const safeIndex = mode === 'BAR' ? Math.max(0, Math.min(currentIndex, ideas.length - 1)) : currentIndex;
  const currentIdea = ideas[safeIndex];
  const remaining = mode === 'BAR' ? ideas.length : ideas.length - currentIndex;

  // Batch review threshold — default 10
  const BATCH_THRESHOLD = 10;
  const showReviewAll = pendingCount >= BATCH_THRESHOLD;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-mc-text-secondary animate-pulse">Loading ideas...</div>
      </div>
    );
  }

  if (loadError !== null) {
    return <FetchError code={loadError} onRetry={loadDeck} />;
  }

  if (!currentIdea || remaining <= 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="text-4xl">&#10024;</div>
        <h3 className="text-lg font-semibold text-mc-text">All caught up!</h3>
        <p className="text-sm text-mc-text-secondary">No more ideas to review right now.</p>
        <div className="flex gap-4 text-sm text-mc-text-secondary">
          <span className="text-green-400">{sessionStats.approved + sessionStats.fired} approved</span>
          <span className="text-red-400">{sessionStats.rejected} rejected</span>
          <span className="text-amber-400">{sessionStats.maybe} maybe</span>
        </div>
        <button
          onClick={loadDeck}
          className="px-4 py-2 bg-mc-accent/20 text-mc-accent rounded-lg hover:bg-mc-accent/30 transition-colors"
        >
          Refresh deck
        </button>
      </div>
    );
  }

  // Card animation styles
  const getCardStyle = () => {
    if (animatingOut) {
      const transforms: Record<string, string> = {
        left: 'translateX(-120%) rotate(-15deg)',
        right: 'translateX(120%) rotate(15deg)',
        up: 'translateY(-120%) scale(1.1)',
        down: 'translateY(120%) scale(0.9)',
      };
      return {
        transform: transforms[animatingOut],
        opacity: 0,
        transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
      };
    }
    if (offsetX !== 0 || offsetY !== 0) {
      const rotation = offsetX * 0.1;
      return {
        transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg)`,
        transition: 'none',
      };
    }
    return { transition: 'transform 0.2s ease-out' };
  };

  // Direction indicator
  const getOverlayColor = () => {
    if (!direction) return 'transparent';
    switch (direction) {
      case 'right': return 'rgba(34, 197, 94, 0.15)';
      case 'left': return 'rgba(239, 68, 68, 0.15)';
      case 'up': return 'rgba(249, 115, 22, 0.15)';
      case 'down': return 'rgba(245, 158, 11, 0.15)';
      default: return 'transparent';
    }
  };

  return (
    <div className={`flex flex-col items-center space-y-6 ${mode !== 'FULL' ? 'pb-24 lg:pb-0' : ''}`}>
      {/* Progress + Review All */}
      <div className="flex items-center gap-4">
        <div className="text-sm text-mc-text-secondary">
          {safeIndex + 1} / {ideas.length} ideas
        </div>
        {showReviewAll && (
          <Link
            href={`/autopilot/${productId}/review`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-mc-accent/20 text-mc-accent rounded-lg hover:bg-mc-accent/30 transition-colors"
          >
            <ListChecks className="w-3.5 h-3.5" />
            Review All ({pendingCount})
          </Link>
        )}
      </div>

      {/* Card stack */}
      <div
        className={`relative select-none ${mode === 'FULL' ? 'touch-none' : '[touch-action:pan-y]'}`}
        style={{ perspective: '1000px' }}
        {...handlers}
      >
        {/* Background card (hint only — no content bleed) */}
        {ideas[currentIndex + 1] && (
          <div className="absolute inset-2 top-3 rounded-xl bg-mc-bg-secondary border border-mc-border opacity-30 pointer-events-none" />
        )}
        {ideas[currentIndex + 2] && (
          <div className="absolute inset-4 top-5 rounded-xl bg-mc-bg-secondary border border-mc-border opacity-15 pointer-events-none" />
        )}

        {/* Active card */}
        <div
          className="relative z-10"
          style={{
            ...getCardStyle(),
            backgroundColor: getOverlayColor(),
            borderRadius: '0.75rem',
          }}
          onClick={(e) => {
            if (mode !== 'FULL') return;
            if ((e.target as HTMLElement).closest('button')) return;
            setShowDetail(true);
          }}
        >
          <div className={mode === 'FULL'
            ? 'relative max-h-[62vh] overflow-hidden rounded-xl'
            : 'max-h-[62vh] overflow-y-auto overscroll-contain rounded-xl'}
          >
            <IdeaCard
              idea={currentIdea}
              onAction={(action, notes) => handleSwipe(action, notes)}
              showActions={mode === 'FULL'}
              showFire={allowFire}
            />
            {mode === 'FULL' && (
              <div className="absolute bottom-0 inset-x-0 h-14 bg-gradient-to-t from-mc-bg-secondary to-transparent flex items-end justify-center pb-1.5 pointer-events-none rounded-b-xl">
                <span className="text-[10px] text-mc-text-secondary uppercase tracking-wider">Tap card to expand</span>
              </div>
            )}
          </div>
        </div>

        {/* Direction label */}
        {direction && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-lg font-bold pointer-events-none z-10">
            {mode === 'BAR' ? (
              <>
                {direction === 'left' && <span className="text-mc-text">NEXT &rarr;</span>}
                {direction === 'right' && <span className="text-mc-text">&larr; PREV</span>}
              </>
            ) : (
              <>
                {direction === 'right' && <span className="text-green-400">YES</span>}
                {direction === 'left' && <span className="text-red-400">PASS</span>}
                {direction === 'up' && allowFire && <span className="text-orange-400">BUILD NOW!</span>}
                {direction === 'down' && <span className="text-amber-400">MAYBE</span>}
              </>
            )}
          </div>
        )}
      </div>

      {/* Action bar (HYBRID and BAR) — fixed on mobile, inline on desktop */}
      {mode !== 'FULL' && currentIdea && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-mc-bg-secondary/95 border-t border-mc-border p-3 lg:static lg:z-auto lg:bg-transparent lg:border-0 lg:p-0">
          <div className="max-w-md mx-auto mb-2">
            <textarea
              value={barNotes}
              onChange={(e) => setBarNotes(e.target.value)}
              onFocus={() => setBarNotesFocused(true)}
              onBlur={() => setBarNotesFocused(false)}
              maxLength={2000}
              rows={barNotesFocused || barNotes.trim() ? 2 : 1}
              placeholder="Optional note — why this decision? Feeds future idea generation."
              className="w-full text-sm rounded-lg bg-mc-bg-tertiary border border-mc-border text-mc-text placeholder:text-mc-text-secondary p-2 resize-none focus:outline-none focus:border-mc-accent"
            />
          </div>
          <div className={`grid gap-2 max-w-md mx-auto ${allowFire ? 'grid-cols-4' : 'grid-cols-3'}`}>
            <button
              onClick={() => handleSwipe('reject', barNotes.trim() || undefined)}
              className="min-h-11 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium transition-colors"
            >
              Pass
            </button>
            <button
              onClick={() => handleSwipe('maybe', barNotes.trim() || undefined)}
              className="min-h-11 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-sm font-medium transition-colors"
            >
              Maybe
            </button>
            {allowFire && (
              <button
                onClick={() => handleSwipe('fire', barNotes.trim() || undefined)}
                className="min-h-11 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 text-sm font-medium transition-colors"
              >
                Now
              </button>
            )}
            <button
              onClick={() => handleSwipe('approve', barNotes.trim() || undefined)}
              className="min-h-11 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 text-sm font-medium transition-colors"
            >
              Yes
            </button>
          </div>
        </div>
      )}

      {/* Decision counters — all-time per product, hydrated from swipe history */}
      <div className="flex gap-4 text-xs text-mc-text-secondary">
        <span>Remaining: {remaining}</span>
        <span className="text-green-400">{sessionStats.approved} yes</span>
        <span className="text-orange-400">{sessionStats.fired} now</span>
        <span className="text-amber-400">{sessionStats.maybe} maybe</span>
        <span className="text-red-400">{sessionStats.rejected} pass</span>
      </div>

      {/* Keyboard hint */}
      <div className="text-xs text-mc-text-secondary/50">
        {mode === 'FULL' && <>&larr; Pass &middot; &darr; Maybe &middot; &rarr; Yes {allowFire && <>&middot; &uarr; Build Now </>}&middot; Tap to expand</>}
        {mode === 'HYBRID' && <>&larr; Pass &middot; &rarr; Yes &middot; buttons for {allowFire ? 'Maybe / Now' : 'Maybe'}</>}
        {mode === 'BAR' && <>&larr; Next &middot; &rarr; Previous &middot; decide with buttons</>}
      </div>

      {/* Detail view (FULL) — scrollable, actions available */}
      {showDetail && currentIdea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowDetail(false)} />
          <button
            onClick={() => setShowDetail(false)}
            className="absolute top-3 right-3 z-20 p-2 rounded-full bg-mc-bg-secondary border border-mc-border text-mc-text-secondary hover:text-mc-text"
            aria-label="Close detail view"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="relative z-10 w-full max-w-md max-h-[88vh] overflow-y-auto overscroll-contain rounded-xl">
            <IdeaCard
              idea={currentIdea}
              onAction={(action, notes) => {
                setShowDetail(false);
                handleSwipe(action, notes);
              }}
              showFire={allowFire}
              showNotesInput
            />
          </div>
        </div>
      )}

      {/* Undo toast — fixed at bottom */}
      {lastSwipe && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <UndoToast
            key={lastSwipe.swipeId}
            swipeId={lastSwipe.swipeId}
            ideaTitle={lastSwipe.idea.title}
            action={lastSwipe.action}
            productId={productId}
            onUndo={handleUndo}
            onExpire={handleUndoExpire}
          />
        </div>
      )}
    </div>
  );
}
