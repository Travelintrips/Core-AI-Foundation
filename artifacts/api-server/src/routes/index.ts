import { Router, type IRouter } from "express";
import healthRouter from "./health";
import registryRouter from "./registry";
import agentsRouter from "./agents";
import orchestratorRouter from "./orchestrator";
import workflowsRouter from "./workflows";
import promptsRouter from "./prompts";
import knowledgeRouter from "./knowledge";
import memoryRouter from "./memory";
import auditRouter from "./audit";
import analyticsRouter from "./analytics";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(registryRouter);
router.use(agentsRouter);
router.use(orchestratorRouter);
router.use(workflowsRouter);
router.use(promptsRouter);
router.use(knowledgeRouter);
router.use(memoryRouter);
router.use(auditRouter);
router.use(analyticsRouter);
router.use(settingsRouter);

export default router;
