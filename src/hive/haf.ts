import axios from "axios";

type IncomingDelegation = {
    delegator: string;
    delegatee: string;
    vests: string; // e.g., "178701.319083"
    hp_equivalent: string; // e.g., "106.457"
    timestamp: string; // ISO string
};

export async function getAuthorDelegationRank(author: string): Promise<number | null> {
  const communityAccount = 'hive-br.voter';
  const url = `https://hafsql-api.mahdiyari.info/delegations/${communityAccount}/incoming`;

  try {
    const response = await axios.get<IncomingDelegation[]>(url);
    const delegations = response.data;
    const rankedDelegators = delegations
      .map((d) => ({
        delegator: d.delegator,
        amount: parseFloat(d.vests),
      }))
      .sort((a, b) => b.amount - a.amount);

    const authorRank = rankedDelegators.findIndex((d) => d.delegator === author);

    return authorRank !== -1 ? authorRank + 1 : null;
  } catch (error) {
    console.error(`Error fetching delegation rank for @${author}:`, error);
    return null;
  }
}