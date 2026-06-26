import type { GeneratedDoc, Timeline } from "./types";

export function getRecordingIdFromPath(): string | null {
  const match = window.location.pathname.match(/\/editor\/recording\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function screenshotUrl(recordingId: string, screenshotId: string): string {
  return `/recording/${encodeURIComponent(recordingId)}/screenshots/${encodeURIComponent(`${screenshotId}.jpg`)}`;
}

export async function fetchDocument(recordingId: string): Promise<GeneratedDoc> {
  const response = await fetch(
    `/recording/${encodeURIComponent(recordingId)}/doc?format=json`,
  );
  if (response.status === 404) {
    throw new Error("DOC_NOT_FOUND");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? `Не удалось загрузить документ (${response.status})`);
  }
  return response.json() as Promise<GeneratedDoc>;
}

export async function generateDocument(recordingId: string): Promise<GeneratedDoc> {
  const response = await fetch(
    `/recording/${encodeURIComponent(recordingId)}/generate`,
    { method: "POST" },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? `Генерация не удалась (${response.status})`);
  }
  return response.json() as Promise<GeneratedDoc>;
}

export async function saveDocument(
  recordingId: string,
  doc: GeneratedDoc,
): Promise<GeneratedDoc> {
  const response = await fetch(
    `/recording/${encodeURIComponent(recordingId)}/doc`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? `Сохранение не удалось (${response.status})`);
  }
  return response.json() as Promise<GeneratedDoc>;
}

export async function loadOrGenerateDocument(recordingId: string): Promise<GeneratedDoc> {
  try {
    return await fetchDocument(recordingId);
  } catch (error) {
    if (error instanceof Error && error.message === "DOC_NOT_FOUND") {
      return generateDocument(recordingId);
    }
    throw error;
  }
}

export async function fetchTimeline(recordingId: string): Promise<Timeline> {
  const response = await fetch(
    `/recording/${encodeURIComponent(recordingId)}/timeline`,
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? `Не удалось загрузить timeline (${response.status})`);
  }
  return response.json() as Promise<Timeline>;
}
