"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Politeness = "polite" | "assertive";

interface AnnouncerApi {
  /** Announce an important state transition. Duplicate messages within 2s are dropped. */
  announce: (message: string, politeness?: Politeness) => void;
}

const AnnouncerContext = createContext<AnnouncerApi>({ announce: () => {} });

/**
 * Live regions for state transitions (master plan §6 accessibility baseline):
 * announce *important* transitions only — never every progress tick.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const last = useRef<{ message: string; at: number }>({ message: "", at: 0 });

  const announce = useCallback((message: string, politeness: Politeness = "polite") => {
    const now = Date.now();
    if (last.current.message === message && now - last.current.at < 2000) return;
    last.current = { message, at: now };
    const set = politeness === "assertive" ? setAssertive : setPolite;
    // Clear then set so repeated identical messages are re-read after the window.
    set("");
    window.setTimeout(() => set(message), 50);
  }, []);

  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      <div className="pm-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="pm-visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): AnnouncerApi {
  return useContext(AnnouncerContext);
}
