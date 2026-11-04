import { AuthError, ForbiddenError, ValidationError } from '../../shared/errors.js';

export function wrap(fn) {
  return async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return {
        ok: false,
        error: {
          code: e.code || 'INTERNAL',
          message: e.message,
          type:
            e instanceof AuthError ? 'AuthError' :
            e instanceof ForbiddenError ? 'ForbiddenError' :
            e instanceof ValidationError ? 'ValidationError' :
            'Error',
        },
      };
    }
  };
}
