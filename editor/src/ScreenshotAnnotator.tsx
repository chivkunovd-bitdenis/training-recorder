import { useCallback, useEffect, useRef, useState } from "react";
import {
  drawAnnotationOnCanvas,
  scaleBBoxToDisplay,
  scaleBBoxToNatural,
} from "../../shared/annotation-utils.mjs";
import { clampBBoxToImage } from "./annotation";
import type { BoundingBox, ScreenshotAnnotation } from "./types";

interface ScreenshotAnnotatorProps {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  stepNumber: number;
  annotation: ScreenshotAnnotation;
  onChange: (annotation: ScreenshotAnnotation) => void;
}

export function ScreenshotAnnotator({
  imageUrl,
  naturalWidth,
  naturalHeight,
  stepNumber,
  annotation,
  onChange,
}: ScreenshotAnnotatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originBBox: BoundingBox;
  } | null>(null);

  const updateDisplaySize = useCallback(() => {
    const img = containerRef.current?.querySelector("img");
    if (!img) {
      return;
    }
    setDisplaySize({
      width: img.clientWidth,
      height: img.clientHeight,
    });
  }, []);

  useEffect(() => {
    updateDisplaySize();
    window.addEventListener("resize", updateDisplaySize);
    return () => window.removeEventListener("resize", updateDisplaySize);
  }, [imageUrl, updateDisplaySize]);

  const displayBBox =
    displaySize.width > 0
      ? scaleBBoxToDisplay(
          annotation.bbox,
          naturalWidth,
          naturalHeight,
          displaySize.width,
          displaySize.height,
        )
      : null;

  const commitDisplayBBox = (nextDisplayBBox: BoundingBox) => {
    if (displaySize.width <= 0) {
      return;
    }
    const naturalBBox = scaleBBoxToNatural(
      nextDisplayBBox,
      naturalWidth,
      naturalHeight,
      displaySize.width,
      displaySize.height,
    );
    onChange({
      ...annotation,
      bbox: clampBBoxToImage(naturalBBox, naturalWidth, naturalHeight),
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!displayBBox || !annotation.enabled) {
      return;
    }
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originBBox: displayBBox,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    commitDisplayBBox({
      ...drag.originBBox,
      x: drag.originBBox.x + deltaX,
      y: drag.originBBox.y + deltaY,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const toggleEnabled = () => {
    onChange({ ...annotation, enabled: !annotation.enabled });
  };

  const downloadAnnotatedPng = () => {
    const preview = document.createElement("canvas");
    preview.width = naturalWidth;
    preview.height = naturalHeight;
    const ctx = preview.getContext("2d");
    const img = containerRef.current?.querySelector("img");
    if (!ctx || !img) {
      return;
    }
    ctx.drawImage(img, 0, 0);
    drawAnnotationOnCanvas(ctx, annotation, stepNumber, naturalWidth, naturalHeight);
    const url = preview.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = `step-${stepNumber}-annotated.png`;
    link.click();
  };

  return (
    <div className="annotator" ref={containerRef}>
      <img
        src={imageUrl}
        alt={`Скриншот шага ${stepNumber}`}
        onLoad={updateDisplaySize}
      />

      {displayBBox && annotation.enabled ? (
        <div
          className="annotation-layer"
          style={{ width: displaySize.width, height: displaySize.height }}
        >
          <div
            className="annotation-box"
            style={{
              left: `${displayBBox.x}px`,
              top: `${displayBBox.y}px`,
              width: `${displayBBox.w}px`,
              height: `${displayBBox.h}px`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {annotation.showStepNumber !== false ? (
              <span className="annotation-step-badge">{stepNumber}</span>
            ) : null}
          </div>

          {annotation.showArrow !== false ? (
            <svg
              className="annotation-arrow"
              width={displaySize.width}
              height={displaySize.height}
              aria-hidden
            >
              <defs>
                <marker
                  id={`arrowhead-${stepNumber}`}
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="4"
                  orient="auto"
                >
                  <polygon points="0 0, 8 4, 0 8" fill="#e11d48" />
                </marker>
              </defs>
              <line
                x1={Math.min(displaySize.width * 0.12, displayBBox.x - 20)}
                y1={Math.max(16, displayBBox.y - 48)}
                x2={displayBBox.x + displayBBox.w / 2}
                y2={displayBBox.y + displayBBox.h / 2}
                stroke="#e11d48"
                strokeWidth="2"
                markerEnd={`url(#arrowhead-${stepNumber})`}
              />
            </svg>
          ) : null}
        </div>
      ) : null}

      <div className="annotation-controls">
        <label className="annotation-toggle">
          <input
            type="checkbox"
            checked={annotation.enabled}
            onChange={toggleEnabled}
          />
          <span>Подсветка элемента</span>
        </label>
        <button type="button" onClick={downloadAnnotatedPng}>
          Скачать с подсветкой (PNG)
        </button>
      </div>
    </div>
  );
}
