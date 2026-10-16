import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_IDLE_TIMEOUT_MS = 28 * 60 * 1000; // 28 minutos hasta mostrar aviso
const DEFAULT_COUNTDOWN_SECONDS = 2 * 60; // 2 minutos (120 segundos) para cerrar a los 30 min

interface UseIdleTimerOptions {
  enabled: boolean;
  idleTimeoutMs?: number;
  countdownSeconds?: number;
  onTimeout: () => void;
}

export function useIdleTimer({
  enabled,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  countdownSeconds = DEFAULT_COUNTDOWN_SECONDS,
  onTimeout,
}: UseIdleTimerOptions) {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(countdownSeconds);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  const showWarningRef = useRef(showWarning);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    showWarningRef.current = showWarning;
  }, [showWarning]);

  const clearAll = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const scheduleIdleWarning = useCallback(() => {
    clearAll();
    if (!enabled) return;

    idleTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      setRemainingSeconds(countdownSeconds);

      countdownIntervalRef.current = setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            clearAll();
            setShowWarning(false);
            onTimeoutRef.current();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, idleTimeoutMs);
  }, [clearAll, countdownSeconds, enabled, idleTimeoutMs]);

  useEffect(() => {
    if (!enabled) {
      clearAll();
      return;
    }

    scheduleIdleWarning();

    const activityEvents = [
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
      'wheel',
    ] as const;

    const handleUserActivity = () => {
      if (!showWarningRef.current) {
        scheduleIdleWarning();
      }
    };

    activityEvents.forEach((event) => {
      window.addEventListener(event, handleUserActivity, { passive: true });
    });

    return () => {
      clearAll();
      activityEvents.forEach((event) => {
        window.removeEventListener(event, handleUserActivity);
      });
    };
  }, [enabled, scheduleIdleWarning, clearAll]);

  const stayActive = useCallback(() => {
    setShowWarning(false);
    setRemainingSeconds(countdownSeconds);
    scheduleIdleWarning();
  }, [countdownSeconds, scheduleIdleWarning]);

  return {
    showWarning,
    remainingSeconds,
    stayActive,
  };
}

