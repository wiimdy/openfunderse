#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const THIS_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(THIS_FILE), "..");
const PACKS_ROOT = path.join(PACKAGE_ROOT, "packs");
const STRATEGY_ENV_TEMPLATE_PATH = path.join(PACKAGE_ROOT, ".env.strategy");
const PARTICIPANT_ENV_TEMPLATE_PATH = path.join(
  PACKAGE_ROOT,
  ".env.participant",
);
const DEFAULT_RUNTIME_PACKAGE = "@wiimdy/openfunderse-agents";
const SUPPORTED_ENV_PROFILES = new Set(["strategy", "participant", "all"]);
const SUPPORTED_BOT_INIT_ROLES = new Set(["strategy", "participant"]);
const DEFAULT_MONAD_CHAIN_ID = "10143";
const TEMP_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

const STRATEGY_ENV_TEMPLATE = `# OpenFunderse strategy env scaffold
RELAYER_URL=https://your-relayer.example.com
BOT_ID=bot-strategy-1
CHAIN_ID=10143
RPC_URL=https://testnet-rpc.monad.xyz
STRATEGY_PRIVATE_KEY=\${TEMP_PRIVATE_KEY}
STRATEGY_ADDRESS=0x0000000000000000000000000000000000000000
`;

const PARTICIPANT_ENV_TEMPLATE = `# OpenFunderse participant env scaffold
RELAYER_URL=https://your-relayer.example.com
BOT_ID=bot-participant-1
CHAIN_ID=10143
RPC_URL=https://testnet-rpc.monad.xyz
PARTICIPANT_PRIVATE_KEY=\${TEMP_PRIVATE_KEY}
PARTICIPANT_ADDRESS=0x0000000000000000000000000000000000000000
`;

const BOTFATHER_STRATEGY_COMMANDS = [
  "start - Show quick start",
  "help - Show command help",
  "create_fund - Create fund onchain via Factory",
  "propose_intent - Propose a trade intent from snapshot",
  "dry_run_intent - Simulate intent execution against ClawCore",
  "attest_intent - Submit intent attestation to IntentBook",
  "execute_intent - Execute attested intent onchain",
];

const BOTFATHER_PARTICIPANT_COMMANDS = [
  "start - Show quick start",
  "help - Show command help",
  "allocation - Mine (optional verify) and optionally submit allocation claim",
  "join - Register this bot as a participant for the fund mapped to the room id",
  "deposit - Deposit native MON or ERC-20 into vault",
  "withdraw - Withdraw assets from vault (native or ERC-20)",
  "redeem - Burn vault shares and receive assets",
  "vault_info - Show vault status and user PnL",
  "participant_daemon - Run participant allocation daemon",
];

function botFatherCommandLinesForProfile(profile) {
  if (profile === "strategy") {
    return BOTFATHER_STRATEGY_COMMANDS;
  }
  if (profile === "participant") {
    return BOTFATHER_PARTICIPANT_COMMANDS;
  }
  const merged = new Set([
    ...BOTFATHER_STRATEGY_COMMANDS,
    ...BOTFATHER_PARTICIPANT_COMMANDS,
  ]);
  return [...merged];
}

function printTelegramBotSetupGuide(profile) {
  const lines = botFatherCommandLinesForProfile(profile);
  console.log("Telegram setup (recommended on first skill install):");
  console.log("1) Open @BotFather and run /setcommands");
  console.log("2) Select your bot and command scope (Default or Group)");
  console.log("3) Paste this command block:");
  console.log("-----");
  for (const line of lines) {
    console.log(line);
  }
  console.log("-----");
}

function printUsage() {
  console.log(`openfunderse

Usage:
  openfunderse list
  openfunderse bot-init [--role <strategy|participant>] [--skill-name <name>] [--env-path <path>] [--wallet-dir <dir>] [--wallet-name <name>] [--force] [--yes]
                       [--no-sync-openclaw-env] [--no-restart-openclaw-gateway]
  openfunderse install <pack-name> [--dest <skills-dir>] [--codex-home <dir>] [--force] [--with-runtime]
                     [--no-init-env] [--env-path <path>] [--env-profile <strategy|participant|all>]
                     [--no-sync-openclaw-env]
                     [--runtime-package <name>] [--runtime-dir <dir>] [--runtime-manager <npm|pnpm|yarn|bun>]

Examples:
  openfunderse list
  openfunderse install openfunderse-strategy --with-runtime
  openfunderse install openfunderse-participant --with-runtime
  openfunderse install openfunderse-strategy --codex-home /tmp/openclaw-workspace
  openfunderse bot-init --skill-name participant --wallet-name participant-bot --yes
  openfunderse bot-init --skill-name strategy --force
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
    initEnv: true,
    initEnvExplicit: false,
    envFile: "",
    envProfile: "",
    envProfileExplicit: false,
    runtimePackage: "",
    runtimeDir: "",
    runtimeManager: "",
    role: "",
    skillName: "",
    walletDir: "",
    walletName: "",
    syncOpenclawEnv: true,
    restartOpenclawGateway: true,
    yes: false,
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
    if (token === "--sync-openclaw-env") {
      options.syncOpenclawEnv = true;
      continue;
    }
    if (token === "--no-sync-openclaw-env") {
      options.syncOpenclawEnv = false;
      continue;
    }
    if (token === "--restart-openclaw-gateway") {
      options.restartOpenclawGateway = true;
      continue;
    }
    if (token === "--no-restart-openclaw-gateway") {
      options.restartOpenclawGateway = false;
      continue;
    }
    if (token === "--init-env") {
      options.initEnv = true;
      options.initEnvExplicit = true;
      continue;
    }
    if (token === "--no-init-env") {
      options.initEnv = false;
      options.initEnvExplicit = true;
      continue;
    }
    if (token === "--env-file" || token === "--env-path") {
      options.envFile = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--env-profile") {
      options.envProfile = args[i + 1] ?? "";
      options.envProfileExplicit = true;
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
  return path.join(os.homedir(), ".openclaw", "workspace");
}

function ensureUnderRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
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
    `invalid --env-profile value: ${rawProfile} (expected strategy|participant|all)`,
  );
}

function defaultEnvProfileForPack(packName) {
  const normalized = String(packName || "")
    .trim()
    .toLowerCase();
  if (normalized.includes("participant")) {
    return "participant";
  }
  if (normalized.includes("strategy")) {
    return "strategy";
  }
  return "all";
}

function normalizeBotInitRole(rawRole) {
  const role = (rawRole || "").trim().toLowerCase();
  if (SUPPORTED_BOT_INIT_ROLES.has(role)) {
    return role;
  }
  throw new Error(
    `invalid --role value: ${rawRole} (expected strategy|participant)`,
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
    process.env.SKILL_NAME,
  ];

  const hints = [
    options.skillName,
    options.envFile ? path.basename(options.envFile) : "",
    options.walletName,
    ...envSkillHints,
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
      "conflicting role hints found. pass explicit --role <strategy|participant>.",
    );
  }

  throw new Error(
    "cannot infer bot role. pass --role or include strategy/participant in --skill-name, --env-path, --wallet-name, or OPENCLAW_SKILL_KEY.",
  );
}

function runtimeEnvExamplePath(runtimeDir, runtimePackage) {
  return path.join(
    runtimeDir,
    "node_modules",
    ...runtimePackage.split("/"),
    ".env.example",
  );
}

function openclawConfigPath(codexHome) {
  const resolvedCodexHome = path.resolve(codexHome);
  return path.join(path.dirname(resolvedCodexHome), "openclaw.json");
}

function defaultEnvFileNameForProfile(profile) {
  if (profile === "strategy") {
    return ".env.strategy";
  }
  if (profile === "participant") {
    return ".env.participant";
  }
  return ".env";
}

function applyTemplateTokens(template) {
  return template.replaceAll("__TEMP_PRIVATE_KEY__", TEMP_PRIVATE_KEY);
}

async function readProfileTemplate(profile) {
  const templatePath =
    profile === "strategy"
      ? STRATEGY_ENV_TEMPLATE_PATH
      : PARTICIPANT_ENV_TEMPLATE_PATH;
  const fallback =
    profile === "strategy" ? STRATEGY_ENV_TEMPLATE : PARTICIPANT_ENV_TEMPLATE;
  if (!existsSync(templatePath)) {
    return fallback;
  }
  const template = await readFile(templatePath, "utf8");
  return applyTemplateTokens(template);
}

async function buildEnvScaffold(profile, runtimeDir, runtimePackage) {
  if (profile === "strategy") {
    return readProfileTemplate("strategy");
  }
  if (profile === "participant") {
    return readProfileTemplate("participant");
  }

  const runtimeTemplate = runtimeEnvExamplePath(runtimeDir, runtimePackage);
  if (existsSync(runtimeTemplate)) {
    return readFile(runtimeTemplate, "utf8");
  }

  const strategy = await readProfileTemplate("strategy");
  const participant = await readProfileTemplate("participant");
  return `${strategy}\n\n${participant}`;
}

async function writeEnvScaffold(options) {
  const runtimeDir = options.runtimeDir
    ? path.resolve(options.runtimeDir)
    : process.cwd();
  const codexHome = options.codexHome
    ? path.resolve(options.codexHome)
    : defaultCodexHome();
  const runtimePackage = options.runtimePackage || DEFAULT_RUNTIME_PACKAGE;
  const rawProfile =
    typeof options.envProfile === "string" &&
    options.envProfile.trim().length > 0
      ? options.envProfile
      : "all";
  const profile = normalizeEnvProfile(rawProfile);
  const envTarget = options.envFile
    ? path.resolve(options.envFile)
    : path.join(codexHome, defaultEnvFileNameForProfile(profile));

  const alreadyExists = existsSync(envTarget);
  if (alreadyExists && !options.force) {
    return {
      written: false,
      envFile: envTarget,
      profile,
    };
  }

  if (alreadyExists && options.force) {
    await rm(envTarget, { force: true });
  }

  const scaffold = await buildEnvScaffold(profile, runtimeDir, runtimePackage);
  await mkdir(path.dirname(envTarget), { recursive: true });
  await writeFile(
    envTarget,
    scaffold.endsWith("\n") ? scaffold : `${scaffold}\n`,
  );

  return {
    written: true,
    envFile: envTarget,
    profile,
  };
}

function defaultEnvPathForRole(role, codexHome) {
  return path.join(path.resolve(codexHome), `.env.${role}`);
}

function resolveExistingBotInitEnvPath(role, options, codexHome) {
  if (options.envFile && options.envFile.trim().length > 0) {
    return path.resolve(options.envFile);
  }

  const roleFileName = `.env.${role}`;
  const candidates = [
    path.join(process.cwd(), roleFileName),
    defaultEnvPathForRole(role, codexHome),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
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

function parseEnvAssignments(content) {
  const result = {};
  const lines = String(content || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match) continue;
    const key = match[1];
    let value = (match[2] || "").trim();
    if (
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) &&
      value.length >= 2
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function syncOpenclawEnvVarsFromFile(envFile, codexHome) {
  const configPath = openclawConfigPath(codexHome);
  if (!existsSync(configPath)) {
    return {
      synced: false,
      reason: "openclaw-config-not-found",
      configPath,
      envFile,
      writtenKeys: [],
    };
  }

  const envContent = await readFile(envFile, "utf8");
  const assignments = parseEnvAssignments(envContent);
  const keys = Object.keys(assignments);
  if (keys.length === 0) {
    return {
      synced: false,
      reason: "empty-env-file",
      configPath,
      envFile,
      writtenKeys: [],
    };
  }

  const rawConfig = await readFile(configPath, "utf8");
  const parsedConfig = JSON.parse(rawConfig);
  if (
    !parsedConfig ||
    typeof parsedConfig !== "object" ||
    Array.isArray(parsedConfig)
  ) {
    throw new Error(`invalid openclaw config json object: ${configPath}`);
  }

  const nextConfig = { ...parsedConfig };
  const envSection =
    nextConfig.env &&
    typeof nextConfig.env === "object" &&
    !Array.isArray(nextConfig.env)
      ? { ...nextConfig.env }
      : {};
  const varsSection =
    envSection.vars &&
    typeof envSection.vars === "object" &&
    !Array.isArray(envSection.vars)
      ? { ...envSection.vars }
      : {};

  const changedKeys = [];
  for (const [key, value] of Object.entries(assignments)) {
    if (varsSection[key] === undefined || String(varsSection[key]) !== value) {
      changedKeys.push(key);
    }
    varsSection[key] = value;
  }

  if (changedKeys.length === 0) {
    return {
      synced: false,
      reason: "no-changes",
      configPath,
      envFile,
      writtenKeys: [],
    };
  }

  envSection.vars = varsSection;
  nextConfig.env = envSection;
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);

  return {
    synced: true,
    reason: "ok",
    configPath,
    envFile,
    writtenKeys: changedKeys,
  };
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

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function generateBotApiKeySecret() {
  return `ofs_${randomBytes(24).toString("hex")}`;
}

async function confirmBotInit({
  role,
  envFile,
  privateKeyKey,
  isRotation,
  assumeYes,
  nextBotId,
}) {
  const mode = isRotation ? "wallet rotation" : "new wallet bootstrap";
  console.log(
    "------------------------------------------------------------------",
  );
  console.log("🚨  WARNING: bot-init is a destructive operation!");
  console.log(
    "------------------------------------------------------------------",
  );
  console.log(`- Role: ${role} (${mode})`);
  console.log(`- Target File: ${envFile}`);
  console.log(`- Private Key Field: ${privateKeyKey} (WILL BE REPLACED)`);
  if (nextBotId) {
    console.log(`- New BOT_ID: ${nextBotId} (WILL BE RANDOMIZED)`);
  }
  console.log("- Caution: Funds tied to the old private key ARE NOT MOVED.");
  console.log(
    "- Private keys are sensitive. Back them up if they contain funds.",
  );
  console.log(
    "------------------------------------------------------------------",
  );

  if (assumeYes) {
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "bot-init requires confirmation in TTY. Re-run with --yes to confirm non-interactively.",
    );
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
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

async function restartOpenclawGateway(configPath) {
  return new Promise((resolve) => {
    const cmd = "openclaw";
    const args = ["gateway", "restart"];
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        // If OpenClaw supports config path overrides, make sure we restart the same instance we just mutated.
        OPENCLAW_CONFIG_PATH: configPath,
      },
    });

    child.on("error", (error) => {
      resolve({
        restarted: false,
        reason: "spawn-error",
        cmd,
        args,
        error,
      });
    });

    child.on("exit", (code, signal) => {
      resolve({
        restarted: code === 0,
        reason: code === 0 ? "ok" : "nonzero-exit",
        cmd,
        args,
        exitCode: code ?? 1,
        signal,
      });
    });
  });
}

function generateMonadWalletWithViem() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey,
  };
}

function randomizeBotId(existingId) {
  if (!existingId) return existingId;
  const match = existingId.match(/^(.*?)-?(\d+)$/);
  const prefix = match ? match[1] : existingId;
  const separator = existingId.includes("-") ? "-" : "";
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}${separator}${randomSuffix}`;
}

function roleEnvUpdates(role, wallet) {
  if (role === "strategy") {
    return {
      CHAIN_ID: DEFAULT_MONAD_CHAIN_ID,
      STRATEGY_PRIVATE_KEY: wallet.privateKey,
      STRATEGY_ADDRESS: wallet.address,
    };
  }
  return {
    CHAIN_ID: DEFAULT_MONAD_CHAIN_ID,
    PARTICIPANT_PRIVATE_KEY: wallet.privateKey,
    PARTICIPANT_ADDRESS: wallet.address,
  };
}

async function persistWallet(role, wallet, options) {
  const walletDir = options.walletDir
    ? path.resolve(options.walletDir)
    : path.join(defaultCodexHome(), "openfunderse", "wallets");
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "");
  const rawName = (options.walletName || `${role}-${timestamp}`).trim();
  if (!rawName) {
    throw new Error("--wallet-name must not be empty");
  }
  if (rawName.includes("/") || rawName.includes("\\")) {
    throw new Error("--wallet-name must be a file name, not a path");
  }
  const baseName = rawName.endsWith(".json")
    ? rawName.slice(0, -".json".length)
    : rawName;
  const walletPath = path.join(walletDir, `${baseName}.json`);
  const privateKeyPath = path.join(walletDir, `${baseName}.private-key`);
  if (
    (existsSync(walletPath) || existsSync(privateKeyPath)) &&
    !options.force
  ) {
    throw new Error(
      `wallet file already exists: ${walletPath} or ${privateKeyPath} (use --force to overwrite)`,
    );
  }

  const payload = {
    createdAt: new Date().toISOString(),
    role,
    chainId: DEFAULT_MONAD_CHAIN_ID,
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
  await mkdir(walletDir, { recursive: true, mode: 0o700 });
  if (options.force) {
    await rm(walletPath, { force: true });
    await rm(privateKeyPath, { force: true });
  }
  await writeFile(walletPath, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
  await writeFile(privateKeyPath, `${wallet.privateKey}\n`, {
    mode: 0o600,
  });
  await chmod(walletPath, 0o600);
  await chmod(privateKeyPath, 0o600);
  return {
    walletPath,
    privateKeyPath,
  };
}

function assertPrivateKeyRotationAllowed(envContent, role, force) {
  const privateKeyKey =
    role === "strategy" ? "STRATEGY_PRIVATE_KEY" : "PARTICIPANT_PRIVATE_KEY";
  const existing = readAssignedEnvValue(envContent, privateKeyKey);
  if (!existing) return;
  if (isPlaceholderEnvValue(existing)) return;
  if (force) return;
  throw new Error(
    `${privateKeyKey} already has a value. bot-init creates a new wallet and will replace it; rerun with --force to rotate.`,
  );
}

async function runBotInit(options) {
  const role = resolveBotInitRole(options);
  const codexHome = options.codexHome
    ? path.resolve(options.codexHome)
    : defaultCodexHome();
  const envFile = resolveExistingBotInitEnvPath(role, options, codexHome);
  if (!existsSync(envFile)) {
    throw new Error(
      `bot-init requires an existing env file: ${envFile}. create ${path.basename(envFile)} first or pass --env-path <file>.`,
    );
  }
  const envContent = await readFile(envFile, "utf8");

  const privateKeyKey =
    role === "strategy" ? "STRATEGY_PRIVATE_KEY" : "PARTICIPANT_PRIVATE_KEY";
  const existingPrivateKey = readAssignedEnvValue(envContent, privateKeyKey);
  const isRotation =
    Boolean(existingPrivateKey) && !isPlaceholderEnvValue(existingPrivateKey);

  assertPrivateKeyRotationAllowed(envContent, role, options.force);

  const existingBotId = readAssignedEnvValue(envContent, "BOT_ID");
  const nextBotId = existingBotId ? randomizeBotId(existingBotId) : null;

  await confirmBotInit({
    role,
    envFile,
    privateKeyKey,
    isRotation,
    assumeYes: options.yes,
    nextBotId,
  });

  const wallet = generateMonadWalletWithViem();
  const walletFiles = await persistWallet(role, wallet, options);
  const updates = roleEnvUpdates(role, wallet);

  if (nextBotId) {
    updates.BOT_ID = nextBotId;
  }

  let nextEnvContent = upsertEnvValues(envContent, updates);
  let envValues = parseEnvAssignments(nextEnvContent);
  await mkdir(path.dirname(envFile), { recursive: true });
  await writeFile(envFile, nextEnvContent);
  await chmod(envFile, 0o600);
  let syncMeta = null;
  if (options.syncOpenclawEnv) {
    syncMeta = await syncOpenclawEnvVarsFromFile(envFile, codexHome);
  }
  const sourceCommand = `set -a; source ${shellQuote(envFile)}; set +a`;

  console.log(
    `Initialized ${role} bot wallet for Monad testnet (${DEFAULT_MONAD_CHAIN_ID}).`,
  );
  console.log(`Address: ${wallet.address}`);
  console.log(`Env file updated: ${envFile}`);
  if (syncMeta) {
    if (syncMeta.synced) {
      console.log(
        `Synced env vars to OpenClaw config: ${syncMeta.configPath} (${syncMeta.writtenKeys.length} keys)`,
      );
    } else {
      console.log(
        `Skipped OpenClaw env sync (${syncMeta.reason}): ${syncMeta.configPath}`,
      );
    }
  }
  console.log(`Wallet backup (keep secret): ${walletFiles.walletPath}`);
  console.log(
    `Private key backup (keep secret): ${walletFiles.privateKeyPath}`,
  );

  if (syncMeta?.synced && options.restartOpenclawGateway) {
    console.log("Restarting OpenClaw gateway to apply env changes...");
    const restartMeta = await restartOpenclawGateway(syncMeta.configPath);
    if (restartMeta.restarted) {
      console.log("OpenClaw gateway restarted.");
    } else if (restartMeta.reason === "spawn-error") {
      const message =
        restartMeta.error instanceof Error
          ? restartMeta.error.message
          : String(restartMeta.error);
      console.log(
        `WARNING: failed to run 'openclaw gateway restart' (${message}).`,
      );
      console.log("Run it manually if your gateway still uses stale env vars.");
    } else {
      console.log(
        `WARNING: 'openclaw gateway restart' failed (exit code ${restartMeta.exitCode}).`,
      );
      console.log("Run it manually if your gateway still uses stale env vars.");
    }
  }
  console.log(`Load env now: ${sourceCommand}`);
}

async function loadManifest(packDir) {
  const candidates = [
    path.join(packDir, "manifest.json"),
    path.join(packDir, "config", "setup-manifest.json"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const json = JSON.parse(await readFile(candidate, "utf8"));
    return { json, path: candidate };
  }

  throw new Error(
    "manifest file not found (manifest.json or config/setup-manifest.json)",
  );
}

async function copySkillDir(sourceDir, destinationDir, force) {
  const destinationExists = existsSync(destinationDir);
  if (destinationExists && !force) {
    throw new Error(
      `skill already exists: ${destinationDir} (use --force to overwrite)`,
    );
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
  const runtimeDir = options.runtimeDir
    ? path.resolve(options.runtimeDir)
    : process.cwd();
  const runtimeManager = options.runtimeManager || detectRuntimeManager();
  const packageJsonPath = path.join(runtimeDir, "package.json");

  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `runtime install target has no package.json: ${runtimeDir} (use --runtime-dir <project-root>)`,
    );
  }

  const { cmd, args } = commandForRuntimeInstall(
    runtimeManager,
    runtimePackage,
  );
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: runtimeDir,
      stdio: "inherit",
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
    runtimeManager,
  };
}

async function installPack(packName, options) {
  if (packName === "openfunderse") {
    throw new Error(
      "pack 'openfunderse' has been removed. use 'openfunderse-strategy' or 'openfunderse-participant'.",
    );
  }

  const packDir = path.join(PACKS_ROOT, packName);
  if (!existsSync(packDir)) {
    throw new Error(`pack not found: ${packName}`);
  }

  const { json: manifest, path: manifestPath } = await loadManifest(packDir);
  if (!Array.isArray(manifest.bundles) || manifest.bundles.length === 0) {
    throw new Error("manifest has no bundles");
  }

  const codexHome = options.codexHome
    ? path.resolve(options.codexHome)
    : defaultCodexHome();
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
    installedSkills: installed,
  };
  await writeFile(
    path.join(packMetaRoot, "install.json"),
    `${JSON.stringify(installedMeta, null, 2)}\n`,
  );

  let runtimeInstallMeta = null;
  if (options.withRuntime) {
    runtimeInstallMeta = await installRuntimePackage(options);
  }

  let envScaffoldMeta = null;
  let resolvedEnvProfile = options.envProfileExplicit
    ? options.envProfile
    : defaultEnvProfileForPack(packName);
  if (options.initEnv) {
    const envOptions = {
      ...options,
      envProfile: resolvedEnvProfile,
      runtimeDir: runtimeInstallMeta?.runtimeDir ?? options.runtimeDir,
      runtimePackage:
        runtimeInstallMeta?.runtimePackage ?? options.runtimePackage,
    };
    envScaffoldMeta = await writeEnvScaffold(envOptions);
  }
  let openclawSyncMeta = null;
  if (envScaffoldMeta && options.syncOpenclawEnv) {
    openclawSyncMeta = await syncOpenclawEnvVarsFromFile(
      envScaffoldMeta.envFile,
      codexHome,
    );
  }

  console.log(`Installed pack: ${packName}`);
  console.log(`Skills root: ${skillsRoot}`);
  console.log(`Installed skills: ${installed.join(", ")}`);
  console.log(`Pack metadata: ${packMetaRoot}`);
  if (runtimeInstallMeta) {
    console.log(
      `Installed runtime package: ${runtimeInstallMeta.runtimePackage} (${runtimeInstallMeta.runtimeManager})`,
    );
    console.log(`Runtime install dir: ${runtimeInstallMeta.runtimeDir}`);
  }
  if (envScaffoldMeta) {
    if (envScaffoldMeta.written) {
      console.log(
        `Generated env scaffold (${envScaffoldMeta.profile}): ${envScaffoldMeta.envFile}`,
      );
    } else {
      console.log(
        `Env scaffold already exists (use --force to overwrite): ${envScaffoldMeta.envFile}`,
      );
    }
  }
  if (openclawSyncMeta) {
    if (openclawSyncMeta.synced) {
      console.log(
        `Synced env vars to OpenClaw config: ${openclawSyncMeta.configPath} (${openclawSyncMeta.writtenKeys.length} keys)`,
      );
    } else {
      console.log(
        `Skipped OpenClaw env sync (${openclawSyncMeta.reason}): ${openclawSyncMeta.configPath}`,
      );
    }
  }
  if (envScaffoldMeta?.profile) {
    resolvedEnvProfile = envScaffoldMeta.profile;
  }
  printTelegramBotSetupGuide(resolvedEnvProfile);
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
