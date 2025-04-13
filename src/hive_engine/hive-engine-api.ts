import axios from 'axios'
import { retry, timeout } from './utils'

const endpoints = [
  'https://engine.deathwing.me',
  'https://herpc.dtools.dev',
  'https://api.primersion.com',
  'https://api.hive-engine.com/rpc',
  'https://api2.hive-engine.com/rpc'
]

type HiveEngineApiConfig = {
  endpoints: string[]
  timeout: number
  retries: number
}
export class HiveEngineApi {
  private config: HiveEngineApiConfig = {
    endpoints: [...endpoints],
    timeout: 5000,
    retries: 3
  }

  private rpcCallId = 0
  private currentEndpoint = this.config.endpoints[Math.floor(Math.random() * this.config.endpoints.length)]

  private selectNextNode = () => {
    const index = endpoints.findIndex((n) => n === this.currentEndpoint) + 1
    this.currentEndpoint = endpoints[index % endpoints.length]
  }

  /* SDK instance configuration */
  setConfig = (newConfig: { endpoints?: string[]; timeout?: number; retries?: number }) => {
    this.config = {
      ...this.config,
      ...newConfig
    }
  }

  getTransaction = async (trxId: string) => {
    return retry(
      () =>
        timeout(
          () =>
            axios.post(`${this.currentEndpoint}/blockchain`, {
              id: this.rpcCallId++,
              jsonrpc: '2.0',
              method: 'getTransactionInfo',
              params: {
                txid: trxId
              }
            }),
          this.config.timeout
        ),
      {
        retries: this.config.retries,
        onFailedAttempt: () => this.selectNextNode()
      }
    ).then((response) => response.data?.result)
  }

  /** Generic utility methods */
  findOne = async (contract: string, table: string, query: any, indexes: [] = []) => {
    return retry(
      () =>
        timeout(
          () =>
            axios.post(`${this.currentEndpoint}/contracts`, {
              id: this.rpcCallId++,
              jsonrpc: '2.0',
              method: 'findOne',
              params: {
                contract: contract,
                table: table,
                query: query,
                limit: 1,
                offset: 0,
                ...(indexes && indexes.length ? { indexes: indexes } : {})
              }
            }),
          this.config.timeout
        ),
      {
        retries: this.config.retries,
        onFailedAttempt: () => this.selectNextNode()
      }
    ).then((response) => response.data?.result)
  }

  findMany = async (
    contract: string,
    table: string,
    query: any,
    limit: number = 1000,
    offset: number = 0,
    indexes: { index: string; descending: boolean }[] = []
  ) => {
    return retry(
      () =>
        timeout(
          () =>
            axios.post(`${this.currentEndpoint}/contracts`, {
              id: this.rpcCallId++,
              jsonrpc: '2.0',
              method: 'find',
              params: {
                contract: contract,
                table: table,
                query: query,
                limit: limit,
                offset: offset,
                ...(indexes && indexes.length ? { indexes: indexes } : {})
              }
            }),
          this.config.timeout
        ),
      {
        retries: this.config.retries,
        onFailedAttempt: () => this.selectNextNode()
      }
    ).then((response) => response.data?.result)
  }

  findAll = async (
    contract: string,
    table: string,
    query: any,
    indexes: { index: string; descending: boolean }[] = []
  ) => {
    let results: any[] = []

    while (true) {
      const records = await this.findMany(contract, table, query, 1000, results.length, indexes)
      results = results.concat(records)

      if (records.length < 1000) {
        break
      }
    }

    return results
  }

  /* Helper methods to simplify common API calls */
  getToken = async (token: string) => {
    return this.findOne('tokens', 'tokens', { symbol: token })
  }
  getPool = async (pair: string) => {
    return this.findOne('marketpools', 'pools', { tokenPair: pair })
  }
  getPools = async (pairs: string[]) => {
    return this.findMany('marketpools', 'pools', { tokenPair: { $in: pairs } })
  }
  getAccountTokensBalances = async (account: string, token: string) => {
    return this.findOne('tokens', 'balances', {
      account: account,
      symbol: token
    })
  }
}

export const hiveEngineApi = new HiveEngineApi()
