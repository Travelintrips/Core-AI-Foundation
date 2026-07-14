# Backend — Company Profile Mapper Expansion

## Target files
1. `artifacts/api-server/src/services/companyProfileDocumentMapper.ts` (521 lines)
2. `artifacts/api-server/src/services/mappers/companyProfileMapperAdapter.ts` (71 lines)

## Goal
1. Expand CompanyProfileBrief with 20 new fields
2. Expand CompanyProfileContent with 7 new fields
3. Update LLM prompt to include new fields + stronger anti-fabrication rules
4. Add 7 missing document sections (history, geographic coverage, how we work/QA, key people, org structure, project experience, clients/partners, sustainability)
5. Add package page limit enforcement (STARTER≤8, PROFESSIONAL≤16, BUSINESS≤24)
6. Add QC scoring function export
7. Update the adapter (companyProfileMapperAdapter.ts) to extract new brief fields

---

## Part 1 — Expand CompanyProfileBrief interface

Replace the current interface (lines ~58-67) with:

```ts
export interface CompanyProfileBrief {
  brandName:              string;
  businessType:           string;
  targetMarket:           string;
  productOrService:       string;
  goal:                   string;
  notes?:                 string | null;
  colorPreference?:       string | null;
  stylePreference?:       string | null;
  // Extended fields from cp-detail step
  legalName?:             string | null;
  yearEstablished?:       string | null;
  companyHistory?:        string | null;
  visionStatement?:       string | null;
  missionStatement?:      string | null;
  companyValues?:         string | null;  // newline-separated
  geographicCoverage?:    string | null;
  facilities?:            string | null;
  productionCapacity?:    string | null;
  certifications?:        string | null;  // newline-separated
  organizationStructure?: string | null;
  keyPeople?:             string | null;  // "Name — Role" per line
  clientsPartners?:       string | null;  // newline-separated
  projectExperience?:     string | null;
  qualityAssurance?:      string | null;
  sustainability?:        string | null;
  industryDetail?:        string | null;
  contactEmail?:          string | null;
  contactPhone?:          string | null;
  contactAddress?:        string | null;
  documentLanguage?:      string | null;
  pageTarget?:            string | null;
  packageType?:           string | null;  // starter | professional | business | enterprise
}
```

## Part 2 — Expand CompanyProfileContent interface

Add these fields to the existing CompanyProfileContent interface:

```ts
  companyHistory:         string;
  geographicCoverage:     string;
  keyPeople:              Array<{ name: string; role: string }>;
  projectExperience:      Array<{ description: string }>;
  qualityAssurance:       string;
  sustainability:         string;
  organizationStructure:  string;
```

## Part 3 — Update LLM system prompt

Add to the "Critical rules" section in COMPANY_PROFILE_SYSTEM_PROMPT:
- If the customer provided their own vision/mission, use them VERBATIM — do not rephrase
- companyHistory must ONLY use years, names, and facts explicitly given — never invent milestones
- keyPeople must ONLY list people explicitly named in the brief
- projectExperience must ONLY describe projects explicitly mentioned — no invented projects
- Leave all new fields as empty string or empty array if no data is provided

## Part 4 — Update LLM prompt builder

In buildCompanyProfilePrompt, after the existing BUSINESS BRIEF section, add:

```
${brief.legalName        ? `- Legal Name: ${brief.legalName}` : ""}
${brief.yearEstablished  ? `- Year Established: ${brief.yearEstablished}` : ""}
${brief.companyHistory   ? `- Company History: ${brief.companyHistory}` : ""}
${brief.visionStatement  ? `- Vision (use verbatim): ${brief.visionStatement}` : ""}
${brief.missionStatement ? `- Mission (use verbatim): ${brief.missionStatement}` : ""}
${brief.companyValues    ? `- Company Values: ${brief.companyValues}` : ""}
${brief.geographicCoverage ? `- Geographic Coverage: ${brief.geographicCoverage}` : ""}
${brief.facilities       ? `- Facilities: ${brief.facilities}` : ""}
${brief.productionCapacity ? `- Production Capacity: ${brief.productionCapacity}` : ""}
${brief.certifications   ? `- Certifications: ${brief.certifications}` : ""}
${brief.keyPeople        ? `- Key People (list verbatim): ${brief.keyPeople}` : ""}
${brief.clientsPartners  ? `- Clients & Partners: ${brief.clientsPartners}` : ""}
${brief.projectExperience ? `- Notable Projects: ${brief.projectExperience}` : ""}
${brief.qualityAssurance ? `- Quality Assurance: ${brief.qualityAssurance}` : ""}
${brief.sustainability   ? `- Sustainability/CSR: ${brief.sustainability}` : ""}
${brief.industryDetail   ? `- Industry Specifics: ${brief.industryDetail}` : ""}
${brief.contactEmail     ? `- Contact Email: ${brief.contactEmail}` : ""}
${brief.contactPhone     ? `- Contact Phone: ${brief.contactPhone}` : ""}
${brief.contactAddress   ? `- Address: ${brief.contactAddress}` : ""}
```

Also extend the JSON schema in the prompt to add the new fields to the return object:
```json
"companyHistory": "company history narrative (ONLY from provided data; empty string if none)",
"geographicCoverage": "geographic coverage narrative (ONLY from provided data; empty string if none)",
"keyPeople": [{ "name": "exact name from brief", "role": "exact title from brief" }],
"projectExperience": [{ "description": "project description from brief only" }],
"qualityAssurance": "quality assurance description (from brief only; empty if none)",
"sustainability": "sustainability/CSR description (from brief only; empty if none)",
"organizationStructure": "org structure description (from brief only; empty if none)"
```

## Part 5 — Update safe defaults in generateCompanyProfileContent

After the existing `contactInfo` defaults block, add:

```ts
companyHistory:         typeof parsed.companyHistory === "string" ? parsed.companyHistory : "",
geographicCoverage:     typeof parsed.geographicCoverage === "string" ? parsed.geographicCoverage : "",
keyPeople:              Array.isArray(parsed.keyPeople) ? parsed.keyPeople.filter(isKeyPerson) : [],
projectExperience:      Array.isArray(parsed.projectExperience) ? parsed.projectExperience.filter(isProjectExp) : [],
qualityAssurance:       typeof parsed.qualityAssurance === "string" ? parsed.qualityAssurance : "",
sustainability:         typeof parsed.sustainability === "string" ? parsed.sustainability : "",
organizationStructure:  typeof parsed.organizationStructure === "string" ? parsed.organizationStructure : "",
```

Add type guards after the existing `isMilestone` guard:

```ts
function isKeyPerson(v: unknown): v is { name: string; role: string } {
  return !!v && typeof v === "object" &&
    typeof (v as Record<string, unknown>)["name"] === "string" &&
    typeof (v as Record<string, unknown>)["role"] === "string" &&
    ((v as Record<string, unknown>)["name"] as string).trim().length > 0;
}
function isProjectExp(v: unknown): v is { description: string } {
  return !!v && typeof v === "object" &&
    typeof (v as Record<string, unknown>)["description"] === "string" &&
    ((v as Record<string, unknown>)["description"] as string).trim().length > 0;
}
```

Also update maxTokens in the executeAI call from 2000 to 3000 (more content to generate).

## Part 6 — Add 7 missing sections to mapCompanyProfileToDocumentSpec

### 6a — Company History (insert AFTER "About" block, BEFORE "Vision & Mission")
```ts
// ── Company History ────────────────────────────────────────────────────────
const historyText = content.companyHistory.trim() || brief.companyHistory?.trim() || "";
if (historyText) {
  include(
    "company-history",
    { type: "heading", title: "Company History" },
    { type: "paragraph", text: historyText },
  );
} else {
  skip("company-history", "No company history data provided");
}
```

### 6b — Geographic Coverage (insert AFTER "Industries / Target Market")
```ts
// ── Geographic Coverage ────────────────────────────────────────────────────
const coverageText = content.geographicCoverage.trim() || brief.geographicCoverage?.trim() || "";
if (coverageText) {
  include(
    "geographic-coverage",
    { type: "heading", title: "Market & Geographic Coverage" },
    { type: "paragraph", text: coverageText },
  );
} else {
  skip("geographic-coverage", "No geographic coverage data");
}
```

### 6c — Quality Assurance / How We Work (insert AFTER "Operational Capabilities")
```ts
// ── Quality Assurance / How We Work ───────────────────────────────────────
const qaText = content.qualityAssurance.trim() || brief.qualityAssurance?.trim() || "";
if (qaText) {
  include(
    "quality-assurance",
    { type: "heading", title: "Quality Assurance" },
    { type: "paragraph", text: qaText },
  );
} else {
  skip("quality-assurance", "No quality assurance data");
}
```

### 6d — Organization Structure (insert AFTER "Team")
```ts
// ── Organization Structure ─────────────────────────────────────────────────
const orgText = content.organizationStructure.trim() || brief.organizationStructure?.trim() || "";
if (orgText) {
  include(
    "org-structure",
    { type: "heading", title: "Organization Structure" },
    { type: "paragraph", text: orgText },
  );
} else {
  skip("org-structure", "No organization structure data");
}
```

### 6e — Key People (insert AFTER "Organization Structure")
```ts
// ── Key People ─────────────────────────────────────────────────────────────
if (content.keyPeople.length > 0) {
  const kpRows = content.keyPeople.map((p) => [p.name, p.role]);
  include(
    "key-people",
    { type: "heading", title: "Leadership Team" },
    { type: "table", headers: ["Name", "Position"], rows: kpRows },
  );
} else if (brief.keyPeople?.trim()) {
  include(
    "key-people",
    { type: "heading", title: "Leadership Team" },
    { type: "paragraph", text: brief.keyPeople },
  );
} else {
  skip("key-people", "No key people data");
}
```

### 6f — Clients & Partners (insert AFTER "Certifications")
```ts
// ── Clients & Partners ─────────────────────────────────────────────────────
const cpRaw = brief.clientsPartners?.trim() ?? "";
if (cpRaw) {
  const cpItems = cpRaw.split("\n").map((s) => s.trim()).filter(Boolean);
  include(
    "clients-partners",
    { type: "heading", title: "Clients & Partners" },
    { type: "bullets", items: cpItems },
  );
} else {
  skip("clients-partners", "No clients/partners data");
}
```

### 6g — Project Experience / Track Record (insert AFTER "Clients & Partners")
```ts
// ── Project Experience ─────────────────────────────────────────────────────
if (content.projectExperience.length > 0) {
  include(
    "project-experience",
    { type: "heading", title: "Project Experience & Track Record" },
    { type: "bullets", items: content.projectExperience.map((p) => p.description) },
  );
} else if (brief.projectExperience?.trim()) {
  include(
    "project-experience",
    { type: "heading", title: "Project Experience & Track Record" },
    { type: "paragraph", text: brief.projectExperience },
  );
} else {
  skip("project-experience", "No project experience data");
}
```

### 6h — Sustainability (insert AFTER "Contact")
```ts
// ── Sustainability / CSR ───────────────────────────────────────────────────
const sustText = content.sustainability.trim() || brief.sustainability?.trim() || "";
if (sustText) {
  include(
    "sustainability",
    { type: "heading", title: "Sustainability & CSR" },
    { type: "paragraph", text: sustText },
  );
} else {
  skip("sustainability", "No sustainability data");
}
```

## Part 7 — Package page limit enforcement

At the END of mapCompanyProfileToDocumentSpec, BEFORE building the spec object, add:

```ts
// ── Package page limits ────────────────────────────────────────────────────
const PAGE_LIMITS: Record<string, number> = {
  starter:      8,
  professional: 16,
  business:     24,
};
const pkgKey = (brief.packageType ?? "").toLowerCase();
const pageLimit = PAGE_LIMITS[pkgKey];
if (pageLimit !== undefined) {
  // Rough estimate: every 2 sections ≈ 1 page (cover + closing are separate)
  const maxSections = Math.max(4, pageLimit * 2);
  if (sections.length > maxSections) {
    // Trim from the end (lower-priority optional sections added last)
    const dropped = sections.splice(maxSections);
    skipped.push({
      sectionId: "page-limit-trim",
      included:  false,
      reason:    `${dropped.length} sections trimmed: ${pkgKey} package allows ~${pageLimit} pages`,
    });
  }
}
```

## Part 8 — Add QC scoring function

Add this EXPORT at the very end of the mapper file:

```ts
// ── QC Scoring ────────────────────────────────────────────────────────────────

export interface CompanyProfileQcResult {
  score: number;    // 0-100
  pass:  boolean;   // score >= 80
  checks: Array<{ id: string; label: string; passed: boolean; weight: number }>;
}

export function scoreCompanyProfileQc(
  content: CompanyProfileContent,
  brief:   CompanyProfileBrief,
  report:  MappingGenerationReport,
): CompanyProfileQcResult {
  const checks: Array<{ id: string; label: string; passed: boolean; weight: number }> = [
    {
      id: "has-about", label: "About section present",
      passed: content.about.trim().length > 20,
      weight: 15,
    },
    {
      id: "has-vision-or-mission", label: "Vision or mission present",
      passed: content.vision.trim().length > 0 || content.mission.trim().length > 0,
      weight: 10,
    },
    {
      id: "has-services", label: "Services/Products described",
      passed: content.servicesOrProducts.length > 0 || brief.productOrService.trim().length > 0,
      weight: 15,
    },
    {
      id: "has-contact", label: "At least one contact info item",
      passed: [
        content.contactInfo.email, content.contactInfo.phone,
        content.contactInfo.website, content.contactInfo.address,
      ].some((s) => s.trim().length > 0),
      weight: 10,
    },
    {
      id: "no-lorem-ipsum", label: "No Lorem ipsum placeholders",
      passed: !/lorem ipsum/i.test(
        content.about + content.vision + content.mission + content.operationalCapabilities,
      ),
      weight: 15,
    },
    {
      id: "no-placeholders", label: "No unfilled placeholders",
      passed: !/\[[\w\s]+\]|\{[\w\s]+\}/.test(
        content.about + content.vision + content.mission,
      ),
      weight: 10,
    },
    {
      id: "has-values-or-advantages", label: "Values or advantages present",
      passed: content.coreValues.length >= 1 || content.competitiveAdvantages.length >= 1,
      weight: 5,
    },
    {
      id: "enough-sections", label: "5+ sections generated",
      passed: report.sectionsIncluded.length >= 5,
      weight: 10,
    },
    {
      id: "has-closing", label: "Closing statement present",
      passed: content.closing.trim().length > 0,
      weight: 5,
    },
    {
      id: "brand-name-used", label: "Brand name appears in content",
      passed: content.about.includes(brief.brandName) ||
              content.tagline.includes(brief.brandName) ||
              content.about.length === 0,
      weight: 5,
    },
  ];

  const totalWeight  = checks.reduce((s, c) => s + c.weight, 0);
  const earnedWeight = checks.filter((c) => c.passed).reduce((s, c) => s + c.weight, 0);
  const score        = Math.round((earnedWeight / totalWeight) * 100);

  return { score, pass: score >= 80, checks };
}
```

## Part 9 — Update companyProfileMapperAdapter.ts

Replace the buildBrief function to extract new fields from briefJson.
First check what fields CreativeProject has by reading the DB package types.

```ts
function buildBrief(project: CreativeProject): CompanyProfileBrief {
  // briefJson contains the full BriefData from the customer portal brief wizard
  const bj = (
    (project as Record<string, unknown>)["briefJson"] ??
    (project as Record<string, unknown>)["brief_json"] ??
    {}
  ) as Record<string, unknown>;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  return {
    brandName:             project.brandName,
    businessType:          project.businessType,
    targetMarket:          project.targetMarket,
    productOrService:      project.productOrService,
    goal:                  project.goal,
    notes:                 project.notes,
    colorPreference:       project.colorPreference,
    stylePreference:       project.stylePreference,
    // Extended from brief form
    legalName:             str(bj["cpLegalName"]),
    yearEstablished:       str(bj["cpYearEstablished"]),
    companyHistory:        str(bj["cpCompanyHistory"]),
    visionStatement:       str(bj["cpVision"]),
    missionStatement:      str(bj["cpMission"]),
    companyValues:         str(bj["cpValues"]),
    geographicCoverage:    str(bj["cpGeographicCoverage"]),
    facilities:            str(bj["cpFacilities"]),
    productionCapacity:    str(bj["cpProductionCapacity"]),
    certifications:        str(bj["cpCertifications"]),
    organizationStructure: str(bj["cpOrganizationStructure"]),
    keyPeople:             str(bj["cpKeyPeople"]),
    clientsPartners:       str(bj["cpClientsPartners"]),
    projectExperience:     str(bj["cpProjectExperience"]),
    qualityAssurance:      str(bj["cpQualityAssurance"]),
    sustainability:        str(bj["cpSustainability"]),
    industryDetail:        str(bj["cpIndustryDetail"]),
    contactEmail:          str(bj["cpContactEmail"]),
    contactPhone:          str(bj["cpContactPhone"]),
    contactAddress:        str(bj["cpContactAddress"]),
    documentLanguage:      str(bj["outputLanguage"]),
    pageTarget:            str(bj["outputFormats"]),
    packageType:           str((project as Record<string, unknown>)["packageType"]),
  };
}
```

If CreativeProject does NOT have a `briefJson` field (check the actual type), just leave those
fields as null and add a TODO comment.

## Final instructions
1. Read both files fully before editing
2. Run after editing: `cd artifacts/api-server && pnpm tsc --noEmit 2>&1 | head -40`
3. Fix all TypeScript errors — especially the new fields not yet on CompanyProfileContent's
   defaults object (they must ALL be in the safe-defaults block)
4. Do NOT remove or rename any existing exports
