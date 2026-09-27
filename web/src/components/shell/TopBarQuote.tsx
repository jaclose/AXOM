import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, EyeOff, Quote, RotateCcw, Settings2, Star, X } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { useQuoteRotation } from "../../lib/useQuoteRotation";
import {
  QUOTE_CATEGORIES,
  QUOTE_ROTATIONS,
  hideQuote,
  toggleFavoriteQuote,
  type QuoteRotation,
} from "../../lib/quotePreferences";
import { QUOTE_CATEGORY_LABELS, type QuoteAttributionStatus, type QuoteCategory } from "../../data/quotes";

export function attributionLabel(status: QuoteAttributionStatus) {
  if (status === "axom-original") return "AXOM original";
  if (status === "commonly-attributed") return "Commonly attributed";
  if (status === "paraphrased") return "Paraphrased";
  if (status === "verified") return "Verified";
  return "Attribution unverified";
}

/**
 * The daily quote, living in the top bar next to the clock on every page.
 * Click the line to open the full quote with its controls; the gear opens
 * rotation and library preferences. Everything here is device-only.
 */
export function TopBarQuote({ dayKey, route }: { dayKey: string; route: string }) {
  const { quote, preferences, save, next, previous, libraryCount } = useQuoteRotation(dayKey, route);
  const [open, setOpen] = useState<"quote" | "settings" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(null); }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const favorite = quote ? preferences.favoriteQuoteIds.includes(quote.id) : false;
  const showLine = preferences.quoteVisible && quote;
  const selectedCategories = new Set(preferences.categories);

  function toggleCategory(category: QuoteCategory) {
    const nextSet = new Set(selectedCategories);
    if (nextSet.has(category)) nextSet.delete(category);
    else nextSet.add(category);
    const list = QUOTE_CATEGORIES.filter((item) => nextSet.has(item));
    save({ ...preferences, categories: list, includeGuilt: list.includes("shame-guilt") });
  }

  return (
    <div className={`tb-quote ${showLine ? "" : "collapsed"}`} ref={rootRef}>
      {showLine ? (
        <button
          type="button"
          className="tb-quote-line"
          aria-expanded={open === "quote"}
          aria-controls={open === "quote" ? panelId : undefined}
          title={`${quote.text} — ${quote.author}`}
          onClick={() => setOpen(open === "quote" ? null : "quote")}
        >
          <Quote size={ICON_SIZE.microInline} aria-hidden="true" className="tb-quote-mark" />
          <span className="tb-quote-text">{quote.text}</span>
          <span className="tb-quote-author">— {quote.author}</span>
        </button>
      ) : null}
      <button
        type="button"
        className="tb-quote-gear"
        aria-label={showLine ? "Quote settings" : "Show quote and quote settings"}
        title="Quote settings"
        aria-expanded={open === "settings"}
        aria-controls={open === "settings" ? panelId : undefined}
        onClick={() => setOpen(open === "settings" ? null : "settings")}
      >
        {showLine ? <Settings2 size={ICON_SIZE.body} aria-hidden="true" /> : <Quote size={ICON_SIZE.body} aria-hidden="true" />}
      </button>

      {open && (
        <div id={panelId} className="tb-quote-popover" role="dialog" aria-labelledby={titleId}>
          <div className="tb-quote-popover-head">
            <span id={titleId}>{open === "quote" ? "Today’s line" : "Quote settings"}</span>
            <button type="button" className="clock-icon-button" aria-label="Close quote panel" onClick={() => setOpen(null)}>
              <X size={ICON_SIZE.body} aria-hidden="true" />
            </button>
          </div>

          {open === "quote" && quote && (
            <>
              <blockquote className="tb-quote-full">“{quote.text}”</blockquote>
              <div className="tb-quote-meta" title={quote.attributionNote}>
                <b>{quote.author}</b>
                <small>{attributionLabel(quote.attributionStatus)} · {QUOTE_CATEGORY_LABELS[quote.category]}</small>
              </div>
              <div className="tb-quote-actions">
                <button type="button" onClick={previous} aria-label="Previous quote"><ChevronLeft size={ICON_SIZE.body} aria-hidden="true" /></button>
                <button type="button" onClick={next} aria-label="Next quote"><ChevronRight size={ICON_SIZE.body} aria-hidden="true" /> Next</button>
                <button
                  type="button"
                  aria-pressed={favorite}
                  className={favorite ? "on" : ""}
                  onClick={() => save(toggleFavoriteQuote(preferences, quote.id))}
                >
                  <Star size={ICON_SIZE.body} aria-hidden="true" /> {favorite ? "Favorited" : "Favorite"}
                </button>
                <button type="button" onClick={() => { save(hideQuote(preferences, quote.id)); next(); }}>
                  <EyeOff size={ICON_SIZE.body} aria-hidden="true" /> Hide
                </button>
                <button type="button" onClick={() => setOpen("settings")} aria-label="Open quote settings">
                  <Settings2 size={ICON_SIZE.body} aria-hidden="true" />
                </button>
              </div>
            </>
          )}

          {open === "settings" && (
            <div className="tb-quote-settings">
              <label className="tb-quote-switch">
                <input
                  type="checkbox"
                  checked={preferences.quoteVisible}
                  onChange={(event) => save({ ...preferences, quoteVisible: event.target.checked })}
                />
                <span>Show a quote in the top bar</span>
              </label>
              <fieldset>
                <legend>Change the quote</legend>
                <div className="tb-quote-rotations">
                  {QUOTE_ROTATIONS.map((rotation) => (
                    <label key={rotation.id} className={preferences.rotation === rotation.id ? "on" : ""}>
                      <input
                        type="radio"
                        name={`${panelId}-rotation`}
                        checked={preferences.rotation === rotation.id}
                        onChange={() => save({ ...preferences, rotation: rotation.id as QuoteRotation })}
                      />
                      <span><b>{rotation.label}</b><small>{rotation.detail}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Draw from</legend>
                <div className="tb-quote-categories">
                  {QUOTE_CATEGORIES.map((category) => {
                    const on = selectedCategories.size === 0
                      ? category !== "shame-guilt" || preferences.includeGuilt
                      : selectedCategories.has(category);
                    return (
                      <button
                        key={category}
                        type="button"
                        className={`filter-pill ${on ? "on" : ""}`}
                        aria-pressed={on}
                        onClick={() => {
                          if (selectedCategories.size === 0) {
                            // First narrowing: start from "everything currently on" minus/plus this one.
                            const current = QUOTE_CATEGORIES.filter((item) => item !== "shame-guilt" || preferences.includeGuilt);
                            const nextList = on ? current.filter((item) => item !== category) : [...current, category];
                            save({ ...preferences, categories: nextList, includeGuilt: nextList.includes("shame-guilt") });
                          } else {
                            toggleCategory(category);
                          }
                        }}
                      >
                        {QUOTE_CATEGORY_LABELS[category]}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <label className="tb-quote-switch">
                <input
                  type="checkbox"
                  checked={preferences.favoritesFirst}
                  onChange={(event) => save({ ...preferences, favoritesFirst: event.target.checked })}
                />
                <span>Show my favorites more often</span>
              </label>
              <div className="tb-quote-footer">
                <span>{libraryCount} quotes · {preferences.favoriteQuoteIds.length} favorite{preferences.favoriteQuoteIds.length === 1 ? "" : "s"} · {preferences.hiddenQuoteIds.length} hidden</span>
                {(preferences.hiddenQuoteIds.length > 0 || preferences.categories.length > 0) && (
                  <button type="button" onClick={() => save({ ...preferences, hiddenQuoteIds: [], categories: [] })}>
                    <RotateCcw size={ICON_SIZE.microInline} aria-hidden="true" /> Reset library
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
