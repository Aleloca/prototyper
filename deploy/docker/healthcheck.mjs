// Docker health check: the server answers on its plain-http port (any status below 500).
const port = process.env.STANDALONE === "true" ? process.env.HTTP_PORT : process.env.PORT;
fetch(`http://127.0.0.1:${port}/.well-known/acme-challenge/health`, { signal: AbortSignal.timeout(4000) }).then(
  (r) => process.exit(r.status < 500 ? 0 : 1),
  () => process.exit(1),
);
