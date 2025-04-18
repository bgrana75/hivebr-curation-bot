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