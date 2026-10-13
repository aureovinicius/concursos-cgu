/* Change VERSION with every release of the application shell. */
const VERSION = "concursos-2";
const SCOPE = new URL(self.registration.scope);
const PREFIX = `concursos:${encodeURIComponent(SCOPE.href)}:`;
const CORE_CACHE = `${PREFIX}${VERSION}:core`;
const RESOURCE_CACHE = `${PREFIX}${VERSION}:resources`;
const MATH_FONTS = ["KaTeX_AMS-Regular.woff2", "KaTeX_Caligraphic-Bold.woff2", "KaTeX_Caligraphic-Regular.woff2", "KaTeX_Fraktur-Bold.woff2", "KaTeX_Fraktur-Regular.woff2", "KaTeX_Main-Bold.woff2", "KaTeX_Main-BoldItalic.woff2", "KaTeX_Main-Italic.woff2", "KaTeX_Main-Regular.woff2", "KaTeX_Math-BoldItalic.woff2", "KaTeX_Math-Italic.woff2", "KaTeX_SansSerif-Bold.woff2", "KaTeX_SansSerif-Italic.woff2", "KaTeX_SansSerif-Regular.woff2", "KaTeX_Script-Regular.woff2", "KaTeX_Size1-Regular.woff2", "KaTeX_Size2-Regular.woff2", "KaTeX_Size3-Regular.woff2", "KaTeX_Size4-Regular.woff2", "KaTeX_Typewriter-Regular.woff2"];
const CORE_PATHS = [
  "vendor/katex/katex.min.js", "vendor/katex/katex.min.css",
  ...MATH_FONTS.map(name => `vendor/katex/fonts/${name}`),
  "./", "app.js?v=concursos-2", "styles.css?v=concursos-2", "pwa.js?v=concursos-2",
  "data/courses.json?v=concursos-2", "manifest.webmanifest", "icons/icon-192.png",
  "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "favicon.svg",
];
const CORE_URLS = new Set(CORE_PATHS.map(path => new URL(path, SCOPE).href));
const OPTIONAL_DATA = new Set(["data/edital-cgu-2026.pdf", "data/courses.json"]);

function relativePath(url) {
  return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname)
    ? url.pathname.slice(SCOPE.pathname.length) : null;
}

function isNavigation(url) {
  const path = relativePath(url);
  return !url.search && (path === "" || path === "index.html");
}

async function safeResponse(response, url, html = false) {
  if (response.status !== 200 || response.redirected || !["basic", "default"].includes(response.type)) return false;
  if (response.url && response.url !== url.href) return false;
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (html) {
    return type === "text/html" && /<meta\s+name=["']application-name["']\s+content=["']Concursos["']\s*\/?\s*>/i.test(await response.clone().text());
  }
  const path = url.pathname;
  if (/\.js$/.test(path)) return ["text/javascript", "application/javascript"].includes(type);
  if (/\.css$/.test(path)) return type === "text/css";
  if (/\.(json|webmanifest)$/.test(path)) return ["application/json", "application/manifest+json"].includes(type);
  if (/\.woff2$/.test(path)) return ["font/woff2", "application/font-woff", "application/font-woff2", "application/octet-stream"].includes(type);
  if (/\.pdf$/.test(path)) return type === "application/pdf";
  return /^image\/(png|jpeg|svg\+xml|webp|gif|avif)$/.test(type);
}

async function storeResponse(cacheName, key, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(key, response.clone());
  } catch {
    // Storage pressure must not prevent a successful network response.
  }
}

async function installShell() {
  const entries = await Promise.all([...CORE_URLS].map(async href => {
    const url = new URL(href);
    const response = await fetch(new Request(href, { cache: "reload", credentials: "same-origin" }));
    if (!await safeResponse(response, url, href === SCOPE.href)) throw new Error("Concursos shell unavailable");
    return [href, response];
  }));
  try {
    const cache = await caches.open(CORE_CACHE);
    for (const [href, response] of entries) await cache.put(href, response);
  } catch (error) {
    await caches.delete(CORE_CACHE);
    throw error;
  }
}

self.addEventListener("install", event => {
  // Leave updates waiting until existing application windows have closed.
  event.waitUntil(installShell());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CORE_CACHE && name !== RESOURCE_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function navigation(request) {
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const cache = await caches.open(CORE_CACHE);
    const offline = await cache.match(SCOPE.href);
    if (offline) return offline;
    throw error;
  }
  // Online login redirects, access denials and server errors always reach the browser.
  // Keep the versioned shell installed together with its JS and catalog coherent.
  return response;
}

async function staticResource(request, core) {
  const cacheName = core ? CORE_CACHE : RESOURCE_CACHE;
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    // Network use remains available when browser storage is disabled or full.
  }
  const response = await fetch(request);
  if (await safeResponse(response, new URL(request.url))) await storeResponse(cacheName, request, response);
  return response;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const path = relativePath(url);
  if (path === null) return;
  if (request.mode === "navigate") {
    if (isNavigation(url)) event.respondWith(navigation(request));
    return;
  }
  const core = CORE_URLS.has(url.href) && url.href !== SCOPE.href;
  const image = !url.search && /^assets\/questions\/[\w/.-]+\.(png|jpe?g|svg|webp|gif|avif)$/i.test(path);
  const data = !url.search && OPTIONAL_DATA.has(path);
  if (core || image || data) event.respondWith(staticResource(request, core));
});
