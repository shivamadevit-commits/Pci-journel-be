import { Router } from 'express';
import { buildRouter, type AnyRoute } from '../utils/route';
import { adminRoutes } from './admin.routes';
import { authRoutes } from './auth.routes';
import { authorRoutes } from './author.routes';
import { editorialRoutes } from './editorial.routes';
import { miscRoutes } from './misc.routes';
import { productionRoutes } from './production.routes';
import { reviewerRoutes } from './reviewer.routes';

export const allRoutes: AnyRoute[] = [
  ...authRoutes,
  ...adminRoutes,
  ...authorRoutes,
  ...editorialRoutes,
  ...reviewerRoutes,
  ...productionRoutes,
  ...miscRoutes,
];

export const apiRouter: Router = buildRouter(allRoutes);
