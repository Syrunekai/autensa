'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, ChevronRight, ChevronLeft, ChevronDown, Zap, Clock, CheckCircle, AlertCircle, Loader, X } from 'lucide-react';
import type { AutopilotActivityEntry } from '@/lib/types';

interface ActivityPanelProps {
  productId: string;
}

const EVENT_ICONS: Record<string, React.ReactNode> = {
  phase_init: <Zap className="w-3.5 h-3.5 text-blue-400" />,
  phase_llm_submitted: <Loader className="w-3.5 h-3.5 text-yellow-400" />,
  phase_llm_polling: <Clock className="w-3.5 h-3.5 text-yellow-400 animate-spin" />,
  phase_report_received: <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  phase_ideas_parsed: <Zap className="w-3.5 h-3.5 text-purple-400" />,
  phase_ideas_stored: <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  phase_completed: <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  idea_stored: <Zap className="w-3.5 h-3.5 text-purple-400" />,
  error: <AlertCircle className="w-3.5 h-3.5 text-red-400" />,
  recovery_requeued: <Loader className="w-3.5 h-3.5 text-orange-400" />,
  recovery_interrupted: <AlertCircle className="w-3.5 h-3.5 text-red-400" />,
  recovery_completed: <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
};

function getEventIcon(eventType: string) {
  return EVENT_ICONS[eventType] || <Activity className="w-3.5 h-3.5 text-mc-text-secondary" />;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function groupByCycle(entries: AutopilotActivityEntry[]): Map<string, AutopilotActivityEntry[]> {
  const groups = new Map<string, AutopilotActivityEntry[]>();
  for (const entry of entries) {
    const key = `${entry.cycle_type}-${entry.cycle_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return groups;
}

function cycleLabel(cycleType: string, cycleNumber?: number): string {
  const type = cycleType === 'research' ? 'Research' : 'Ideation';
  // cycle_number is the per-type chronological ordinal provided by the API.
  return cycleNumber !== undefined ? `${type} Cycle #${cycleNumber}` : `${type} Cycle`;
}

const PANEL_MIN_WIDTH = 240;
const PANEL_MAX_WIDTH = 640;
const PANEL_DEFAULT_WIDTH = 320;
const PANEL_WIDTH_KEY = 'autopilot-activity-width';

export function ActivityPanel({ productId }: ActivityPanelProps) {
  const [entries, setEntries] = useState<AutopilotActivityEntry[]>([]);
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(`autopilot-activity-open-${productId}`) !== 'false';
  });
  // Desktop panel width, resizable via drag handle; persisted in localStorage.
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return PANEL_DEFAULT_WIDTH;
    const w = parseInt(localStorage.getItem(PANEL_WIDTH_KEY) || '', 10);
    return Number.isFinite(w) ? Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, w)) : PANEL_DEFAULT_WIDTH;
  });
  // Per-group collapse overrides; keys absent from the map use the default
  // (only the newest group of each type is expanded).
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const initialLoadDone = useRef(false);

  // Persist open/closed state
  useEffect(() => {
    localStorage.setItem(`autopilot-activity-open-${productId}`, String(isOpen));
  }, [isOpen, productId]);

  // Persist panel width
  useEffect(() => {
    localStorage.setItem(PANEL_WIDTH_KEY, String(width));
  }, [width]);

  // Drag-to-resize: width tracks the distance from the cursor to the right
  // viewport edge, clamped to the min/max bounds.
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      setWidth(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, window.innerWidth - ev.clientX)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Fetch initial entries (no auto-scroll on mount)
  useEffect(() => {
    fetch(`/api/products/${productId}/activity?limit=50`)
      .then(res => res.ok ? res.json() : { entries: [] })
      .then(data => {
        setEntries(data.entries.reverse()); // Oldest first for display
        // Mark initial load done after a tick so the scroll effect skips this batch
        requestAnimationFrame(() => { initialLoadDone.current = true; });
      })
      .catch(err => console.error('[ActivityPanel] Fetch failed:', err));
  }, [productId]);

  // Subscribe to SSE for live updates
  const handleSSEMessage = useCallback((event: MessageEvent) => {
    try {
      if (event.data.startsWith(':')) return;
      const sseEvent = JSON.parse(event.data);
      if (sseEvent.type === 'autopilot_activity' && sseEvent.payload?.product_id === productId) {
        setEntries(prev => [...prev, sseEvent.payload as AutopilotActivityEntry]);
      }
    } catch {
      // ignore parse errors
    }
  }, [productId]);

  useEffect(() => {
    const es = new EventSource('/api/events/stream');
    eventSourceRef.current = es;
    es.onmessage = handleSSEMessage;
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [handleSSEMessage]);

  // Scroll to the top when live entries arrive (groups render newest-first).
  // Skipped on initial load to preserve the current scroll position.
  useEffect(() => {
    if (initialLoadDone.current) {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [entries]);

  const grouped = groupByCycle(entries);
  // Groups are ordered newest-first; entries within a group remain chronological.
  const displayKeys = Array.from(grouped.keys()).reverse();
  // The newest group of each type is expanded by default.
  const newestOfType: Record<string, string> = {};
  for (const key of displayKeys) {
    const t = key.split('-')[0];
    if (!(t in newestOfType)) newestOfType[t] = key;
  }
  const isCollapsed = (key: string, cycleType: string) =>
    collapsedOverrides[key] ?? (newestOfType[cycleType] !== key);

  // Mobile drawer state
  const [mobileOpen, setMobileOpen] = useState(false);

  const panelContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-mc-border">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-mc-accent" />
          <span className="text-sm font-medium text-mc-text">Activity</span>
          <span className="text-xs text-mc-text-secondary">({entries.length})</span>
        </div>
        {/* Desktop: collapse button */}
        <button
          onClick={() => setIsOpen(false)}
          className="hidden lg:block text-mc-text-secondary hover:text-mc-text"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {/* Mobile: close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden text-mc-text-secondary hover:text-mc-text"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {entries.length === 0 && (
          <p className="text-xs text-mc-text-secondary text-center py-4">No activity yet</p>
        )}

        {displayKeys.map((key) => {
          const group = grouped.get(key)!;
          const cycleType = key.split('-')[0];
          const cycleNumber = group.find(e => e.cycle_number !== undefined)?.cycle_number;
          const collapsed = isCollapsed(key, cycleType);

          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => setCollapsedOverrides(prev => ({ ...prev, [key]: !collapsed }))}
                className="w-full flex items-center gap-1 text-[10px] font-semibold text-mc-text-secondary uppercase tracking-wider mb-1 hover:text-mc-text"
              >
                {collapsed
                  ? <ChevronRight className="w-3 h-3 shrink-0" />
                  : <ChevronDown className="w-3 h-3 shrink-0" />}
                <span>{cycleLabel(cycleType, cycleNumber)}</span>
                <span className="normal-case font-normal">({group.length})</span>
              </button>
              {!collapsed && (
              <div className="space-y-1">
                {group.map(entry => (
                  <div key={entry.id} className="flex items-start gap-2 text-xs group">
                    <div className="mt-0.5 shrink-0">{getEventIcon(entry.event_type)}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-mc-text">{entry.message}</span>
                      {entry.detail && (
                        <span className="text-mc-text-secondary ml-1">— {entry.detail}</span>
                      )}
                      {(entry.cost_usd != null && entry.cost_usd > 0) && (
                        <span className="text-green-400 ml-1">${entry.cost_usd.toFixed(4)}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-mc-text-secondary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {relativeTime(entry.created_at)}
                    </span>
                  </div>
                ))}
              </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: side panel (drag left edge to resize; width persisted) */}
      {isOpen ? (
        <div
          className="hidden lg:flex relative border-l border-mc-border bg-mc-bg-secondary flex-col"
          style={{ width }}
        >
          <div
            onMouseDown={startDrag}
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-mc-accent/40 z-10"
            title="Drag to resize"
          />
          {panelContent}
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="hidden lg:flex items-center justify-center w-8 border-l border-mc-border bg-mc-bg-secondary hover:bg-mc-bg text-mc-text-secondary hover:text-mc-text"
          title="Show activity panel"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}

      {/* Mobile: floating button + slide-over */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-mc-accent text-white shadow-lg flex items-center justify-center"
      >
        <Activity className="w-5 h-5" />
        {entries.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
            {Math.min(entries.length, 99)}
          </span>
        )}
      </button>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-mc-bg-secondary">
            {panelContent}
          </div>
        </div>
      )}
    </>
  );
}
