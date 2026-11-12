import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { query } from '../config/database.js';
import type { AuthUser } from '../types/express.js';
import type { HttpError, AuthUserRow, RefreshTokenRow } from '../types/services_A.js';

const JWT_SECRET = process.env.JWT_SECRET || 'rayna-tours-jwt-fallback-dev-secret';
const ACCESS_EXPIRES_IN = '1d';          // short-lived access token (was 7d)
const REFRESH_EXPIRES_DAYS = 30;         // refresh token lifetime

// Refresh tokens are stored HASHED (never plaintext) so a DB leak can't reuse them.
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

class AuthService {

  static _signAccessToken(user: { id: number; email: string; role: string }): string {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role, type: 'access' },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRES_IN }
    );
  }

  // Create + persist a random opaque refresh token; returns the raw token to hand to the client.
  static async _issueRefreshToken(userId: number): Promise<string> {
    const raw = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 86400000);
    await query(
      'INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, hashToken(raw), expiresAt]
    );
    return raw;
  }

  static async login(email: string, password: string) {
    if (!email || !password) {
      const err: HttpError = new Error('Email and password are required');
      err.status = 400;
      throw err;
    }

    const { rows } = await query<AuthUserRow>(
      'SELECT id, email, password_hash, name, role FROM auth_users WHERE email = $1 AND is_active = true',
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      const err: HttpError = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      const err: HttpError = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    const token = this._signAccessToken(user);
    const refreshToken = await this._issueRefreshToken(user.id);

    return {
      token,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  /**
   * Exchange a valid refresh token for a fresh access token. Rotates the refresh token
   * (revokes the used one, issues a new one) so a stolen token is single-use.
   */
  static async refresh(refreshToken: string) {
    if (!refreshToken) {
      const err: HttpError = new Error('Refresh token required');
      err.status = 400;
      throw err;
    }

    const { rows } = await query<RefreshTokenRow>(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked, u.email, u.name, u.role, u.is_active
         FROM auth_refresh_tokens rt
         JOIN auth_users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1`,
      [hashToken(refreshToken)]
    );

    const rec = rows[0];
    if (!rec || rec.revoked || !rec.is_active || new Date(rec.expires_at) < new Date()) {
      const err: HttpError = new Error('Invalid or expired refresh token');
      err.status = 401;
      throw err;
    }

    // Rotate: revoke the used token, mint a new pair.
    await query('UPDATE auth_refresh_tokens SET revoked = true WHERE id = $1', [rec.id]);
    const token = this._signAccessToken({ id: rec.user_id, email: rec.email, role: rec.role });
    const newRefreshToken = await this._issueRefreshToken(rec.user_id);

    return {
      token,
      refreshToken: newRefreshToken,
      user: { id: rec.user_id, email: rec.email, name: rec.name, role: rec.role },
    };
  }

  // Revoke a refresh token (logout). Best-effort — never throws.
  static async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await query('UPDATE auth_refresh_tokens SET revoked = true WHERE token_hash = $1', [hashToken(refreshToken)])
      .catch(() => {});
  }

  // Short-lived token for the backend calling its own protected API (e.g. TestSendScheduler).
  static signServiceToken(service: string): string {
    return jwt.sign(
      { userId: null, email: null, role: 'system', service, type: 'access' },
      JWT_SECRET,
      { expiresIn: '30m' }
    );
  }

  static verifyToken(token: string): AuthUser {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthUser;
      if (decoded?.type && decoded.type !== 'access') throw new Error('Wrong token type');
      return decoded;
    } catch {
      const error: HttpError = new Error('Invalid or expired token');
      error.status = 401;
      throw error;
    }
  }

  static async getUserById(id: number | string) {
    const { rows } = await query<Omit<AuthUserRow, 'password_hash'>>(
      'SELECT id, email, name, role FROM auth_users WHERE id = $1 AND is_active = true',
      [id]
    );
    return rows[0] || null;
  }
}

export default AuthService;
