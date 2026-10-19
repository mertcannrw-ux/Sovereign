import { useEffect } from 'react';

const FAVICON = '/favicon.svg';
/** The same mark without the cursor: alternating the two blinks it. */
const FAVICON_NO_CURSOR = '/favicon-blink.svg';
const BLINK_MS = 500;

/**
 * Blinks the favicon's cursor while `active` and the tab is in the
 * background, so a running build shows in the tab strip. Restores the normal
 * favicon when the build ends or the tab comes back to the front.
 */
export function useFaviconBlink(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const link = document.querySelector<HTMLLinkElement>(`link[rel="icon"][href^="${FAVICON}"]`);
    if (!link) return;
    const original = link.href;
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      clearInterval(timer);
      timer = undefined;
      link.href = original;
    };
    const sync = () => {
      if (!document.hidden) return stop();
      if (timer) return;
      let cursorOn = true;
      timer = setInterval(() => {
        cursorOn = !cursorOn;
        link.href = cursorOn ? original : FAVICON_NO_CURSOR;
      }, BLINK_MS);
    };

    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      stop();
    };
  }, [active]);
}
