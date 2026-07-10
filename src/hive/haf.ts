import axios from "axios";

type IncomingDelegation = {
    delegator: string;
    delegatee: string;
    vests: string; // e.g., "178701.319083"
    hp_equivalent: string; // e.g., "106.457"
    timestamp: string; // ISO string
};

type RankedDelegator = {
  delegator: string;
  amount: number;
};

const REQUEST_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// Falls back to the last successful fetch when the API is flaky, so a
// transient outage doesn't get displayed as "Not Ranked" for real delegators.
let cachedRankedDelegators: RankedDelegator[] | null = null;

// Circuit breaker: after 5 consecutive failures, stop hammering the HAF API
// for 60s instead of retrying on every single rank lookup.
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60000;
const circuit = { failures: 0, openUntil: 0 };

function circuitOpen(): boolean {
  if (circuit.failures < CIRCUIT_FAILURE_THRESHOLD) return false;
  if (Date.now() >= circuit.openUntil) {
    // Cooldown expired — allow one probe through.
    circuit.failures = 0;
    return false;
  }
  return true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRankedDelegators(): Promise<RankedDelegator[]> {
  const communityAccount = 'hive-br.voter';
  const url = `https://hafsql-api.mahdiyari.info/delegations/${communityAccount}/incoming`;

  if (circuitOpen()) {
    if (cachedRankedDelegators) return cachedRankedDelegators;
    throw new Error('HAF API unavailable — circuit open');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await axios.get<IncomingDelegation[]>(url, { timeout: REQUEST_TIMEOUT_MS });
      const rankedDelegators = response.data
        .map((d) => ({
          delegator: d.delegator,
          amount: parseFloat(d.vests),
        }))
        .sort((a, b) => b.amount - a.amount);

      cachedRankedDelegators = rankedDelegators;
      circuit.failures = 0;
      return rankedDelegators;
    } catch (error) {
      lastError = error;
      circuit.failures++;
      circuit.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      if (attempt < MAX_ATTEMPTS && !circuitOpen()) {
        await sleep(RETRY_DELAY_MS * attempt);
      } else {
        break;
      }
    }
  }

  console.error(`Error fetching delegations from HAF API after ${MAX_ATTEMPTS} attempts:`, lastError);
  if (cachedRankedDelegators) {
    console.error('Falling back to last known delegation snapshot.');
    return cachedRankedDelegators;
  }
  throw lastError;
}

export async function getAuthorDelegationRank(author: string): Promise<number | null> {
  try {
    const rankedDelegators = await fetchRankedDelegators();
    const authorRank = rankedDelegators.findIndex((d) => d.delegator === author);
    return authorRank !== -1 ? authorRank + 1 : null;
  } catch (error) {
    console.error(`Error fetching delegation rank for @${author}:`, error);
    return null;
  }
}