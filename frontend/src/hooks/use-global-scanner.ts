'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Detects physical barcode scanner input anywhere on the page.
 *
 * How barcode scanners work:
 * - They act as USB/Bluetooth keyboard emulators
 * - They type all characters very rapidly (< 50ms between chars)
 * - Then automatically press Enter
 * - Regular human typing is much slower (> 150ms per char)
 *
 * This hook listens at document level. When no input/textarea is focused
 * and rapid keystrokes followed by Enter are detected, it fires onScan().
 */
export function useGlobalScanner(onScan: (trackingNumber: string) => void) {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't intercept when user is typing in an input/textarea/select
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.target as HTMLElement)?.isContentEditable) return;

    const now = Date.now();
    const gap = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;

    // Gap > 100ms = new sequence (human keystroke or new scan)
    if (gap > 100) {
      bufferRef.current = '';
    }

    if (e.key === 'Enter') {
      const value = bufferRef.current.trim().toUpperCase();
      bufferRef.current = '';
      // Must be at least 6 chars to be a valid tracking number
      if (value.length >= 6) {
        onScanRef.current(value);
      }
    } else if (e.key.length === 1) {
      bufferRef.current += e.key;
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
