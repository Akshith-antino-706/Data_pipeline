import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'rayna-tours-jwt-fallback-dev-secret';
const JWT_EXPIRES_IN = '15d';

class AuthService {

  static async login(email, password) {
    if (!email || !password) {
      const err = new Error('Email and password are required');
      err.status = 400;
      throw err;
    }

    const { rows } = await query(
      'SELECT id, email, password_hash, name, role FROM auth_users WHERE email = $1 AND is_active = true',
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      const err = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      const err = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  static verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch {
      const error = new Error('Invalid or expired token');
      error.status = 401;
      throw error;
    }
  }

  static async getUserById(id) {
    const { rows } = await query(
      'SELECT id, email, name, role FROM auth_users WHERE id = $1 AND is_active = true',
      [id]
    );
    return rows[0] || null;
  }
}

export default AuthService;
