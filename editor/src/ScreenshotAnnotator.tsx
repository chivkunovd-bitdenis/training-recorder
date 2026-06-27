import { useCallback, useEffect, useRef, useState } from "react";
import {
  displayBBoxToScreenshot,
  drawAnnotationOnCanvas,
  screenshotAnnotationToDisplayLayer,
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
  const [loadedNaturalSize, setLoadedNaturalSize] = useState({
    width: naturalWidth,
    height: naturalHeight,
  });
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
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setLoadedNaturalSize({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    }
    setDisplaySize({
      width: img.clientWidth,
      height: img.clientHeight,
    });
  }, []);

  const effectiveNaturalWidth = loadedNaturalSize.width || naturalWidth;
  const effectiveNaturalHeight = loadedNaturalSize.height || naturalHeight;
  const screenshotMeta = {
    width: effectiveNaturalWidth,
    height: effectiveNaturalHeight,
  };

  const displayLayer =
    displaySize.width > 0
      ? screenshotAnnotationToDisplayLayer(
          annotation,
          screenshotMeta,
          displaySize,
          stepNumber,
        )
      : null;

  useEffect(() => {
    updateDisplaySize();
    const img = containerRef.current?.querySelector("img");
    const observer =
      img && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateDisplaySize())
        : null;
    observer?.observe(img as Element);
    window.addEventListener("resize", updateDisplaySize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateDisplaySize);
    };
  }, [imageUrl, updateDisplaySize]);

  const commitDisplayBBox = (nextDisplayBBox: BoundingBox) => {
    if (!displayLayer || displaySize.width <= 0) {
      return;
    }
    const naturalBBox = displayBBoxToScreenshot(
      nextDisplayBBox,
      screenshotMeta,
      displaySize,
    );
    onChange({
      ...annotation,
      bbox: clampBBoxToImage(
        naturalBBox,
        effectiveNaturalWidth,
        effectiveNaturalHeight,
      ),
      coordinateSpace: "screenshotPixels",
      confidence: "manual",
      ...(annotation.annotationMode === "clickPoint"
        ? { annotationMode: "clickPoint" as const }
        : {}),
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!displayLayer || !annotation.enabled) {
      return;
    }
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originBBox: displayLayer.displayRect,
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

  const downloadAnnotatedPng = async () => {
    const preview = document.createElement("canvas");
    preview.width = effectiveNaturalWidth;
    preview.height = effectiveNaturalHeight;
    const ctx = preview.getContext("2d");
    if (!ctx) {
      return;
    }
    const fullImage = new Image();
    fullImage.crossOrigin = "anonymous";
    fullImage.src = imageUrl;
    await fullImage.decode();
    ctx.drawImage(fullImage, 0, 0);
    drawAnnotationOnCanvas(
      ctx,
      annotation,
      stepNumber,
      effectiveNaturalWidth,
      effectiveNaturalHeight,
    );
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

      {displayLayer && annotation.enabled ? (
        <div
          className="annotation-layer"
          style={{
            left: `${displayLayer.offset.x}px`,
            top: `${displayLayer.offset.y}px`,
            width: `${displayLayer.renderSize.width}px`,
            height: `${displayLayer.renderSize.height}px`,
          }}
        >
          <div
            className={
              annotation.annotationMode === "clickPoint"
                ? "annotation-box annotation-box--point"
                : "annotation-box"
            }
            style={{
              left: `${displayLayer.displayRect.x}px`,
              top: `${displayLayer.displayRect.y}px`,
              width: `${displayLayer.displayRect.w}px`,
              height: `${displayLayer.displayRect.h}px`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />

          {annotation.showStepNumber !== false ? (
            <span
              className="annotation-step-badge"
              style={{
                left: `${displayLayer.decoration.badge.x}px`,
                top: `${displayLayer.decoration.badge.y}px`,
                width: `${displayLayer.decoration.badge.w}px`,
                height: `${displayLayer.decoration.badge.h}px`,
              }}
            >
              {stepNumber}
            </span>
          ) : null}

          {annotation.showArrow !== false ? (
            <svg
              className="annotation-arrow"
              width={displayLayer.renderSize.width}
              height={displayLayer.renderSize.height}
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
                x1={displayLayer.decoration.arrow.from.x}
                y1={displayLayer.decoration.arrow.from.y}
                x2={displayLayer.decoration.arrow.to.x}
                y2={displayLayer.decoration.arrow.to.y}
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
