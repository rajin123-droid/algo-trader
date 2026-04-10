import Redis from "ioredis";
import { logger } from "./logger.js";
import { dbConfig } from "../config/db.js";

const REDIS_URL = dbConfig.redisUrl;

let _redis: Redis | null = null;
let available = false;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(REDIS_URL, {
      retryStrategy: (times) => Math.min(times * 200, 10_000),
      lazyConnect: false,
      enableOfflineQueue: false,
    });

    _redis.on("ready", () => {
      available = true;
      logger.info("Redis ready");
    });

    _redis.on("error", (err) => {
      if (available) {
        logger.warn({ err }, "Redis error");
      }
      available = false;
    });

    _redis.on("close", () => {
      available = false;
    });
  }

  return _redis;
}

export function isRedisAvailable(): boolean {
  return available;
}
