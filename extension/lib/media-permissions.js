/**
 * Сначала экран/вкладка, потом микрофон — как в прошлом плагине записи.
 * Два диалога Chrome по очереди, без лишних кнопок в расширении.
 */

/**
 * @param {unknown} error
 */
export function formatMediaPermissionError(error) {
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  if (
    name === "NotAllowedError" ||
    message.includes("Permission dismissed") ||
    message.includes("denied")
  ) {
    return (
      "Доступ не дан. В диалогах Chrome нажмите «Разрешить». " +
      "Если диалогов нет — chrome://settings/content/microphone и /camera."
    );
  }

  if (name === "NotFoundError") {
    return "Микрофон не найден. Подключите микрофон или проверьте настройки Chrome.";
  }

  if (name === "AbortError") {
    return "Выбор экрана отменён. Закройте окно и нажмите «Запись» снова.";
  }

  return message || "Не удалось получить доступ к микрофону или экрану";
}

export async function requestCapturePermissionsSequential() {
  let displayStream;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    });
  } catch (error) {
    throw new Error(formatMediaPermissionError(error));
  }

  let micStream;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
  } catch (error) {
    for (const track of displayStream.getTracks()) {
      track.stop();
    }
    throw new Error(formatMediaPermissionError(error));
  }

  return { displayStream, micStream };
}
