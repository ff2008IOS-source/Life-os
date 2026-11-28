"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * "Take me on a tutorial": a guided walk through every page. Each stop opens
 * its page, highlights the real thing on it and says what it does and how to
 * use it. Start it from Settings → Account, from search, or with
 * /settings?tour=start. Progress lives in this browser tab only.
 */
export type TourStop = {
  path: string;
  /** What to highlight; the stop still shows if it isn't on the page. */
  target?: string;
  title: string;
  body: string;
};

export const TOUR: TourStop[] = [
  {
    path: "/",
    target: ".td-now-title",
    title: "Today: do this next",
    body: "Your one next action, picked from deadlines, your calendar's free time and priorities. Start it, skip it, or press Other to choose from everything open in your life.",
  },
  {
    path: "/",
    target: ".headline-numbers",
    title: "Today at a glance",
    body: "The numbers that matter today: what's due, how much free time is left and how the week is going.",
  },
  {
    path: "/",
    target: ".shape-river",
    title: "Your day as a river",
    body: "Classes, practices and blocks in time order, with the free gaps between them so you can see where work fits.",
  },
  {
    path: "/",
    target: ".skyline",
    title: "The week's skyline",
    body: "Taller days are busier; pins are deadlines. Plan heavy work for the short buildings.",
  },
  {
    path: "/",
    target: "[data-tour=search]",
    title: "Search everything",
    body: "Find any task, course file, email, person or page. On a keyboard press ⌘K (Ctrl K).",
  },
  {
    path: "/",
    target: "[data-tour=quick-add]",
    title: "Quick add",
    body: "Capture a task in seconds from any page: a title is enough, details can wait.",
  },
  {
    path: "/planner",
    target: ".planner-calendar",
    title: "Week planner",
    body: "Your Google calendars in one week view, coloured by area. Drag Life OS blocks to move them, click an empty slot to add one; shaded stretches are free time.",
  },
  {
    path: "/areas/academics",
    target: ".course-shelf",
    title: "School",
    body: "Each course is a book on the shelf. Open one for its overview, materials (with search), grades and the grade planner that shows what you need on what's left.",
  },
  {
    path: "/growth",
    target: ".orbit",
    title: "Growth: your people",
    body: "Contacts orbit by how recently you spoke. A pulsing ring means a follow-up is due. Tap someone to log a conversation or add a photo.",
  },
  {
    path: "/goals",
    target: ".trail",
    title: "Goals as trails",
    body: "Each goal is a path from start to finish; the walked part is what's done. Link tasks and projects to a goal to move along it.",
  },
  {
    path: "/reviews",
    target: ".postcards",
    title: "Weekly reviews",
    body: "Every Sunday you sit down with Gemini to review the week, ask about what's coming and build study plans. Past reviews are postcards you can open any day.",
  },
  {
    path: "/insights",
    target: ".insight-numbers",
    title: "Insights",
    body: "How your time and work have been going over the weeks, from what you actually did.",
  },
  {
    path: "/settings?section=integrations",
    target: ".st-switchboard",
    title: "Connections",
    body: "Everything Life OS reads from. A line turns amber when something needs you, and its row has the one button that fixes it.",
  },
  {
    path: "/settings?section=integrations",
    target: "#st-canvas-key",
    title: "Your Canvas key",
    body: "Days left before the SFU Canvas key needs renewing, with step-by-step renewal instructions tucked underneath.",
  },
  {
    path: "/settings?section=privacy",
    target: ".st-lock",
    title: "You're all set",
    body: "Two-step sign-in and remembered devices live here. You can take this tour again any time from Settings → Account → Take me on a tutorial.",
  },
];

const KEY = "lifeos_tour_step";
const EVENT = "lifeos-tour";
const readStep = () => {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
};
const writeStep = (step: number | null) => {
  try {
    if (step === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, String(step));
  } catch {
    /* The tour still runs for this page view. */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: step }));
};
export const startTour = () => writeStep(0);

const here = (pathname: string, search: string, path: string) => {
  const [p, q] = path.split("?");
  if (pathname !== p) return false;
  if (!q) return true;
  const want = new URLSearchParams(q);
  const have = new URLSearchParams(search);
  return [...want].every(([k, v]) => have.get(k) === v);
};

type Box = { top: number; left: number; width: number; height: number };

export function GuidedTour() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search.toString();
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const card = useRef<HTMLDivElement>(null);

  // Pick up a tour in progress (after a reload) or a ?tour=start link.
  useEffect(() => {
    const id = setTimeout(() => {
      if (search.get("tour") === "start") writeStep(0);
      else setStep(readStep());
    }, 0);
    const on = (e: Event) => setStep((e as CustomEvent<number | null>).detail);
    window.addEventListener(EVENT, on);
    return () => {
      clearTimeout(id);
      window.removeEventListener(EVENT, on);
    };
  }, [search]);

  const stop = step === null ? null : TOUR[step];

  // Go to the stop's page.
  useEffect(() => {
    if (stop && !here(pathname, query, stop.path)) router.push(stop.path);
  }, [stop, pathname, query, router]);

  // Find and follow the highlighted element.
  // Keep the card on screen: below the highlight, or above it if there's no room.
  const [place, setPlace] = useState<React.CSSProperties>({});
  const measure = useCallback(() => {
    const el = stop?.target ? document.querySelector(stop.target) : null;
    const r = el?.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) {
      setBox(null);
      setPlace({});
      return;
    }
    setBox((b) =>
      b &&
      b.top === r.top &&
      b.left === r.left &&
      b.width === r.width &&
      b.height === r.height
        ? b
        : { top: r.top, left: r.left, width: r.width, height: r.height },
    );
    const vw = window.innerWidth,
      vh = window.innerHeight;
    if (vw < 560) return setPlace({});
    const h = card.current?.offsetHeight ?? 220;
    const w = Math.min(380, vw - 32);
    const left = Math.min(Math.max(16, r.left), vw - w - 16);
    const below = r.bottom + 14;
    const top = below + h < vh - 16 ? below : Math.max(16, r.top - h - 14);
    setPlace({ top, left, width: w, bottom: "auto", right: "auto" });
  }, [stop]);
  useEffect(() => {
    if (!stop || !here(pathname, query, stop.path)) return;
    let tries = 0;
    const find = setInterval(() => {
      const el = stop.target ? document.querySelector(stop.target) : null;
      if (el || ++tries > 30) {
        clearInterval(find);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(measure, 350);
        card.current?.focus();
      }
    }, 100);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    // Pages keep loading after they appear; follow the highlight as they settle.
    const follow = setInterval(measure, 400);
    return () => {
      clearInterval(find);
      clearInterval(follow);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [stop, pathname, query, measure]);

  useEffect(() => {
    if (step === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") writeStep(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [step]);

  if (!stop || step === null) return null;
  const last = step === TOUR.length - 1;
  return (
    <div className="tour" aria-live="polite">
      {box ? (
        <div
          className="tour-spot"
          style={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
          }}
          aria-hidden
        />
      ) : (
        <div className="tour-dim" aria-hidden />
      )}
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        tabIndex={-1}
        style={place}
      >
        <span className="tour-count">
          {step + 1} of {TOUR.length}
        </span>
        <h2 id="tour-title">{stop.title}</h2>
        <p>{stop.body}</p>
        <div className="tour-progress" aria-hidden>
          {TOUR.map((_, i) => (
            <i key={i} className={i <= step ? "on" : ""} />
          ))}
        </div>
        <div className="tour-actions">
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={() => writeStep(null)}
          >
            End tour
          </button>
          <span>
            {step > 0 && (
              <button
                type="button"
                className="button button-outline button-sm"
                onClick={() => writeStep(step - 1)}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className="button button-primary button-sm"
              onClick={() => writeStep(last ? null : step + 1)}
            >
              {last ? "Finish" : "Next"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
