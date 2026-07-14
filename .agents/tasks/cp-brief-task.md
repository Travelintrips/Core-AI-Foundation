# Brief Wizard — Company Profile Expansion

## Target file
`artifacts/customer-portal/src/pages/brief.tsx` (1423 lines)

## Goal
Add company-profile-specific fields and an extra "Company Details" step that appears
ONLY when serviceType === "company_profile". All changes must be additive and
backward-compatible with other service types.

---

## Change 1 — Extend BriefData type

In the BriefData type definition (around line 37), add these optional fields at the end,
inside the type block (before the closing `}`):

```ts
  // Company Profile — only populated when serviceType === "company_profile"
  cpLegalName:             string;
  cpYearEstablished:       string;
  cpCompanyHistory:        string;
  cpVision:                string;
  cpMission:               string;
  cpValues:                string;   // newline-separated
  cpGeographicCoverage:    string;
  cpFacilities:            string;
  cpProductionCapacity:    string;
  cpCertifications:        string;   // newline-separated
  cpOrganizationStructure: string;
  cpKeyPeople:             string;   // "Name — Title" per line
  cpClientsPartners:       string;   // newline-separated
  cpProjectExperience:     string;
  cpQualityAssurance:      string;
  cpSustainability:        string;
  cpIndustryDetail:        string;   // logistics/trading/manufacturing details
  cpContactEmail:          string;
  cpContactPhone:          string;
  cpContactAddress:        string;
```

## Change 2 — Add defaults in EMPTY_BRIEF

Add empty-string defaults for all 19 new fields in the EMPTY_BRIEF object.

## Change 3 — Compute dynamic steps

After the STEPS array and TOTAL_STEPS constant (around line 92), add:

```ts
// Company Profile inserts an extra "Company Details" step at position 2
const CP_STEP_META = {
  id: 2,
  title: "Detail Perusahaan",
  description: "Informasi lengkap untuk profil perusahaan Anda.",
  icon: Building2,
};
```

Then INSIDE the BriefPage component, after serviceType/serviceConfig are computed
(around line 157), add:

```ts
const isCompanyProfile = serviceType === "company_profile";

// activeSteps: insert CP step between Business Info (1) and Goals (2) for company_profile
const activeSteps = isCompanyProfile
  ? [STEPS[0]!, CP_STEP_META, ...STEPS.slice(1)]
  : STEPS;
const totalSteps = activeSteps.length;

// Map raw currentStep → content key for step rendering
// company_profile: 1→business 2→cp-detail 3→goals 4→audience 5→visual 6→deliverables 7→timeline 8→review
// other:           1→business 2→goals     3→audience 4→visual  5→deliverables 6→timeline 7→review
const CP_KEYS   = ["business","cp-detail","goals","audience","visual","deliverables","timeline","review"] as const;
const BASE_KEYS = ["business","goals","audience","visual","deliverables","timeline","review"] as const;
type ContentKey = typeof CP_KEYS[number];
const contentKey: ContentKey = isCompanyProfile
  ? (CP_KEYS[currentStep - 1] ?? "review")
  : (BASE_KEYS[currentStep - 1] ?? "review");
const isReview = contentKey === "review";
```

## Change 4 — Update references to TOTAL_STEPS and stepInfo

Replace `const TOTAL_STEPS = STEPS.length;` (the original) with the `totalSteps` computed above.
Update every reference to `TOTAL_STEPS` to use `totalSteps`.
Update `const stepInfo = STEPS[currentStep - 1]` to `const stepInfo = activeSteps[currentStep - 1]!`.
Update `<ProgressStepper steps={STEPS}` to `<ProgressStepper steps={activeSteps}`.
Update `estimatedMinutes={5}` to `estimatedMinutes={isCompanyProfile ? 8 : 5}`.

## Change 5 — Re-key ALL step render conditions

Replace every `currentStep === N` render condition with `contentKey === "X"`:

| Old                   | New                              |
|-----------------------|----------------------------------|
| currentStep === 1     | contentKey === "business"        |
| currentStep === 2     | contentKey === "goals"           |
| currentStep === 3     | contentKey === "audience"        |
| currentStep === 4     | contentKey === "visual"          |
| currentStep === 5     | contentKey === "deliverables"    |
| currentStep === 6     | contentKey === "timeline"        |
| currentStep === 7     | contentKey === "review"          |

Also fix the `isReview` variable — it's likely `currentStep === TOTAL_STEPS` somewhere;
replace with `contentKey === "review"`.

## Change 6 — Add Company Details step rendering

After the closing `)}` of the Step 1 (business) block, insert this new block:

```tsx
{/* ── Company Profile Details step ─────────────────────────────── */}
{contentKey === "cp-detail" && (
  <div className="space-y-6">

    {/* Identity */}
    <SectionCard icon={Building2} title="Identitas Perusahaan" description="Data resmi perusahaan Anda.">
      <FieldItem id="cpLegalName" label="Nama resmi / legal perusahaan" optional hint="Sesuai akta atau dokumen legal">
        <input id="brief-cpLegalName" className="input-field" value={brief.cpLegalName}
          onChange={(e) => handleChange("cpLegalName", e.target.value)}
          placeholder="PT. Nama Perusahaan Indonesia" />
      </FieldItem>
      <FieldItem id="cpYearEstablished" label="Tahun berdiri" optional>
        <input id="brief-cpYearEstablished" className="input-field" value={brief.cpYearEstablished}
          onChange={(e) => handleChange("cpYearEstablished", e.target.value)}
          placeholder="Contoh: 2010" inputMode="numeric" maxLength={4} />
      </FieldItem>
      <FieldItem id="cpCompanyHistory" label="Sejarah & latar belakang perusahaan" optional
        hint="Bagaimana bisnis ini bermula, pencapaian besar, perjalanan hingga saat ini">
        <textarea id="brief-cpCompanyHistory" className="input-field min-h-[100px]"
          value={brief.cpCompanyHistory}
          onChange={(e) => handleChange("cpCompanyHistory", e.target.value)}
          placeholder="Perusahaan kami berdiri pada tahun... Bermula dari..." />
      </FieldItem>
    </SectionCard>

    {/* Vision, Mission, Values */}
    <SectionCard icon={Target} title="Visi, Misi & Nilai" description="Dasar filosofi dan budaya perusahaan Anda.">
      <FieldItem id="cpVision" label="Pernyataan visi" optional hint="Ke mana arah jangka panjang perusahaan Anda?">
        <textarea id="brief-cpVision" className="input-field min-h-[80px]"
          value={brief.cpVision}
          onChange={(e) => handleChange("cpVision", e.target.value)}
          placeholder="Menjadi perusahaan logistik terpercaya di Asia Tenggara..." />
      </FieldItem>
      <FieldItem id="cpMission" label="Pernyataan misi" optional hint="Bagaimana Anda mewujudkan visi tersebut?">
        <textarea id="brief-cpMission" className="input-field min-h-[80px]"
          value={brief.cpMission}
          onChange={(e) => handleChange("cpMission", e.target.value)}
          placeholder="Kami menghadirkan solusi logistik terintegrasi dengan teknologi..." />
      </FieldItem>
      <FieldItem id="cpValues" label="Nilai-nilai perusahaan" optional hint="Satu nilai per baris">
        <textarea id="brief-cpValues" className="input-field min-h-[80px]"
          value={brief.cpValues}
          onChange={(e) => handleChange("cpValues", e.target.value)}
          placeholder={"Integritas\nInovasi\nKemitraan"} />
      </FieldItem>
    </SectionCard>

    {/* Operations */}
    <SectionCard icon={Package} title="Operasional & Kapabilitas" description="Apa yang membuat perusahaan Anda mampu melayani klien.">
      <FieldItem id="cpGeographicCoverage" label="Jangkauan geografis" optional hint="Kota, provinsi, atau negara yang dilayani">
        <input id="brief-cpGeographicCoverage" className="input-field"
          value={brief.cpGeographicCoverage}
          onChange={(e) => handleChange("cpGeographicCoverage", e.target.value)}
          placeholder="Jakarta, Surabaya, Medan — seluruh Indonesia" />
      </FieldItem>
      <FieldItem id="cpFacilities" label="Fasilitas / aset utama" optional hint="Gudang, pabrik, armada, kantor">
        <textarea id="brief-cpFacilities" className="input-field min-h-[80px]"
          value={brief.cpFacilities}
          onChange={(e) => handleChange("cpFacilities", e.target.value)}
          placeholder="Gudang 5.000 m² di Cikarang, armada 50 truk, cold storage..." />
      </FieldItem>
      <FieldItem id="cpProductionCapacity" label="Kapasitas produksi / volume" optional hint="Berikan angka nyata jika ada">
        <input id="brief-cpProductionCapacity" className="input-field"
          value={brief.cpProductionCapacity}
          onChange={(e) => handleChange("cpProductionCapacity", e.target.value)}
          placeholder="5.000 ton/bulan, 200 pengiriman/hari" />
      </FieldItem>
      {/* Industry-conditional hints */}
      <FieldItem id="cpIndustryDetail" label="Spesifikasi industri" optional
        hint={
          /logistik|logistics|ekspedisi|freight|cargo/i.test(brief.companyIndustry)
            ? "Air freight, sea freight, trucking, customs clearance, warehousing — yang mana yang Anda layani?"
            : /trading|perdagangan|ekspor|impor/i.test(brief.companyIndustry)
            ? "Komoditas, negara asal/tujuan, kapasitas bulanan, incoterms"
            : /manufaktur|manufacturing|pabrik|produksi/i.test(brief.companyIndustry)
            ? "Lokasi pabrik, mesin utama, proses produksi, standar QC"
            : "Detail spesifik industri yang penting untuk dicantumkan"
        }>
        <textarea id="brief-cpIndustryDetail" className="input-field min-h-[80px]"
          value={brief.cpIndustryDetail}
          onChange={(e) => handleChange("cpIndustryDetail", e.target.value)}
          placeholder="Jelaskan detail spesifik yang relevan untuk industri Anda..." />
      </FieldItem>
    </SectionCard>

    {/* People & Credentials */}
    <SectionCard icon={Users} title="Tim & Legalitas" description="Sumber daya manusia dan dokumen legalitas.">
      <FieldItem id="cpKeyPeople" label="Pimpinan / tokoh kunci" optional hint="Nama dan jabatan, satu per baris">
        <textarea id="brief-cpKeyPeople" className="input-field min-h-[80px]"
          value={brief.cpKeyPeople}
          onChange={(e) => handleChange("cpKeyPeople", e.target.value)}
          placeholder={"Budi Santoso — Direktur Utama\nSari Dewi — Head of Operations"} />
      </FieldItem>
      <FieldItem id="cpCertifications" label="Sertifikasi & izin usaha" optional hint="ISO, SNI, SIUP, NIB, dll — satu per baris">
        <textarea id="brief-cpCertifications" className="input-field min-h-[80px]"
          value={brief.cpCertifications}
          onChange={(e) => handleChange("cpCertifications", e.target.value)}
          placeholder={"ISO 9001:2015\nISO 14001\nSIUJP Kementerian Perhubungan"} />
      </FieldItem>
      <FieldItem id="cpOrganizationStructure" label="Struktur organisasi" optional hint="Divisi atau departemen utama">
        <textarea id="brief-cpOrganizationStructure" className="input-field min-h-[80px]"
          value={brief.cpOrganizationStructure}
          onChange={(e) => handleChange("cpOrganizationStructure", e.target.value)}
          placeholder="Directorate → Operational Division, Commercial Division, Finance & HR..." />
      </FieldItem>
    </SectionCard>

    {/* Track record */}
    <SectionCard icon={Award} title="Rekam Jejak & Keberlanjutan" description="Portofolio, klien, dan komitmen perusahaan Anda.">
      <FieldItem id="cpClientsPartners" label="Klien & mitra utama" optional hint="Nama perusahaan yang bisa dicantumkan publik, satu per baris">
        <textarea id="brief-cpClientsPartners" className="input-field min-h-[80px]"
          value={brief.cpClientsPartners}
          onChange={(e) => handleChange("cpClientsPartners", e.target.value)}
          placeholder={"PT Unilever Indonesia\nPT Astra International\nGaruda Indonesia"} />
      </FieldItem>
      <FieldItem id="cpProjectExperience" label="Proyek atau pengalaman menonjol" optional hint="Deskripsi singkat proyek atau kontrak besar">
        <textarea id="brief-cpProjectExperience" className="input-field min-h-[80px]"
          value={brief.cpProjectExperience}
          onChange={(e) => handleChange("cpProjectExperience", e.target.value)}
          placeholder="Penanganan logistik G20 2022 — 500 ton peralatan dari 35 negara..." />
      </FieldItem>
      <FieldItem id="cpQualityAssurance" label="Sistem jaminan kualitas" optional hint="SOP, audit, kontrol kualitas yang diterapkan">
        <input id="brief-cpQualityAssurance" className="input-field"
          value={brief.cpQualityAssurance}
          onChange={(e) => handleChange("cpQualityAssurance", e.target.value)}
          placeholder="Audit internal bulanan, QC 3-tahap, zero-defect policy" />
      </FieldItem>
      <FieldItem id="cpSustainability" label="Keberlanjutan / CSR" optional hint="Program lingkungan atau sosial">
        <input id="brief-cpSustainability" className="input-field"
          value={brief.cpSustainability}
          onChange={(e) => handleChange("cpSustainability", e.target.value)}
          placeholder="Green logistics initiative, carbon offset program..." />
      </FieldItem>
    </SectionCard>

    {/* Contact */}
    <SectionCard icon={Building2} title="Informasi Kontak Resmi" description="Data kontak untuk profil perusahaan.">
      <FieldItem id="cpContactEmail" label="Email perusahaan" optional>
        <input id="brief-cpContactEmail" className="input-field" type="email"
          value={brief.cpContactEmail}
          onChange={(e) => handleChange("cpContactEmail", e.target.value)}
          placeholder="info@perusahaan.com" />
      </FieldItem>
      <FieldItem id="cpContactPhone" label="Nomor telepon" optional>
        <input id="brief-cpContactPhone" className="input-field" type="tel"
          value={brief.cpContactPhone}
          onChange={(e) => handleChange("cpContactPhone", e.target.value)}
          placeholder="+62 21 1234 5678" />
      </FieldItem>
      <FieldItem id="cpContactAddress" label="Alamat kantor pusat" optional>
        <textarea id="brief-cpContactAddress" className="input-field min-h-[80px]"
          value={brief.cpContactAddress}
          onChange={(e) => handleChange("cpContactAddress", e.target.value)}
          placeholder="Jl. Sudirman No. 1, Jakarta Pusat 10220" />
      </FieldItem>
    </SectionCard>

  </div>
)}
```

## Change 7 — Update validateStep

The function currently checks:
- step 2: primaryGoal required
- step 3: audienceDemographics required
- step 4: stylePreference required
- step 5: outputFormats required
- step 6: deadline required

For company_profile, all these shift by 1 (because step 2 is now cp-detail, not goals).
Update the signature to: `function validateStep(step: number, brief: BriefData, isCP = false)`

Update the body:
```ts
if (step === 2 && !isCP && !hasAnySelection(brief.primaryGoal)) errors.primaryGoal = "...";
if (step === 3 && isCP  && !hasAnySelection(brief.primaryGoal)) errors.primaryGoal = "...";
if (step === 3 && !isCP && !hasAnySelection(brief.audienceDemographics)) errors.audienceDemographics = "...";
if (step === 4 && isCP  && !hasAnySelection(brief.audienceDemographics)) errors.audienceDemographics = "...";
if (step === 4 && !isCP && !hasAnySelection(brief.stylePreference)) errors.stylePreference = "...";
if (step === 5 && isCP  && !hasAnySelection(brief.stylePreference)) errors.stylePreference = "...";
if (step === 5 && !isCP && !brief.outputFormats.trim()) errors.outputFormats = "...";
if (step === 6 && isCP  && !brief.outputFormats.trim()) errors.outputFormats = "...";
if (step === 6 && !isCP && !brief.deadline.trim()) errors.deadline = "...";
if (step === 7 && isCP  && !brief.deadline.trim()) errors.deadline = "...";
```

Update all calls from `validateStep(currentStep, brief)` to `validateStep(currentStep, brief, isCompanyProfile)`.

## Change 8 — Update REVIEW_SECTIONS

In the ReviewStep function body, add CP rows when cp fields are filled:
```ts
const cpRows = [
  { label: "Legal Name",    value: brief.cpLegalName },
  { label: "Tahun Berdiri", value: brief.cpYearEstablished },
  { label: "Visi",          value: brief.cpVision ? brief.cpVision.slice(0, 80) + (brief.cpVision.length > 80 ? "…" : "") : "" },
  { label: "Misi",          value: brief.cpMission ? brief.cpMission.slice(0, 80) + (brief.cpMission.length > 80 ? "…" : "") : "" },
  { label: "Sertifikasi",   value: brief.cpCertifications },
  { label: "Klien Utama",   value: brief.cpClientsPartners },
  { label: "Kontak",        value: [brief.cpContactEmail, brief.cpContactPhone].filter(Boolean).join(" · ") },
].filter((r) => r.value.trim());

const allSections = [
  ...sections,
  ...(cpRows.length > 0 ? [{ heading: "Detail Perusahaan", step: 2, icon: Building2, rows: cpRows }] : []),
];
```
Then pass `allSections` to `<SummaryCard sections={allSections} ...>` instead of `sections`.

## Final instructions
1. Read the full file first
2. Make all changes in cohesive edits — do NOT leave orphan code
3. After editing run: `cd artifacts/customer-portal && pnpm tsc --noEmit 2>&1 | head -40`
4. Fix any TypeScript errors — the most likely ones are:
   - Missing fields in EMPTY_BRIEF
   - contentKey type narrowing (add `as ContentKey` cast if needed)
5. Verify the file still compiles for all service types
