export const delay = async (delay: number) => {
    return new Promise((resolve) => setTimeout(resolve, delay))
  }
  
  export const timeout = async (fn: () => Promise<any>, time = 30000) => {
    let timer: any = 0
    return Promise.race([fn(), new Promise((_resolve, reject) => (timer = setTimeout(reject, time)))]).finally(
      () => timer && clearTimeout(timer)
    )
  }
  
  export const retry = async (
    fn: () => Promise<any>,
    config: { retries: number; delay?: number; onFailedAttempt?: () => any | Promise<any> }
  ): Promise<any> => {
    const options = {
      ...{ delay: 1000, onFailedAttempt: () => {} },
      ...config
    }
    try {
      return await fn()
    } catch (error: any) {
      console.error(
        `Attempt failed ${error?.message ? `: ${error.message}` : 'with error'}. Waiting ${
          options.delay
        } ms before retrying.`
      )
  
      if (options.onFailedAttempt) {
        await options.onFailedAttempt()
      }
  
      if (options.retries > 0) {
        await delay(options.delay)
        return retry(fn, { ...options, retries: options.retries - 1 })
      } else {
        throw error
      }
    }
  }
  