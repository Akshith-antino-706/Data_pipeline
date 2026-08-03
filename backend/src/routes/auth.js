import { Router } from 'express';
import AuthService from '../services/AuthService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { success: true, data: { token, user } }
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await AuthService.login(email, password);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 * Returns: { success: true, data: { token, refreshToken, user } }
 * Exchanges a valid (rotating) refresh token for a fresh 1-day access token.
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const result = await AuthService.refresh(req.body?.refreshToken);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 * Body: { refreshToken } — revokes it so it can't be used again.
 */
router.post('/logout', async (req, res) => {
  await AuthService.logout(req.body?.refreshToken);
  res.json({ success: true });
});

/**
 * GET /api/auth/me
 * Headers: Authorization: Bearer <token>
 * Returns: { success: true, data: { id, email, name, role } }
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await AuthService.getUserById(req.user.userId);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

export default router;
