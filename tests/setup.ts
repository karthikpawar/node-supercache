import Client from "ioredis";
import Redlock from "redlock";
import { Cached } from "../lib/lock";
import { Logger } from "../lib/logging";

const redisPath = '127.0.0.1';
const redisPort = 6379;
const redisPassword = '';
const useTls = {}

const redisCommonOptions: any = {
    host: redisPath,
    port: redisPort,
    keepAlive: 1,
}

// if(useTls && Object.keys(useTls).length !== 0){
//     redisCommonOptions.password = redisPassword
//     redisCommonOptions.tls = useTls
// }

export const redisMain = new Client({
    enableAutoPipelining: true,
    ...redisCommonOptions
});

const redisSubscriber = new Client({
  autoResubscribe: true,
  enableAutoPipelining: true,
  ...redisCommonOptions
});
const redisPublisher = new Client({
  enableAutoPipelining: true,
  ...redisCommonOptions
});
const redlock = new Redlock([redisMain], {
  driftFactor: 0.01,
  retryCount: 0,
  retryDelay: 100,
  retryJitter: 200,
  automaticExtensionThreshold: 200,
});

export const tempRedlock = new Redlock([redisMain], {
  driftFactor: 0.01,
  retryCount: 50,
  retryDelay: 200,
  retryJitter: 200,
  automaticExtensionThreshold: 200,
});

export const Cache = new Cached({
  redisMain: redisMain,
  redisPublisher: redisPublisher,
  redisSubscriber: redisSubscriber,
  redlock: redlock,
  debug: false,
});

export const stopRedisHandles = async() => {
  Cache.removeAllListeners()
  await redisMain.quit()
  await redisSubscriber.unsubscribe()
  await redisPublisher.quit()
  await redisSubscriber.quit()
}