import { Router, type IRouter } from "express";
import healthRouter from "./health";
import metricsRouter from "./metrics";
import agentsRouter from "./agents";
import registryRouter from "./registry";
import orchestratorRouter from "./orchestrator";
import workflowsRouter from "./workflows";
import promptsRouter from "./prompts";
import knowledgeRouter from "./knowledge";
import memoryRouter from "./memory";
import auditRouter from "./audit";
import analyticsRouter from "./analytics";
import settingsRouter from "./settings";

import creativeAiRouter from "./creative-ai";
import imageBatchRouter from "./image-batch";
import capabilitiesRouter from "./capabilities";
import feedbackRouter from "./feedback";
import clientMemoryRouter from "./client-memory";
import seedRouter from "./seed";
import testRunsRouter from "./test-runs";
import exportRouter from "./export-routes";
import clientReviewRouter from "./client-review";
import workforceRouter from "./workforce";
import publicRouter from "./public";
import operationsRouter from "./operations";
import jobsRouter from "./jobs";
import dispatcherRouter from "./dispatcher";
import clusterRouter from "./cluster";
import workspaceHealthRouter from "./workspace-health";
import eventsRouter from "./events";
import schedulesRouter from "./schedules";
import marketplaceRouter from "./marketplace";
import humanTasksRouter from "./human-tasks";
import customerPortalRouter from "./customer-portal";
import publicReviewRouter from "./public-review";
import cpReviewRouter from "./cp-review";
import quotationsRouter from "./quotations";
import catalogRouter from "./catalog";
import commercialGatesRouter from "./commercialGates";
import aiQuotationsRouter from "./aiQuotations";
import automationRouter from "./automation";
import paymentsRouter from "./payments";
import portfolioRouter from "./portfolio";
import portfolioPublicRouter from "./portfolio-public";
import portfolioBatchRouter from "./portfolio-batch";
import filesRouter from "./files";
import customerWorkspaceRouter from "./customer-workspace";
import customerWorkspaceSseRouter from "./customer-workspace-sse";
import customerWorkspaceDocumentsRouter from "./customer-workspace-documents";
import adminCustomerWorkspaceRouter from "./admin-customer-workspace";
import salesFunnelRouter from "./salesFunnel";
import promotionsRouter from "./promotions";
import couponsRouter from "./coupons";
import referralsRouter from "./referrals";
import affiliatesRouter from "./affiliates";
import customerHealthRouter from "./customerHealth";
import commercialAnalyticsRouter from "./commercialAnalytics";
import storageRouter from "./storage";
import observabilityRouter from "./observability";
import internalAuthRouter from "./internal-auth";
import internalCatalogRouter from "./internal-catalog";
import brandKitEnterpriseRouter from "./brand-kit-enterprise";
import assetLibraryRouter from "./asset-library";
import zipDeliveryRouter from "./zip-delivery";
import brandIntelligenceRouter from "./brand-intelligence";
import assetIntelligenceRouter from "./asset-intelligence";
import templatesRouter from "./templates";
import templateEngineRouter from "./template-engine";
import portfolioGalleryRouter from "./portfolio-gallery";
import productionPipelineRouter from "./production-pipeline";
import designStudioRouter from "./design-studio";
import designTemplatesRouter from "./design-templates";
import designTemplatesAiAssistRouter from "./design-templates-ai-assist";
import creativeMarketplaceRouter from "./creative-marketplace";
import cargoRatesRouter from "./cargo-rates";
import serviceNormalizationRouter from "./service-normalization.js";
import { designQualityRouter } from "./design-quality.js";
// ── Team 05: Discovery Analytics & Feature Flags ──────────────────────────
import discoveryAnalyticsRouter from "./discoveryAnalytics.js";
// ── Team 10: Universal Design API Contracts & Orchestration Boundary ──────
import universalDesignRouter from "./universal-design/index.js";
// ── Team 14: Universal Asset Browser ─────────────────────────────────────
import assetBrowserRouter from "./asset-browser.js";
// ── Team 18: Universal Annotation and Comment System ─────────────────────────
import { annotationRouter } from "../domains/annotation-system/index.js";
// ── Team 21: Universal Material Library ───────────────────────────────────
import materialLibraryRouter from "./material-library.js";
// ── Interior Design Material Library (Phase 1) ────────────────────────────
import materialLibraryCatalogRouter from "./material-library-catalog.js";
// ── Interior Design Material Library (Phase 2 intelligence, additive) ─────
import materialIntelligenceRouter from "./material-intelligence.js";
// ── Team 23: Design Knowledge & Recommendation Adapter ────────────────────────
import designKnowledgeRouter from "./design-knowledge.js";
// ── Team 17 / Team 34: Universal Design Export Workspace ─────────────────────
import exportWorkspaceRouter from "./export-workspace/index.js";
// ── Team 34: Design Cost, Usage, and Budget Attribution ───────────────────────
import designCostAttributionRouter from "./design-cost-attribution.js";
// ── Team 35: Design Observability & Operations ────────────────────────────────
import designObservabilityOpsRouter from "./design-observability.js";

// ── Team 01: Creative Workflow V2 ──────────────────────────────────────────
import { creativeWorkflowV2Router, creativeWorkflowPublicRouter } from "./creative-workflow-v2/index.js";
// ── Team 02: Customer Creative Workspace (enhanced) ───────────────────────
import customerCreativeWorkspaceRouter from "./customer-creative-workspace/index.js";
// ── Team 02: Goal Taxonomy (V4.2C) ────────────────────────────────────────
import goalTaxonomyRouter from "../goals/goalRoutes.js";
// ── Team 03: Creative Commercial Automation ───────────────────────────────
import creativeCommercialRouter from "./creative-commercial/index.js";
// ── Team 04: Portfolio V2 (Gallery, Inspiration, Compare) ────────────────
import galleryV2Router from "./creative-portfolio-v2/index.js";
// ── Team 05: Brand Intelligence V2 ───────────────────────────────────────
import brandIntelligenceV2Router from "./brand-intelligence-v2/index.js";
// ── Team 06: Asset Intelligence V2 ───────────────────────────────────────
import assetIntelligenceV2Router from "./asset-intelligence-v2/index.js";
// ── Team 07: Design Blueprints ────────────────────────────────────────────
import designBlueprintsRouter from "./design-blueprints/index.js";
// ── Team 07: Domain Plugin Framework ─────────────────────────────────────
import { designPluginsRouter } from "../domains/design-plugins/index.js";
// ── Team 08: Design Components ───────────────────────────────────────────
import designComponentsRouter from "./design-components/router.js";
// ── Team 09: Design Patterns ─────────────────────────────────────────────
import designPatternsRouter from "./design-patterns/index.js";
// ── Team 09: Design Version History & Revision System ────────────────────
import designVersioningRouter from "./design-versioning.js";
// ── Team 10: Design Tokens (Typography & Palette) ────────────────────────
import designTokensRouter from "./design-tokens/index.js";
// ── Team 11: Universal Template Matching ─────────────────────────────────
import universalTemplateMatchingRouter from "./universal-template-matching/index.js";
// ── Team 12: Layout Composer ─────────────────────────────────────────────
import layoutComposerRouter from "./layout-composer/index.js";
// ── Team 13: Dynamic Design Composer ─────────────────────────────────────
import dynamicDesignComposerRouter from "./dynamic-design-composer/index.js";
// ── Team 14: Universal Renderer ──────────────────────────────────────────
import universalRendererRouter from "./universal-renderer/index.js";
// ── Team 16: Design Review and Approval Workspace ────────────────────────
import reviewWorkspaceRouter from "./review-workspace.js";
// ── Team 15: Graphic Design Domain ───────────────────────────────────────
import graphicDesignRouter from "../domains/graphic-design/routes.js";
// ── Team 17: Interior Design ─────────────────────────────────────────────
import interiorDesignRouter from "./interior-design.js";
// ── Team 18: Fashion Design ──────────────────────────────────────────────
import fashionDesignRouter from "./fashion-design.js";
// ── Team 19: Packaging Design ────────────────────────────────────────────
import packagingDesignRouter from "./packaging-design.js";
// ── Team 22: Creative Vendor Ecosystem ───────────────────────────────────
import { vendorRouter } from "../domains/creative-vendors/index.js";
// ── Team 27: Branding & Identity Plugin ──────────────────────────────────
import brandingIdentityRouter from "../domains/branding-identity/routes.js";
// ── V5.0: Enterprise Template Knowledge Library ───────────────────────────
import templateKnowledgeRouter from "./template-knowledge.js";
import seedKnowledgeRouter from "./seedKnowledge.js";
// ── Two-Stage Image Preview Pipeline ─────────────────────────────────────
import imagePreviewPipelineRouter from "./image-preview-pipeline.js";
// ── Customs Tariff (BTKI) ─────────────────────────────────────────────────
import customsRouter from "./customs.js";
// ── DEV-ONLY: Payment test adapter (never active in production) ───────────
import devPaymentTestRouter from "./dev-payment-test.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(internalAuthRouter);
router.use(internalCatalogRouter);
router.use(agentsRouter);
router.use(registryRouter);
router.use(orchestratorRouter);
router.use(workflowsRouter);
router.use(promptsRouter);
router.use(knowledgeRouter);
router.use(memoryRouter);
router.use(auditRouter);
router.use(analyticsRouter);
router.use(settingsRouter);
router.use(creativeAiRouter);
router.use(imageBatchRouter);
router.use(capabilitiesRouter);
router.use(feedbackRouter);
router.use(clientMemoryRouter);
router.use(seedRouter);
router.use(testRunsRouter);
router.use(exportRouter);
router.use(clientReviewRouter);
router.use(workforceRouter);
router.use(operationsRouter);
router.use(jobsRouter);
router.use(dispatcherRouter);
router.use(clusterRouter);
router.use(workspaceHealthRouter);
router.use(eventsRouter);
router.use(schedulesRouter);
router.use(marketplaceRouter);
router.use(humanTasksRouter);
router.use(customerPortalRouter);
router.use(publicReviewRouter);
router.use(cpReviewRouter);
router.use(quotationsRouter);
router.use(catalogRouter);
router.use(commercialGatesRouter);
router.use(aiQuotationsRouter);
router.use(automationRouter);
router.use(paymentsRouter);
router.use(portfolioRouter);
router.use(portfolioPublicRouter);
router.use(portfolioBatchRouter);
router.use(filesRouter);
router.use(customerWorkspaceRouter);
router.use(brandKitEnterpriseRouter);
router.use(assetLibraryRouter);
router.use(zipDeliveryRouter);
router.use(brandIntelligenceRouter);
router.use(assetIntelligenceRouter);
router.use(templatesRouter);
router.use(templateEngineRouter);
router.use(portfolioGalleryRouter);
router.use(productionPipelineRouter);
router.use(customerWorkspaceSseRouter);
router.use(customerWorkspaceDocumentsRouter);
router.use(adminCustomerWorkspaceRouter);
router.use(salesFunnelRouter);
router.use(promotionsRouter);
router.use(couponsRouter);
router.use(referralsRouter);
router.use(affiliatesRouter);
router.use(customerHealthRouter);
router.use(commercialAnalyticsRouter);
router.use(observabilityRouter);
router.use(metricsRouter);
router.use(designStudioRouter);
router.use(designTemplatesRouter);
router.use(designTemplatesAiAssistRouter);
router.use(creativeMarketplaceRouter);

// ── Team 01: Creative Workflow V2 ─────────────────────────────────────────
router.use(creativeWorkflowPublicRouter);
router.use(creativeWorkflowV2Router);
// ── Team 02: Customer Creative Workspace Enhanced ─────────────────────────
router.use(customerCreativeWorkspaceRouter);
// ── Team 02: Goal Taxonomy (V4.2C) ────────────────────────────────────────
router.use(goalTaxonomyRouter);
// ── Team 03: Creative Commercial Automation ───────────────────────────────
router.use(creativeCommercialRouter);
// ── Team 04: Portfolio V2 — mount BEFORE any catch-all ───────────────────
router.use(galleryV2Router);
// ── Team 05: Brand Intelligence V2 ───────────────────────────────────────
router.use(brandIntelligenceV2Router);
// ── Team 06: Asset Intelligence V2 ───────────────────────────────────────
router.use(assetIntelligenceV2Router);
// ── Team 07: Design Blueprints ────────────────────────────────────────────
router.use(designBlueprintsRouter);
// ── Team 07: Domain Plugin Framework ─────────────────────────────────────
router.use(designPluginsRouter);
// ── Team 08: Design Components ───────────────────────────────────────────
// The router's paths are relative to /ai/design-components. Mounting it at
// the API root would let its generic GET /:id handler intercept unrelated
// endpoints such as /material-library.
router.use("/ai/design-components", designComponentsRouter);
// ── Team 09: Design Patterns ─────────────────────────────────────────────
// The router's paths are relative to /ai/design-patterns. Keep its generic
// GET /:id route from intercepting unrelated API endpoints.
router.use("/ai/design-patterns", designPatternsRouter);
// ── Team 09: Design Version History & Revision System ────────────────────
router.use(designVersioningRouter);
// ── Team 10: Design Tokens ───────────────────────────────────────────────
router.use(designTokensRouter);
// ── Team 11: Universal Template Matching ─────────────────────────────────
router.use(universalTemplateMatchingRouter);
// ── Team 12: Layout Composer ─────────────────────────────────────────────
router.use(layoutComposerRouter);
// ── Team 13: Dynamic Design Composer ─────────────────────────────────────
router.use(dynamicDesignComposerRouter);
// ── Team 14: Universal Renderer ──────────────────────────────────────────
router.use(universalRendererRouter);
// ── Team 16: Design Review and Approval Workspace ────────────────────────
router.use(reviewWorkspaceRouter);
// ── Team 15: Graphic Design Domain ───────────────────────────────────────
router.use(graphicDesignRouter);
// ── Team 17: Interior Design ─────────────────────────────────────────────
router.use(interiorDesignRouter);
// ── Team 18: Fashion Design ──────────────────────────────────────────────
router.use(fashionDesignRouter);
// ── Team 19: Packaging Design ────────────────────────────────────────────
router.use(packagingDesignRouter);
// ── Team 22: Creative Vendor Ecosystem — after portfolioGalleryRouter ─────
router.use(vendorRouter);
// ── Team 27: Branding & Identity Plugin ──────────────────────────────────
router.use(brandingIdentityRouter);
// ── V5.0: Enterprise Template Knowledge Library ───────────────────────────
router.use("/template-knowledge", templateKnowledgeRouter);
router.use("/seed", seedKnowledgeRouter);
// ── Two-Stage Image Preview Pipeline ─────────────────────────────────────
router.use(imagePreviewPipelineRouter);
// ── Customs Tariff (BTKI) ─────────────────────────────────────────────────
router.use(customsRouter);
router.use(cargoRatesRouter);
// ── Team 33: Universal Design Quality Assurance Engine ───────────────────────
router.use(designQualityRouter);
// ── Team 04: Service Normalization & Solution Collections ─────────────────────
router.use(serviceNormalizationRouter);
// ── Team 05: Discovery Analytics & Feature Flags ──────────────────────────────
router.use(discoveryAnalyticsRouter);
// ── Team 10: Universal Design API Contracts & Orchestration Boundary ──────────
router.use(universalDesignRouter);
// ── Team 14: Universal Asset Browser ──────────────────────────────────────────
router.use(assetBrowserRouter);
// ── Team 18: Universal Annotation and Comment System ─────────────────────────
router.use(annotationRouter);
// ── Team 21: Universal Material Library ───────────────────────────────────────
router.use(materialLibraryRouter);
// ── Interior Design Material Library (Phase 1) ────────────────────────────────
// Mount Phase 2 before Phase 1's generic /material-library/:id route so
// /suggestions and /:id/similar are resolved by the owning domain.
router.use(materialIntelligenceRouter);
router.use(materialLibraryCatalogRouter);
// ── Team 23: Design Knowledge & Recommendation Adapter ────────────────────────
router.use(designKnowledgeRouter);
// ── Team 17 / Team 34: Universal Design Export Workspace ─────────────────────
router.use(exportWorkspaceRouter);
// ── Team 34: Design Cost, Usage, and Budget Attribution ───────────────────────
router.use(designCostAttributionRouter);
// ── Team 35: Design Observability & Operations ────────────────────────────────
router.use(designObservabilityOpsRouter);

// ── DEV-ONLY: Payment test adapter ───────────────────────────────────────────
// Never mounted in production. Requires explicit DEV_PAYMENT_TEST_ENABLED=true
// in addition to NODE_ENV !== "production" (double guard against accidental use).
if (process.env["NODE_ENV"] !== "production") {
  router.use(devPaymentTestRouter);
}

export default router;
