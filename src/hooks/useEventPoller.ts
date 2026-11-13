/**
 * React hook – wraps the EventPoller service for React component use.
 *
 * • Starts / stops the poller based on connection status.
 * • Provides the latest event plus poller status as React state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { EventPoller, EventPollerStatus } from '../services/eventPoller';
import { EventPollingResponse } from '../types/ccapi';
import { ccapi } from '../services/ccapi';

interface UseEventPollerReturn {
  pollerStatus: EventPollerStatus;
  lastEvent: EventPollingResponse | null;
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

export function useEventPoller(
  isConnected: boolean,
  onNewContent?: (urls: string[]) => void,
): UseEventPollerReturn {
  const pollerRef = useRef<EventPoller | null>(null);
  const [pollerStatus, setPollerStatus] = useState<EventPollerStatus>('idle');
  const [lastEvent, setLastEvent] = useState<EventPollingResponse | null>(null);

  // Keep a stable ref of the callback so we don't re-subscribe every render.
  const onNewContentRef = useRef(onNewContent);
  onNewContentRef.current = onNewContent;

  // ── Lazy initialisation ──────────────────────────────────────

  const getPoller = useCallback(() => {
    if (!pollerRef.current) {
      const poller = new EventPoller(ccapi);
      poller.onStatusChange((s) => setPollerStatus(s));
      poller.onEvent((evt) => {
        setLastEvent(evt);
        const newContents = [
          ...(evt.addedcontents || []),
          ...(evt.updatedcontents || []),
        ];
        if (newContents.length > 0) {
          onNewContentRef.current?.(newContents);
        }
      });
      pollerRef.current = poller;
    }
    return pollerRef.current;
  }, []);

  // ── Controls ─────────────────────────────────────────────────

  const start = useCallback(() => getPoller().start(), [getPoller]);
  const stop = useCallback(() => getPoller().stop(), [getPoller]);
  const pause = useCallback(() => getPoller().pause(), [getPoller]);
  const resume = useCallback(() => getPoller().resume(), [getPoller]);

  // Auto-start / stop based on connection state.
  useEffect(() => {
    if (isConnected) {
      getPoller().start();
    } else {
      getPoller().stop();
    }
    return () => {
      pollerRef.current?.stop();
    };
  }, [isConnected, getPoller]);

  return { pollerStatus, lastEvent, start, stop, pause, resume };
}
