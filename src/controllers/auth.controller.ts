import * as v from '../validators/auth.validators';
import * as auth from '../services/auth.service';
import { getMe } from '../services/user.service';
import type { C, PC } from '../utils/route';

const GENERIC = 'If the request can be processed, an email has been sent.';

export const register = async ({ body }: PC<typeof v.registerBody>) => {
  await auth.register(body);
  return { status: 202, message: 'If the email address can be registered, a verification code has been sent to it.' };
};

export const verifyEmail = async ({ body }: PC<typeof v.verifyEmailBody>) => {
  await auth.verifyEmail(body.email, body.otp);
  return { message: 'Email verified. You can now sign in.' };
};

export const resendVerification = async ({ body }: PC<typeof v.resendVerificationBody>) => {
  await auth.resendVerification(body.email);
  return { message: GENERIC };
};

export const login = async ({ body }: PC<typeof v.loginBody>) => {
  const r = await auth.login(body.email, body.password);
  if (r.otpRequired) {
    return {
      message: 'A verification code has been sent to your email address.',
      data: { otpRequired: true, challengeId: r.challengeId, expiresAt: r.expiresAt, resendAvailableInSeconds: r.resendAvailableInSeconds },
    };
  }
  return { message: 'Signed in successfully', data: { otpRequired: false, ...r.tokens, user: r.user } };
};

export const verifyLoginOtp = async ({ body }: PC<typeof v.verifyLoginOtpBody>) => {
  const r = await auth.verifyLoginOtp(body.challengeId, body.otp);
  return { message: 'Signed in successfully', data: { ...r.tokens, user: r.user } };
};

export const resendLoginOtp = async ({ body }: PC<typeof v.resendLoginOtpBody>) => {
  const r = await auth.resendLoginOtp(body.challengeId);
  return { message: 'A new verification code has been sent.', data: r };
};

export const refresh = async ({ body }: PC<typeof v.refreshBody>) => ({ message: 'Token refreshed', data: await auth.refresh(body.refreshToken) });

export const logout = async ({ user }: C) => {
  await auth.logout(user);
  return { message: 'Signed out' };
};

export const forgotPassword = async ({ body }: PC<typeof v.forgotPasswordBody>) => {
  await auth.forgotPassword(body.email);
  return { message: 'If an account exists for this email, a password reset link has been sent.' };
};

export const resetPassword = async ({ body }: PC<typeof v.resetPasswordBody>) => {
  await auth.resetPassword(body.token, body.newPassword);
  return { message: 'Your password has been reset. Please sign in.' };
};

export const changePassword = async ({ user, body }: C<typeof v.changePasswordBody>) => {
  await auth.changePassword(user, body.currentPassword, body.newPassword);
  return { message: 'Password changed. Other sessions were signed out.' };
};

export const me = async ({ user }: C) => ({ data: await getMe(user.id) });
