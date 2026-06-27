/** @readonly */
export const WORKFLOW_STORAGE_KEY = "trWorkflow";

/** @typedef {'idle'|'requesting_permissions'|'recording'|'stopping'|'uploading'|'processing'|'ready'|'error'} WorkflowPhase */

/**
 * @typedef {Object} WorkflowState
 * @property {WorkflowPhase} phase
 * @property {string} [recordingId]
 * @property {number} [tabId]
 * @property {number} [startedAt]
 * @property {number} [progress] 0–100
 * @property {string} [statusText]
 * @property {string} [editorUrl]
 * @property {string} [error]
 * @property {number} [t0]
 * @property {boolean} [keepVideo]
 */

/** @returns {WorkflowState} */
export function createIdleWorkflow() {
  return {
    phase: "idle",
    progress: 0,
    statusText: "Готов к записи",
  };
}

/** @returns {Promise<WorkflowState>} */
export async function getWorkflow() {
  const data = await chrome.storage.local.get(WORKFLOW_STORAGE_KEY);
  const raw = data[WORKFLOW_STORAGE_KEY];
  if (!raw || typeof raw !== "object") {
    return createIdleWorkflow();
  }
  return { ...createIdleWorkflow(), ...raw };
}

/**
 * @param {Partial<WorkflowState>} patch
 * @returns {Promise<WorkflowState>}
 */
export async function setWorkflow(patch) {
  const current = await getWorkflow();
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ [WORKFLOW_STORAGE_KEY]: next });
  return next;
}

/** @returns {Promise<WorkflowState>} */
export async function resetWorkflow() {
  const idle = createIdleWorkflow();
  await chrome.storage.local.set({ [WORKFLOW_STORAGE_KEY]: idle });
  return idle;
}
