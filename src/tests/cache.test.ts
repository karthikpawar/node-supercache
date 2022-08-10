/**
 * 
 * 1. Sucessful callback
 * 2. Callback timeout
 * 3. Callback error
 * 4. Handle status checks(main, sub, pub and redlock)
 * 5. Compare stats
 * 6. Concurrent requests -> queue size -> check stats
 * 
 */

import { Cache, stopRedisHandles } from '../../setup'
import objectHash = require("object-hash")
import crypto = require('crypto')

beforeAll(()=>{
    // if(Cache.handles.logger){
    //     Cache.handles.logger.mode = 'live'
    // }
    jest.spyOn(global.console, 'log').mockImplementation(() => jest.fn());
    console.log('start tests.')
})


describe('Check Redis connections', () => {
    const generalRedisHandles = [
        Cache.handles.redisMain
    ]
    const prefix = crypto.randomBytes(20).toString('hex');
    test('Check GET/SET commands',async () => {
        generalRedisHandles.forEach(async(connection: any) => {
            const testKey = `${prefix}:test-get-set`;
            const testVal = 'GET-1'

            await connection.set(testKey, testVal, 'ex', 5)

            const getVal = await connection.get(testKey)

            expect(getVal).toBe(testVal)
            // const 
        })
    }, 2000)

    test('Check Redis Pub/Sub', async () =>{

        await Cache.handles.redisSubscriber.subscribe(`${prefix}:test-channel-1`)

        Cache.handles.redisSubscriber.once('message', (channel: any, message: any)=> {
            Cache.handles.redisSubscriber.unsubscribe(`${prefix}:test-channel-1`)

            expect(channel).toStrictEqual(`${prefix}:test-channel-1`)
            expect(message).toStrictEqual('test-message-1')

        })

        await Cache.handles.redisPublisher.publish(`${prefix}:test-channel-1`, 'test-message-1')
    }, 2000)
})

describe('Callback tests', () => {
    test('Successful callback', async () => {
        const cachedCallback = Cache.control({
            ttl: 10,
            prefix: '/successful-callback',
            callback: async (req, res) => {
                return new Promise((resolve, reject) => {
                    return resolve({
                        status: 200,
                        message: "success"
                    })
                })
            },
            cacheKeyHandle: async (req, res) => {
                return objectHash({
                    URL: req.originalUrl,
                    body: req.body
                })
            }
        })

        const request: any = {
            originalUrl: '/successful-callback',
            body: {
                heart: "*",
                liver: "^"
            }
        }
        const response: any = {
            locals: {}
        }

        const nextCallback = () => {
            return true
        }

        await cachedCallback(request, response, nextCallback).then((data: any) => {
            expect(response.data).toStrictEqual({
                status: 200,
                message: "success"
            })
            expect(data).toBe(true)
        })
    })
    
    test('Failing callback', async () => {
        const cachedCallback = Cache.control({
            ttl: 10,
            prefix: '/failing-callback',
            callback: async (req, res) => {
                return new Promise((resolve, reject) => {
                    throw new Error('Error for testing')
                    reject(false)
                })
            },
            cacheKeyHandle: async (req, res) => {
                return objectHash({
                    URL: req.originalUrl,
                    body: req.body
                })
            }
        })

        const request: any = {
            originalUrl: '/successful-callback',
            body: {
                heart: "*",
                liver: "^"
            }
        }
        const response: any = {
            locals: {},
            status: (code: number) => {
                return {
                    send: (error: any) => {
                        return error
                    }
                }
            }
        }

        const nextCallback = () => {
            return true
        }

        await cachedCallback(request, response, nextCallback).then((err: any) => {
            expect(err.success).toBe(false)
            expect(err.code).toBe(500)
        })
    }, 2000)

    test('Failing cacheKeyHandle', async() => {
        const cachedCallback = Cache.control({
            ttl: 10,
            prefix: '/successful-callback',
            callback: async (req, res) => {
                return new Promise((resolve, reject) => {
                    return resolve({
                        status: 200,
                        message: "success"
                    })
                })
            },
            cacheKeyHandle: async (req, res) => {
                throw new Error('Error:key_generation_failed')
            }
        })

        const request: any = {
            originalUrl: '/successful-callback',
            body: {
                heart: "*",
                liver: "^"
            }
        }
        const response: any = {
            locals: {},
            status: (code: number) => {
                return {
                    send: (error: any) => {
                        return error
                    }
                }
            }
        }

        const nextCallback = () => {
            return true
        }
        const tres = await cachedCallback(request, response, nextCallback)

        expect(tres.success).toBe(false)
        expect(tres.code).toBe(500)
    })

    test('Concurrent successful callbacks', async() => {
        const callBack1 = jest.fn(async (req: any, res: any) => {
            await new Promise(resolve => setTimeout(resolve, 4000));
            return {
                status: 200,
                message: "success"
            }
        })
        const cachedCallback = Cache.control({
            ttl: 1,
            prefix: '/Concurrent successful callbacks',
            callback: callBack1,
            cacheKeyHandle: async (req, res) => {
                return objectHash({
                    URL: req.originalUrl,
                    body: req.body
                })
            }
        })

        const request: any = {
            originalUrl: '/Concurrent successful callbacks',
            body: {
                heart: "*",
                liver: "^"
            }
        }
        const response: any = {
            locals: {},
            status: (code: number) => {
                return {
                    send: (error: any) => {
                        return error
                    }
                }
            }
        }

        const nextCallback = () => {
            return true
        }

        let callList = []
        let reqID=0
        for(; reqID<10; reqID++){
            callList.push(
                cachedCallback(request, response, nextCallback)
            )
        }

        const resolvedCalls = await Promise.all(callList)

        expect(callBack1).toBeCalledTimes(1)

        resolvedCalls.forEach((cb: any) => {
            expect(cb).toBe(true)
            expect(cb).toBe(true)
        })


    }, 5000)
})

afterAll(async()=>{
    await stopRedisHandles()
})