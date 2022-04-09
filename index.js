import * as fs from "fs/promises";
import { createReadStream } from "fs";
import * as readline from "readline";

import mkdirp from "mkdirp";
import rimraf from "rimraf";
import Redis from "ioredis";
import pg from "pg";

// Dev values
// const TOTAL_KEYS_COUNT = 5000;
// const KEY_LENGTH = 10;
// const MAX_VALUE = 24;
// const MAX_QUERY_KEYS_COUNT = 10;
// const REQUESTS_COUNT = 100;

// "Prod" values
const TOTAL_KEYS_COUNT = 500000;
const KEY_LENGTH = 40;
const MAX_VALUE = 24;
const MAX_QUERY_KEYS_COUNT = 5000;
const REQUESTS_COUNT = 10000;

const global = {
  keys: null,
  keysArray: null,
};

const randomString = (length) => {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result = `${result}${Math.random().toString(16).slice(2, 3)}`;
  }
  return result;
};

const prepRequestLog = async (name, keysArray) => {
  for (let i = 0; i < REQUESTS_COUNT; i += 1) {
    const request = [];
    const keysCount = Math.floor(
      Math.random() * (MAX_QUERY_KEYS_COUNT - 1) + 1
    );
    for (let j = 0; j < keysCount; j += 1) {
      const keyIndex = Math.trunc(Math.random() * TOTAL_KEYS_COUNT);
      request.push(keysArray[keyIndex]);
    }
    await fs.appendFile(
      `./tmpdata/${name}.txt`,
      `${JSON.stringify(request)}\n`
    );
  }
};

const prepData = async () => {
  // Prepare keys
  const keys = {};
  console.time("prepare_keys");
  for (let i = 0; i < TOTAL_KEYS_COUNT; i += 1) {
    keys[randomString(KEY_LENGTH)] = Math.floor(Math.random() * MAX_VALUE);
  }
  await fs.writeFile(
    "./tmpdata/keys.json",
    JSON.stringify(keys, null, 2),
    "utf-8"
  );
  const keysArray = Object.keys(keys);
  global.keys = keys;
  global.keysArray = keysArray;
  console.timeEnd("prepare_keys");

  // Prepare "access logs"
  console.time("prep_access_logs");
  await prepRequestLog("reqwarmup", keysArray);
  await prepRequestLog("reqmeasure", keysArray);
  console.timeEnd("prep_access_logs");
};

// Dry run
const dryRun = async (name) => {
  console.time(`dry_run_${name}`);

  let totalLength = 0;

  const rl = readline.createInterface({
    input: createReadStream(`./tmpdata/${name}.txt`),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const query = JSON.parse(line);
    const len = query.length;
    totalLength += len;
  }

  console.timeEnd(`dry_run_${name}`);
};

// Redis
let redis;

const redisPrepare = async () => {
  console.time("prep_redis");

  redis = new Redis(6379, "redis");

  await redis.flushall();

  await Promise.all(
    Object.entries(global.keys).map(([key, value]) =>
      (async () => await redis.set(key, value))()
    )
  );

  console.timeEnd("prep_redis");
};

const redisRun = async (name) => {
  console.time(`redis_run_${name}`);

  let totalLen = 0;

  const rl = readline.createInterface({
    input: createReadStream(`./tmpdata/${name}.txt`),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const query = JSON.parse(line);
    const response = await redis.mget(...query);
    totalLen += response.length;
  }

  console.timeEnd(`redis_run_${name}`);
};

// Postgres
let pgclient;

const pgPrepare = async () => {
  console.time("pg_prepare");
  const { Client } = pg;
  pgclient = new Client("postgres://postgres:postgres@postgres/postgres");
  await pgclient.connect();

  await pgclient.query(`
    DROP TABLE keys;
    CREATE TABLE keys (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `);

  for (let i = 0; i < global.keysArray.length; i += 1) {
    await pgclient.query(`INSERT INTO keys VALUES ($1::TEXT, $2::INTEGER);`, [
      global.keysArray[i],
      global.keys[global.keysArray[i]],
    ]);
  }

  await pgclient.query(`
    CREATE UNIQUE INDEX keys_index ON keys (key) INCLUDE (value);
    ANALYZE;
    SET random_page_cost = 1.0;
  `);

  console.timeEnd("pg_prepare");
};

const pgRun = async (name) => {
  console.time(`pg_run_${name}`);

  let totalLen = 0;

  const rl = readline.createInterface({
    input: createReadStream(`./tmpdata/${name}.txt`),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const query = JSON.parse(line);
    let sql = "SELECT key, value FROM keys WHERE key IN (";
    for (let i = 0; i < query.length; i += 1) {
      sql += `'${query[i]}'`;
      if (i < query.length - 1) {
        sql += ",";
      }
    }
    sql += ");";

    const response = await pgclient.query(sql);

    totalLen += response.rows.length;
  }

  console.timeEnd(`pg_run_${name}`);
};

(async () => {
  rimraf.sync("./tmpdata");
  mkdirp.sync("./tmpdata");

  await prepData();

  await dryRun("reqwarmup");
  await dryRun("reqmeasure");

  await redisPrepare();
  await redisRun("reqwarmup");
  await dryRun("reqmeasure");
  await redisRun("reqmeasure");

  await pgPrepare();
  await pgRun("reqwarmup");
  await dryRun("reqmeasure");
  await pgRun("reqmeasure");

  process.exit(0); // force disconnect redis & pg
})();
