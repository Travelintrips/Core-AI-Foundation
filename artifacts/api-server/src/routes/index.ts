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
import creativeAiRouter from "./creative-ai";
import capabilitiesRouter from "./capabilities";
import feedbackRouter from "./feedback";
import clientMemoryRouter from "./client-memory";

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
router.use(creativeAiRouter);
router.use(capabilitiesRouter);
router.use(feedbackRouter);
router.use(clientMemoryRouter);

export default router;
