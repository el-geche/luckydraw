// Node-only dependency that the in-browser demo backend never uses.
export default {};
export const Resvg = class { constructor() { throw new Error('Not available in the browser demo'); } };
