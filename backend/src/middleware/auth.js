import AuthService from '../services/AuthService.js';

/**
 * JWT authentication middleware.
 * Expects: Authorization: Bearer <token>
 * Sets: req.user = { userId, email, role }
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const token = header.slice(7);

  try {
    const decoded = AuthService.verifyToken(token);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// Routes reachable without a login, matched against req.path under the /api mount.
// Everything else under /api requires a valid access token.
const PUBLIC_API_ROUTES = [
  // Login flow
  ['POST', /^\/auth\/(login|refresh|logout)$/],
  ['GET', /^\/health$/],
  // Called by email clients, recipients and providers — they can't send a user token
  ['GET', /^\/track\//],
  ['GET', /^\/v3\/utm\/track\/[^/]+$/],
  ['*', /^\/unsubscribe(\/|$)/],
  ['*', /^\/webhooks\//],
  ['POST', /^\/v3\/gupshup\/webhook\/(wa|sms)$/],
  ['POST', /^\/v3\/gtm\/events$/],
  // Leads screen (opened with the leads access token, not a login)
  ['GET', /^\/v3\/chat-leads\/(summary|trend|mail-summary|mail-trend|department-periods|mail-department-periods|department-users|departments|groups|registrations|registrations\/summary|registrations\/periods)$/],
  ['POST', /^\/v3\/chat-leads\/groups$/],
  ['PUT', /^\/v3\/chat-leads\/groups\/[^/]+$/],
  ['DELETE', /^\/v3\/chat-leads\/groups\/[^/]+$/],
];

function isPublicApiRoute(req) {
  const reqMethod = req.method === 'HEAD' ? 'GET' : req.method;
  return PUBLIC_API_ROUTES.some(([method, re]) => (method === '*' || method === reqMethod) && re.test(req.path));
}

/** Mount with app.use('/api', apiAuthGate) — protects every /api route not in PUBLIC_API_ROUTES. */
export function apiAuthGate(req, res, next) {
  if (req.method === 'OPTIONS' || isPublicApiRoute(req)) return next();
  return requireAuth(req, res, next);
}

/**
 * Role-based guard (for future use).
 * Usage: router.use(requireRole('admin'))
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  };
}
