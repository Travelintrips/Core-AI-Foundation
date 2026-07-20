/**
 * serviceNormalizationRepository.ts — Team 04
 *
 * All database access for:
 *   - service_canonical_concepts
 *   - service_normalization_mappings
 *   - service_aliases
 *   - solution_collections
 *   - solution_collection_services
 *
 * Rules:
 *   - No raw queries inside route handlers; all DB access goes through here.
 *   - Multi-step writes use db.transaction().
 *   - Never silently fall back from a transaction client to the global db client.
 *   - Uses ai_services and ai_service_categories from @workspace/db for
 *     commercial eligibility joins (Team 01 policy: status='active',
 *     visibility='public', commercial_status='commercial_ready').
 */

import { eq, and, asc, inArray } from "drizzle-orm";
import {
  db,
  aiServicesTable,
  aiServiceCategoriesTable,
  serviceCanonicalConceptsTable,
  serviceNormalizationMappingsTable,
  serviceAliasesTable,
  solutionCollectionsTable,
  solutionCollectionServicesTable,
  type ServiceCanonicalConcept,
  type ServiceNormalizationMapping,
  type ServiceAlias,
  type SolutionCollection,
  type SolutionCollectionService,
  type InsertServiceCanonicalConcept,
  type InsertServiceNormalizationMapping,
  type InsertServiceAlias,
  type InsertSolutionCollection,
  type InsertSolutionCollectionService,
} from "@workspace/db";

// ── Canonical Concepts ────────────────────────────────────────────────────────

export async function createCanonicalConcept(
  data: InsertServiceCanonicalConcept,
): Promise<ServiceCanonicalConcept> {
  const [row] = await db
    .insert(serviceCanonicalConceptsTable)
    .values(data)
    .returning();
  return row!;
}

export async function getCanonicalConceptById(
  id: number,
): Promise<ServiceCanonicalConcept | null> {
  const [row] = await db
    .select()
    .from(serviceCanonicalConceptsTable)
    .where(eq(serviceCanonicalConceptsTable.id, id))
    .limit(1);
  return row ?? null;
}

export async function getCanonicalConceptByCode(
  code: string,
): Promise<ServiceCanonicalConcept | null> {
  const [row] = await db
    .select()
    .from(serviceCanonicalConceptsTable)
    .where(eq(serviceCanonicalConceptsTable.code, code))
    .limit(1);
  return row ?? null;
}

export async function getCanonicalConceptBySlug(
  slug: string,
): Promise<ServiceCanonicalConcept | null> {
  const [row] = await db
    .select()
    .from(serviceCanonicalConceptsTable)
    .where(eq(serviceCanonicalConceptsTable.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function listCanonicalConcepts(opts: {
  status?: string;
}): Promise<ServiceCanonicalConcept[]> {
  if (opts.status) {
    return db
      .select()
      .from(serviceCanonicalConceptsTable)
      .where(eq(serviceCanonicalConceptsTable.status, opts.status))
      .orderBy(asc(serviceCanonicalConceptsTable.displayOrder), asc(serviceCanonicalConceptsTable.id));
  }
  return db
    .select()
    .from(serviceCanonicalConceptsTable)
    .orderBy(asc(serviceCanonicalConceptsTable.displayOrder), asc(serviceCanonicalConceptsTable.id));
}

export async function updateCanonicalConcept(
  id: number,
  data: Partial<Omit<InsertServiceCanonicalConcept, "code">>,
): Promise<ServiceCanonicalConcept | null> {
  const [row] = await db
    .update(serviceCanonicalConceptsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(serviceCanonicalConceptsTable.id, id))
    .returning();
  return row ?? null;
}

// ── Normalization Mappings ────────────────────────────────────────────────────

export async function createMapping(
  data: InsertServiceNormalizationMapping,
): Promise<ServiceNormalizationMapping> {
  const [row] = await db
    .insert(serviceNormalizationMappingsTable)
    .values(data)
    .returning();
  return row!;
}

export async function getMappingByServiceId(
  serviceId: number,
): Promise<ServiceNormalizationMapping | null> {
  const [row] = await db
    .select()
    .from(serviceNormalizationMappingsTable)
    .where(eq(serviceNormalizationMappingsTable.serviceId, serviceId))
    .limit(1);
  return row ?? null;
}

export async function listMappingsByConceptId(
  canonicalConceptId: number,
): Promise<ServiceNormalizationMapping[]> {
  return db
    .select()
    .from(serviceNormalizationMappingsTable)
    .where(eq(serviceNormalizationMappingsTable.canonicalConceptId, canonicalConceptId))
    .orderBy(asc(serviceNormalizationMappingsTable.id));
}

export async function getPrimaryMappingForConcept(
  canonicalConceptId: number,
): Promise<ServiceNormalizationMapping | null> {
  const [row] = await db
    .select()
    .from(serviceNormalizationMappingsTable)
    .where(
      and(
        eq(serviceNormalizationMappingsTable.canonicalConceptId, canonicalConceptId),
        eq(serviceNormalizationMappingsTable.isPrimary, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function deleteMappingByServiceId(
  canonicalConceptId: number,
  serviceId: number,
): Promise<boolean> {
  const result = await db
    .delete(serviceNormalizationMappingsTable)
    .where(
      and(
        eq(serviceNormalizationMappingsTable.canonicalConceptId, canonicalConceptId),
        eq(serviceNormalizationMappingsTable.serviceId, serviceId),
      ),
    )
    .returning({ id: serviceNormalizationMappingsTable.id });
  return result.length > 0;
}

// ── Service Aliases ───────────────────────────────────────────────────────────

export async function createAlias(data: InsertServiceAlias): Promise<ServiceAlias> {
  const [row] = await db
    .insert(serviceAliasesTable)
    .values(data)
    .returning();
  return row!;
}

export async function getAliasByNormalized(
  canonicalConceptId: number,
  normalizedAlias: string,
): Promise<ServiceAlias | null> {
  const [row] = await db
    .select()
    .from(serviceAliasesTable)
    .where(
      and(
        eq(serviceAliasesTable.canonicalConceptId, canonicalConceptId),
        eq(serviceAliasesTable.normalizedAlias, normalizedAlias),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listAliasesByConceptId(
  canonicalConceptId: number,
): Promise<ServiceAlias[]> {
  return db
    .select()
    .from(serviceAliasesTable)
    .where(eq(serviceAliasesTable.canonicalConceptId, canonicalConceptId))
    .orderBy(asc(serviceAliasesTable.id));
}

// ── Solution Collections ──────────────────────────────────────────────────────

export async function createCollection(data: InsertSolutionCollection): Promise<SolutionCollection> {
  const [row] = await db
    .insert(solutionCollectionsTable)
    .values(data)
    .returning();
  return row!;
}

export async function getCollectionBySlug(slug: string): Promise<SolutionCollection | null> {
  const [row] = await db
    .select()
    .from(solutionCollectionsTable)
    .where(eq(solutionCollectionsTable.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function listCollections(opts: {
  status?: string;
  visibility?: string;
}): Promise<SolutionCollection[]> {
  const conditions = [];
  if (opts.status) conditions.push(eq(solutionCollectionsTable.status, opts.status));
  if (opts.visibility) conditions.push(eq(solutionCollectionsTable.visibility, opts.visibility));

  const q = db
    .select()
    .from(solutionCollectionsTable)
    .orderBy(asc(solutionCollectionsTable.displayOrder), asc(solutionCollectionsTable.id));

  if (conditions.length > 0) {
    return q.where(and(...conditions));
  }
  return q;
}

export async function updateCollection(
  id: number,
  data: Partial<Omit<InsertSolutionCollection, "code">>,
): Promise<SolutionCollection | null> {
  const [row] = await db
    .update(solutionCollectionsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(solutionCollectionsTable.id, id))
    .returning();
  return row ?? null;
}

// ── Collection Memberships ────────────────────────────────────────────────────

export async function addServiceToCollection(
  data: InsertSolutionCollectionService,
): Promise<SolutionCollectionService> {
  const [row] = await db
    .insert(solutionCollectionServicesTable)
    .values(data)
    .returning();
  return row!;
}

export async function getCollectionMembership(
  collectionId: number,
  serviceId: number,
): Promise<SolutionCollectionService | null> {
  const [row] = await db
    .select()
    .from(solutionCollectionServicesTable)
    .where(
      and(
        eq(solutionCollectionServicesTable.collectionId, collectionId),
        eq(solutionCollectionServicesTable.serviceId, serviceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function removeServiceFromCollection(
  collectionId: number,
  serviceId: number,
): Promise<boolean> {
  const result = await db
    .delete(solutionCollectionServicesTable)
    .where(
      and(
        eq(solutionCollectionServicesTable.collectionId, collectionId),
        eq(solutionCollectionServicesTable.serviceId, serviceId),
      ),
    )
    .returning({ id: solutionCollectionServicesTable.id });
  return result.length > 0;
}

/**
 * Returns collection members that pass Team 01 commercial eligibility:
 *   s.status = 'active' AND c.visibility = 'public' AND c.commercial_status = 'commercial_ready' AND c.status = 'active'
 *
 * Blocked or internal services are silently excluded from the public result.
 */
export async function listEligibleServicesForCollection(collectionId: number) {
  const memberships = await db
    .select()
    .from(solutionCollectionServicesTable)
    .where(eq(solutionCollectionServicesTable.collectionId, collectionId))
    .orderBy(asc(solutionCollectionServicesTable.displayOrder), asc(solutionCollectionServicesTable.id));

  if (memberships.length === 0) return [];

  const serviceIds = memberships.map((m) => m.serviceId);

  // ── Team 1 commercial eligibility policy (reused, not duplicated) ──
  // A service is publicly eligible when:
  //   1. its own status = 'active'
  //   2. its category visibility = 'public'
  //   3. its category commercial_status = 'commercial_ready'
  //   4. its category status = 'active'
  const eligibleServices = await db
    .select({
      id: aiServicesTable.id,
      serviceCode: aiServicesTable.serviceCode,
      serviceName: aiServicesTable.serviceName,
      shortDescription: aiServicesTable.shortDescription,
      serviceType: aiServicesTable.serviceType,
      serviceFlow: aiServicesTable.serviceFlow,
      startingPrice: aiServicesTable.startingPrice,
      currency: aiServicesTable.currency,
      estimatedDelivery: aiServicesTable.estimatedDelivery,
      deliverables: aiServicesTable.deliverables,
      categoryId: aiServiceCategoriesTable.id,
      categoryName: aiServiceCategoriesTable.name,
    })
    .from(aiServicesTable)
    .innerJoin(aiServiceCategoriesTable, eq(aiServicesTable.categoryId, aiServiceCategoriesTable.id))
    .where(
      and(
        inArray(aiServicesTable.id, serviceIds),
        eq(aiServicesTable.status, "active"),
        eq(aiServiceCategoriesTable.visibility, "public"),
        eq(aiServiceCategoriesTable.commercialStatus, "commercial_ready"),
        eq(aiServiceCategoriesTable.status, "active"),
      ),
    );

  const eligibleById = new Map(eligibleServices.map((s) => [s.id, s]));

  const result = [];
  for (const membership of memberships) {
    const svc = eligibleById.get(membership.serviceId);
    if (!svc) continue; // ineligible — omit from public response
    result.push({
      membership,
      serviceId: svc.id,
      serviceCode: svc.serviceCode,
      serviceName: svc.serviceName,
      shortDescription: svc.shortDescription,
      serviceType: svc.serviceType,
      serviceFlow: svc.serviceFlow,
      startingPrice: svc.startingPrice,
      currency: svc.currency,
      estimatedDelivery: svc.estimatedDelivery,
      deliverables: svc.deliverables as string[] | null,
      categoryId: svc.categoryId,
      categoryName: svc.categoryName,
    });
  }
  return result;
}
