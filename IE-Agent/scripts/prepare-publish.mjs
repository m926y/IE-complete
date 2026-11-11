import { access, cp, mkdir, readFile, rm } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);
const publishRoot = new URL("../.qw-pages/publish/", import.meta.url);

async function requireFile(relativePath) {
  const url = new URL(relativePath, projectRoot);
  await access(url);
  return url;
}

await Promise.all([
  requireFile("dist/index.html"),
  requireFile("server.mjs"),
  requireFile("package.json"),
  requireFile("package-lock.json"),
]);

await rm(publishRoot, { force: true, recursive: true });
await mkdir(publishRoot, { recursive: true });

await Promise.all([
  cp(new URL("dist/", projectRoot), new URL("dist/", publishRoot), {
    recursive: true,
  }),
  cp(new URL("server.mjs", projectRoot), new URL("server.mjs", publishRoot)),
  cp(new URL("package.json", projectRoot), new URL("package.json", publishRoot)),
  cp(
    new URL("package-lock.json", projectRoot),
    new URL("package-lock.json", publishRoot),
  ),
]);

try {
  await access(new URL("server/", projectRoot));
  await cp(new URL("server/", projectRoot), new URL("server/", publishRoot), {
    recursive: true,
  });
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

const packageJson = JSON.parse(
  await readFile(new URL("package.json", publishRoot), "utf8"),
);
if (packageJson.type !== "module") {
  throw new Error('Dynamic publish package must use "type": "module"');
}

await mkdir(new URL("scripts/",publishRoot),{recursive:true});
await cp(new URL("scripts/recompute-model.py",projectRoot),new URL("scripts/recompute-model.py",publishRoot));
await cp(new URL("scripts/scoring_source/",projectRoot),new URL("scripts/scoring_source/",publishRoot),{recursive:true});

await cp(new URL("scripts/extract-learning-document.py",projectRoot),new URL("scripts/extract-learning-document.py",publishRoot));
await cp(new URL("scripts/extract-ai-upload.py",projectRoot),new URL("scripts/extract-ai-upload.py",publishRoot));
// 云端首启种子数据（gzip JSON，约3MB）：业务库快照，首启幂等导入 Supabase
try {
  await access(new URL("cloud-seed/manifest.json", projectRoot));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  console.warn("Cloud seed is absent; building the local workstation without cloud initialization data.");
}
try {
  await cp(new URL("cloud-seed/",projectRoot),new URL("cloud-seed/",publishRoot),{recursive:true});
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
