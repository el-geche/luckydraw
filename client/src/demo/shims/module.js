// createRequire() stand-in: only package.json lookups are used by the server code paths the demo runs.
export function createRequire() {
  const req = (p) => (String(p).endsWith('package.json') ? { version: '1.0.0', name: 'luckydraw' } : {});
  req.resolve = (p) => p;
  return req;
}
export default { createRequire };
