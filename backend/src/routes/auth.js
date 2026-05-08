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
