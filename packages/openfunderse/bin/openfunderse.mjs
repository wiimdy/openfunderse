#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(THIS_FILE), "..");
const PACKS_ROOT = path.join(PACKAGE_ROOT, "packs");
const DEFAULT_RUNTIME_PACKAGE = "@wiimdy/openfunderse-agents";

function printUsage() {
  console.log(`openfunderse

Usage:
  openfunderse list
  openfunderse install <pack-name> [--dest <skills-dir>] [--openclaw-home <dir>] [--force] [--link] [--with-runtime]
                     [--runtime-package <name>] [--runtime-dir <dir>] [--runtime-manager <npm|pnpm|yarn|bun>]

Examples:
  openfunderse list
  openfunderse install openfunderse
  openfunderse install openfunderse --link
  openfunderse install openfunderse --with-runtime
  openfunderse install openfunderse --openclaw-home /tmp/.openclaw
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const options = {
    force: false,
    link: false,
    dest: "",
    openclawHome: "",
    withRuntime: false,
    runtimePackage: "",
    runtimeDir: "",
    runtimeManager: ""
  };
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--force") {
      options.force = true;
      continue;
    }
    if (token === "--link") {
      options.link = true;
      continue;
    }
    if (token === "--dest") {
      options.dest = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--openclaw-home" || token === "--codex-home") {
      options.openclawHome = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--with-runtime") {
      options.withRuntime = true;
      continue;
    }
    if (token === "--runtime-package") {
      options.runtimePackage = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--runtime-dir") {
      options.runtimeDir = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--runtime-manager") {
      options.runtimeManager = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token.startsWith("--")) {
      throw new Error(`unknown option: ${token}`);
    }
    positionals.push(token);
  }

  return { command, options, positionals };
}

function defaultOpenClawHome() {
  return process.env.OPENCLAW_HOME || process.env.CODEX_HOME || path.join(os.homedir(), ".openclaw");
}

function ensureUnderRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    return;
  }
  throw new Error(`path escapes pack root: ${target}`);
}

async function listPacks() {
  const entries = await readdir(PACKS_ROOT, { withFileTypes: true });
  const packs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (packs.length === 0) {
    console.log("No packs bundled.");
    return;
  }

  for (const pack of packs) {
    console.log(pack);
  }
}

async function loadManifest(packDir) {
  const candidates = [
    path.join(packDir, "manifest.json"),
    path.join(packDir, "config", "setup-manifest.json")
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const json = JSON.parse(await readFile(candidate, "utf8"));
    return { json, path: candidate };
  }

  throw new Error("manifest file not found (manifest.json or config/setup-manifest.json)");
}

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return {};
  }

  const fields = {};
  const lines = match[1].split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (!pair) continue;
    const key = pair[1];
    const value = pair[2].replace(/^["']|["']$/g, "").trim();
    fields[key] = value;
  }
  return fields;
}

async function readSkillInfo(skillMdPath, fallbackSkillName) {
  const markdown = await readFile(skillMdPath, "utf8");
  const frontMatter = parseFrontMatter(markdown);
  return {
    skillName: fallbackSkillName,
    displayName:
      typeof frontMatter.name === "string" && frontMatter.name.length > 0
        ? frontMatter.name
        : fallbackSkillName,
    description:
      typeof frontMatter.description === "string" && frontMatter.description.length > 0
        ? frontMatter.description
        : ""
  };
}

async function installSkillDir(sourceDir, destinationDir, options) {
  const destinationExists = existsSync(destinationDir);
  if (destinationExists && !options.force) {
    throw new Error(`skill already exists: ${destinationDir} (use --force to overwrite)`);
  }

  if (destinationExists && options.force) {
    await rm(destinationDir, { recursive: true, force: true });
  }

  await mkdir(path.dirname(destinationDir), { recursive: true });
  if (!options.link) {
    await cp(sourceDir, destinationDir, { recursive: true });
    return;
  }

  const symlinkTarget = path.relative(path.dirname(destinationDir), sourceDir) || ".";
  const symlinkType = process.platform === "win32" ? "junction" : "dir";
  try {
    await symlink(symlinkTarget, destinationDir, symlinkType);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to create symlink for ${path.basename(destinationDir)}: ${message} (retry without --link)`
    );
  }
}

function detectRuntimeManager() {
  const userAgent = process.env.npm_config_user_agent || "";
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  if (userAgent.startsWith("bun/")) return "bun";
  return "npm";
}

function commandForRuntimeInstall(manager, runtimePackage) {
  if (manager === "pnpm") {
    return { cmd: "pnpm", args: ["add", runtimePackage] };
  }
  if (manager === "yarn") {
    return { cmd: "yarn", args: ["add", runtimePackage] };
  }
  if (manager === "bun") {
    return { cmd: "bun", args: ["add", runtimePackage] };
  }
  return { cmd: "npm", args: ["install", runtimePackage] };
}

async function installRuntimePackage(options) {
  const runtimePackage = options.runtimePackage || DEFAULT_RUNTIME_PACKAGE;
  const runtimeDir = options.runtimeDir ? path.resolve(options.runtimeDir) : process.cwd();
  const runtimeManager = options.runtimeManager || detectRuntimeManager();
  const packageJsonPath = path.join(runtimeDir, "package.json");

  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `runtime install target has no package.json: ${runtimeDir} (use --runtime-dir <project-root>)`
    );
  }

  const { cmd, args } = commandForRuntimeInstall(runtimeManager, runtimePackage);
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: runtimeDir,
      stdio: "inherit"
    });

    child.on("error", (error) => {
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`runtime install failed with exit code ${code}`));
    });
  });

  return {
    runtimePackage,
    runtimeDir,
    runtimeManager
  };
}

async function installPack(packName, options) {
  const packDir = path.join(PACKS_ROOT, packName);
  if (!existsSync(packDir)) {
    throw new Error(`pack not found: ${packName}`);
  }

  const { json: manifest, path: manifestPath } = await loadManifest(packDir);
  if (!Array.isArray(manifest.bundles) || manifest.bundles.length === 0) {
    throw new Error("manifest has no bundles");
  }

  const openclawHome = options.openclawHome
    ? path.resolve(options.openclawHome)
    : defaultOpenClawHome();
  const skillsRoot = options.dest
    ? path.resolve(options.dest)
    : path.join(openclawHome, "skills");
  const packMetaRoot = path.join(openclawHome, "packs", packName);

  await mkdir(path.dirname(path.join(packMetaRoot, "_")), { recursive: true });
  await cp(packDir, packMetaRoot, { recursive: true, force: true });
  await mkdir(skillsRoot, { recursive: true });

  const installed = [];
  const installOptions = { force: options.force, link: options.link };

  for (const bundle of manifest.bundles) {
    if (!bundle || typeof bundle.skill !== "string") {
      throw new Error("invalid bundle entry: missing skill path");
    }

    const skillMd = path.resolve(packMetaRoot, bundle.skill);
    ensureUnderRoot(packMetaRoot, skillMd);

    if (path.basename(skillMd) !== "SKILL.md") {
      throw new Error(`bundle skill must point to SKILL.md: ${bundle.skill}`);
    }

    if (!existsSync(skillMd)) {
      throw new Error(`missing skill file: ${skillMd}`);
    }

    const sourceSkillDir = path.dirname(skillMd);
    const skillName = path.basename(sourceSkillDir);
    const destinationSkillDir = path.join(skillsRoot, skillName);
    const info = await readSkillInfo(skillMd, skillName);

    await installSkillDir(sourceSkillDir, destinationSkillDir, installOptions);
    installed.push({
      id: typeof bundle.id === "string" ? bundle.id : skillName,
      ...info
    });
  }

  const installedMeta = {
    installedAt: new Date().toISOString(),
    source: "openfunderse",
    packageRoot: PACKAGE_ROOT,
    installMode: options.link ? "symlink" : "copy",
    manifestPath: path.relative(packDir, manifestPath),
    installedSkills: installed.map((item) => item.skillName),
    installedSkillDetails: installed
  };
  await writeFile(path.join(packMetaRoot, "install.json"), `${JSON.stringify(installedMeta, null, 2)}\n`);

  let runtimeInstallMeta = null;
  if (options.withRuntime) {
    runtimeInstallMeta = await installRuntimePackage(options);
  }

  console.log(`Installed pack: ${packName}`);
  console.log(`Install mode: ${options.link ? "symlink" : "copy"}`);
  console.log(`Skills root: ${skillsRoot}`);
  console.log("Installed skills:");
  for (const item of installed) {
    const description = item.description ? ` - ${item.description}` : "";
    console.log(`- ${item.displayName} (${item.skillName})${description}`);
  }
  console.log(`Pack metadata: ${packMetaRoot}`);
  if (runtimeInstallMeta) {
    console.log(
      `Installed runtime package: ${runtimeInstallMeta.runtimePackage} (${runtimeInstallMeta.runtimeManager})`
    );
    console.log(`Runtime install dir: ${runtimeInstallMeta.runtimeDir}`);
  }
  console.log("Restart Codex to pick up new skills.");
}

async function main() {
  const { command, options, positionals } = parseArgs(process.argv.slice(2));

  if (!command || options.help || command === "help") {
    printUsage();
    return;
  }

  if (command === "list") {
    await listPacks();
    return;
  }

  if (command === "install") {
    const packName = positionals[0];
    if (!packName) {
      throw new Error("missing required argument: <pack-name>");
    }
    await installPack(packName, options);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`openfunderse error: ${message}`);
  process.exitCode = 1;
});
