/** JWT access-token payload set on req.user by requireAuth (see AuthService). */
export interface AuthUser {
  userId: number | string | null;
  email: string | null;
  role: string;
  type: 'access';
  service?: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
