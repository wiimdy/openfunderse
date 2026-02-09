const port = process.env.INDEXER_PORT ?? "3200";
const dbPath = process.env.INDEXER_DB_PATH ?? "./data/indexer.db";

console.log(`[indexer] scaffold worker boot`);
console.log(`[indexer] port=${port}`);
console.log(`[indexer] sqlite=${dbPath}`);
