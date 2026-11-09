import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { Modal } from "../ui/Modal";
import { GButton } from "../ui/primitives";
import "./QuestionImageViewer.css";

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8] as const;

export function QuestionImageViewer({ src, alt, width, height, onClose, shouldRestoreFocus }: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  onClose: () => void;
  shouldRestoreFocus?: () => boolean;
}) {
  const hintId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: width || 1, height: height || 1 });
  const [level, setLevel] = useState(0);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const lastImageWidth = useRef(0);
  const zoom = ZOOM_LEVELS[level];
  const fit = viewport.width && viewport.height ? Math.min(1, viewport.width / natural.width, viewport.height / natural.height) : 1;
  const imageWidth = Math.max(1, Math.round(natural.width * fit * zoom));
  const imageHeight = Math.max(1, Math.round(natural.height * fit * zoom));

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => setViewport(previous => previous.width === element.clientWidth && previous.height === element.clientHeight
      ? previous : { width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    // Keep the inspected area near the center while zooming; Fit always resets panning.
    const ratio = lastImageWidth.current ? imageWidth / lastImageWidth.current : 1;
    element.scrollLeft = level ? (element.scrollLeft + element.clientWidth / 2) * ratio - element.clientWidth / 2 : 0;
    element.scrollTop = level ? (element.scrollTop + element.clientHeight / 2) * ratio - element.clientHeight / 2 : 0;
    lastImageWidth.current = imageWidth;
  }, [imageWidth, level]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Modal owns focus traversal and dismissal. Other keys must not answer or
    // submit the quiz behind this focusable viewport; browser defaults remain available.
    if (event.key === "Escape" || event.key === "Tab") return;
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") setLevel(value => Math.min(ZOOM_LEVELS.length - 1, value + 1));
    else if (event.key === "-") setLevel(value => Math.max(0, value - 1));
    else if (event.key === "0") setLevel(0);
    else if (event.target === viewportRef.current && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      const element = viewportRef.current;
      element.scrollLeft += event.key === "ArrowRight" ? 80 : event.key === "ArrowLeft" ? -80 : 0;
      element.scrollTop += event.key === "ArrowDown" ? 80 : event.key === "ArrowUp" ? -80 : 0;
    } else return;
    event.preventDefault();
  }

  return <Modal title={alt} onClose={onClose} shouldRestoreFocus={shouldRestoreFocus}
    className="question-image-viewer" bodyClassName="question-image-viewer__body">
    <div className="question-image-viewer__content" onKeyDown={onKeyDown}>
      <div className="question-image-viewer__toolbar" role="group" aria-label="Image zoom controls">
        <GButton type="button" iconOnly aria-label="Zoom out" disabled={level === 0} onClick={() => setLevel(value => Math.max(0, value - 1))}><ZoomOut size={ICON_SIZE.control} aria-hidden="true" /></GButton>
        <output className="question-image-viewer__scale" aria-label="Image zoom" aria-live="polite">{Math.round(zoom * 100)}%</output>
        <GButton type="button" iconOnly aria-label="Zoom in" disabled={level === ZOOM_LEVELS.length - 1} onClick={() => setLevel(value => Math.min(ZOOM_LEVELS.length - 1, value + 1))}><ZoomIn size={ICON_SIZE.control} aria-hidden="true" /></GButton>
        <GButton type="button" onClick={() => setLevel(0)} disabled={level === 0}><Maximize2 size={ICON_SIZE.body} aria-hidden="true" /> Fit</GButton>
      </div>
      <div ref={viewportRef} className="question-image-viewer__viewport" tabIndex={0} role="region" aria-label="Image detail" aria-describedby={hintId}
        data-zoomed={level > 0} data-panning={panning}
        onPointerDown={event => {
          // Touch uses native scrolling and browser pinch zoom. Mouse users can drag either axis.
          if (event.pointerType !== "mouse" || event.button !== 0 || level === 0) return;
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.currentTarget.focus();
          setPanning(true);
          event.preventDefault();
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (!start || event.pointerId !== start.pointerId) return;
          event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
          event.currentTarget.scrollTop = start.top + start.y - event.clientY;
          event.preventDefault();
        }}
        onPointerUp={event => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null; setPanning(false);
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; setPanning(false); }}
        onLostPointerCapture={() => { drag.current = null; setPanning(false); }}>
        <div className="question-image-viewer__canvas" style={{ width: Math.max(imageWidth, viewport.width), minHeight: Math.max(imageHeight, viewport.height) }}>
          <img src={src} alt={alt} className="question-image-viewer__image" draggable={false}
            style={{ width: imageWidth, height: imageHeight }}
            onLoad={event => {
              const image = event.currentTarget;
              if (image.naturalWidth && image.naturalHeight) setNatural({ width: image.naturalWidth, height: image.naturalHeight });
            }} />
        </div>
      </div>
      <p id={hintId} className="question-image-viewer__hint">Zoom in to inspect. Drag or scroll to move. Keyboard: + / − to zoom, 0 to fit, arrows to move.</p>
    </div>
  </Modal>;
}
