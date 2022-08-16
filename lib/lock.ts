// import Client, { Redis } from "ioredis";
// import * as Redis from "ioredis";

const Redis = require('ioredis');
import Redlock from "redlock";
import { EventEmitter } from "stream";
import { setTimeout } from "timers";
import { EventPollTimeout, InternalException } from "./eceptions";
import { Logger, Logger_I } from "./logging";


/**
 * A Nested Dictionary type
 */
 export type Dictionary = {
    [x: string]: any | Dictionary;
};

/**
 * A simple un-nested Dictionary type
 */
export type DVal_Dictionary < T > = {
    [x: string]: T;
};


export type CacheGeneratorCallback = (req: any, res: any) => PromiseLike<Dictionary>

export type APICacheHashGenerator = (req: any, res: any) => PromiseLike<string>

export interface Cached_I {
    readonly handles: CachedSettings
    subscribeToChannel(channelID: string): any
    control(params: Input_I): (req: any, res: any, next: any) => Promise<any>
}

export interface Input_I {
    /**
     * Time to live duration of a cached response
     */
    ttl: number,
    /**
     * Key prefix of cached data keys
     */
    prefix: string,
    /**
     * Callback to get original API response which is to be cached. The callback result will be saved in res.data
     */
    callback: CacheGeneratorCallback,
    /**
     * A method to generate a unique key for a request body.
     */
    cacheKeyHandle: APICacheHashGenerator,
    /**
     * Whether to expire the cached data from Redis after TTL or, use auto revalidation queue to regenerate cache.
     */
    expireCache?: boolean
}

export type CachedSettings = {
    /**
     * The primary Redis connection which must be used only for general Redis operations.
     */
    redisMain: typeof Redis.Client,
    /**
     * The Redlock instance used for locking concurrent API requests
     */
    redlock: Redlock,
    /**
     * The Redis connection used for subscribing to channels
     */
    redisSubscriber: typeof Redis.Client,
    /**
        The Redis connection used for publishing to Redis channels
     */
    redisPublisher: typeof Redis.Client,
    /**
     * The number of times the API endpoint should be retried in case of failure/error
     */
    callbackRetryCount?: number,
    /**
     * The interval in milliseconds used as retrying failed callback executions
     */
    callbackRetryInterval?: number,
    /**
     * Global prefix used for all keys used by this object
     */
    keyPrefix?: string,
    /**
     * Logging object which follows the interface Logger_I
     */
    logger?: Logger_I,
    /**
     * Running mode of application. True if in Debug mode.
     */
    debug?: boolean,
}

export class Cached extends EventEmitter implements Cached_I{
    readonly handles: CachedSettings
    constructor(handles: CachedSettings){
        super();
        this.handles = handles

        if(this.handles?.callbackRetryCount == undefined)
            this.handles.callbackRetryCount = 4

        if(this.handles?.callbackRetryInterval == undefined)
            this.handles.callbackRetryInterval = 200

        if(!this.handles?.keyPrefix){
            this.handles.keyPrefix = 'tmc-apig-cache'
        }
        
        if(!this.handles?.debug){
            this.handles.debug = false
        }

        if(!this.handles?.logger){
            this.handles.logger = new Logger('APIG-CACHE-LOGGER', this.handles.debug?'DEBUG': 'LIVE')
        }

        this.setMaxListeners(0)
        this.handles.redisSubscriber.on("message", this._messageHandler)
    }

    private _messageHandler = (channel: any, message: any) => {
        this.handles.logger?.log.debug('messageEvent ', channel, ' :: ', message)
        this.emit(channel, channel,message)
    }


    async subscribeToChannel(channelID: string) {
        const {err, count} = await this.handles.redisSubscriber.subscribe(channelID);

        if(err){
            this.handles.logger?.log.error('subscribeToChannel:Error: ', err)
            throw err
        }

        this.handles.logger?.log.debug('subscribeToChannel: count: ', count)
        return true
    }


    private withPrefix(key: string) {
        return `${this.handles?.keyPrefix}:${key}`
    }

    private _logAPIUsage(prefix: string, retries: number, request: string){
        this.handles.redisMain.incr(this.withPrefix(`stats:callback_usage_count:${prefix}`))
        this.handles.redisMain.set(this.withPrefix(`stats:callback_request_object:${prefix}`), request)
        if(retries > 0){
            this.handles.redisMain.incrby(this.withPrefix(`stats:callback_retries_sum:${prefix}`), retries)
        }
    }

    private _executeCallback(callback: CacheGeneratorCallback, retryCount: number = 2, retryInterval: number = 200, req: any, res: any): Promise<any> {

        return new Promise(async(resolve, reject) => {
            let attempt: number = 0
            let maxAttempts: number = retryCount
    
            for(; attempt < maxAttempts; attempt++){
                try{
                    const APIResponse = await callback(req, res)
                    this.handles.logger?.log.debug('callback execution successful at attempt: ', attempt)
                    return resolve({
                        retryAttempts: attempt,
                        APIResponse: APIResponse
                    })
                }
                catch(callbackErr){
                    this.handles.logger?.log.info(`callbackAttempt: ${attempt} failed, retrying.. in ${attempt*200}`)
                    await new Promise(timeout => setTimeout(timeout, attempt*retryInterval))
                }
            }

            this.handles.logger?.log.error(`Callback execution failed. Retried ${maxAttempts} times.`)
            return reject(`Callback execution failed. Retried ${maxAttempts} times.`)
        })

    }

    _getKeyPrefix(prefix: string, requestHash: string){
        return this.withPrefix(`${prefix}:${requestHash}`)
    }

    private async _entryPoint(params: Input_I, req: any, res: any): Promise<any> {


        return new Promise(async(resolve, reject) => {
            try{
                const requestHash = await params.cacheKeyHandle(req, res)
                const keyPrefix = this._getKeyPrefix(params.prefix, requestHash)
                const cachedResponseKey = `${keyPrefix}:api-response`
                const lockingKey = `:${cachedResponseKey}:lock`
                const lockEventChannel = `lock-type:create::channel:${keyPrefix}`
        
                const cachedAPIResponse = await this._serveAPIFromCache(cachedResponseKey)
        
                // 1. Check if key exists in cache
                //      > return value if exists
    
                if(cachedAPIResponse){
                    this.handles.logger?.log.debug(`Served ${cachedResponseKey} from cache`)
                    return resolve(cachedAPIResponse)
                }
        
                // 2. Lock the key 
                //      > if lock not aquired, listen for unlock event
        
                try{
                    let lockedObject = await this.handles.redlock.acquire([lockingKey], 10000)
    
                    // 3. Generate cache value, set cache
                    let APIResponse: any = undefined;
                    let hasError: any = undefined;
                    try{
                        let executionResponse = await this._executeCallback(
                            params.callback,
                            this.handles.callbackRetryCount,
                            this.handles.callbackRetryInterval,
                            req, res)
    
                        // log usage 
    
                        this._logAPIUsage(keyPrefix, executionResponse.retryAttempts, JSON.stringify(req.body))
    
                        // check if api response should be cached or not
    
                            /*
                                1. Callback should throw error for non 2xx response
                                2. Check sample print of response vs response(TODO)
                            */
    
                        // await new Promise(resolve => setTimeout(resolve, 7000));
    
                        APIResponse = executionResponse.APIResponse
                        await this.handles.redisMain.set(cachedResponseKey, JSON.stringify(executionResponse.APIResponse), 'ex', params.ttl)
    
                    }
                    catch(err1: any){
                        this.handles.logger?.log.error('lockedOperationError:_entryPoint: ', err1, ' :body: ', req.body)
                        hasError = err1
                    }
                    finally{
    
                        //  4. release lock.
                        await lockedObject.release()
    
                        if(hasError){
                            this.handles.redisPublisher.publish(lockEventChannel, "error")
                            return reject(hasError)
                        }
    
                        // 5. Publish unlock event
                        this.handles.redisPublisher.publish(lockEventChannel, "unlocked")
                        this.handles.logger?.log.debug('resolved req')
    
                        return resolve(APIResponse)
                    }
                }catch(lockError: any){
                    // is already locked
    
                    this._getResponsePostUnlock(lockEventChannel, cachedResponseKey, lockError).then(newlyCachedAPIResponse =>{
                        return resolve(newlyCachedAPIResponse)
                    }).catch(Error => {
                        return reject(Error)
                    })
                }
            }catch(entryPointErr: any){
                return reject(entryPointErr)
            }
        })

    }

    _logAPIWaitingQueue(key: string) {
        this.handles.redisMain.incr(this.withPrefix(`stats:callback_listeners_count:${key}`))
    }

    private  _getResponsePostUnlock(lockEventChannel: string, key: string, lockError: any, timeout?: number){

        return new Promise(async (resolve, reject) => {
            if(lockError.message !== 'The operation was unable to achieve a quorum during its retry window.'){
                this.handles.logger?.log.error('lockerror rejected')
                this.handles.redisPublisher.publish(lockEventChannel, "error")
                return reject(lockError)
            }


            this._logAPIWaitingQueue(key)

            this.handles.logger?.log.debug('going to wait for unlock......')
            await this.subscribeToChannel(lockEventChannel)

            const pollTimeout = setTimeout(() => {

                const eventTimeoutError =  new EventPollTimeout('Maximum time limit reaching waiting for cache unlock event. Please check if event publish process is active.')

                this._serveAPIFromCache(key).then(cachedResponse => {
                    if(cachedResponse){
                        return resolve(cachedResponse)
                    }
                    return reject(eventTimeoutError)
                }).catch(error => {
                    return reject(error)
                })

            }, timeout?timeout:4000);

            this.once(lockEventChannel, async (channel: any, message: any) =>{

                clearTimeout(pollTimeout)

                process.nextTick(async() => {
                    if((message === 'unlocked')){

                        this.handles.redisMain.incr(this.withPrefix(`stats:callback_successListens_count:${key}`))
    
                        const newlyCachedAPIResponse = await this._serveAPIFromCache(key)
                        return resolve(newlyCachedAPIResponse)
                    }
    
                    this.handles.logger?.log.error('lockedResourceError: ', channel, message)
                    return reject(false)
                })
            })
        })

    }

    _serveAPIFromCache(requestHash: string): Promise<any>{

        return new Promise(async(resolve, reject) => {

            try{
                const cachedAPIResponse = await this.handles.redisMain.get(requestHash)
                return resolve(JSON.parse(cachedAPIResponse))
            }
            catch(err){
                return reject(err)
            }

        })
    }
    control(params: Input_I): any {

        const routerCallback = async (req: any, res: any, next: any) => {
            // this.handles.logger?.log.debug('t1: ', new Date().getTime())
            try{
                const APIResponse = await this._entryPoint(params, req, res)
                res.data = APIResponse
                return next()
            }
            catch(callbackError: any){
                this.handles.logger?.log.error('routerCallback:callbackHasError: ', callbackError)
                return res.status(500).send({
                    success: false,
                    code: 500,
                    error: 'Something went wrong, please try again later.'
                })
            }
        }

        return routerCallback
    }
}