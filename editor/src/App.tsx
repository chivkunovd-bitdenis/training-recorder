import { useCallback, useEffect, useState } from "react";
import {
  fetchTimeline,
  getRecordingIdFromPath,
  loadOrGenerateDocument,
  saveDocument,
  screenshotUrl,
} from "./api";
import {
  downloadHtmlExport,
  downloadMarkdownExport,
  printPdfExport,
} from "./export";
import {
  getScreenshotMeta,
  resolveAnnotationForStep,
  shouldShowAnnotationWarning,
} from "./annotation";
import { ScreenshotAnnotator } from "./ScreenshotAnnotator";
import type { DocStep, GeneratedDoc, ScreenshotAnnotation, Timeline } from "./types";

type LoadState = "loading" | "ready" | "error";

function stepScreenshotOptions(step: DocStep): string[] {
  const options = new Set<string>();
  if (step.screenshotId) {
    options.add(step.screenshotId);
  }
  for (const candidate of step.screenshotCandidates ?? []) {
    options.add(candidate);
  }
  return Array.from(options);
}

function mergeSteps(current: DocStep, next: DocStep): DocStep {
  return {
    ...current,
    title: current.title || next.title,
    body: [current.body, next.body].filter(Boolean).join("\n\n"),
    eventIds: [...current.eventIds, ...next.eventIds],
    screenshotId: current.screenshotId ?? next.screenshotId,
    needsReview: current.needsReview || next.needsReview,
    screenshotCandidates: Array.from(
      new Set([
        ...(current.screenshotCandidates ?? []),
        ...(next.screenshotCandidates ?? []),
        ...(current.screenshotId ? [current.screenshotId] : []),
        ...(next.screenshotId ? [next.screenshotId] : []),
      ]),
    ),
    screenshotAnnotation: current.screenshotAnnotation ?? next.screenshotAnnotation,
  };
}

export function App() {
  const recordingId = getRecordingIdFromPath();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [doc, setDoc] = useState<GeneratedDoc | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [exporting, setExporting] = useState<null | "md" | "html" | "pdf">(null);
  const [exportMessage, setExportMessage] = useState("");

  useEffect(() => {
    if (!recordingId) {
      setLoadState("error");
      setErrorMessage("В адресе нет recordingId. Откройте редактор из расширения.");
      return;
    }

    let cancelled = false;

    async function load() {
      setLoadState("loading");
      setErrorMessage("");
      try {
        const [loadedDoc, loadedTimeline] = await Promise.all([
          loadOrGenerateDocument(recordingId),
          fetchTimeline(recordingId),
        ]);
        if (!cancelled) {
          setDoc(loadedDoc);
          setTimeline(loadedTimeline);
          setLoadState("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setLoadState("error");
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  const updateStep = useCallback((stepId: string, patch: Partial<DocStep>) => {
    setDoc((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        steps: current.steps.map((step) =>
          step.id === stepId ? { ...step, ...patch } : step,
        ),
      };
    });
  }, []);

  const deleteStep = useCallback((stepId: string) => {
    setDoc((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        steps: current.steps.filter((step) => step.id !== stepId),
      };
    });
  }, []);

  const mergeWithNext = useCallback((index: number) => {
    setDoc((current) => {
      if (!current || index >= current.steps.length - 1) {
        return current;
      }
      const merged = mergeSteps(current.steps[index], current.steps[index + 1]);
      const steps = [...current.steps];
      steps.splice(index, 2, merged);
      return { ...current, steps };
    });
  }, []);

  const handleSave = async () => {
    if (!recordingId || !doc) {
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const saved = await saveDocument(recordingId, doc);
      setDoc(saved);
      setSaveMessage("Сохранено");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const runExport = async (kind: "md" | "html" | "pdf") => {
    if (!recordingId || !doc) {
      return;
    }
    setExporting(kind);
    setExportMessage("");
    try {
      if (kind === "md") {
        await downloadMarkdownExport(recordingId, doc, timeline);
      } else if (kind === "html") {
        await downloadHtmlExport(recordingId, doc, timeline);
      } else {
        await printPdfExport(recordingId, doc, timeline);
      }
      setExportMessage("Готово");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(null);
    }
  };

  if (loadState === "loading") {
    return (
      <main className="page">
        <p className="status">Загрузка документа…</p>
      </main>
    );
  }

  if (loadState === "error" || !doc || !recordingId) {
    return (
      <main className="page">
        <h1>Редактор инструкции</h1>
        <p className="error">{errorMessage || "Не удалось открыть документ"}</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>{doc.title}</h1>
          <p className="meta">Запись: {recordingId}</p>
        </div>
        <div className="header-actions">
          <button type="button" className="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
          <div className="export-actions">
            <button
              type="button"
              onClick={() => void runExport("md")}
              disabled={exporting !== null}
            >
              {exporting === "md" ? "Экспорт…" : "Скачать Markdown"}
            </button>
            <button
              type="button"
              onClick={() => void runExport("html")}
              disabled={exporting !== null}
            >
              {exporting === "html" ? "Экспорт…" : "Скачать HTML"}
            </button>
            <button
              type="button"
              onClick={() => void runExport("pdf")}
              disabled={exporting !== null}
            >
              {exporting === "pdf" ? "Подготовка…" : "Печать в PDF"}
            </button>
          </div>
        </div>
      </header>

      {saveMessage ? <p className="save-message">{saveMessage}</p> : null}
      {exportMessage ? <p className="export-message">{exportMessage}</p> : null}

      <section className="section">
        <h2>Назначение</h2>
        <textarea
          value={doc.purpose}
          onChange={(event) => setDoc({ ...doc, purpose: event.target.value })}
          rows={3}
        />
      </section>

      <section className="steps">
        <h2>Шаги</h2>
        {doc.steps.map((step, index) => {
          const screenshotOptions = stepScreenshotOptions(step);
          const screenshotMeta = getScreenshotMeta(timeline, step.screenshotId);
          const annotation = resolveAnnotationForStep(step, timeline);

          const handleAnnotationChange = (next: ScreenshotAnnotation) => {
            updateStep(step.id, { screenshotAnnotation: next });
          };

          return (
            <article
              key={step.id}
              className={`step-card${step.needsReview ? " needs-review" : ""}`}
            >
              <div className="step-header">
                <span className="step-number">{index + 1}</span>
                {step.needsReview ? (
                  <span className="review-badge">Нужна проверка</span>
                ) : null}
              </div>

              <label>
                Заголовок
                <input
                  type="text"
                  value={step.title}
                  onChange={(event) =>
                    updateStep(step.id, { title: event.target.value })
                  }
                />
              </label>

              <label>
                Текст шага
                <textarea
                  value={step.body}
                  onChange={(event) => updateStep(step.id, { body: event.target.value })}
                  rows={4}
                />
              </label>

              <div className="screenshot-block">
                {step.screenshotId && annotation && screenshotMeta ? (
                  <>
                    {shouldShowAnnotationWarning(annotation) ? (
                      <p className="annotation-warning" role="status">
                        Подсветка могла сдвинуться — проверьте и подвиньте рамку
                      </p>
                    ) : annotation.annotationMode === "clickPoint" &&
                      annotation.confidence === "measured" ? (
                      <p
                        className="annotation-click-hint"
                        title="Координаты взяты из точки нажатия при записи"
                      >
                        Подсветка: точка нажатия
                      </p>
                    ) : null}
                    <ScreenshotAnnotator
                    imageUrl={screenshotUrl(recordingId, step.screenshotId)}
                    naturalWidth={screenshotMeta.width}
                    naturalHeight={screenshotMeta.height}
                    stepNumber={index + 1}
                    annotation={annotation}
                    onChange={handleAnnotationChange}
                  />
                  </>
                ) : step.screenshotId ? (
                  <img
                    src={screenshotUrl(recordingId, step.screenshotId)}
                    alt={`Скриншот шага ${index + 1}`}
                  />
                ) : (
                  <p className="muted">Скриншот не выбран</p>
                )}

                {screenshotOptions.length > 0 ? (
                  <label>
                    Скриншот
                    <select
                      value={step.screenshotId ?? ""}
                      onChange={(event) =>
                        updateStep(step.id, {
                          screenshotId: event.target.value || null,
                          needsReview: false,
                          screenshotAnnotation: undefined,
                        })
                      }
                    >
                      <option value="">— не выбран —</option>
                      {screenshotOptions.map((optionId) => (
                        <option key={optionId} value={optionId}>
                          {optionId}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div className="step-actions">
                <button type="button" onClick={() => deleteStep(step.id)}>
                  Удалить шаг
                </button>
                {index < doc.steps.length - 1 ? (
                  <button type="button" onClick={() => mergeWithNext(index)}>
                    Объединить со следующим
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
