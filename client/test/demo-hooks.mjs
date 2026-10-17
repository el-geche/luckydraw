// Node module hooks: resolve `express` and `cors` to the browser demo shims, exactly as the static build does.
const map = {
  express: new URL('../src/demo/shims/express.js', import.meta.url).href,
  cors: new URL('../src/demo/shims/cors.js', import.meta.url).href,
};
export async function resolve(specifier, context, next) {
  if (map[specifier]) return { url: map[specifier], shortCircuit: true };
  return next(specifier, context);
}
