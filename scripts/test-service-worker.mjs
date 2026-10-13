import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../dist/sw.js", import.meta.url), "utf8");
const FONT_FILES = await readdir(new URL("../dist/vendor/katex/fonts/", import.meta.url));
const APP_HTML = '<!doctype html><meta name="application-name" content="Concursos" /><main>Concursos</main>';

function response(body, type, options = {}) {
  const result = new Response(body, { status: options.status || 200, headers: { "content-type": type } });
  for (const key of ["url", "redirected"]) if (key in options) Object.defineProperty(result, key, { value: options[key] });
  return result;
}

function contentFor(url) {
  if (url.pathname.endsWith("/")) return response(APP_HTML, "text/html");
  if (url.pathname.endsWith(".js")) return response("/* shell */", "text/javascript");
  if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
  if (/\.(json|webmanifest)$/.test(url.pathname)) return response("{}", "application/json");
  if (url.pathname.endsWith(".woff2")) return response("font", "font/woff2");
  if (url.pathname.endsWith(".pdf")) return response("pdf", "application/pdf");
  return response("image", url.pathname.endsWith(".svg") ? "image/svg+xml" : "image/png");
}

function harness(scope = "https://example.test/concursos-cgu/") {
  const handlers = new Map();
  const buckets = new Map();
  const calls = [];
  const failures = { open: false, put: false };
  const prefix = `concursos:${encodeURIComponent(scope)}:`;
  const core = `${prefix}concursos-3:core`;
  const resources = `${prefix}concursos-3:resources`;
  let network = request => contentFor(new URL(typeof request === "string" ? request : request.url));
  let claims = 0;
  let skips = 0;
  const key = request => typeof request === "string" ? request : request.url;
  const caches = {
    async open(name) {
      if (failures.open) throw new Error("Storage unavailable");
      if (!buckets.has(name)) buckets.set(name, new Map());
      return {
        async match(request) { return buckets.get(name).get(key(request))?.clone(); },
        async put(request, value) {
          if (failures.put) throw new Error("Quota exceeded");
          buckets.get(name).set(key(request), value.clone());
        },
      };
    },
    async keys() { return [...buckets.keys()]; },
    async delete(name) { return buckets.delete(name); },
  };
  vm.runInNewContext(source, {
    URL, Request, Response, caches,
    self: {
      registration: { scope },
      addEventListener: (name, listener) => handlers.set(name, listener),
      clients: { async claim() { claims++; } },
      async skipWaiting() { skips++; },
    },
    async fetch(request) {
      calls.push(request);
      return network(request);
    },
  });
  return {
    scope, core, resources, buckets, calls, failures,
    get claims() { return claims; }, get skips() { return skips; },
    network(fn) { network = fn; },
    async dispatch(type) {
      let work;
      handlers.get(type)({ waitUntil(promise) { work = promise; } });
      return work;
    },
    fetch(path, options = {}) {
      let work;
      const request = { url: new URL(path, scope).href, method: options.method || "GET", mode: options.mode || "cors" };
      handlers.get("fetch")({ request, respondWith(promise) { work = promise; } });
      return work;
    },
  };
}

for (const scope of ["https://example.test/", "https://example.test/concursos-cgu/"]) {
  test(`precache installs a coherent shell in scope ${new URL(scope).pathname} and waits for open windows`, async () => {
    const app = harness(scope);
    await app.dispatch("install");
    assert.equal(app.buckets.get(app.core).size, 13 + FONT_FILES.length);
    assert.equal(app.calls.length, 13 + FONT_FILES.length);
    assert.equal(app.skips, 0);
    assert.ok(app.calls.every(request => request.url.startsWith(scope) && request.cache === "reload"));
    app.network(() => { throw new TypeError("Offline"); });
    assert.equal(await (await app.fetch("./", { mode: "navigate" })).text(), APP_HTML);
    assert.equal(await (await app.fetch("index.html", { mode: "navigate" })).text(), APP_HTML);
    for (const path of ["app.js?v=concursos-3", "styles.css?v=concursos-3", "pwa.js?v=concursos-3", "data/courses.json?v=concursos-3", "vendor/katex/katex.min.js", "vendor/katex/katex.min.css", ...FONT_FILES.map(name => `vendor/katex/fonts/${name}`)]) {
      assert.equal((await app.fetch(path)).status, 200);
    }
  });
}

test("online navigation returns authentication redirects, login HTML and HTTP failures without using the offline shell", async () => {
  const app = harness();
  await app.dispatch("install");
  for (const result of [
    response("Sign in", "text/html", { url: "https://login.example.test/", redirected: true }),
    response("Sign in", "text/html"),
    response("Unauthorized", "text/html", { status: 401 }),
    response("Forbidden", "text/html", { status: 403 }),
    response("Service unavailable", "text/html", { status: 503 }),
  ]) {
    app.network(() => result);
    assert.equal(await app.fetch("./", { mode: "navigate" }), result);
    assert.equal(await app.buckets.get(app.core).get(app.scope).clone().text(), APP_HTML);
  }
});

test("failed precache never replaces an existing version with authentication HTML or a partial new shell", async () => {
  for (const result of [
    response("Login", "text/html"),
    response(APP_HTML, "text/html", { redirected: true }),
    response(APP_HTML, "text/html", { url: "https://example.test/login" }),
    response("Forbidden", "text/html", { status: 403 }),
  ]) {
    const app = harness();
    const old = app.core.replace("concursos-3", "pwa-0");
    app.buckets.set(old, new Map([[app.scope, response(APP_HTML, "text/html")]]));
    app.network(request => request.url === app.scope ? result : contentFor(new URL(request.url)));
    await assert.rejects(app.dispatch("install"), /shell unavailable/);
    assert.ok(app.buckets.has(old));
    assert.ok(!app.buckets.has(app.core));
  }
  const app = harness();
  const old = app.core.replace("concursos-3", "pwa-0");
  app.buckets.set(old, new Map());
  app.failures.put = true;
  await assert.rejects(app.dispatch("install"), /Quota exceeded/);
  assert.ok(app.buckets.has(old));
  assert.ok(!app.buckets.has(app.core));
});

test("only visited question images and explicitly allowed local data become available offline", async () => {
  const app = harness();
  await app.dispatch("install");
  assert.ok(!app.calls.some(request => request.url.includes("assets/questions/")));
  for (const path of ["assets/questions/2023/1/chart.png", "data/courses.json", "data/edital-cgu-2026.pdf"]) {
    assert.equal((await app.fetch(path)).status, 200);
  }
  assert.equal(app.buckets.get(app.resources).size, 3);
  app.network(() => { throw new TypeError("Offline"); });
  assert.equal(await (await app.fetch("assets/questions/2023/1/chart.png")).text(), "image");
  assert.equal(await (await app.fetch("data/courses.json")).text(), "{}");
  await assert.rejects(app.fetch("assets/questions/2023/2/unvisited.png"), /Offline/);
});

test("external resources, sibling scopes, authentication routes, unknown data, non-GET and query navigation are not intercepted", () => {
  const app = harness();
  for (const [path, options] of [
    ["https://other.test/concursos-cgu/assets/questions/1.png", {}],
    ["/assets/questions/1.png", {}],
    ["/enem-other/assets/questions/1.png", {}],
    ["/concursos-cgu/login", { mode: "navigate" }],
    ["/concursos-cgu/?code=secret", { mode: "navigate" }],
    ["/concursos-cgu/lesson", { mode: "navigate" }],
    ["data/private.json", {}],
    ["data/courses.json?v=old", {}],
    ["assets/questions/1.png?token=secret", {}],
    ["assets/questions/1.png", { method: "POST" }],
    ["./", { method: "POST", mode: "navigate" }],
  ]) assert.equal(app.fetch(path, options), undefined, path);
  assert.equal(app.calls.length, 0);
});

test("runtime responses with login HTML, redirects or access denial are returned without caching", async () => {
  const app = harness();
  for (const result of [
    response("Sign in", "text/html"),
    response("png", "image/png", { redirected: true }),
    response("png", "image/png", { url: "https://other.test/image.png" }),
    response("Forbidden", "text/plain", { status: 403 }),
  ]) {
    app.network(() => result);
    assert.equal(await app.fetch("assets/questions/2023/1/chart.png"), result);
    assert.equal(app.buckets.get(app.resources).size, 0);
  }
});

test("storage read and write failures do not block available network resources", async () => {
  for (const failure of ["open", "put"]) {
    const app = harness();
    app.failures[failure] = true;
    assert.equal(await (await app.fetch("assets/questions/2023/1/chart.png")).text(), "image");
  }
});

test("activation removes only old caches for this exact scope and leaves other applications untouched", async () => {
  const app = harness();
  const old = app.core.replace("concursos-3", "pwa-0");
  const root = harness("https://example.test/").core;
  const sibling = harness("https://example.test/enem-other/").core;
  for (const name of [old, app.core, app.resources, root, sibling, "unrelated-cache"]) app.buckets.set(name, new Map());
  await app.dispatch("activate");
  assert.deepEqual([...app.buckets.keys()], [app.core, app.resources, root, sibling, "unrelated-cache"]);
  assert.equal(app.claims, 1);
  assert.equal(app.skips, 0);
});

test("navigation without an installed shell surfaces a network error instead of inventing a response", async () => {
  const app = harness();
  app.network(() => { throw new TypeError("Offline"); });
  await assert.rejects(app.fetch("./", { mode: "navigate" }), /Offline/);
});
