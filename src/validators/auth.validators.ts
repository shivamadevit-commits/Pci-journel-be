import { z } from 'zod';
import { email, name, optionalText, otp, password, uuid } from '../schemas/common';

export const registerBody = z.object({
  email,
  password,
  firstName: name(),
  lastName: name(),
  affiliation: optionalText(250),
  country: optionalText(100),
});

export const verifyEmailBody = z.object({ email, otp });
export const resendVerificationBody = z.object({ email });

// Login accepts any non-empty password string: complexity rules apply when a password is *set*, not when it is checked.
export const loginBody = z.object({ email, password: z.string().min(1).max(128) });
export const verifyLoginOtpBody = z.object({ challengeId: uuid, otp });
export const resendLoginOtpBody = z.object({ challengeId: uuid });
export const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });
export const forgotPasswordBody = z.object({ email });
export const resetPasswordBody = z.object({ token: z.string().min(20).max(200), newPassword: password });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
