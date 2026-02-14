type CounterKey =
  | "requests_total"
  | "requests_claim_attest"
  | "requests_intent_attest"
  | "verify_success"
  | "verify_fail"
  | "duplicate_rejected"
  | "threshold_met"
  | "onchain_submit_success"
  | "onchain_submit_fail"
  | "execution_success"
  | "execution_fail"
  | "execution_preflight_fail"
  | "execution_dryrun_fail";

const counters: Record<CounterKey, number> = {
  requests_total: 0,
  requests_claim_attest: 0,
  requests_intent_attest: 0,
  verify_success: 0,
  verify_fail: 0,
  duplicate_rejected: 0,
  threshold_met: 0,
  onchain_submit_success: 0,
  onchain_submit_fail: 0,
  execution_success: 0,
  execution_fail: 0,
  execution_preflight_fail: 0,
  execution_dryrun_fail: 0
};

export function incCounter(key: CounterKey, delta = 1): void {
  counters[key] += delta;
}

export function getCounters(): Record<CounterKey, number> {
  return { ...counters };
}
