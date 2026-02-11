import { runRedditMvpCli } from "./reddit-mvp.js";

console.log("[agents] boot");
console.log(`[agents] strategy key set=${Boolean(process.env.STRATEGY_PRIVATE_KEY)}`);
console.log(`[agents] verifier key set=${Boolean(process.env.VERIFIER_PRIVATE_KEY)}`);
console.log(`[agents] crawler key set=${Boolean(process.env.CRAWLER_PRIVATE_KEY)}`);

runRedditMvpCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agents] error: ${message}`);
  process.exitCode = 1;
});
