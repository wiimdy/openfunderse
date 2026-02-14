import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const cwd = process.cwd();

const run = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env,
      ...options
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`));
    });
  });

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function main() {
  const tmp = join(tmpdir(), `clawbot-smoke-${Date.now()}`);
  const claimPath = `${tmp}.claim.json`;
  const envPath = `${tmp}.env`;
  const intentPath = `${tmp}.intent.json`;
  const routePath = `${tmp}.route.json`;

  const now = nowSeconds();
  const deadline = now + 1800;

  const sampleClaim = {
    fundId: process.env.FUND_ID ?? 'demo-fund',
    epochId: 1,
    observation: {
      claimHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      sourceSpecId: 'sample-source',
      token: '0x00000000000000000000000000000000000000a1',
      timestamp: now,
      extracted: 'sample',
      responseHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      evidenceURI: 'https://example.com/evidence',
      crawler: '0x00000000000000000000000000000000000000b2',
      canonicalPayload: {
        schemaId: 'claim_template_v0',
        sourceType: 'WEB',
        sourceRef: 'https://example.com/evidence',
        selector: '$.raw',
        extracted:
          '{"token":"0x00000000000000000000000000000000000000a1","sample":"sample"}',
        extractedType: 'json',
        timestamp: String(now),
        responseHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        evidenceType: 'url',
        evidenceURI: 'https://example.com/evidence',
        crawler: '0x00000000000000000000000000000000000000b2'
      }
    }
  };

  const sampleIntent = {
    intentVersion: 'V1',
    vault: process.env.VAULT_ADDRESS ?? '0x0000000000000000000000000000000000000001',
    action: 'BUY',
    tokenIn: process.env.NADFUN_WMON_ADDRESS ?? '0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd',
    tokenOut: process.env.NADFUN_TARGET_TOKEN ?? '0x00000000000000000000000000000000000000a1',
    amountIn: '1000000000000000',
    minAmountOut: '1',
    deadline: String(deadline),
    maxSlippageBps: '100',
    snapshotHash:
      process.env.DEFAULT_SNAPSHOT_HASH ??
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  };

  const sampleRoute = {
    tokenIn: sampleIntent.tokenIn,
    tokenOut: sampleIntent.tokenOut,
    quoteAmountOut: '1',
    minAmountOut: sampleIntent.minAmountOut,
    adapter: process.env.ADAPTER_ADDRESS ?? '0x0000000000000000000000000000000000000002',
    adapterData: '0x'
  };

  try {
    await writeFile(claimPath, JSON.stringify(sampleClaim, null, 2));
    await writeFile(intentPath, JSON.stringify(sampleIntent, null, 2));
    await writeFile(routePath, JSON.stringify(sampleRoute, null, 2));

    console.log('\n[smoke] 1) clawbot-run help');
    await run('npm', ['run', 'clawbot:run', '--', '--help']);

    console.log('\n[smoke] 2) participant verify routing');
    await run('npm', [
      'run',
      'clawbot:run',
      '--',
      '--role',
      'participant',
      '--action',
      'verify_claim',
      '--claim-file',
      claimPath,
      '--reproducible',
      'false',
      '--max-data-age-seconds',
      '86400'
    ]);

    console.log('\n[smoke] 3) strategy set_aa routing');
    await run('npm', [
      'run',
      'clawbot:run',
      '--',
      '--role',
      'strategy',
      '--action',
      'set_aa',
      '--address',
      '0x00000000000000000000000000000000000000a1',
      '--env-path',
      envPath
    ]);

    const canNetwork =
      Boolean(process.env.RELAYER_URL) &&
      Boolean(process.env.BOT_ID) &&
      Boolean(process.env.BOT_API_KEY) &&
      Boolean(process.env.FUND_ID);

    if (canNetwork) {
      console.log('\n[smoke] 4) strategy propose_intent (network)');
      await run('npm', [
        'run',
        'clawbot:run',
        '--',
        '--role',
        'strategy',
        '--action',
        'propose_intent',
        '--fund-id',
        process.env.FUND_ID,
        '--intent-file',
        intentPath,
        '--execution-route-file',
        routePath
      ]);
    } else {
      console.log(
        '\n[smoke] 4) strategy propose_intent skipped (need RELAYER_URL,BOT_ID,BOT_API_KEY,FUND_ID)'
      );
    }

    console.log('\n[smoke] PASS');
  } finally {
    await Promise.allSettled([
      rm(claimPath, { force: true }),
      rm(intentPath, { force: true }),
      rm(routePath, { force: true }),
      rm(envPath, { force: true })
    ]);
  }
}

main().catch((error) => {
  console.error(`[smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
