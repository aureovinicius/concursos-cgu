// Native browser menus own installation; do not suppress beforeinstallprompt.
window.addEventListener("beforeinstallprompt", () => {
  document.documentElement.dataset.installable = "true";
});
window.addEventListener("appinstalled", () => {
  document.documentElement.dataset.installable = "installed";
});

async function registerOfflineSupport() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    // Resolve from this module so / and /concursos-cgu/ keep independent scopes.
    await navigator.serviceWorker.register(new URL("./sw.js", import.meta.url), {
      scope: new URL("./", import.meta.url).pathname,
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
    document.documentElement.dataset.offline = "ready";
  } catch (error) {
    document.documentElement.dataset.offline = "unavailable";
    console.warn("O acesso offline não está disponível neste navegador.", error);
  }
}

if (document.readyState === "complete") registerOfflineSupport();
else window.addEventListener("load", registerOfflineSupport, { once: true });
