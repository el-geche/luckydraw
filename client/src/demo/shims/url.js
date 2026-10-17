export const fileURLToPath = (u) => { try { return new URL(String(u)).pathname; } catch { return String(u); } };
export const pathToFileURL = (p) => new URL(`file://${p}`);
export default { fileURLToPath, pathToFileURL };
