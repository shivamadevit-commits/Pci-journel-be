import * as c from '../controllers/auth.controller';
import * as v from '../validators/auth.validators';
import { publicRoute, route } from '../utils/route';

const tag = 'Authentication';

export const authRoutes = [
  publicRoute({ method: 'post', path: '/auth/register', tag, summary: 'Register an Author account (sends an email verification code)', limiter: 'register', status: 202, body: v.registerBody, errors: [400, 429], handler: c.register }),
  publicRoute({ method: 'post', path: '/auth/verify-email', tag, summary: 'Verify email with the OTP sent at registration', limiter: 'otpVerify', body: v.verifyEmailBody, errors: [400, 429], handler: c.verifyEmail }),
  publicRoute({ method: 'post', path: '/auth/resend-verification', tag, summary: 'Resend the email verification OTP (generic response)', limiter: 'otpResend', body: v.resendVerificationBody, errors: [429], handler: c.resendVerification }),
  publicRoute({
    method: 'post', path: '/auth/login', tag, limiter: 'login', body: v.loginBody, errors: [401, 403, 429, 503],
    summary: 'Step 1 of sign-in: email + password',
    description: 'When LOGIN_OTP_REQUIRED=true (default) no tokens are issued here: the response contains `challengeId` and an OTP is e-mailed. Complete sign-in with POST /auth/login/verify-otp. Wrong password, unknown email and locked account all return the same 401.',
    handler: c.login,
  }),
  publicRoute({ method: 'post', path: '/auth/login/verify-otp', tag, summary: 'Step 2 of sign-in: submit the e-mailed OTP and receive tokens', limiter: 'otpVerify', body: v.verifyLoginOtpBody, errors: [401, 429], handler: c.verifyLoginOtp }),
  publicRoute({ method: 'post', path: '/auth/login/resend-otp', tag, summary: 'Request a new login OTP (cooldown applies); returns a new challengeId', limiter: 'otpResend', body: v.resendLoginOtpBody, errors: [401, 429, 503], handler: c.resendLoginOtp }),
  publicRoute({ method: 'post', path: '/auth/refresh', tag, summary: 'Rotate the refresh token and obtain a new access token', limiter: 'login', body: v.refreshBody, errors: [401, 429], handler: c.refresh }),
  publicRoute({ method: 'post', path: '/auth/forgot-password', tag, summary: 'Request a password-reset link (generic response)', limiter: 'forgotPassword', body: v.forgotPasswordBody, errors: [429], handler: c.forgotPassword }),
  publicRoute({
    method: 'post', path: '/auth/reset-password', tag, limiter: 'resetPassword', body: v.resetPasswordBody, errors: [400, 429],
    summary: 'Set a new password with a reset or account-invitation token',
    description: 'Tokens are single-use and time-limited. Used for password reset and for first-time password setup of invited staff / approved reviewers. All sessions are revoked.',
    handler: c.resetPassword,
  }),
  route({ method: 'post', path: '/auth/logout', tag, roles: 'any', summary: 'Sign out (revokes the current session and its refresh tokens)', handler: c.logout }),
  route({ method: 'post', path: '/auth/change-password', tag, roles: 'any', summary: 'Change password (other sessions are revoked)', limiter: 'resetPassword', body: v.changePasswordBody, errors: [400, 429], handler: c.changePassword }),
  route({ method: 'get', path: '/auth/me', tag, roles: 'any', summary: 'Current authenticated user and role-specific profile', handler: c.me }),
];
