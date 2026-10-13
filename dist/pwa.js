let installPrompt = null;
let installed = false;
let prompting = false;
let installMessage = "";
const standalone = window.matchMedia("(display-mode: standalone)");

function isAppWindow() {
  return installed || standalone.matches || navigator.standalone === true;
}

function refreshInstallUI() {
  const inApp = isAppWindow();
  document.documentElement.dataset.installable = inApp ? "installed" : installPrompt ? "true" : "unknown";
  const button = document.querySelector("[data-pwa-install]");
  if (button) {
    button.hidden = inApp || !installPrompt;
    button.disabled = prompting;
  }
  const instructions = document.querySelector("[data-pwa-instructions]");
  if (instructions) instructions.hidden = inApp;
  const status = document.querySelector("[data-pwa-status]");
  if (status) status.textContent = inApp ? "O Concursos já está aberto ou instalado como aplicativo."
    : installMessage || (installPrompt ? "Pronto para instalar. Use o botão abaixo ou o menu do navegador."
      : "A instalação está disponível pelo menu dos navegadores compatíveis.");
  const offline = document.querySelector("[data-pwa-offline]");
  if (offline) {
    const ready = document.documentElement.dataset.offline === "ready";
    offline.textContent = ready ? (navigator.onLine === false
      ? "Você está offline. Continue com o conteúdo que já foi salvo neste dispositivo."
      : "Conteúdo principal disponível offline neste dispositivo.")
      : document.documentElement.dataset.offline === "unavailable"
        ? "O conteúdo offline não pôde ser preparado. Você pode continuar usando o app com internet."
        : "Acesse uma vez com internet para preparar o conteúdo principal para uso offline.";
  }
}

// Keep browser-owned installation available; never suppress its native menu.
window.addEventListener("beforeinstallprompt", event => {
  installPrompt = event;
  installMessage = "";
  refreshInstallUI();
});
window.addEventListener("appinstalled", () => {
  installed = true;
  installPrompt = null;
  refreshInstallUI();
});
standalone.addEventListener?.("change", refreshInstallUI);
window.addEventListener("online", refreshInstallUI);
window.addEventListener("offline", refreshInstallUI);
window.concursosPwa = { refresh: refreshInstallUI };

document.addEventListener("click", async event => {
  if (!event.target.closest?.("[data-pwa-install]") || !installPrompt || prompting || isAppWindow()) return;
  const prompt = installPrompt;
  prompting = true;
  refreshInstallUI();
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    installMessage = choice.outcome === "accepted" ? "Instalação solicitada. Aguarde a confirmação do navegador."
      : "Você pode instalar depois pelo menu do navegador.";
  } catch {
    installMessage = "Use o menu do navegador para instalar o aplicativo.";
  } finally {
    // A native install event can only be used once.
    if (installPrompt === prompt) installPrompt = null;
    prompting = false;
    refreshInstallUI();
  }
});

async function registerOfflineSupport() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    document.documentElement.dataset.offline = "unavailable";
    refreshInstallUI();
    return;
  }
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
  refreshInstallUI();
}

refreshInstallUI();
if (document.readyState === "complete") registerOfflineSupport();
else window.addEventListener("load", registerOfflineSupport, { once: true });
