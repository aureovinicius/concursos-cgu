import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildGitHubPages, normalizeBasePath } from "./build-github-pages.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "concursos-pages-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = {
    "index.html": '<script src="/vendor/katex/katex.min.js"></script><link href="/vendor/katex/katex.min.css"><link rel="icon" href="/favicon.svg"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link href="/styles.css?v=2"><script src="/app.js?v=2"></script><script type="module" src="/pwa.js?v=2"></script><a href="#praticar">Praticar</a>',
    "app.js": 'const DATA_URL = "/data/courses.json?v=2"; const allowed = url => url.startsWith("/assets/questions/"); const download = `<a href="/data/matrix.pdf">Download</a>`;',
    "styles.css": "body { color: #123; }",
    "vendor/katex/katex.min.js": "/* math renderer */",
    "vendor/katex/katex.min.css": '@font-face{src:url("fonts/Math.woff2")}',
    "vendor/katex/fonts/Math.woff2": "font fixture",
    "favicon.svg": "<svg></svg>",
    "pwa.js": 'navigator.serviceWorker.register(new URL("./sw.js", import.meta.url)); const fallback = "/sw.js";',
    "sw.js": 'const root = self.registration.scope; const shell = ["./", "./app.js?v=2", "./styles.css?v=2"];',
    "manifest.webmanifest": JSON.stringify({ name: "Concursos", id: "/", start_url: "/#aprender", scope: "/", display: "standalone", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] }),
    "icons/icon-192.png": "192 pixel icon fixture",
    "icons/icon-512.png": "512 pixel icon fixture",
    "icons/icon-maskable-512.png": "maskable icon fixture",
    "apple-touch-icon.png": "Apple icon fixture",
    "data/matrix.pdf": "pdf fixture",
    "data/courses.json": JSON.stringify({ context: "![Gráfico](/assets/questions/2023/1/chart.png)", alternatives: [{ file: "/assets/questions/2023/1/chart.png" }], source: "https://example.org/data/official.json", sourceImage: "https://enem.dev/2023/questions/1/chart.png" }),
    "assets/questions/2023/1/chart.png": "image fixture",
  };
  for (const [relative, value] of Object.entries(source)) {
    await mkdir(path.dirname(path.join(root, "dist", relative)), { recursive: true });
    await writeFile(path.join(root, "dist", relative), value);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "--", "dist"], { cwd: root });
  await writeFile(path.join(root, "dist/assets/questions/2023/1/chart 2.png"), "untracked duplicate");
  return { root, source };
}

for (const basePath of ["/", "/concursos-cgu", "/nested/concursos-cgu/"]) {
  test(`packages all local resources for ${basePath}, preserving external URLs and source files`, async t => {
    const { root, source } = await fixture(t);
    const built = await buildGitHubPages({ root, basePath });
    const base = normalizeBasePath(basePath);
    const html = await readFile(path.join(built.output, "index.html"), "utf8");
    assert.ok(html.includes(`src="${base}/app.js?v=2"`));
    assert.ok(html.includes(`src="${base}/vendor/katex/katex.min.js"`));
    assert.ok(html.includes(`href="${base}/vendor/katex/katex.min.css"`));
    assert.equal(await readFile(path.join(built.output, "vendor/katex/katex.min.css"), "utf8"), source["vendor/katex/katex.min.css"]);
    assert.ok(html.includes(`href="${base}/manifest.webmanifest"`));
    assert.ok(html.includes(`href="${base}/apple-touch-icon.png"`));
    assert.ok(html.includes(`src="${base}/pwa.js?v=2"`));
    assert.ok(html.includes('href="#praticar"'));
    const js = await readFile(path.join(built.output, "app.js"), "utf8");
    assert.ok(js.includes(`"${base}/data/courses.json?v=2"`));
    assert.ok(js.includes(`startsWith("${base}/assets/questions/")`));
    assert.ok(js.includes(`href="${base}/data/matrix.pdf"`));
    const catalog = JSON.parse(await readFile(path.join(built.output, "data/courses.json"), "utf8"));
    assert.equal(catalog.context, `![Gráfico](${base}/assets/questions/2023/1/chart.png)`);
    assert.equal(catalog.alternatives[0].file, `${base}/assets/questions/2023/1/chart.png`);
    assert.equal(catalog.source, "https://example.org/data/official.json");
    assert.equal(catalog.sourceImage, "https://enem.dev/2023/questions/1/chart.png");
    const manifest = JSON.parse(await readFile(path.join(built.output, "manifest.webmanifest"), "utf8"));
    assert.equal(manifest.id, `${base}/`);
    assert.equal(manifest.scope, `${base}/`);
    assert.equal(manifest.start_url, `${base}/#aprender`);
    assert.equal(manifest.display, "standalone");
    assert.deepEqual(manifest.icons.map(icon => icon.src), ["icon-192.png", "icon-512.png", "icon-maskable-512.png"].map(name => `${base}/icons/${name}`));
    assert.equal(manifest.icons[2].purpose, "maskable");
    const origin = "https://example.org";
    const documentUrl = `${origin}${base}/`;
    const pwaUrl = new URL(`${base}/pwa.js?v=2`, documentUrl);
    assert.equal(new URL("./sw.js", pwaUrl).pathname, `${base}/sw.js`);
    assert.equal(new URL(manifest.start_url, documentUrl).pathname, new URL(manifest.scope, documentUrl).pathname);
    const pwa = await readFile(path.join(built.output, "pwa.js"), "utf8");
    assert.ok(pwa.includes('new URL("./sw.js", import.meta.url)'));
    assert.ok(pwa.includes(`"${base}/sw.js"`));
    assert.equal(await readFile(path.join(built.output, "sw.js"), "utf8"), source["sw.js"]);
    assert.deepEqual(await readdir(path.join(built.output, "assets/questions/2023/1")), ["chart.png"]);
    assert.equal(built.files, Object.keys(source).length + 1);
    for (const [relative, contents] of Object.entries(source)) assert.equal(await readFile(path.join(root, "dist", relative), "utf8"), contents);
    await buildGitHubPages({ root, basePath, output: "_site_again" });
    for (const relative of Object.keys(source)) assert.deepEqual(await readFile(path.join(root, "_site", relative)), await readFile(path.join(root, "_site_again", relative)));
  });
}

test("rejects malformed base paths before producing output", async t => {
  const { root } = await fixture(t);
  for (const basePath of ["enem", "//evil.com", "/../enem", "/enem/..", "/enem?x", "/enem#x", "/enem%2fother", "/enem/<script>", "/a//b", "https://example.org", "/x\ny"]) {
    await assert.rejects(buildGitHubPages({ root, basePath }), /Base path/);
  }
  assert.ok(!(await readdir(root)).includes("_site"));
});

test("requires tracked referenced resources and prevents partial output", async t => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, "dist/data/courses.json"), JSON.stringify({ context: "![Missing](/assets/questions/2023/1/chart%202.png)" }));
  await assert.rejects(buildGitHubPages({ root, basePath: "/concursos-cgu" }), /Missing or unsafe local resource/);
  assert.ok(!(await readdir(root)).includes("_site"));
});

test("requires all manifest icons to be tracked before creating output", async t => {
  const { root } = await fixture(t);
  execFileSync("git", ["rm", "--cached", "-q", "--", "dist/icons/icon-maskable-512.png"], { cwd: root });
  await assert.rejects(buildGitHubPages({ root, basePath: "/concursos-cgu" }), /Missing or unsafe local resource in manifest.webmanifest/);
  assert.ok(!(await readdir(root)).includes("_site"));
});

test("rejects unsafe or missing manifest routes before creating output", async t => {
  const { root, source } = await fixture(t);
  for (const field of ["id", "start_url", "scope"]) {
    for (const route of [undefined, "enem/", "https://example.org/", "//example.org/", "/../enem/", "/enem\\other/", "/enem\n/"]) {
      const manifest = { ...JSON.parse(source["manifest.webmanifest"]), [field]: route };
      await writeFile(path.join(root, "dist/manifest.webmanifest"), JSON.stringify(manifest));
      await assert.rejects(buildGitHubPages({ root, basePath: "/concursos-cgu" }), new RegExp(`Manifest ${field}`));
      assert.ok(!(await readdir(root)).includes("_site"));
    }
  }
});

test("refuses unsafe output directories, existing files, and tracked symlinks", async t => {
  const { root } = await fixture(t);
  for (const output of [".", "dist", "dist/subdirectory", "../external"]) await assert.rejects(buildGitHubPages({ root, output }), /Output/);
  const external = await mkdtemp(path.join(tmpdir(), "fisio-pages-external-"));
  t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, path.join(root, "linked-parent"));
  await assert.rejects(buildGitHubPages({ root, output: "linked-parent/output" }), /Output parent resolves outside/);
  assert.deepEqual(await readdir(external), []);
  await mkdir(path.join(root, "_site"));
  await writeFile(path.join(root, "_site/keep.txt"), "keep");
  await assert.rejects(buildGitHubPages({ root }), /existing files are never removed/);
  assert.equal(await readFile(path.join(root, "_site/keep.txt"), "utf8"), "keep");
  await symlink("../index.html", path.join(root, "dist/data/linked.html"));
  execFileSync("git", ["add", "--", "dist/data/linked.html"], { cwd: root });
  await assert.rejects(buildGitHubPages({ root, output: "safe" }), /Only regular files/);
});

test("requires a tracked entry point even when an untracked copy exists", async t => {
  const { root } = await fixture(t);
  execFileSync("git", ["rm", "--cached", "-q", "--", "dist/index.html"], { cwd: root });
  await assert.rejects(buildGitHubPages({ root }), /Missing tracked deployment file: dist\/index.html/);
  assert.ok(!(await readdir(root)).includes("_site"));
});
