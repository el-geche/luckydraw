export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const badRequest = (m, c = 'BAD_REQUEST', x) => new HttpError(400, m, c, x);
export const unauthorized = (m = 'Sign in required') => new HttpError(401, m, 'UNAUTHORIZED');
export const forbidden = (m = 'Admin access required') => new HttpError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Not found') => new HttpError(404, m, 'NOT_FOUND');
export const conflict = (m, c = 'CONFLICT', x) => new HttpError(409, m, c, x);
