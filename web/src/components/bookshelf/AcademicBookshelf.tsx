// The academic bookshelf: real books on shelves, one shelf to a term. A book
// lifts on hover and focus, comes off the shelf and opens when chosen, and
// goes back where it stood when closed. The books and their thickness come
// in as data (lib/bookshelf); this file only draws and moves them.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { spineHeight, spineThickness, spineTone, type BookShelf, type ShelfBook } from "../../lib/bookshelf/model";
import "../../styles/bookshelf.css";

export interface AcademicBookshelfProps<T extends ShelfBook> {
  /** Names the whole shelf for a screen reader: "Course library". */
  label: string;
  shelves: readonly BookShelf<T>[];
  /** The inside of an open book. `close` puts it back and returns focus to its spine. */
  renderBook: (book: T, close: () => void) => ReactNode;
  /** Shown in place of the shelves when there is not a single book. */
  empty?: ReactNode;
}

type Phase = "closed" | "lifting" | "turning" | "opening" | "open" | "closing" | "returning";

/** How long each step of the opening takes, in milliseconds. Kept beside the CSS that uses the same numbers. */
const STEP = { turning: 560, opening: 520, closing: 380, returning: 480 } as const;

const prefersLessMotion = (): boolean =>
  typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce");

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function describe(book: ShelfBook): string {
  return `${book.title}${book.identifier ? `, ${book.identifier}` : ""}, ${book.shelf}. ${book.countLabel}.${book.stateNote ? ` ${book.stateNote}` : ""}`;
}

interface Flight {
  /** Where the spine stood, in the viewport. */
  from: { left: number; top: number; width: number; height: number };
  /** The size the cover reaches when it faces the reader. */
  cover: { width: number; height: number };
}

function measureFlight(spine: HTMLElement): Flight {
  const box = spine.getBoundingClientRect();
  const height = Math.min(window.innerHeight * 0.74, 600);
  const width = Math.min(height * 0.68, window.innerWidth - 48);
  return { from: { left: box.left, top: box.top, width: box.width, height: box.height }, cover: { width, height } };
}

function flightStyle(flight: Flight): CSSProperties {
  const scale = flight.from.height / flight.cover.height;
  return {
    "--cover-w": `${flight.cover.width}px`,
    "--cover-h": `${flight.cover.height}px`,
    "--spine-w": `${flight.from.width / scale}px`,
    "--from-x": `${flight.from.left + flight.from.width / 2 - window.innerWidth / 2}px`,
    "--from-y": `${flight.from.top + flight.from.height / 2 - window.innerHeight / 2}px`,
    "--from-scale": String(scale),
  } as CSSProperties;
}

export function AcademicBookshelf<T extends ShelfBook>({ label, shelves, renderBook, empty }: AcademicBookshelfProps<T>) {
  const books = useMemo(() => shelves.flatMap((shelf) => shelf.books), [shelves]);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("closed");
  const [flight, setFlight] = useState<Flight | undefined>(undefined);
  const spines = useRef(new Map<string, HTMLButtonElement>());
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | undefined>(undefined);
  const titleId = useId();
  const openBook = books.find((book) => book.id === openId);
  const tabStop = books.some((book) => book.id === focusId) ? focusId : books[0]?.id;

  const open = useCallback((book: T) => {
    const spine = spines.current.get(book.id);
    if (!spine || phase !== "closed") return;
    setFlight(measureFlight(spine));
    setOpenId(book.id);
    setFocusId(book.id);
    setPhase(prefersLessMotion() ? "open" : "lifting");
  }, [phase]);

  const close = useCallback(() => {
    if (phase !== "open") return;
    // The shelf may have scrolled while the book was open: fly back to where the gap is now.
    const spine = openId ? spines.current.get(openId) : undefined;
    if (spine) setFlight(measureFlight(spine));
    setPhase(prefersLessMotion() ? "closed" : "closing");
  }, [phase, openId]);

  // One step leads to the next. Each wait matches a transition in bookshelf.css.
  useEffect(() => {
    if (phase === "lifting") {
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("turning")));
      return () => cancelAnimationFrame(frame);
    }
    const next: Partial<Record<Phase, [Phase, number]>> = {
      turning: ["opening", STEP.turning],
      opening: ["open", STEP.opening],
      closing: ["returning", STEP.closing],
      returning: ["closed", STEP.returning],
    };
    const step = next[phase];
    if (!step) return undefined;
    const timer = window.setTimeout(() => setPhase(step[0]), step[1]);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // Back on the shelf. The spine is hidden while its book is out, and a hidden
  // button cannot take focus, so focus returns one render later, once it shows again.
  useLayoutEffect(() => {
    if (phase !== "closed" || !openId) return;
    returnTo.current = openId;
    setOpenId(undefined);
    setFlight(undefined);
  }, [phase, openId]);
  useLayoutEffect(() => {
    if (openId || !returnTo.current) return;
    spines.current.get(returnTo.current)?.focus({ preventScroll: true });
    returnTo.current = undefined;
  }, [openId]);

  // Open: focus moves inside, Tab stays inside, Escape closes.
  useEffect(() => {
    if (phase !== "open") return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog).focus({ preventScroll: true });
    const onKey = (event: globalThis.KeyboardEvent) => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, close]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, shelfIndex: number, bookIndex: number) => {
    const shelf = shelves[shelfIndex];
    const go = (target: ShelfBook | undefined) => {
      if (!target) return;
      event.preventDefault();
      setFocusId(target.id);
      spines.current.get(target.id)?.focus();
    };
    const onShelf = (index: number, at: number) => shelves[index]?.books[Math.min(at, (shelves[index]?.books.length ?? 1) - 1)];
    if (event.key === "ArrowRight") go(shelf.books[bookIndex + 1] ?? shelves[shelfIndex + 1]?.books[0]);
    else if (event.key === "ArrowLeft") go(shelf.books[bookIndex - 1] ?? shelves[shelfIndex - 1]?.books[shelves[shelfIndex - 1].books.length - 1]);
    else if (event.key === "ArrowDown") go(onShelf(shelfIndex + 1, bookIndex));
    else if (event.key === "ArrowUp") go(onShelf(shelfIndex - 1, bookIndex));
    else if (event.key === "Home") go(shelf.books[0]);
    else if (event.key === "End") go(shelf.books[shelf.books.length - 1]);
  };

  if (!books.length) return <div className="academic-bookshelf academic-bookshelf-empty">{empty}</div>;

  const openTone = openBook ? toneOf(shelves, openBook.id) : undefined;
  return (
    <div className="academic-bookshelf" data-open={phase !== "closed" ? "true" : undefined} role="region" aria-label={label}>
      <p className="bookshelf-hint" id={`${titleId}-hint`}>Arrow keys move along the shelves. Enter opens a book.</p>
      <div className="bookshelf-shelves" aria-hidden={phase === "open" ? "true" : undefined}>
        {shelves.map((shelf, shelfIndex) => (
          <section key={shelf.id} className="bookshelf-shelf" aria-label={shelf.label}>
            <h3 className="bookshelf-plate">{shelf.label}</h3>
            <ul className="bookshelf-row" role="list">
              {shelf.books.map((book, bookIndex) => {
                const tone = spineTone(shelfIndex, bookIndex);
                return (
                  <li key={book.id} className="bookshelf-slot">
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) spines.current.set(book.id, element);
                        else spines.current.delete(book.id);
                      }}
                      className="shelf-book"
                      data-state={book.state}
                      data-tone={tone.family}
                      data-step={tone.step}
                      data-out={book.id === openId ? "true" : undefined}
                      style={{ "--spine": `${spineThickness(book.count)}px`, "--rise": String(spineHeight(book.id)) } as CSSProperties}
                      aria-label={describe(book)}
                      aria-describedby={`${titleId}-hint`}
                      aria-haspopup="dialog"
                      tabIndex={book.id === tabStop ? 0 : -1}
                      onFocus={() => setFocusId(book.id)}
                      onKeyDown={(event) => move(event, shelfIndex, bookIndex)}
                      onClick={() => open(book)}
                    >
                      <span className="shelf-book-body" aria-hidden="true">
                        <span className="shelf-book-spine">
                          <span className="spine-crest">Λ</span>
                          <span className="spine-title">{book.title}</span>
                          {book.identifier && <span className="spine-id">{book.identifier}</span>}
                        </span>
                        <span className="shelf-book-cover" />
                        <span className="shelf-book-top" />
                      </span>
                      <span className="shelf-book-tip" aria-hidden="true">
                        <strong>{book.title}</strong>
                        <span>{book.state === "empty" ? book.stateNote ?? "Empty" : book.countLabel}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="bookshelf-plank" aria-hidden="true" />
          </section>
        ))}
      </div>
      {openBook && flight && createPortal(
        <div className="open-book-layer" data-phase={phase} data-tone={openTone?.family} data-step={openTone?.step} style={flightStyle(flight)}>
          <div className="open-book-scrim" onClick={close} />
          <div className="book-flight" aria-hidden="true">
            <div className="book-flight-box">
              <span className="flight-spine"><span className="spine-crest">Λ</span><span className="spine-title">{openBook.title}</span></span>
              <span className="flight-pages" />
              <span className="flight-cover">
                <span className="flight-cover-face">
                  <span className="cover-crest">Λ</span>
                  <span className="cover-title">{openBook.title}</span>
                  {openBook.identifier && <span className="cover-id">{openBook.identifier}</span>}
                  <span className="cover-shelf">{openBook.shelf}</span>
                </span>
                <span className="flight-cover-inside" />
              </span>
            </div>
          </div>
          <div ref={dialogRef} className="open-book" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} aria-hidden={phase === "open" ? undefined : "true"}>
            <header className="open-book-head">
              <div>
                <p className="open-book-kicker">{[openBook.shelf, openBook.identifier].filter(Boolean).join(" · ")}</p>
                <h2 id={titleId} className="open-book-title">{openBook.title}</h2>
              </div>
              <button type="button" className="open-book-close" onClick={close} aria-label={`Close ${openBook.title} and put it back`} data-autofocus>
                <X size={ICON_SIZE.control} aria-hidden="true" />
              </button>
            </header>
            <div className="open-book-body">{renderBook(openBook, close)}</div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function toneOf(shelves: readonly BookShelf[], id: string): { family: number; step: number } | undefined {
  for (const [shelfIndex, shelf] of shelves.entries()) {
    const bookIndex = shelf.books.findIndex((book) => book.id === id);
    if (bookIndex >= 0) return spineTone(shelfIndex, bookIndex);
  }
  return undefined;
}
