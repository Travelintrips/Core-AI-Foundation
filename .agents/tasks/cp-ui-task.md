# Portal UI — Company Profile Enhancements

## Task 1 — Service detail checklist for company_profile

File: `artifacts/customer-portal/src/pages/service-detail.tsx`

READ the file fully first. This is a large file (~1144 lines).

### 1a — Detect service type

Add this import near the top (if not already present):
```ts
import { detectServiceType } from "@/config/brief-service-config";
```

Inside the component (after service data is loaded, around line 350), add:
```ts
const serviceType = detectServiceType(service?.serviceName);
```

### 1b — Add "prepare" to tracked sections

Find the `sectionIds` array (contains "overview", "deliverables", etc.).
Add `"prepare"` to the array right after `"deliverables"`.

### 1c — Add "Persiapan" to in-page nav

Find NAV_SECTIONS array. Add this entry right after the deliverables entry:
```ts
...(serviceType === "company_profile" ? [{ id: "prepare", label: "Persiapan" }] : []),
```

### 1d — Insert the checklist section

After the closing `</section>` of the "deliverables" section (id="deliverables"),
insert this block (still inside `<div className="lg:col-span-2 space-y-14">`):

```tsx
{/* Company Profile preparation checklist */}
{serviceType === "company_profile" && (
  <section id="prepare">
    <SectionHead icon={ClipboardList} title="Yang Perlu Anda Siapkan" />
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid rgba(46,66,112,0.5)", background: "rgba(13,21,38,0.6)" }}
    >
      <div className="p-5 pb-3">
        <p className="text-sm text-[#8B9BC4] leading-relaxed">
          Profil perusahaan terbaik dibangun dari data nyata. Siapkan informasi berikut
          sebelum brief — semakin lengkap, semakin akurat dokumen AI Anda.
        </p>
      </div>

      <div
        className="grid grid-cols-1 sm:grid-cols-2 gap-px"
        style={{ background: "rgba(46,66,112,0.3)" }}
      >
        {([
          {
            icon: Building2,
            label: "Identitas Perusahaan",
            items: ["Nama legal / akta", "Tahun berdiri", "Alamat kantor pusat", "Website & media sosial"],
          },
          {
            icon: Target,
            label: "Visi, Misi & Nilai",
            items: ["Pernyataan visi", "Pernyataan misi", "Nilai-nilai perusahaan", "Tagline (jika ada)"],
          },
          {
            icon: Package,
            label: "Layanan & Kapabilitas",
            items: ["Daftar layanan atau produk", "Jangkauan geografis", "Fasilitas / armada", "Kapasitas produksi"],
          },
          {
            icon: Award,
            label: "Kredensial & Rekam Jejak",
            items: ["Sertifikasi (ISO, SNI, dll)", "Dokumen legal (SIUP, NIB)", "Klien atau mitra utama", "Proyek menonjol"],
          },
          {
            icon: Users,
            label: "Tim & Struktur",
            items: ["Nama & jabatan pimpinan", "Struktur organisasi", "Jumlah karyawan (opsional)"],
          },
          {
            icon: FileText,
            label: "Aset Visual & Dokumen",
            items: ["Logo (PNG/SVG)", "Foto kantor / fasilitas", "Foto produk atau tim", "Referensi dokumen (PDF)"],
          },
        ] as const).map(({ icon: Icon, label, items }) => (
          <div key={label} className="p-5" style={{ background: "rgba(13,21,38,0.8)" }}>
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                style={{ background: "rgba(124,110,250,0.15)" }}
              >
                <Icon className="w-3.5 h-3.5 text-violet" />
              </div>
              <p
                className="text-sm font-semibold text-[#F0F4FF]"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {label}
              </p>
            </div>
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs text-[#8B9BC4]">
                  <Check className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div
        className="px-5 py-4 flex items-start gap-3"
        style={{ borderTop: "1px solid rgba(46,66,112,0.3)", background: "rgba(13,21,38,0.6)" }}
      >
        <BadgeCheck className="w-4 h-4 text-violet shrink-0 mt-0.5" />
        <p className="text-xs text-[#8B9BC4] leading-relaxed">
          <span className="text-[#F0F4FF] font-medium">Data opsional, bukan keharusan.</span>{" "}
          AI kami hanya menggunakan informasi yang Anda berikan dan tidak pernah mengarang
          fakta. Bagian yang tidak ada datanya dilewati secara otomatis.
        </p>
      </div>
    </div>
  </section>
)}
```

### Imports check
Make sure these are imported from lucide-react (most should already be there):
- `Building2` — may need adding
- `Target` — may need adding  
- `Package` ✓ already imported
- `Award` ✓ already imported
- `Users` ✓ already imported
- `FileText` ✓ already imported
- `ClipboardList` — check, may need adding
- `Check` ✓ already imported
- `BadgeCheck` ✓ already imported

If `Building2`, `Target`, or `ClipboardList` are missing from the lucide-react import line, add them.

---

## Task 2 — Brand Kit completeness warning

File: `artifacts/customer-portal/src/pages/workspace/brand-kit.tsx`

READ the full file (101 lines).

### 2a — Add warning banner

Find the else block where items are rendered (after the empty state check).
BEFORE the `<div className="space-y-6">` that wraps the map loop, add:

```tsx
{/* Brand Kit completeness warning */}
{data.items.some((kit) => !kit.colorPalette || !kit.typography) && (
  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3 mb-2">
    <div className="shrink-0 mt-0.5">
      <svg
        className="w-5 h-5 text-amber-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667
             1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464
             0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    </div>
    <div>
      <p className="text-sm font-medium text-amber-300 mb-1">Brand Kit belum lengkap</p>
      <p className="text-xs text-amber-200/70 leading-relaxed">
        Untuk hasil terbaik pada layanan Company Profile, pastikan Brand Kit sudah
        memiliki logo, warna, dan tipografi. Informasi ini digunakan AI untuk
        menghasilkan dokumen yang sesuai identitas visual perusahaan Anda.
      </p>
    </div>
  </div>
)}
```

### 2b — Add per-kit completeness indicator

Inside the existing `data.items.map((kit) => { ... })` loop, find where the color palette
and typography are displayed (the 3-column grid). After that grid, add:

```tsx
{/* Completeness indicator */}
{(!kit.colorPalette || !kit.typography) && (
  <p className="text-xs text-amber-400/80 flex items-center gap-1.5 mt-2">
    <span aria-hidden="true">⚠</span>
    {!kit.colorPalette && !kit.typography
      ? "Warna dan tipografi belum tersedia — lengkapi untuk hasil optimal"
      : !kit.colorPalette
      ? "Warna brand belum tersedia"
      : "Tipografi belum tersedia"}
  </p>
)}
```

---

## Final instructions
1. Read both files fully before editing
2. Do NOT break any existing functionality
3. Check TypeScript: `cd artifacts/customer-portal && pnpm tsc --noEmit 2>&1 | head -30`
4. Fix any import errors
5. The brand-kit.tsx file does NOT use lucide-react for the warning — we use inline SVG
   to avoid adding a new import dependency
