const port = process.env.RELAYER_PORT ?? "3100";
const rpc = process.env.RPC_URL ?? "";

console.log(`[relayer] scaffold server boot`);
console.log(`[relayer] port=${port}`);
console.log(`[relayer] rpc=${rpc || "(unset)"}`);
