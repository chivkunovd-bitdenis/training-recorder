import { bakeAnnotatedScreenshot } from "../../shared/annotation-utils.mjs";
import { resolveAnnotationForStep } from "./annotation";
import { screenshotUrl } from "./api";
import type { GeneratedDoc, Timeline } from "./types";

export type ExportFormat = "md" | "html";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Не удалось загрузить скриншот: ${url}`));
    image.src = url;
  });
}

export async function prepareStepExportImages(
  doc: GeneratedDoc,
  timeline: Timeline | null,
  recordingId: string,
): Promise<Map<string, Blob>> {
  const images = new Map<string, Blob>();

  for (let index = 0; index < doc.steps.length; index += 1) {
    const step = doc.steps[index];
    const stepId = step.id;
    const screenshotId = step.screenshotId;
    if (!stepId || !screenshotId || images.has(stepId)) {
      continue;
    }

    const url = screenshotUrl(recordingId, screenshotId);
    const annotation = resolveAnnotationForStep(step, timeline);

    if (annotation?.enabled) {
      const image = await loadImage(url);
      images.set(
        stepId,
        await bakeAnnotatedScreenshot(image, annotation, index + 1),
      );
      continue;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Не удалось загрузить скриншот шага ${index + 1}`);
    }
    images.set(stepId, await response.blob());
  }

  return images;
}

function buildExportFormData(
  doc: GeneratedDoc,
  format: ExportFormat,
  stepImages: Map<string, Blob>,
): FormData {
  const formData = new FormData();
  formData.append("doc", JSON.stringify(doc));
  formData.append("format", format);
  for (const [stepId, blob] of stepImages) {
    formData.append(`step_image_${stepId}`, blob, `step_image_${stepId}.png`);
  }
  return formData;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) {
    return fallback;
  }
  const match = /filename="([^"]+)"/i.exec(header);
  return match?.[1] ?? fallback;
}

export async function requestExport(
  recordingId: string,
  doc: GeneratedDoc,
  timeline: Timeline | null,
  format: ExportFormat,
): Promise<Response> {
  const stepImages = await prepareStepExportImages(doc, timeline, recordingId);
  const formData = buildExportFormData(doc, format, stepImages);
  const response = await fetch(
    `/recording/${encodeURIComponent(recordingId)}/export`,
    {
      method: "POST",
      body: formData,
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? `Экспорт не удался (${response.status})`);
  }
  return response;
}

export async function downloadMarkdownExport(
  recordingId: string,
  doc: GeneratedDoc,
  timeline: Timeline | null,
): Promise<void> {
  const response = await requestExport(recordingId, doc, timeline, "md");
  const blob = await response.blob();
  const filename = filenameFromDisposition(
    response.headers.get("Content-Disposition"),
    "instruction.zip",
  );
  downloadBlob(blob, filename);
}

export async function downloadHtmlExport(
  recordingId: string,
  doc: GeneratedDoc,
  timeline: Timeline | null,
): Promise<void> {
  const response = await requestExport(recordingId, doc, timeline, "html");
  const blob = await response.blob();
  const filename = filenameFromDisposition(
    response.headers.get("Content-Disposition"),
    "instruction.html",
  );
  downloadBlob(blob, filename);
}

export async function printPdfExport(
  recordingId: string,
  doc: GeneratedDoc,
  timeline: Timeline | null,
): Promise<void> {
  const response = await requestExport(recordingId, doc, timeline, "html");
  const html = await response.text();
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Браузер заблокировал окно печати. Разрешите всплывающие окна.");
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => {
    printWindow.print();
  }, 300);
}
