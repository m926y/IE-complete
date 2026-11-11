import assert from "node:assert/strict";
import { access, chmod, cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const publishRoot = new URL("../.qw-pages/publish/", import.meta.url);

async function openPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  await new Promise((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
  if (!address || typeof address === "string") {
    throw new Error("Unable to allocate a test port");
  }
  return address.port;
}

async function waitForResponse(url, process, readOutput) {
  const deadline = Date.now() + 15_000;
  let lastError;

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `Server exited early with code ${process.exitCode}\n${readOutput()}`,
      );
    }
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError ?? new Error("Server did not become ready");
}

async function runCommand(command, args, options) {
  const actualArgs = process.platform === "win32" && command === "npm" ? [join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), ...args] : args;
  const actualCommand = process.platform === "win32" && command === "npm" ? process.execPath : command;
  const child = spawn(actualCommand, actualArgs, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with code ${exitCode}\n${output}`,
    );
  }
}

async function setTreeWritable(root, writable) {
  const directoryMode = writable ? 0o755 : 0o555;
  const fileMode = writable ? 0o644 : 0o444;
  await chmod(root, directoryMode);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    await chmod(
      join(entry.parentPath, entry.name),
      entry.isDirectory() ? directoryMode : fileMode,
    );
  }
}

test("build emits a standalone dynamic QW Page and serves healthy root", async () => {
  await Promise.all([
    access(new URL("package.json", publishRoot)),
    access(new URL("package-lock.json", publishRoot)),
    access(new URL("server.mjs", publishRoot)),
    access(new URL("dist/index.html", publishRoot)),
  ]);

  const publishedEntries = (await readdir(publishRoot)).sort();
  assert.deepEqual(publishedEntries, [
    ...((await access(new URL("../cloud-seed/", import.meta.url)).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) ? ["cloud-seed"] : []),
    "dist",
    "package-lock.json",
    "package.json",
    "scripts",
    "server",
    "server.mjs",
  ]);

  // Copy the publish artifact out of the source tree so the server cannot
  // resolve packages from the project's dev node_modules, install only
  // production dependencies, and drop write access to mirror the deployed
  // immutable filesystem.
  const appRoot = await mkdtemp(join(tmpdir(), "qw-pages-standalone-"));
  const writableRoot = await mkdtemp(join(tmpdir(), "qw-pages-template-test-"));
  let child;

  try {
    await cp(publishRoot, appRoot, { recursive: true });
    await runCommand(
      "npm",
      ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: appRoot },
    );
    await setTreeWritable(appRoot, false);

    const port = await openPort();
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: appRoot,
      env: {
        HOME: writableRoot,
        HOST: "127.0.0.1",
        NODE_ENV: "production",
        PORT: String(port),
        QWENWORK_WRITABLE_DIR: writableRoot,
        TMPDIR: writableRoot,
        XDG_CACHE_HOME: join(writableRoot, "cache"),
        XDG_CONFIG_HOME: join(writableRoot, "config"),
        XDG_DATA_HOME: join(writableRoot, "data"),
      },
      stdio: "pipe",
    });
    let childOutput = "";
    child.stdout.on("data", (chunk) => (childOutput += chunk));
    child.stderr.on("data", (chunk) => (childOutput += chunk));

    const rootResponse = await waitForResponse(
      `http://127.0.0.1:${port}/`,
      child,
      () => childOutput,
    );
    assert.equal(rootResponse.status, 200);
    assert.match(rootResponse.headers.get("content-type") ?? "", /^text\/html\b/);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: "ok" });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("close", resolve));
    }
    await setTreeWritable(appRoot, true).catch(() => {});
    await rm(appRoot, { force: true, recursive: true });
    await rm(writableRoot, { force: true, recursive: true });
  }
});
