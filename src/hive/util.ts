import { getHiveClient } from './index';

export async function convertVestToHive (amount: number) {
  const hiveClient = getHiveClient();
  const globalProperties = await hiveClient.call('condenser_api', 'get_dynamic_global_properties', []);
  const totalVestingFund = extractNumber(globalProperties.total_vesting_fund_hive)
  const totalVestingShares = extractNumber(globalProperties.total_vesting_shares)
  const vestHive = ( totalVestingFund * amount ) / totalVestingShares
  return vestHive
}

export function extractNumber(value: string): number {

  const match = value.match(/([\d.]+)/);
  return match ? parseFloat(match[0]) : 0;
}

export async function getVotingPower(accountName: string) {
  try {
    const hiveClient = getHiveClient();
    const accounts = await hiveClient.database.getAccounts([accountName]);
    if (accounts && accounts.length > 0) {
      const account = accounts[0];
      const votingPower = account.voting_power / 100; // Convert to percentage
      //console.log(`Voting power for ${accountName}: ${votingPower}%`);
      return votingPower;
    } else {
      console.log(`VP not available. Account not found: ${accountName}`);
    }
  } catch (error) {
    console.error('Error fetching voting power:', error);
  }
}