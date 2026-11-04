export class AuthError extends Error {
  constructor(msg = 'Not authenticated') { super(msg); this.code = 'AUTH'; }
}
export class ForbiddenError extends Error {
  constructor(msg = 'Forbidden') { super(msg); this.code = 'FORBIDDEN'; }
}
export class ValidationError extends Error {
  constructor(msg) { super(msg); this.code = 'VALIDATION'; }
}
