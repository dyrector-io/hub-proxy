/* eslint-disable no-console */
import http from 'http';
import https from 'https';
import { exit } from 'process';
import redis from 'redis';

const PORT = process.env.PORT ?? 9999;
const HOST = process.env.HOST ?? '0.0.0.0';
const { TOKEN } = process.env;

if (!TOKEN) {
  console.error('[ERROR] Proxy - TOKEN is undefined');
  exit(-1);
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://172.17.0.1:6379';
const REDIS_AGE = process.env.REDIS_AGE ? parseInt(process.env.REDIS_AGE, 10) : 60_000; // millis
const REDIS_EX = process.env.REDIS_EX
  ? parseInt(process.env.REDIS_EX, 10)
  : 60 * 60 * 24; // seconds

const TARGET_URL = 'hub.docker.com';

const CACHE_FIELD_AGE = 'age';
const CACHE_FIELD_BODY = 'body';
const CACHE_FIELD_STATUS = 'status';
const CACHE_FIELD_HEADERS = 'headers';

const cache = redis.createClient({
  url: REDIS_URL,
});

cache.on('error', (err) => console.error('[ERROR] Redis -', err));

await cache.connect();

const onRequest = async (clientReq, clientRes) => {
  const reqToken = clientReq.headers.authorization;

  if (reqToken !== TOKEN) {
    clientRes.writeHead(401);
    clientRes.end();
    return;
  }

  const path = clientReq.url;

  if (await cache.exists(path)) {
    const age = await cache.hGet(path, CACHE_FIELD_AGE);
    const status = await cache.hGet(path, CACHE_FIELD_STATUS);
    const headers = await cache.hGet(path, CACHE_FIELD_HEADERS);
    const body = await cache.hGet(path, CACHE_FIELD_BODY);

    console.info('[INFO]  Hit -', status, path);

    clientRes.writeHead(status, JSON.parse(headers));
    clientRes.write(body);
    clientRes.end();

    const now = new Date().getTime();
    if (now - age <= REDIS_AGE) {
      return;
    }
  }

  const options = {
    hostname: TARGET_URL,
    porst: 443,
    path,
    method: clientReq.method,
  };

  await https.request(options, (res) => {
    const status = res.statusCode;
    const { headers } = res;

    let body = '';
    res.on('data', (chunk) => {
      body += chunk.toString();
    });

    res.on('error', (err) => console.error('[ERROR] Proxy -', err));

    res.on('end', () => {
      console.info('[INFO]  Proxy -', status, path);

      cache.hSet(path, CACHE_FIELD_AGE, new Date().getTime());
      cache.hSet(path, CACHE_FIELD_STATUS, status);
      cache.hSet(path, CACHE_FIELD_HEADERS, JSON.stringify(headers));
      cache.hSet(path, CACHE_FIELD_BODY, body);
      cache.expire(path, REDIS_EX);

      if (!clientRes.writableEnded) {
        clientRes.writeHead(status, headers);
        clientRes.write(body);
        clientRes.end();
      }
    });

    if (!clientRes.writableEnded) {
      res.on('error', () => {
        clientRes.writeHead(503);
        clientRes.end();
      });
    }
  }).end();
};

const server = http.createServer(onRequest);
server.on('listening', () => console.info(`[INFO]  Proxy - listening on ${HOST}:${PORT}`));

server.listen(PORT, HOST);
