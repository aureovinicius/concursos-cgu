import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../dist/pwa.js", import.meta.url), "utf8");

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback, options = {}) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ callback, once: options.once });
    },
    async dispatch(type, event = {}) {
      const current = [...(listeners.get(type) || [])];
      listeners.set(type, (listeners.get(type) || []).filter(listener => !listener.once));
      await Promise.all(current.map(({ callback }) => callback(event)));
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function installEvent({ outcome = "accepted", prompt, choice } = {}) {
  const calls = { prompt: 0, preventDefault: 0 };
  return {
    calls,
    event: {
      preventDefault() { calls.preventDefault++; },
      async prompt() { calls.prompt++; if (prompt) return prompt(); },
      userChoice: choice || Promise.resolve({ outcome }),
    },
  };
}

function harness(options = {}) {
  const nodes = new Map(["install", "instructions", "status", "offline"].map(name => [
    `[data-pwa-${name}]`, { hidden: name === "install", disabled: false, textContent: "" },
  ]));
  const document = {
    ...eventTarget(),
    documentElement: { dataset: {} },
    readyState: options.readyState || "loading",
    querySelector: selector => nodes.get(selector) || null,
  };
  const media = { ...eventTarget(), matches: options.standalone === true };
  const window = {
    ...eventTarget(),
    isSecureContext: options.secure !== false,
    matchMedia(query) {
      assert.equal(query, "(display-mode: standalone)");
      return media;
    },
  };
  const registrations = [];
  const warnings = [];
  const navigator = { standalone: options.iosStandalone === true, onLine: options.online !== false };
  if (options.serviceWorker !== false) {
    navigator.serviceWorker = {
      async register(url, config) {
        registrations.push({ url: url.href, scope: config.scope, updateViaCache: config.updateViaCache });
        if (options.registerError) throw new Error("Registration refused");
        return {};
      },
      get ready() { return options.readyError ? Promise.reject(new Error("Activation refused")) : Promise.resolve({}); },
    };
  }
  const moduleUrl = options.moduleUrl || "https://example.test/concursos-cgu/pwa.js?v=concursos-8";
  vm.runInNewContext(source.replaceAll("import.meta.url", JSON.stringify(moduleUrl)), {
    window, document, navigator, URL, console: { warn: (...args) => warnings.push(args) },
  });
  return {
    nodes, document, window, navigator, media, registrations, warnings,
    node: name => nodes.get(`[data-pwa-${name}]`),
    refresh() { window.concursosPwa.refresh(); },
    clickInstall() { return document.dispatch("click", { target: { closest: selector => nodes.get(selector) } }); },
  };
}

test("installation instructions remain available without a browser install event and after rendering a new card", async () => {
  const app = harness();
  assert.equal(app.node("install").hidden, true);
  assert.equal(app.node("instructions").hidden, false);
  assert.equal(app.document.documentElement.dataset.installable, "unknown");
  assert.match(app.node("status").textContent, /menu/);
  await app.clickInstall();
  const savedNodes = [...app.nodes];
  app.nodes.clear();
  assert.doesNotThrow(() => app.refresh());
  const offer = installEvent();
  await app.window.dispatch("beforeinstallprompt", offer.event);
  for (const [name, node] of savedNodes) app.nodes.set(name, node);
  app.refresh();
  assert.equal(app.node("install").hidden, false);
  assert.equal(offer.calls.preventDefault, 0, "native browser installation is not suppressed");
});

test("an accepted prompt waits for appinstalled confirmation and is only used once", async () => {
  const app = harness();
  const offer = installEvent();
  await app.window.dispatch("beforeinstallprompt", offer.event);
  await app.clickInstall();
  assert.equal(offer.calls.prompt, 1);
  assert.equal(app.node("install").hidden, true);
  assert.equal(app.node("install").disabled, false);
  assert.match(app.node("status").textContent, /Aguarde a confirmação/);
  assert.notEqual(app.document.documentElement.dataset.installable, "installed");
  await app.clickInstall();
  assert.equal(offer.calls.prompt, 1);
  await app.window.dispatch("appinstalled");
  assert.equal(app.document.documentElement.dataset.installable, "installed");
  assert.equal(app.node("instructions").hidden, true);
  assert.match(app.node("status").textContent, /instalado/);
});

test("dismissed or failing prompts leave menu instructions and allow a later install event", async () => {
  for (const options of [
    { outcome: "dismissed" },
    { prompt: () => { throw new Error("Prompt unavailable"); } },
    { choice: { then(_resolve, reject) { reject(new Error("Choice unavailable")); } } },
  ]) {
    const app = harness();
    const offer = installEvent(options);
    await app.window.dispatch("beforeinstallprompt", offer.event);
    await assert.doesNotReject(app.clickInstall());
    assert.equal(offer.calls.prompt, 1);
    assert.equal(app.node("install").hidden, true);
    assert.equal(app.node("install").disabled, false);
    assert.equal(app.node("instructions").hidden, false);
    assert.match(app.node("status").textContent, /menu do navegador/);
    await app.clickInstall();
    assert.equal(offer.calls.prompt, 1);
    const next = installEvent();
    await app.window.dispatch("beforeinstallprompt", next.event);
    assert.equal(app.node("install").hidden, false);
    await app.clickInstall();
    assert.equal(next.calls.prompt, 1);
  }
});

test("repeated clicks cannot open concurrent prompts or consume a replacement install event", async () => {
  const app = harness();
  const decision = deferred();
  const offer = installEvent({ choice: decision.promise });
  await app.window.dispatch("beforeinstallprompt", offer.event);
  const firstClick = app.clickInstall();
  assert.equal(app.node("install").disabled, true);
  await app.clickInstall();
  assert.equal(offer.calls.prompt, 1);
  const next = installEvent();
  await app.window.dispatch("beforeinstallprompt", next.event);
  await app.clickInstall();
  assert.equal(next.calls.prompt, 0);
  decision.resolve({ outcome: "dismissed" });
  await firstClick;
  assert.equal(app.node("install").hidden, false);
  assert.equal(app.node("install").disabled, false);
  await app.clickInstall();
  assert.equal(next.calls.prompt, 1);
});

test("standalone windows, iOS standalone and display-mode changes suppress redundant installation", async () => {
  for (const options of [{ standalone: true }, { iosStandalone: true }]) {
    const app = harness(options);
    const offer = installEvent();
    await app.window.dispatch("beforeinstallprompt", offer.event);
    assert.equal(app.document.documentElement.dataset.installable, "installed");
    assert.equal(app.node("install").hidden, true);
    assert.equal(app.node("instructions").hidden, true);
    await app.clickInstall();
    assert.equal(offer.calls.prompt, 0);
  }
  const app = harness();
  const offer = installEvent();
  await app.window.dispatch("beforeinstallprompt", offer.event);
  app.media.matches = true;
  await app.media.dispatch("change");
  assert.equal(app.node("install").hidden, true);
  app.media.matches = false;
  await app.media.dispatch("change");
  assert.equal(app.node("install").hidden, false);
});

for (const pathname of ["/", "/concursos-cgu/", "/nested/concursos-cgu/"]) {
  test(`offline support registers once with the module-relative scope ${pathname}`, async () => {
    const app = harness({ moduleUrl: `https://example.test${pathname}pwa.js?v=concursos-8` });
    assert.equal(app.registrations.length, 0);
    await app.window.dispatch("load");
    assert.deepEqual(app.registrations, [{ url: `https://example.test${pathname}sw.js`, scope: pathname, updateViaCache: "none" }]);
    assert.equal(app.document.documentElement.dataset.offline, "ready");
    assert.match(app.node("offline").textContent, /principal disponível offline/);
    await app.window.dispatch("load");
    assert.equal(app.registrations.length, 1);
    app.navigator.onLine = false;
    await app.window.dispatch("offline");
    assert.match(app.node("offline").textContent, /Você está offline/);
    app.navigator.onLine = true;
    await app.window.dispatch("online");
    assert.match(app.node("offline").textContent, /principal disponível offline/);
  });
}

test("missing service workers, insecure origins and registration failures leave the app and install help usable", async () => {
  for (const options of [{ serviceWorker: false }, { secure: false }, { registerError: true }, { readyError: true }]) {
    const app = harness(options);
    await assert.doesNotReject(app.window.dispatch("load"));
    assert.equal(app.document.documentElement.dataset.offline, "unavailable");
    assert.match(app.node("offline").textContent, /continuar usando o app com internet/);
    assert.equal(app.node("instructions").hidden, false);
    const offer = installEvent();
    await app.window.dispatch("beforeinstallprompt", offer.event);
    await app.clickInstall();
    assert.equal(offer.calls.prompt, 1);
    assert.equal(app.warnings.length, options.registerError || options.readyError ? 1 : 0);
  }
});

test("loading the module after the page is complete prepares offline support without waiting for another load", async () => {
  const app = harness({ readyState: "complete" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.registrations.length, 1);
  assert.equal(app.document.documentElement.dataset.offline, "ready");
  await app.window.dispatch("load");
  assert.equal(app.registrations.length, 1);
});
