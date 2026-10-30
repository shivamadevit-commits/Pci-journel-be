import { env } from '../config/env';

// Frontend route conventions assumed by the e-mail links. Adjust here if the SPA uses different paths.
const base = () => env.FRONTEND_URL.replace(/\/$/, '');

export const links = {
  resetPassword: (token: string) => `${base()}/reset-password?token=${encodeURIComponent(token)}`,
  setPassword: (token: string) => `${base()}/set-password?token=${encodeURIComponent(token)}`,
  login: () => `${base()}/login`,
  authorArticle: (articleId: string) => `${base()}/author/articles/${articleId}`,
  // Cashfree replaces {order_id} with the real order id when redirecting the author back.
  authorPaymentReturn: (articleId: string) => `${base()}/author/articles/${articleId}?tab=payment&payment=return&order_id={order_id}`,
  editorArticle: (articleId: string) => `${base()}/editor/articles/${articleId}`,
  reviewerAssignment: (assignmentId: string) => `${base()}/reviewer/assignments/${assignmentId}`,
  productionArticle: (articleId: string) => `${base()}/production/articles/${articleId}`,
  publication: (submissionId: string) => `${base()}/articles/${encodeURIComponent(submissionId)}`,
};
