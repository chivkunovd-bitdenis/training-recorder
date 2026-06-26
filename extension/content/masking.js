(() => {
  const MASK_TOKEN = "••••";
  const MAX_VALUE_LENGTH = 200;

  const SENSITIVE_AUTOCOMPLETE = new Set([
    "email",
    "tel",
    "cc-number",
    "cc-exp",
    "cc-csc",
  ]);

  /**
   * @param {Element} element
   */
  function isInsideSensitiveContainer(element) {
    return Boolean(element.closest("[data-sensitive]"));
  }

  /**
   * @param {Element} element
   */
  function hasSensitiveAttribute(element) {
    return element.hasAttribute("data-sensitive");
  }

  /**
   * @param {Element} element
   */
  function getFieldHint(element) {
    return [
      element.getAttribute("name"),
      element.id,
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  /**
   * @param {Element} element
   */
  function getInputType(element) {
    if (element.tagName.toLowerCase() !== "input") {
      return null;
    }
    return (element.getAttribute("type") || "text").toLowerCase();
  }

  /**
   * @param {string} value
   */
  function shouldMaskValueContent(value) {
    const normalized = value.trim();
    if (!normalized) {
      return false;
    }

    if (/^\d{10}$/.test(normalized) || /^\d{12}$/.test(normalized)) {
      return true;
    }

    if (/^\d{3}-\d{3}-\d{3}\s\d{2}$/.test(normalized)) {
      return true;
    }

    if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i.test(normalized.replace(/\s/g, ""))) {
      return true;
    }

    return false;
  }

  /**
   * @param {Element} element
   */
  function shouldMaskField(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const tag = element.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea") {
      return false;
    }

    const type = getInputType(element) || "text";
    if (type === "password") {
      return true;
    }

    if (type === "email" || type === "tel") {
      return true;
    }

    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();
    if (SENSITIVE_AUTOCOMPLETE.has(autocomplete)) {
      return true;
    }

    const hint = getFieldHint(element);
    if (/password|passwd|pwd|пароль/.test(hint)) {
      return true;
    }
    if (/email|e-mail|mail|почта/.test(hint)) {
      return true;
    }
    if (/phone|tel|mobile|телефон/.test(hint)) {
      return true;
    }
    if (/card|cc-number|cvv|cvc|iban/.test(hint)) {
      return true;
    }
    if (/inn|инн|снилс|snils/.test(hint)) {
      return true;
    }

    return false;
  }

  /**
   * @param {string | null | undefined} value
   */
  function limitValueLength(value) {
    if (value == null) {
      return null;
    }
    return value.length > MAX_VALUE_LENGTH
      ? value.slice(0, MAX_VALUE_LENGTH)
      : value;
  }

  /**
   * @param {object | null} context
   * @param {Element} element
   */
  function sanitizeContextFields(context, element) {
    if (!context) {
      return context;
    }

    const inSensitiveZone =
      isInsideSensitiveContainer(element) || hasSensitiveAttribute(element);

    if (inSensitiveZone) {
      context.text = null;
      context.nearbyText = null;
      context.masked = true;
    }

    if (shouldMaskField(element)) {
      if (context.text) {
        context.text = MASK_TOKEN;
      }
      context.masked = true;
    }

    return context;
  }

  /**
   * @param {string | null | undefined} value
   * @param {Element} element
   */
  function sanitizeEventValue(value, element) {
    if (value == null) {
      return null;
    }

    if (
      shouldMaskField(element) ||
      shouldMaskValueContent(value) ||
      isInsideSensitiveContainer(element) ||
      hasSensitiveAttribute(element)
    ) {
      return MASK_TOKEN;
    }

    return limitValueLength(value);
  }

  /**
   * @param {object} event
   * @param {Element} element
   */
  function applyToRecEvent(event, element) {
    if (event.target) {
      sanitizeContextFields(event.target, element);
    }

    if (event.value != null) {
      event.value = sanitizeEventValue(event.value, element);
      if (event.value === MASK_TOKEN && event.target) {
        event.target.masked = true;
      }
    }

    return event;
  }

  const root = typeof window !== "undefined" ? window : globalThis;
  root.TrainingRecorderMasking = {
    MASK_TOKEN,
    MAX_VALUE_LENGTH,
    isInsideSensitiveContainer,
    hasSensitiveAttribute,
    shouldMaskField,
    shouldMaskValueContent,
    sanitizeContextFields,
    sanitizeEventValue,
    applyToRecEvent,
    limitValueLength,
  };
})();
