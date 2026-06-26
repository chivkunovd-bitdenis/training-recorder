(() => {
  if (window.__TRNetHookInstalled) {
    return;
  }
  window.__TRNetHookInstalled = true;

  const SOURCE = "training-recorder-net-hook";
  let activeCount = 0;

  function broadcast() {
    window.postMessage(
      {
        source: SOURCE,
        activeCount,
      },
      "*",
    );
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(...args) {
    activeCount += 1;
    broadcast();
    return originalFetch(...args).finally(() => {
      activeCount = Math.max(0, activeCount - 1);
      broadcast();
    });
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(...args) {
    this.__trTracked = true;
    return originalOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    if (this.__trTracked) {
      activeCount += 1;
      broadcast();
      const finalize = () => {
        activeCount = Math.max(0, activeCount - 1);
        broadcast();
      };
      // loadend срабатывает один раз после любого завершения (load/error/abort/timeout).
      // Отдельные слушатели error/abort давали бы двойной декремент → ложный network idle.
      this.addEventListener("loadend", finalize, { once: true });
    }
    return originalSend.apply(this, args);
  };

  broadcast();
})();
