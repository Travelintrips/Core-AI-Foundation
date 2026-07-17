/**
 * routes/index.ts — Team 21 CM2 router barrel
 *
 * Exports a single combined router for Team 24 to mount in routes/index.ts.
 * Usage: import cm2Router from "../domains/creative-marketplace-v2/routes/index.js";
 *        app.use(cm2Router);   // or router.use(cm2Router) in central barrel
 */
import { Router } from "express";
import adminRouter from "./admin.js";
import publicRouter from "./public.js";
import workspaceRouter from "./workspace.js";

const cm2Router = Router();

cm2Router.use(adminRouter);
cm2Router.use(publicRouter);
cm2Router.use(workspaceRouter);

export { cm2Router };
export default cm2Router;
