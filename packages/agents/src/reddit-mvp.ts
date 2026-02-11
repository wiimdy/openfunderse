import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters } from "viem";

type Hex = `0x${string}`;
type Address = `0x${string}`;

interface ClaimPayload {
  schemaId: string;
  sourceType: string;
  sourceRef: string;
  selector: string;
  extracted: string;
  extractedType: string;
  timestamp: bigint;
  responseHash: Hex;
  evidenceType: string;
  evidenceURI: string;
  crawler: Address;
  notes?: string;
}

interface RedditPost {
  id: string;
  title: string;
  permalink: string;
  createdUtc: number;
}

interface KeywordStats {
  keywordHits: Record<string, number>;
  postsWithKeyword: number;
  totalKeywordHits: number;
}

interface RedditMinedExtraction extends KeywordStats {
  version: "REDDIT_KEYWORD_MINING_V1";
  subreddit: string;
  listing: "new";
  limit: number;
  keywords: string[];
  sampledAt: number;
  sampleSize: number;
  posts: RedditPost[];
}

interface StoredClaimPayload extends Omit<ClaimPayload, "timestamp"> {
  timestamp: string;
}

interface StoredClaimBundle {
  version: "openclaw-reddit-claim-bundle-v1";
  createdAt: string;
  source: {
    provider: "reddit";
    listingUrl: string;
    subreddit: string;
    postIds: string[];
  };
  mined: RedditMinedExtraction;
  claimPayload: StoredClaimPayload;
  claimHash: Hex;
  evidenceFile: string;
}

interface VerificationResult {
  ok: boolean;
  checkedAt: string;
  claimFile: string;
  claimHashExpected: Hex;
  claimHashComputed: Hex;
  responseHashExpected: Hex;
  responseHashComputed: Hex;
  mismatches: string[];
  recrawled: {
    sampleSize: number;
    postsWithKeyword: number;
    totalKeywordHits: number;
    keywordHits: Record<string, number>;
  };
}

interface ParsedCli {
  command?: string;
  options: Map<string, string>;
  flags: Set<string>;
  positionals: string[];
}

const UINT64_MAX = (1n << 64n) - 1n;
const DEFAULT_LIMIT = 25;
const DEFAULT_SUBREDDIT = "CryptoCurrency";
const DEFAULT_KEYWORDS = ["monad"];
const DEFAULT_CRAWLER = "0x1111111111111111111111111111111111111111" as Address;
const CLAIM_SCHEMA_ID = "REDDIT_KEYWORD_MINING_V1";
const CLAIM_SOURCE_TYPE = "REDDIT";
const CLAIM_EVIDENCE_TYPE = "RECrawlConsensus";
const DEFAULT_USER_AGENT = "openclaw-mvp-crawler/0.1 (+https://github.com/wiimdy/agent)";

function parseCli(argv: string[]): ParsedCli {
  const [command, ...rest] = argv;
  const options = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const option = token.slice(2);
    if (option.includes("=")) {
      const [key, ...valueParts] = option.split("=");
      options.set(key, valueParts.join("="));
      continue;
    }

    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      options.set(option, next);
      i += 1;
      continue;
    }

    flags.add(option);
  }

  return {
    command,
    options,
    flags,
    positionals
  };
}

function optionOrDefault(parsed: ParsedCli, key: string, fallback: string): string {
  return parsed.options.get(key) ?? fallback;
}

function requiredOption(parsed: ParsedCli, key: string): string {
  const value = parsed.options.get(key);
  if (!value) {
    throw new Error(`missing required option --${key}`);
  }
  return value;
}

function normalizeText(value: string): string {
  return value.normalize("NFC").trim();
}

function normalizeAddress(value: Address): Address {
  return getAddress(value);
}

function assertUint64(value: bigint, label: string): void {
  if (value < 0n || value > UINT64_MAX) {
    throw new Error(`${label} must be uint64`);
  }
}

function canonicalClaim(input: ClaimPayload): ClaimPayload {
  return {
    ...input,
    schemaId: normalizeText(input.schemaId),
    sourceType: normalizeText(input.sourceType),
    sourceRef: normalizeText(input.sourceRef),
    selector: normalizeText(input.selector),
    extracted: normalizeText(input.extracted),
    extractedType: normalizeText(input.extractedType),
    evidenceType: normalizeText(input.evidenceType),
    evidenceURI: normalizeText(input.evidenceURI),
    crawler: normalizeAddress(input.crawler),
    notes: input.notes === undefined ? undefined : normalizeText(input.notes)
  };
}

function claimHash(payload: ClaimPayload): Hex {
  const canonical = canonicalClaim(payload);
  assertUint64(canonical.timestamp, "timestamp");
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string schemaId,string sourceType,string sourceRef,string selector,string extracted,string extractedType,uint64 timestamp,bytes32 responseHash,string evidenceType,string evidenceURI,address crawler,string notes"
      ),
      [
        canonical.schemaId,
        canonical.sourceType,
        canonical.sourceRef,
        canonical.selector,
        canonical.extracted,
        canonical.extractedType,
        canonical.timestamp,
        canonical.responseHash,
        canonical.evidenceType,
        canonical.evidenceURI,
        canonical.crawler,
        canonical.notes ?? ""
      ]
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    output[key] = toStableJsonValue(value[key]);
  }
  return output;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

function sha256Hex(value: string): Hex {
  return `0x${createHash("sha256").update(value).digest("hex")}` as Hex;
}

function parseKeywords(raw: string): string[] {
  const deduped = new Set<string>();
  for (const chunk of raw.split(",")) {
    const normalized = chunk.trim().toLowerCase();
    if (normalized.length > 0) {
      deduped.add(normalized);
    }
  }
  return [...deduped];
}

function toInteger(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.trunc(input);
  }
  if (typeof input === "string" && input.length > 0) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

function normalizePermalink(value: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `https://www.reddit.com${value}`;
}

function parsePostsFromListing(listingJson: unknown): RedditPost[] {
  if (!isRecord(listingJson)) {
    throw new Error("reddit listing response is not an object");
  }

  const data = listingJson.data;
  if (!isRecord(data) || !Array.isArray(data.children)) {
    throw new Error("reddit listing response missing data.children");
  }

  const posts: RedditPost[] = [];
  for (const child of data.children) {
    if (!isRecord(child) || !isRecord(child.data)) {
      continue;
    }

    const record = child.data;
    const id = typeof record.id === "string" ? record.id : null;
    const title = typeof record.title === "string" ? record.title : null;
    const permalink =
      typeof record.permalink === "string" ? normalizePermalink(record.permalink) : null;
    const createdUtc = toInteger(record.created_utc);

    if (!id || !title || !permalink || createdUtc === null) {
      continue;
    }

    posts.push({
      id,
      title,
      permalink,
      createdUtc
    });
  }

  return posts;
}

function computeKeywordStats(posts: RedditPost[], keywords: string[]): KeywordStats {
  const keywordHits: Record<string, number> = {};
  for (const keyword of keywords) {
    keywordHits[keyword] = 0;
  }

  let postsWithKeyword = 0;
  for (const post of posts) {
    const loweredTitle = post.title.toLowerCase();
    let hasAny = false;

    for (const keyword of keywords) {
      if (loweredTitle.includes(keyword)) {
        keywordHits[keyword] += 1;
        hasAny = true;
      }
    }

    if (hasAny) {
      postsWithKeyword += 1;
    }
  }

  let totalKeywordHits = 0;
  for (const count of Object.values(keywordHits)) {
    totalKeywordHits += count;
  }

  return {
    keywordHits,
    postsWithKeyword,
    totalKeywordHits
  };
}

async function fetchJson(url: string, userAgent: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`request failed (${response.status}) for ${url}`);
  }

  return (await response.json()) as unknown;
}

function serializedClaimPayload(payload: ClaimPayload): StoredClaimPayload {
  return {
    ...payload,
    timestamp: payload.timestamp.toString()
  };
}

function deserializeClaimPayload(payload: StoredClaimPayload): ClaimPayload {
  return {
    ...payload,
    timestamp: BigInt(payload.timestamp)
  };
}

function stringifyPretty(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}

function fromClaimFileBaseName(claimFile: string): string {
  const name = basename(claimFile);
  if (name.endsWith(".claim.json")) {
    return name.slice(0, -".claim.json".length);
  }
  if (name.endsWith(".json")) {
    return name.slice(0, -".json".length);
  }
  return name;
}

async function mineRedditClaim(params: {
  subreddit: string;
  keywords: string[];
  limit: number;
  crawler: Address;
  outDir: string;
  userAgent: string;
}): Promise<{
  claimFile: string;
  evidenceFile: string;
  bundle: StoredClaimBundle;
}> {
  const listingUrl = new URL(`https://www.reddit.com/r/${params.subreddit}/new.json`);
  listingUrl.searchParams.set("limit", String(params.limit));
  listingUrl.searchParams.set("raw_json", "1");

  const listingJson = await fetchJson(listingUrl.toString(), params.userAgent);
  const posts = parsePostsFromListing(listingJson).slice(0, params.limit);
  if (posts.length === 0) {
    throw new Error(`no posts found from subreddit r/${params.subreddit}`);
  }

  const sampledAt = Math.trunc(Date.now() / 1000);
  const keywordStats = computeKeywordStats(posts, params.keywords);
  const extraction: RedditMinedExtraction = {
    version: "REDDIT_KEYWORD_MINING_V1",
    subreddit: params.subreddit,
    listing: "new",
    limit: params.limit,
    keywords: params.keywords,
    sampledAt,
    sampleSize: posts.length,
    posts,
    ...keywordStats
  };

  const canonicalEvidencePayload = {
    subreddit: params.subreddit,
    keywords: params.keywords,
    listing: "new",
    posts
  };
  const responseHash = sha256Hex(stableStringify(canonicalEvidencePayload));
  const extracted = stableStringify(extraction);

  const outDir = resolve(params.outDir);
  await mkdir(outDir, { recursive: true });

  const keywordSlug = params.keywords.join("-").replace(/[^a-z0-9-]/g, "");
  const baseName = `${params.subreddit.toLowerCase()}-${keywordSlug || "keywords"}-${sampledAt}`;
  const evidenceFile = join(outDir, `${baseName}.evidence.json`);
  const claimFile = join(outDir, `${baseName}.claim.json`);

  const claimPayload: ClaimPayload = {
    schemaId: CLAIM_SCHEMA_ID,
    sourceType: CLAIM_SOURCE_TYPE,
    sourceRef: listingUrl.toString(),
    selector: `listing=new;field=title;keywords=${params.keywords.join(",")};limit=${params.limit}`,
    extracted,
    extractedType: "application/json",
    timestamp: BigInt(sampledAt),
    responseHash,
    evidenceType: CLAIM_EVIDENCE_TYPE,
    evidenceURI: `file://${evidenceFile}`,
    crawler: params.crawler,
    notes: "responseHash=sha256(stable-json(listing:new + post[id,title,permalink,createdUtc]))"
  };

  const computedClaimHash = claimHash(claimPayload);

  const evidenceDoc = {
    version: "openclaw-reddit-evidence-v1",
    listingUrl: listingUrl.toString(),
    fetchedAt: new Date().toISOString(),
    posts
  };
  await writeFile(evidenceFile, stringifyPretty(evidenceDoc));

  const bundle: StoredClaimBundle = {
    version: "openclaw-reddit-claim-bundle-v1",
    createdAt: new Date().toISOString(),
    source: {
      provider: "reddit",
      listingUrl: listingUrl.toString(),
      subreddit: params.subreddit,
      postIds: posts.map((post) => post.id)
    },
    mined: extraction,
    claimPayload: serializedClaimPayload(claimPayload),
    claimHash: computedClaimHash,
    evidenceFile
  };

  await writeFile(claimFile, stringifyPretty(bundle));

  return {
    claimFile,
    evidenceFile,
    bundle
  };
}

async function recrawlPostsByIds(postIds: string[], userAgent: string): Promise<RedditPost[]> {
  if (postIds.length === 0) {
    return [];
  }

  const byIdParam = postIds.map((id) => `t3_${id}`).join(",");
  const url = new URL(`https://www.reddit.com/by_id/${byIdParam}.json`);
  url.searchParams.set("raw_json", "1");

  const byIdJson = await fetchJson(url.toString(), userAgent);
  const fetchedPosts = parsePostsFromListing(byIdJson);
  const byId = new Map<string, RedditPost>();
  for (const post of fetchedPosts) {
    byId.set(post.id, post);
  }

  const ordered: RedditPost[] = [];
  for (const id of postIds) {
    const post = byId.get(id);
    if (!post) {
      throw new Error(`by_id recrawl missing post id=${id}`);
    }
    ordered.push(post);
  }

  return ordered;
}

function parseStoredClaimBundle(raw: string): StoredClaimBundle {
  const parsed = JSON.parse(raw) as Partial<StoredClaimBundle>;
  if (!parsed || parsed.version !== "openclaw-reddit-claim-bundle-v1") {
    throw new Error("unsupported claim bundle format");
  }

  if (!parsed.claimPayload || typeof parsed.claimPayload.timestamp !== "string") {
    throw new Error("claim bundle missing claimPayload.timestamp");
  }

  if (!parsed.source || !Array.isArray(parsed.source.postIds)) {
    throw new Error("claim bundle missing source.postIds");
  }

  return parsed as StoredClaimBundle;
}

function objectsEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

async function verifyClaimBundle(params: {
  claimFile: string;
  userAgent: string;
}): Promise<VerificationResult> {
  const claimFile = resolve(params.claimFile);
  const raw = await readFile(claimFile, "utf8");
  const stored = parseStoredClaimBundle(raw);
  const payload = deserializeClaimPayload(stored.claimPayload);

  const mismatches: string[] = [];
  const recomputedClaimHash = claimHash(payload);
  if (recomputedClaimHash.toLowerCase() !== stored.claimHash.toLowerCase()) {
    mismatches.push("claimHash mismatch against claim payload");
  }

  const recrawledPosts = await recrawlPostsByIds(stored.source.postIds, params.userAgent);
  const recrawledStats = computeKeywordStats(recrawledPosts, stored.mined.keywords);
  const recrawledExtraction: RedditMinedExtraction = {
    version: "REDDIT_KEYWORD_MINING_V1",
    subreddit: stored.mined.subreddit,
    listing: "new",
    limit: stored.mined.limit,
    keywords: stored.mined.keywords,
    sampledAt: stored.mined.sampledAt,
    sampleSize: recrawledPosts.length,
    posts: recrawledPosts,
    ...recrawledStats
  };

  const recrawledResponseHash = sha256Hex(
    stableStringify({
      subreddit: stored.mined.subreddit,
      keywords: stored.mined.keywords,
      listing: "new",
      posts: recrawledPosts
    })
  );

  if (payload.responseHash.toLowerCase() !== recrawledResponseHash.toLowerCase()) {
    mismatches.push("responseHash mismatch after recrawl");
  }

  if (!objectsEqual(stored.mined.posts, recrawledPosts)) {
    mismatches.push("post sample mismatch (title/permalink/createdUtc changed)");
  }

  if (!objectsEqual(stored.mined.keywordHits, recrawledStats.keywordHits)) {
    mismatches.push("keywordHits mismatch");
  }

  if (stored.mined.postsWithKeyword !== recrawledStats.postsWithKeyword) {
    mismatches.push("postsWithKeyword mismatch");
  }

  if (stored.mined.totalKeywordHits !== recrawledStats.totalKeywordHits) {
    mismatches.push("totalKeywordHits mismatch");
  }

  const extractedFromRecrawl = stableStringify(recrawledExtraction);
  if (payload.extracted !== extractedFromRecrawl) {
    mismatches.push("extracted payload mismatch after recrawl");
  }

  return {
    ok: mismatches.length === 0,
    checkedAt: new Date().toISOString(),
    claimFile,
    claimHashExpected: stored.claimHash,
    claimHashComputed: recomputedClaimHash,
    responseHashExpected: payload.responseHash,
    responseHashComputed: recrawledResponseHash,
    mismatches,
    recrawled: {
      sampleSize: recrawledPosts.length,
      postsWithKeyword: recrawledStats.postsWithKeyword,
      totalKeywordHits: recrawledStats.totalKeywordHits,
      keywordHits: recrawledStats.keywordHits
    }
  };
}

function printUsage(): void {
  console.log(`
[agents] Reddit MVP crawler/verifier

commands:
  crawl-reddit
    --subreddit <name>       (default: ${DEFAULT_SUBREDDIT})
    --keywords <csv>         (default: ${DEFAULT_KEYWORDS.join(",")})
    --limit <n>              (default: ${DEFAULT_LIMIT})
    --out-dir <path>         (default: ./data/claims)
    --crawler <0xaddress>    (default: env CRAWLER_ADDRESS or ${DEFAULT_CRAWLER})
    --user-agent <string>    (default: env REDDIT_USER_AGENT)

  verify-reddit-claim
    --claim <file>
    --user-agent <string>    (default: env REDDIT_USER_AGENT)

  mvp-reddit-flow
    crawl-reddit -> verify-reddit-claim in one command
`);
}

async function runCrawlCommand(parsed: ParsedCli, verifyAfter: boolean): Promise<void> {
  const subreddit = optionOrDefault(parsed, "subreddit", DEFAULT_SUBREDDIT).trim();
  if (subreddit.length === 0) {
    throw new Error("subreddit cannot be empty");
  }

  const keywords = parseKeywords(
    optionOrDefault(parsed, "keywords", DEFAULT_KEYWORDS.join(","))
  );
  if (keywords.length === 0) {
    throw new Error("at least one keyword is required");
  }

  const limitRaw = optionOrDefault(parsed, "limit", String(DEFAULT_LIMIT));
  const limit = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be an integer between 1 and 100");
  }

  const outDir = optionOrDefault(parsed, "out-dir", resolve(process.cwd(), "data", "claims"));
  const crawler = optionOrDefault(parsed, "crawler", process.env.CRAWLER_ADDRESS ?? DEFAULT_CRAWLER);
  const userAgent = optionOrDefault(
    parsed,
    "user-agent",
    process.env.REDDIT_USER_AGENT ?? DEFAULT_USER_AGENT
  );

  const mined = await mineRedditClaim({
    subreddit,
    keywords,
    limit,
    crawler: crawler as Address,
    outDir,
    userAgent
  });

  console.log("[agents] crawl-reddit complete");
  console.log(
    stringifyPretty({
      claimFile: mined.claimFile,
      evidenceFile: mined.evidenceFile,
      claimHash: mined.bundle.claimHash,
      sourceRef: mined.bundle.claimPayload.sourceRef,
      sampleSize: mined.bundle.mined.sampleSize,
      keywordHits: mined.bundle.mined.keywordHits
    })
  );

  if (!verifyAfter) {
    return;
  }

  const verification = await verifyClaimBundle({
    claimFile: mined.claimFile,
    userAgent
  });
  const baseName = fromClaimFileBaseName(mined.claimFile);
  const verificationFile = join(dirname(mined.claimFile), `${baseName}.verification.json`);
  await writeFile(verificationFile, stringifyPretty(verification));

  console.log("[agents] mvp-reddit-flow verification complete");
  console.log(
    stringifyPretty({
      verificationFile,
      ok: verification.ok,
      mismatches: verification.mismatches
    })
  );

  if (!verification.ok) {
    process.exitCode = 2;
  }
}

async function runVerifyCommand(parsed: ParsedCli): Promise<void> {
  const claimFile = requiredOption(parsed, "claim");
  const userAgent = optionOrDefault(
    parsed,
    "user-agent",
    process.env.REDDIT_USER_AGENT ?? DEFAULT_USER_AGENT
  );

  const verification = await verifyClaimBundle({
    claimFile,
    userAgent
  });

  const absoluteClaimFile = resolve(claimFile);
  const baseName = fromClaimFileBaseName(absoluteClaimFile);
  const verificationFile = join(dirname(absoluteClaimFile), `${baseName}.verification.json`);
  await writeFile(verificationFile, stringifyPretty(verification));

  console.log("[agents] verify-reddit-claim complete");
  console.log(
    stringifyPretty({
      verificationFile,
      ok: verification.ok,
      mismatches: verification.mismatches
    })
  );

  if (!verification.ok) {
    process.exitCode = 2;
  }
}

export async function runRedditMvpCli(argv: string[]): Promise<void> {
  const parsed = parseCli(argv);
  const command = parsed.command ?? "";

  if (command.length === 0 || command === "help" || parsed.flags.has("help")) {
    printUsage();
    return;
  }

  if (command === "crawl-reddit") {
    await runCrawlCommand(parsed, false);
    return;
  }

  if (command === "verify-reddit-claim") {
    await runVerifyCommand(parsed);
    return;
  }

  if (command === "mvp-reddit-flow") {
    await runCrawlCommand(parsed, true);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}
