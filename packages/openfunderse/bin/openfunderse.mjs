#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(THIS_FILE), "..");
const PACKS_ROOT = path.join(PACKAGE_ROOT, "packs");
const DEFAULT_RUNTIME_PACKAGE = "@wiimdy/openfunderse-agents";
const SUPPORTED_ENV_PROFILES = new Set(["strategy", "participant", "all"]);
const SUPPORTED_BOT_INIT_ROLES = new Set(["strategy", "participant"]);
const DEFAULT_MONAD_CHAIN_ID = "10143";
const TEMP_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

const STRATEGY_ENV_TEMPLATE = `# OpenFunderse strategy env scaffold
# Copy values from your relayer + deployed contracts.

RELAYER_URL=https://your-relayer.example.com
BOT_ID=bot-strategy-1
BOT_API_KEY=replace_me
BOT_ADDRESS=0x0000000000000000000000000000000000000000
CHAIN_ID=10143
RPC_URL=https://testnet-rpc.monad.xyz

# NadFun / protocol addresses
INTENT_BOOK_ADDRESS=0x0000000000000000000000000000000000000000
NADFUN_EXECUTION_ADAPTER_ADDRESS=0x0000000000000000000000000000000000000000
VAULT_ADDRESS=0x0000000000000000000000000000000000000000
NADFUN_LENS_ADDRESS=0x0000000000000000000000000000000000000000
NADFUN_BONDING_CURVE_ROUTER=0x0000000000000000000000000000000000000000
NADFUN_DEX_ROUTER=0x0000000000000000000000000000000000000000
NADFUN_WMON_ADDRESS=0x0000000000000000000000000000000000000000

# Strategy signer (EOA)
# Temporary bootstrap key (public and unsafe). Replace via bot-init before real usage.
STRATEGY_PRIVATE_KEY=${TEMP_PRIVATE_KEY}
# STRATEGY_CREATE_MIN_SIGNER_BALANCE_WEI=10000000000000000

# Safety defaults
STRATEGY_REQUIRE_EXPLICIT_SUBMIT=true
STRATEGY_AUTO_SUBMIT=false
# STRATEGY_TRUSTED_RELAYER_HOSTS=openfunderse-relayer.example.com
# STRATEGY_ALLOW_HTTP_RELAYER=true
`;

const PARTICIPANT_ENV_TEMPLATE = `# OpenFunderse participant env scaffold
RELAYER_URL=https://your-relayer.example.com
BOT_ID=bot-participant-1
BOT_API_KEY=replace_me
BOT_ADDRESS=0x0000000000000000000000000000000000000000
CHAIN_ID=10143
# Temporary bootstrap key (public and unsafe). Replace via bot-init before real usage.
PARTICIPANT_PRIVATE_KEY=${TEMP_PRIVATE_KEY}
CLAIM_ATTESTATION_VERIFIER_ADDRESS=0x0000000000000000000000000000000000000000
PARTICIPANT_REQUIRE_EXPLICIT_SUBMIT=true
PARTICIPANT_AUTO_SUBMIT=false
# PARTICIPANT_TRUSTED_RELAYER_HOSTS=openfunderse-relayer.example.com
# PARTICIPANT_ALLOW_HTTP_RELAYER=true
`;

function printUsage() {
  console.log(`openfunderse

Usage:
  openfunderse list
  openfunderse bot-init [--role <strategy|participant>] [--skill-name <name>] [--env-path <path>] [--wallet-dir <dir>] [--wallet-name <name>] [--force] [--yes]
  openfunderse install <pack-name> [--dest <skills-dir>] [--codex-home <dir>] [--force] [--with-runtime]
                     [--init-env] [--env-path <path>] [--env-profile <strategy|participant|all>]
                     [--runtime-package <name>] [--runtime-dir <dir>] [--runtime-manager <npm|pnpm|yarn|bun>]

Examples:
  openfunderse list
  openfunderse install openfunderse
  openfunderse install openfunderse --with-runtime
  openfunderse install openfunderse --with-runtime --init-env --env-profile strategy
  openfunderse install openfunderse --codex-home /tmp/codex-home
  openfunderse bot-init --env-path .env.participant --wallet-name participant-bot --yes
  openfunderse bot-init --skill-name strategy --env-path .env.strategy --force
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const options = {
    force: false,
    dest: "",
    codexHome: "",
    withRuntime: false,
    initEnv: false,
    envFile: "",
    envProfile: "strategy",
    runtimePackage: "",
    runtimeDir: "",
    runtimeManager: "",
    role: "",
    skillName: "",
    walletDir: "",
    walletName: "",
    yes: false
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
    if (token === "--yes") {
      options.yes = true;
      continue;
    }
    if (token === "--dest") {
      options.dest = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--codex-home") {
      options.codexHome = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--with-runtime") {
      options.withRuntime = true;
      continue;
    }
    if (token === "--init-env") {
      options.initEnv = true;
      continue;
    }
    if (token === "--env-file" || token === "--env-path") {
      options.envFile = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--env-profile") {
      options.envProfile = args[i + 1] ?? "";
      i += 1;
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
    if (token === "--role") {
      options.role = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--skill-name") {
      options.skillName = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--wallet-dir") {
      options.walletDir = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--wallet-name") {
      options.walletName = args[i + 1] ?? "";
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

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
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

function normalizeEnvProfile(rawProfile) {
  const profile = (rawProfile || "").trim().toLowerCase();
  if (SUPPORTED_ENV_PROFILES.has(profile)) {
    return profile;
  }
  throw new Error(
    `invalid --env-profile value: ${rawProfile} (expected strategy|participant|all)`
  );
}

function normalizeBotInitRole(rawRole) {
  const role = (rawRole || "").trim().toLowerCase();
  if (SUPPORTED_BOT_INIT_ROLES.has(role)) {
    return role;
  }
  throw new Error(
    `invalid --role value: ${rawRole} (expected strategy|participant)`
  );
}

function inferRoleFromHint(hint) {
  const normalized = (hint || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("participant")) return "participant";
  if (normalized.includes("strategy")) return "strategy";
  return "";
}

function resolveBotInitRole(options) {
  if (options.role && options.role.trim().length > 0) {
    return normalizeBotInitRole(options.role);
  }

  const envSkillHints = [
    process.env.OPENCLAW_SKILL_KEY,
    process.env.OPENCLAW_ACTIVE_SKILL,
    process.env.SKILL_KEY,
    process.env.SKILL_NAME
  ];

  const hints = [
    options.skillName,
    options.envFile ? path.basename(options.envFile) : "",
    options.walletName,
    ...envSkillHints
  ].filter((entry) => Boolean(entry && entry.trim().length > 0));

  const inferredRoles = new Set();
  for (const hint of hints) {
    const inferred = inferRoleFromHint(hint);
    if (inferred) {
      inferredRoles.add(inferred);
    }
  }

  if (inferredRoles.size === 1) {
    return [...inferredRoles][0];
  }

  if (inferredRoles.size > 1) {
    throw new Error(
      "conflicting role hints found. pass explicit --role <strategy|participant>."
    );
  }

  throw new Error(
    "cannot infer bot role. pass --role or include strategy/participant in --skill-name, --env-path, --wallet-name, or OPENCLAW_SKILL_KEY."
  );
}

function runtimeEnvExamplePath(runtimeDir, runtimePackage) {
  return path.join(runtimeDir, "node_modules", ...runtimePackage.split("/"), ".env.example");
}

async function buildEnvScaffold(profile, runtimeDir, runtimePackage) {
  if (profile === "strategy") {
    return STRATEGY_ENV_TEMPLATE;
  }
  if (profile === "participant") {
    return PARTICIPANT_ENV_TEMPLATE;
  }

  const runtimeTemplate = runtimeEnvExamplePath(runtimeDir, runtimePackage);
  if (existsSync(runtimeTemplate)) {
    return readFile(runtimeTemplate, "utf8");
  }

  return `${STRATEGY_ENV_TEMPLATE}\n\n${PARTICIPANT_ENV_TEMPLATE}`;
}

async function writeEnvScaffold(options) {
  const runtimeDir = options.runtimeDir ? path.resolve(options.runtimeDir) : process.cwd();
  const runtimePackage = options.runtimePackage || DEFAULT_RUNTIME_PACKAGE;
  const profile = normalizeEnvProfile(options.envProfile);
  const envTarget = options.envFile
    ? path.resolve(options.envFile)
    : path.join(runtimeDir, ".env.openfunderse");

  const alreadyExists = existsSync(envTarget);
  if (alreadyExists && !options.force) {
    return {
      written: false,
      envFile: envTarget,
      profile
    };
  }

  if (alreadyExists && options.force) {
    await rm(envTarget, { force: true });
  }

  const scaffold = await buildEnvScaffold(profile, runtimeDir, runtimePackage);
  await mkdir(path.dirname(envTarget), { recursive: true });
  await writeFile(envTarget, scaffold.endsWith("\n") ? scaffold : `${scaffold}\n`);

  return {
    written: true,
    envFile: envTarget,
    profile
  };
}

function defaultEnvPathForRole(role) {
  return path.join(process.cwd(), `.env.${role}`);
}

function readAssignedEnvValue(content, key) {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    if (match[1] !== key) continue;
    return match[2];
  }
  return "";
}

function isPlaceholderEnvValue(value) {
  const normalized = (value || "").trim();
  if (!normalized) return true;
  if (normalized === "replace_me") return true;
  if (normalized.toLowerCase() === TEMP_PRIVATE_KEY.toLowerCase()) return true;
  if (/^0xYOUR_/i.test(normalized)) return true;
  if (/^YOUR_/i.test(normalized)) return true;
  if (/^0x0+$/i.test(normalized)) return true;
  if (normalized === "0x0000000000000000000000000000000000000000") return true;
  return false;
}

function upsertEnvValues(content, updates) {
  const lines = content.split(/\r?\n/);
  const applied = new Set();

  const patched = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) return line;
    const key = match[1];
    if (!(key in updates)) return line;
    applied.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (applied.has(key)) continue;
    patched.push(`${key}=${value}`);
  }

  return `${patched.join("\n").replace(/\n+$/g, "")}\n`;
}

function shellQuote(input) {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}

async function runCommandCapture(cmd, args, cwd = process.cwd()) {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8")
        });
        return;
      }
      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      reject(
        new Error(
          `command failed: ${cmd} ${args.join(" ")} (exit ${code})${stderrText ? ` - ${stderrText}` : ""}`
        )
      );
    });
  });
}

async function confirmBotInit({ role, envFile, privateKeyKey, isRotation, assumeYes }) {
  const mode = isRotation ? "wallet rotation" : "new wallet bootstrap";
  console.log("WARNING: bot-init will generate a new wallet and update your env private key.");
  console.log(`- Mode: ${mode}`);
  console.log(`- Role: ${role}`);
  console.log(`- Env file: ${envFile}`);
  console.log(`- Key field: ${privateKeyKey}`);
  console.log("- Existing funds tied to old key are not moved automatically.");

  if (assumeYes) {
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("bot-init requires confirmation in TTY. Re-run with --yes to confirm non-interactively.");
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    const answer = await rl.question("Type YES to continue: ");
    if (answer.trim().toUpperCase() !== "YES") {
      throw new Error("bot-init cancelled by user.");
    }
  } finally {
    rl.close();
  }
}

async function generateMonadWalletWithCast() {
  let output;
  try {
    output = await runCommandCapture("cast", ["wallet", "new", "--json"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      throw new Error(
        "cast is not installed. Install Foundry first (https://book.getfoundry.sh/getting-started/installation)."
      );
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(output.stdout);
  } catch {
    throw new Error(`failed to parse cast output as JSON: ${output.stdout}`);
  }

  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const address = String(first?.address ?? "");
  const privateKey = String(first?.private_key ?? first?.privateKey ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`invalid wallet address from cast: ${address}`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("invalid private key from cast output");
  }

  return {
    address,
    privateKey
  };
}

function roleEnvUpdates(role, wallet) {
  if (role === "strategy") {
    return {
      CHAIN_ID: DEFAULT_MONAD_CHAIN_ID,
      STRATEGY_PRIVATE_KEY: wallet.privateKey,
      BOT_ADDRESS: wallet.address
    };
  }
  return {
    CHAIN_ID: DEFAULT_MONAD_CHAIN_ID,
    PARTICIPANT_PRIVATE_KEY: wallet.privateKey,
    PARTICIPANT_BOT_ADDRESS: wallet.address,
    BOT_ADDRESS: wallet.address
  };
}

async function persistWallet(role, wallet, options) {
  const walletDir = options.walletDir
    ? path.resolve(options.walletDir)
    : path.join(defaultCodexHome(), "openfunderse", "wallets");
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const rawName = (options.walletName || `${role}-${timestamp}`).trim();
  if (!rawName) {
    throw new Error("--wallet-name must not be empty");
  }
  if (rawName.includes("/") || rawName.includes("\\")) {
    throw new Error("--wallet-name must be a file name, not a path");
  }
  const fileName = rawName.endsWith(".json") ? rawName : `${rawName}.json`;
  const walletPath = path.join(walletDir, fileName);
  if (existsSync(walletPath) && !options.force) {
    throw new Error(`wallet file already exists: ${walletPath} (use --force to overwrite)`);
  }

  const payload = {
    createdAt: new Date().toISOString(),
    role,
    chainId: DEFAULT_MONAD_CHAIN_ID,
    address: wallet.address,
    privateKey: wallet.privateKey
  };
  await mkdir(walletDir, { recursive: true, mode: 0o700 });
  await writeFile(walletPath, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(walletPath, 0o600);
  return walletPath;
}

function assertPrivateKeyRotationAllowed(envContent, role, force) {
  const privateKeyKey = role === "strategy" ? "STRATEGY_PRIVATE_KEY" : "PARTICIPANT_PRIVATE_KEY";
  const existing = readAssignedEnvValue(envContent, privateKeyKey);
  if (!existing) return;
  if (isPlaceholderEnvValue(existing)) return;
  if (force) return;
  throw new Error(
    `${privateKeyKey} already has a value. bot-init creates a new wallet and will replace it; rerun with --force to rotate.`
  );
}

async function runBotInit(options) {
  const role = resolveBotInitRole(options);
  const envFile = options.envFile ? path.resolve(options.envFile) : defaultEnvPathForRole(role);
  const runtimeDir = options.runtimeDir ? path.resolve(options.runtimeDir) : process.cwd();
  const runtimePackage = options.runtimePackage || DEFAULT_RUNTIME_PACKAGE;

  let envContent;
  if (existsSync(envFile)) {
    envContent = await readFile(envFile, "utf8");
  } else {
    envContent = await buildEnvScaffold(role, runtimeDir, runtimePackage);
  }

  const privateKeyKey = role === "strategy" ? "STRATEGY_PRIVATE_KEY" : "PARTICIPANT_PRIVATE_KEY";
  const existingPrivateKey = readAssignedEnvValue(envContent, privateKeyKey);
  const isRotation = Boolean(existingPrivateKey) && !isPlaceholderEnvValue(existingPrivateKey);

  assertPrivateKeyRotationAllowed(envContent, role, options.force);
  await confirmBotInit({
    role,
    envFile,
    privateKeyKey,
    isRotation,
    assumeYes: options.yes
  });

  const wallet = await generateMonadWalletWithCast();
  const walletPath = await persistWallet(role, wallet, options);
  const updates = roleEnvUpdates(role, wallet);
  const nextEnvContent = upsertEnvValues(envContent, updates);

  await mkdir(path.dirname(envFile), { recursive: true });
  await writeFile(envFile, nextEnvContent);
  await chmod(envFile, 0o600);
  const sourceCommand = `set -a; source ${shellQuote(envFile)}; set +a`;

  console.log(`Initialized ${role} bot wallet for Monad testnet (${DEFAULT_MONAD_CHAIN_ID}).`);
  console.log(`Address: ${wallet.address}`);
  console.log(`Env file updated: ${envFile}`);
  console.log(`Wallet backup (keep secret): ${walletPath}`);
  console.log(`Load env now: ${sourceCommand}`);
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

async function copySkillDir(sourceDir, destinationDir, force) {
  const destinationExists = existsSync(destinationDir);
  if (destinationExists && !force) {
    throw new Error(`skill already exists: ${destinationDir} (use --force to overwrite)`);
  }

  if (destinationExists && force) {
    await rm(destinationDir, { recursive: true, force: true });
  }

  await mkdir(path.dirname(destinationDir), { recursive: true });
  await cp(sourceDir, destinationDir, { recursive: true });
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

  const codexHome = options.codexHome ? path.resolve(options.codexHome) : defaultCodexHome();
  const skillsRoot = options.dest
    ? path.resolve(options.dest)
    : path.join(codexHome, "skills");

  await mkdir(skillsRoot, { recursive: true });

  const installed = [];

  for (const bundle of manifest.bundles) {
    if (!bundle || typeof bundle.skill !== "string") {
      throw new Error("invalid bundle entry: missing skill path");
    }

    const skillMd = path.resolve(packDir, bundle.skill);
    ensureUnderRoot(packDir, skillMd);

    if (path.basename(skillMd) !== "SKILL.md") {
      throw new Error(`bundle skill must point to SKILL.md: ${bundle.skill}`);
    }

    if (!existsSync(skillMd)) {
      throw new Error(`missing skill file: ${skillMd}`);
    }

    const sourceSkillDir = path.dirname(skillMd);
    const skillName = path.basename(sourceSkillDir);
    const destinationSkillDir = path.join(skillsRoot, skillName);

    await copySkillDir(sourceSkillDir, destinationSkillDir, options.force);
    installed.push(skillName);
  }

  const packMetaRoot = path.join(codexHome, "packs", packName);
  await mkdir(path.dirname(path.join(packMetaRoot, "_")), { recursive: true });

  await cp(packDir, packMetaRoot, { recursive: true, force: true });

  const installedMeta = {
    installedAt: new Date().toISOString(),
    source: "openfunderse",
    packageRoot: PACKAGE_ROOT,
    manifestPath: path.relative(packDir, manifestPath),
    installedSkills: installed
  };
  await writeFile(path.join(packMetaRoot, "install.json"), `${JSON.stringify(installedMeta, null, 2)}\n`);

  let runtimeInstallMeta = null;
  if (options.withRuntime) {
    runtimeInstallMeta = await installRuntimePackage(options);
  }

  let envScaffoldMeta = null;
  if (options.initEnv) {
    const envOptions = {
      ...options,
      runtimeDir: runtimeInstallMeta?.runtimeDir ?? options.runtimeDir,
      runtimePackage: runtimeInstallMeta?.runtimePackage ?? options.runtimePackage
    };
    envScaffoldMeta = await writeEnvScaffold(envOptions);
  }

  console.log(`Installed pack: ${packName}`);
  console.log(`Skills root: ${skillsRoot}`);
  console.log(`Installed skills: ${installed.join(", ")}`);
  console.log(`Pack metadata: ${packMetaRoot}`);
  if (runtimeInstallMeta) {
    console.log(
      `Installed runtime package: ${runtimeInstallMeta.runtimePackage} (${runtimeInstallMeta.runtimeManager})`
    );
    console.log(`Runtime install dir: ${runtimeInstallMeta.runtimeDir}`);
  }
  if (envScaffoldMeta) {
    if (envScaffoldMeta.written) {
      console.log(`Generated env scaffold (${envScaffoldMeta.profile}): ${envScaffoldMeta.envFile}`);
    } else {
      console.log(
        `Env scaffold already exists (use --force to overwrite): ${envScaffoldMeta.envFile}`
      );
    }
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

  if (command === "bot-init") {
    await runBotInit(options);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`openfunderse error: ${message}`);
  process.exitCode = 1;
});
