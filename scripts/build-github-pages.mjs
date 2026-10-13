#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const TEXT_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".svg"]);
// Match local URL tokens only, including Markdown image URLs and the image allowlist.
const LOCAL_URL = /(["'(])\/(assets\/questions\/|data\/|icons\/|vendor\/|favicon\.svg\b|apple-touch-icon\.png\b|styles\.css\b|app\.js\b|pwa\.js\b|sw\.js\b|manifest\.webmanifest\b)/g;
const LOCAL_REFERENCE = /["'(](\/(?:assets\/questions\/|data\/|icons\/|vendor\/|favicon\.svg\b|apple-touch-icon\.png\b|styles\.css\b|app\.js\b|pwa\.js\b|sw\.js\b|manifest\.webmanifest\b)[^"'\\\s<)]*)/g;

function rewriteManifestRoutes(text, base) {
  const manifest = JSON.parse(text);
  function rewriteRoute(route, field) {
    if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") || /[\\\s]/.test(route) || route.includes("..")) {
      throw new Error(`Manifest ${field} must be a safe root-relative URL.`);
    }
    return `${base}${route}`;
  }
  for (const field of ["id", "start_url", "scope"]) {
    manifest[field] = rewriteRoute(manifest[field], field);
  }
  for (const shortcut of manifest.shortcuts || []) shortcut.url = rewriteRoute(shortcut.url, "shortcut URL");
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function normalizeBasePath(value = "") {
  if (value === "" || value === "/") return "";
  if (typeof value !== "string" || !/^\/[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*\/?$/.test(value)) {
    throw new Error("Base path must be empty, /, or a local path such as /enem (no query, traversal, or URL).");
  }
  return value.replace(/\/$/, "");
}

export async function buildGitHubPages({ root = process.cwd(), output = "_site", basePath = "" } = {}) {
  const base = normalizeBasePath(basePath);
  const projectRoot = await realpath(root);
  const sourceRoot = await realpath(path.join(projectRoot, "dist"));
  if (!sourceRoot.startsWith(`${projectRoot}${path.sep}`)) throw new Error("dist must resolve inside the project.");
  const outputRoot = path.resolve(projectRoot, output);
  const outputRelative = path.relative(projectRoot, outputRoot);
  if (outputRoot === projectRoot || outputRoot === sourceRoot || outputRoot.startsWith(`${sourceRoot}${path.sep}`) || outputRelative === ".." || outputRelative.startsWith(`..${path.sep}`)) {
    throw new Error("Output must be a separate directory inside the project, outside dist.");
  }
  try {
    if (!(await lstat(outputRoot)).isDirectory() || (await readdir(outputRoot)).length) throw new Error("Output must be absent or an empty directory; existing files are never removed.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  let existingParent = path.dirname(outputRoot);
  while (true) {
    try {
      const physicalParent = await realpath(existingParent);
      if (physicalParent !== projectRoot && !physicalParent.startsWith(`${projectRoot}${path.sep}`)) throw new Error("Output parent resolves outside the project.");
      if (physicalParent === sourceRoot || physicalParent.startsWith(`${sourceRoot}${path.sep}`)) throw new Error("Output parent resolves inside dist.");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      existingParent = path.dirname(existingParent);
    }
  }

  const tracked = execFileSync("git", ["ls-files", "-z", "--", "dist"], { cwd: projectRoot, encoding: "utf8" }).split("\0").filter(Boolean).sort();
  const files = new Map();
  for (const trackedPath of tracked) {
    if (!trackedPath.startsWith("dist/") || trackedPath.split("/").includes("..")) throw new Error(`Invalid tracked path: ${trackedPath}`);
    const absolute = path.join(projectRoot, trackedPath);
    if (!(await lstat(absolute)).isFile() || !(await realpath(absolute)).startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`Only regular files inside dist can be packaged: ${trackedPath}`);
    files.set(trackedPath.slice(5), await readFile(absolute));
  }
  for (const required of ["index.html", "app.js", "diagnostic.js", "styles.css", "data/courses.json", "manifest.webmanifest", "pwa.js", "sw.js"]) {
    if (!files.has(required)) throw new Error(`Missing tracked deployment file: dist/${required}`);
  }
  let references = 0;
  // Validate before creating output, so a missing image never produces a partial package.
  for (const [relative, contents] of files) {
    const compressed = relative.endsWith('.json.gz');
    if (!compressed && !TEXT_EXTENSIONS.has(path.extname(relative))) continue;
    const text = (compressed ? gunzipSync(contents) : contents).toString("utf8");
    for (const match of text.matchAll(LOCAL_REFERENCE)) {
      const resource = match[1].split(/[?#]/, 1)[0];
      if (resource.endsWith("/")) continue; // The Markdown renderer's directory allowlist.
      if (resource.includes("..") || !files.has(resource.slice(1))) throw new Error(`Missing or unsafe local resource in ${relative}: ${resource}`);
      references++;
    }
    const withRoutes = relative === "manifest.webmanifest" ? rewriteManifestRoutes(text, base) : text;
    const rewritten = Buffer.from(withRoutes.replace(LOCAL_URL, (_, boundary, resource) => `${boundary}${base}/${resource}`));
    files.set(relative, compressed ? gzipSync(rewritten, {level:9}) : rewritten);
  }
  await mkdir(outputRoot, { recursive: true });
  // An output parent symlink must not turn a project-local path into an external write.
  const physicalOutput = await realpath(outputRoot);
  if (!physicalOutput.startsWith(`${projectRoot}${path.sep}`) || physicalOutput.startsWith(`${sourceRoot}${path.sep}`)) throw new Error("Output resolves outside the project or inside dist.");
  for (const [relative, contents] of files) {
    const target = path.join(outputRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  await writeFile(path.join(outputRoot, ".nojekyll"), "");
  return { output: outputRoot, basePath: base || "/", files: files.size + 1, references };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const flag = process.argv[i];
      const value = process.argv[i + 1];
      if (!["--base-path", "--out-dir"].includes(flag) || value === undefined) throw new Error("Usage: node scripts/build-github-pages.mjs [--base-path /enem] [--out-dir _site]");
      options[flag === "--base-path" ? "basePath" : "output"] = value;
    }
    console.log(JSON.stringify(await buildGitHubPages(options)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
