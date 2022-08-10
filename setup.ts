import Client from "ioredis";
import Redlock from "redlock";
import { Cached } from "./src/lock";
import { Logger } from "./src/logging";

const redisPath = process.env.REDIS_ENDPOINT_PATH;
const redisPort = process.env.REDIS_ENDPOINT_PORT
  ? parseInt(process.env.REDIS_ENDPOINT_PORT)
  : 6379;

const reditPassword = process.env.REDIS_ENDPOINT_PASSWORD ;

const redisCommonOptions: any = {
    host: redisPath,
    port: redisPort,
    keepAlive: 1,
}

if(process.env.REDIS_ENDPOINT_PASSWORD && (process.env.REDIS_ENDPOINT_PASSWORD !== '')){
    redisCommonOptions.password = process.env.REDIS_ENDPOINT_PASSWORD
    redisCommonOptions.tls = {}
}

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