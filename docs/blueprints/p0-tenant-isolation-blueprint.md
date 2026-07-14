# Implementation Blueprint — P0-1: Enterprise Tenant Isolation
**Tanggal:** 14 Juli 2026
**Sifat:** Blueprint teknis murni. **Tidak ada source code, migration, atau commit yang dibuat/diubah dalam penyusunan dokumen ini.**
**Basis:** Audit Enterprise Readiness, Validation Audit, Roadmap Enterprise, dan pembacaan source code aktual (schema `lib/db/src/schema`, middleware/service/worker di `artifacts/api-server/src`).

---

## 1. Current Architecture — Bagaimana Tenant Bekerja Sekarang

**Kesimpulan inti: platform ini hari ini adalah aplikasi single-tenant yang melayani banyak customer, bukan aplikasi multi-tenant.** Konsep "tenant" yang ada di skema adalah *placeholder* yang disiapkan untuk masa depan, belum ditegakkan di mana pun.

**Kolom tenant yang sudah ada di skema** (`lib/db/src/schema/`), semuanya bersifat opsional/placeholder:

| Tabel | Kolom | Nullable | Default | Komentar di kode |
|---|---|---|---|---|
| `ai_installed_packages` | `tenantId` | Tidak | `'default'` | "free-text slug" |
| `ai_service_portfolios` | `tenantId` | Ya | — | "null = shared across all tenants" |
| `ai_service_categories` | `ai_services` | `tenantId` | Ya | "null = shared; free-text slug once real multi-tenancy lands" |
| `ai_service_requests` | `tenantId` | Ya | — | "null = default tenant" |
| `ai_service_price_rules` | `tenantId` | Ya | — | "null = applies to all tenants" |
| `ai_quotations` | `tenantId` | Ya | — | — |
| `ai_commercial_gates` | `tenantId` | Ya | — | "null = default/shared tenant" |
| `ai_workflow_costs` | `companyId` | Ya | — | "future multi-tenant" |
| `ai_execution_logs` | `companyId` | Ya | — | "future: multi-tenant company" |

**Tabel inti bisnis yang TIDAK punya kolom tenant sama sekali:** `creative_projects`, `creative_project_quotations`, seluruh tabel proyek/klien/deliverable, `ai_jobs`, `ai_audit_logs`, `ai_schedules`, seluruh tabel Human Task Center dan Event Bus. Isolasi data pada tabel-tabel ini bergantung sepenuhnya pada `projectId`/token, bukan konsep tenant.

**Pemakaian aktual `tenantId` di kode** (hasil grep menyeluruh):
- `packageManagerService.ts` — filter instalasi paket marketplace per tenant (`findInstallation`, `install`, `upgrade`, `uninstall`)
- `aiPricingService.ts` (`resolveTax`) — membangun key setting pajak per tenant
- `marketplace.ts` — middleware `parseTenantId` membaca `tenantId` dari body/query request lalu meneruskannya ke service (tanpa validasi terhadap identitas pemanggil — nilai ini **sepenuhnya dipercaya dari input klien**)
- `observabilityService.ts` — menulis `companyId` ke log biaya/eksekusi
- `commercialGateService.ts`, `aiQuotationService.ts` — menuliskan `tenantId` saat insert, tapi **tidak memfilter saat membaca**
- `seed.ts` — hardcode `tenantId: "default"`

**Kesimpulan kritis:** tidak ada satu pun titik di sistem yang me-*resolve* tenant dari identitas request (session/token) secara otomatis. Nilai `tenantId` yang ada, jika dipakai, **didapat langsung dari input request** (`marketplace.ts`) — ini bukan tenant isolation, ini adalah *tenant labeling* yang bisa dipalsukan siapa pun yang mengirim request.

**Autentikasi & otorisasi saat ini** (`src/middleware/`):
- `adminAuth.ts` — validasi `ADMIN_API_KEY`/session, attach `req.internalUser`, fail-open di development
- `internalAuth.ts` — RBAC internal (`requireInternalRole`), attach `req.internalUser`
- `paymentGate.ts` — cek status pembayaran project via `req.params.id`/`req.body.projectId`
- `rateLimiter.ts`, `ssrfGuard.ts` — kontrol keamanan generik, tidak menyentuh konsep tenant
- Rute publik (`/api/public/...`) — identifikasi lewat **review token** yang di-hash lalu dicocokkan ke `creativeAiClientReviewsTable.reviewTokenHash`, yang berelasi ke satu `projectId` — akses dibatasi ke project itu saja, bukan ke "tenant" manapun

**Worker & Scheduler:**
- `AiJob` (jobWorkerService.ts/queueManagerService.ts) tidak punya field `tenantId` sama sekali di level top — hanya `departmentId`/`employeeId`, serta `projectId`/`brandSlug` di dalam `payloadJson` masing-masing job.
- `aiSchedulesTable` (aiSchedulerService.ts) juga tidak punya field tenant — identitas job turunan hanya lewat `payloadJson`/`targetConfigJson` bebas-bentuk.

**SSE (`sseManager.ts`):**
- Channel dikunci per `projectId` (bukan per tenant). Broadcast sudah terisolasi per-project (bukan global), tapi tidak ada konsep tenant sama sekali di layer ini.

**Export (PDF/Presentation/ZIP/Preview/Thumbnail):**
- `creativeDocumentWorkerService.ts`/`creativePresentationWorkerService.ts` mengambil data hanya berdasarkan `projectId` dari `job.payloadJson` — **tidak ada validasi `customerId`/`tenantId` apa pun** saat eksekusi export. Job payload diasumsikan sudah tepercaya sejak dibuat (saat ini aman karena job hanya dibuat oleh sistem internal, tapi ini menjadi risiko begitu ada lebih dari satu tenant yang berbagi worker pool yang sama).

**Audit Log (`aiAuditService.ts` → `ai_audit_logs`):**
- Field: `module`, `action`, `resourceId`, `resourceType`, `status`, `details` (JSONB). **Tidak ada kolom `tenantId` maupun `actorId` eksplisit** — informasi aktor/tenant, jika ada, hanya mungkin terselip di dalam `details` JSON secara tidak konsisten.

---

## 2. Target Architecture — Bagaimana Tenant Seharusnya Bekerja

**Definisi tenant untuk platform ini:** berdasarkan pola kolom yang sudah disiapkan (marketplace, katalog, pricing, commercial gates — semua fitur yang bersifat *platform-level configuration*), **tenant = organisasi/agency yang mengoperasikan instance layanan ini**, bukan customer akhir dari agency tersebut. Ini konsisten dengan arah bisnis "Enterprise Creative Agency AI" di roadmap — platform ini berpotensi dijual sebagai SaaS ke agency lain, di mana setiap agency (tenant) punya katalog, staf, klien, dan data operasionalnya sendiri yang terisolasi dari agency lain.

**Target:** setiap request — baik dari staf internal, klien lewat customer portal, klien lewat token publik, job worker, scheduler, maupun SSE — **selalu punya tenant context yang eksplisit, ditegakkan secara sistemik**, bukan opsional atau bisa dipalsukan dari body request.

Prinsip desain target:
1. Tenant context ditentukan dari **sumber tepercaya** (session/JWT yang sudah tervalidasi, atau diturunkan dari resource yang sudah diverifikasi kepemilikannya) — **tidak pernah** dari `req.body`/`req.query` mentah seperti `marketplace.ts` saat ini.
2. Setiap tabel yang berisi data spesifik-tenant memiliki kolom `tenant_id` yang **wajib** (bukan nullable) setelah migrasi selesai, kecuali tabel yang secara sadar didesain sebagai *shared/global* (katalog dasar yang dipakai semua tenant sebagai starting point).
3. Enforcement terjadi di **repository layer** sebagai lapisan wajib pertama, dengan **PostgreSQL RLS** sebagai lapisan pertahanan kedua independen (defense in depth) — bukan mengandalkan disiplin manual developer menambahkan `WHERE tenant_id = ?` di setiap query.
4. Staf internal yang butuh visibilitas lintas-tenant (superadmin platform) diberi akses lewat **role eksplisit yang di-audit**, bukan lewat ketidakhadiran filter tenant secara default.

---

## 3. Tenant Context Flow

```
Request
  ↓
Authentication
  (adminAuth / internalAuth / customer session / review token hash lookup)
  ↓
Tenant Resolution
  (turunkan tenantId dari sumber tepercaya sesuai jalur otentikasi — lihat Bagian 4)
  ↓
Authorization
  (RBAC role internal DITAMBAH pengecekan tenant match — akses ditolak jika role valid tapi tenant tidak cocok, kecuali role superadmin eksplisit)
  ↓
Service
  (menerima tenant context sebagai parameter wajib, bukan opsional)
  ↓
Repository
  (setiap query ke tabel tenant-scoped WAJIB menyertakan filter tenant dari context yang diterima — lihat Bagian 7)
  ↓
Database
  (RLS sebagai jaring pengaman independen — lihat Bagian 5)
  ↓
Response
  (payload yang dikembalikan tidak pernah berisi data tenant lain; jika terjadi mismatch, response harus 403/404, bukan silent-empty yang membingungkan debugging)
```

Titik kritis: **Tenant Resolution harus terjadi sebelum Authorization**, karena keputusan otorisasi (apakah role ini boleh mengakses resource ini) sebagian bergantung pada apakah tenant cocok, bukan hanya soal role semata.

---

## 4. Tenant Resolution Strategy

| Strategi | Cocok untuk platform ini? | Alasan |
|---|---|---|
| **JWT dengan tenant claim** | Sebagian — hanya untuk sesi terautentikasi | Sistem sudah punya session cookie (`SESSION_COOKIE_NAME`), bukan JWT murni; mengganti seluruh mekanisme sesi ke JWT adalah perubahan besar yang tidak proporsional untuk masalah ini |
| **Workspace-based** | Cocok untuk sisi internal/admin | Selaras dengan pola "Internal AI Portal" yang sudah ada (RBAC role internal) — tenant setara "workspace organisasi" yang staf login ke dalamnya |
| **Organization-based** | Konsep sama dengan Workspace | Tidak memberi keunggulan berbeda untuk kasus ini dibanding istilah "Workspace" yang sudah lebih dekat dengan bahasa kode yang ada |
| **Subdomain-based** | Tidak cocok saat ini | Platform dijalankan lewat path-based routing artifact Replit, bukan domain kustom per tenant — mengubah ini butuh perubahan infrastruktur besar yang tidak proporsional untuk P0 |
| **Header-based (X-Tenant-Id)** | Tidak cocok sebagai sumber utama | Header bisa dikirim bebas oleh klien mana pun — persis pola berbahaya yang sudah ada di `marketplace.ts` (`parseTenantId` dari body/query) — ini pola yang sedang diperbaiki, bukan ditiru |
| **Resource-derived (token → project → tenant)** | Cocok, wajib untuk jalur publik | Jalur customer publik (`review token`) saat ini sudah terbukti aman lewat mekanisme ini — token dipetakan ke `projectId` yang sudah diverifikasi kepemilikannya di database, tenant tinggal diturunkan satu langkah lagi dari project tersebut |
| **Hybrid** | **DIPILIH** | Kombinasi Workspace-based (untuk staf internal & customer portal terautentikasi) + Resource-derived (untuk jalur token publik) — inilah satu-satunya kombinasi yang sesuai dengan DUA jalur otentikasi yang benar-benar ada di kode hari ini |

**Rekomendasi final: Hybrid.**
- **Jalur terautentikasi** (internal staff, admin, customer portal berbasis session): tenant context diambil dari session yang sudah divalidasi (`req.internalUser`/customer session), bukan dari input request.
- **Jalur token publik** (`/api/public/...`): tenant context **diturunkan dari resource** — token → `projectId` (mekanisme yang sudah ada dan sudah terbukti aman) → `tenantId` milik project tersebut. Token itu sendiri tidak perlu membawa klaim tenant; tenant ditentukan oleh data yang divalidasi di database, bukan oleh apa yang diklaim di request.
- **Jalur job worker/scheduler**: tenant context diturunkan dari record sumber (project/service request) yang memicu job tersebut, disimpan eksplisit di payload job saat *enqueue* — bukan direkonstruksi ulang saat eksekusi.

Alasan memilih Hybrid dibanding satu strategi tunggal: platform ini punya karakter dua-sisi yang nyata di kode (portal internal bersesi vs akses klien tanpa akun/token-only) — memaksakan satu strategi tunggal (misal JWT murni) akan memaksa perombakan jalur token publik yang sudah berfungsi baik, padahal masalahnya bukan di jalur itu.

---

## 5. Data Isolation Strategy

| Level | Deskripsi | Kecukupan untuk platform ini |
|---|---|---|
| **Application level** (filter manual di service) | Developer menambahkan `WHERE tenant_id = ?` secara manual di setiap query | Tidak cukup sendirian — pola ini persis yang gagal hari ini (grep membuktikan `tenantId` dipakai di sebagian kecil service, tidak konsisten) |
| **Repository level** | Satu lapisan wajib antara service dan database yang otomatis menyisipkan filter tenant | Diperlukan sebagai **lapisan utama** — memindahkan tanggung jawab dari "developer harus ingat" ke "struktur kode tidak memungkinkan lupa" |
| **Database level (RLS)** | PostgreSQL/Supabase Row-Level Security menegakkan isolasi di level koneksi, independen dari kode aplikasi | Diperlukan sebagai **lapisan kedua (defense in depth)** — melindungi dari bug di repository layer, akses langsung ke DB (mis. lewat tooling admin/BI), atau kesalahan human error |
| **Hybrid (Repository + RLS)** | **DIREKOMENDASIKAN** | Kombinasi keduanya adalah standar enterprise: repository layer memberi ergonomi development yang baik (error cepat terdeteksi saat development), RLS memberi jaminan keamanan yang tidak bergantung pada kode aplikasi berjalan benar |

**Yang TIDAK direkomendasikan:** database-per-tenant atau schema-per-tenant. Platform sudah punya banyak tabel *shared/global* by design (katalog dasar, pricing rules dengan `tenantId = null` berarti "berlaku untuk semua tenant") — memisahkan database/schema per tenant akan merusak semantik "shared" yang sudah sengaja dibangun, dan merupakan perubahan infrastruktur yang jauh melampaui skala masalah yang perlu diselesaikan.

---

## 6. Middleware Strategy (Blueprint, Tanpa Implementasi)

Satu middleware baru: **`resolveTenantContext`**, ditempatkan di pipeline **setelah** middleware otentikasi (`adminAuth`/`internalAuth`/resolusi session customer) dan **sebelum** route handler mana pun yang menyentuh data tenant-scoped.

Tanggung jawab middleware ini:
1. Membaca hasil otentikasi yang sudah divalidasi (`req.internalUser`, session customer, atau hasil lookup token publik) — **tidak pernah membaca `tenantId` langsung dari body/query/header request** (ini adalah pola yang harus dihentikan, menggantikan pendekatan `parseTenantId` di `marketplace.ts` saat ini).
2. Menentukan tenant context sesuai strategi Hybrid di Bagian 4, lalu menempelkannya ke request sebagai objek tenant context terstruktur (bukan variabel `tenantId` string lepas).
3. Untuk staf internal dengan role superadmin platform, menandai context sebagai "cross-tenant access" secara eksplisit — bukan sekadar "tidak ada tenant" — sehingga akses lintas-tenant selalu tercatat sebagai keputusan sadar, bukan default kosong.
4. Jika tenant tidak bisa diresolusi sama sekali (bukan superadmin, bukan token valid, bukan session tenant valid) — request **ditolak di titik ini**, sebelum mencapai service/repository layer.

Middleware existing yang perlu diselaraskan (bukan diganti):
- `adminAuth.ts`/`internalAuth.ts` tetap menangani "siapa" (identitas & role); `resolveTenantContext` menambahkan "milik tenant mana" — dua tanggung jawab berbeda yang dijalankan berurutan.
- `paymentGate.ts` perlu dipastikan urutan eksekusinya **setelah** `resolveTenantContext`, karena `paymentGate` mengecek status project — pengecekan ini harus sudah dalam scope tenant yang benar agar tidak salah mengevaluasi status project milik tenant lain.

---

## 7. Repository Strategy

Kondisi hari ini: **tidak ada repository layer** — service memanggil query drizzle langsung ke database. Ini akar masalah utama mengapa filter tenant tidak konsisten (setiap service "menemukan sendiri" caranya, seperti terlihat dari perbedaan pola antara `packageManagerService.ts` yang rajin filter dan `commercialGateService.ts` yang hanya menulis tenant tanpa membaca dengan filter).

**Strategi target:** memperkenalkan lapisan repository/query-helper **secara bertahap, hanya untuk tabel tenant-scoped**, bukan menulis ulang seluruh akses data di aplikasi. Setiap fungsi akses data untuk tabel tenant-scoped harus menerima tenant context sebagai parameter wajib (bukan opsional), dan lapisan ini bertanggung jawab menyisipkan predikat tenant ke setiap operasi read/write/delete.

Prinsip yang harus dipegang:
- **Tidak ada jalan pintas.** Fungsi query untuk tabel tenant-scoped tidak boleh punya varian "tanpa tenant" kecuali dipanggil eksplisit dari jalur superadmin yang sudah tercatat di Bagian 6.
- **Tabel shared/global tetap dilayani terpisah.** Query untuk data yang secara sengaja "berlaku untuk semua tenant" (`tenantId = null` pada katalog/pricing) tetap punya jalur sendiri yang jelas dibedakan dari query tenant-scoped biasa — bukan dicampur dalam kondisi `if` yang mudah salah.
- **Migrasi bertahap per domain tabel**, dimulai dari tabel risiko rendah (katalog, pricing — sudah punya kebiasaan tenant sebagian) menuju tabel risiko tinggi (project, quotation, job) — urutan detail di Bagian 14 dan 17.

---

## 8. Worker Strategy

Tantangan utama: job berjalan **asinkron**, terpisah dari request HTTP yang memicunya — tenant context dari Bagian 3 tidak otomatis "ikut" ke proses background.

**Strategi:**
1. **Capture at enqueue time, not derive at execution time.** Saat sebuah job dibuat (`createJob`/enqueue), tenant context dari request pemicunya harus disimpan **eksplisit** sebagai bagian dari record job (bukan digali ulang dari `payloadJson` bebas-bentuk saat job dieksekusi). Ini adalah perubahan skema (`AiJob` perlu kolom tenant eksplisit) — dicatat sebagai kebutuhan migrasi, bukan diimplementasikan di blueprint ini.
2. **Claim tetap agnostik terhadap tenant** (worker pool tetap dibagi lintas tenant untuk efisiensi — tidak perlu worker pool terpisah per tenant, ini akan membuang resource) — tapi begitu job diklaim, tenant context yang tersimpan di record job **wajib** digunakan untuk semua operasi repository selama eksekusi job tersebut.
3. **Validasi kepemilikan sebelum eksekusi**, bukan sesudah. Sebelum job memproses `projectId` dari payload, worker harus memverifikasi bahwa project tersebut memang milik tenant yang tercatat di job record — mencegah kasus di mana payload rusak/salah/dipalsukan menyebabkan eksekusi menyentuh data tenant lain. Ini menjawab risiko konkret yang ditemukan di export pipeline (Bagian 1 — export services hari ini tidak melakukan validasi ini sama sekali).

---

## 9. AI Workflow Strategy

AI job (4-step Creative Pipeline, Image Designer, dsb) dieksekusi lewat `executeAI`/`aiExecutionService.ts`, dipicu dari `creativeWorkflowRunner.ts` yang dijalankan sebagai job biasa lewat worker — sehingga **strategi worker di Bagian 8 otomatis berlaku** untuk seluruh AI workflow, karena AI job pada dasarnya adalah kategori job seperti job lainnya di sistem yang sama.

Hal tambahan yang spesifik untuk AI:
1. **Client Memory/context AI** (`ai_client_memory` dari fitur memory service) harus diberi tenant context yang sama ketat seperti data project — memori/konteks yang dikumpulkan AI dari satu tenant **tidak boleh** pernah muncul sebagai konteks untuk prompt AI tenant lain (ini kategori risiko "AI leak" yang dibahas di Bagian 13).
2. **Cost tracking** (`ai_cost_records`, `ai_execution_logs` yang sudah punya kolom `companyId` placeholder) harus dijadikan kolom tenant resmi begitu tenant context ditegakkan — ini juga membuka kemampuan pelaporan biaya AI per tenant yang berguna untuk model bisnis SaaS multi-tenant di masa depan.
3. **aiCeoService** (execution plan/task assignment) juga harus mewarisi tenant context yang sama dari project yang memicunya — konsisten dengan rekomendasi konsolidasi orkestrasi di roadmap (P1.1), sehingga saat konsolidasi dilakukan, tenant context cukup didefinisikan sekali di titik masuk pipeline, bukan dua kali di dua service yang overlap.

---

## 10. Export Strategy (PDF, Presentation, ZIP, Preview, Thumbnail)

Temuan kunci: seluruh worker export (`creativeDocumentWorkerService.ts`, `creativePresentationWorkerService.ts`, dan turunan thumbnail/preview) mengambil data **hanya** berdasarkan `projectId` dari payload job, tanpa validasi kepemilikan tenant sama sekali.

**Strategi target:**
1. Terapkan aturan validasi dari Bagian 8 (poin 3) secara spesifik di titik masuk setiap worker export: sebelum membaca data project untuk digenerate menjadi dokumen/presentasi, verifikasi `project.tenantId` (setelah migrasi) sama dengan tenant yang tercatat di job.
2. **Namespace path penyimpanan file** (object storage) disarankan menyertakan identitas tenant sebagai bagian dari struktur path, selain `ownerSlug`/`projectId` yang sudah ada — ini memberi isolasi tambahan di level storage, bukan hanya di level database, dan mempermudah audit/purge data per tenant di masa depan (relevan juga untuk P0-2 Soft Delete/retention).
3. **Thumbnail & preview service** mengikuti pola yang sama — karena keduanya dipanggil dari worker yang sama dan memakai objek project yang sama, validasi di poin 1 otomatis melindungi keduanya tanpa perlu titik pemeriksaan terpisah.
4. **ZIP/portfolio-batch export** — karena sifatnya menggabungkan banyak asset sekaligus, validasi tenant harus diterapkan **per-item** di dalam loop penggabungan, bukan hanya sekali di awal — untuk mencegah satu item nyasar dari tenant lain masuk ke dalam satu ZIP gabungan.

---

## 11. SSE Strategy

Kondisi hari ini: channel dikunci per `projectId`, broadcast sudah terisolasi per-project (bukan global) — ini sudah memberi isolasi yang **cukup untuk model single-tenant saat ini** karena satu project secara implisit "milik" satu customer.

**Strategi target (begitu tenant ditegakkan):**
1. Tambahkan validasi tenant saat `registerSubscriber` — pemohon koneksi SSE harus membawa tenant context yang cocok dengan tenant pemilik `projectId` yang di-subscribe, di atas pemeriksaan token/limit yang sudah ada (`MAX_CONNECTIONS_PER_IP`/`MAX_CONNECTIONS_PER_TOKEN`).
2. `pollAndFanOut` yang query database per-`projectId` sebaiknya turut menyertakan tenant sebagai bagian dari predikat query (bukan hanya `projectId`) — sejalan dengan seluruh tabel lain yang wajib difilter tenant di Bagian 7, agar konsisten dan tidak menjadi satu-satunya titik yang terlewat.
3. **Tidak perlu** merestrukturisasi `channels` Map yang sudah dikunci per-project menjadi berlapis per-tenant — cukup menambahkan pemeriksaan tenant sebagai *gate* tambahan sebelum registrasi subscriber diterima, karena struktur data yang ada sudah cukup granular (per-project selalu berada dalam satu tenant).

---

## 12. Audit Log Strategy

Kondisi hari ini: `ai_audit_logs` (`aiAuditService.ts`) menyimpan `module`, `action`, `resourceId`, `resourceType`, `status`, `details` — **tidak ada kolom `tenantId` maupun `actorId` eksplisit**. Perlu dicatat juga temuan bahwa `customerWorkspaceService.ts` mengindikasikan arah migrasi menuju "Canonical Runtime Event Model" (v4.0C) — audit log saat ini kemungkinan sedang dalam transisi ke model event yang lebih baru.

**Strategi target:**
1. Tenant context harus menjadi **field wajib tingkat pertama** (bukan terselip di `details` JSON) di setiap entri audit log baru — berlaku baik untuk `ai_audit_logs` yang ada sekarang maupun model Canonical Event yang menggantikannya nanti (lihat P0-3 Audit Log Blueprint untuk detail lengkap skema).
2. Setiap pemanggilan `logAudit`/pencatatan event di seluruh service (termasuk export worker, quotation service, commercial gate service) harus disertai tenant context yang sama dengan yang dipakai untuk operasi bisnis itu sendiri — idealnya tenant context ini "mengikuti" secara otomatis dari repository layer (Bagian 7), bukan diisi manual satu-satu di titik pemanggilan audit log.
3. Akses lintas-tenant oleh superadmin (Bagian 6) **wajib** menghasilkan entri audit log tersendiri yang menandai bahwa ini adalah akses cross-tenant yang disengaja — ini kebutuhan keamanan minimum yang harus ada sebelum fitur superadmin cross-tenant diaktifkan.

---

## 13. Security Analysis — Kemungkinan Kebocoran

| Vektor | Kemungkinan saat ini | Penjelasan |
|---|---|---|
| **Tenant leak** (data tenant lain terlihat tanpa disadari) | **Tinggi** jika multi-tenant diaktifkan hari ini | Kolom `tenantId` nullable dengan semantik "shared" di banyak tabel katalog — begitu benar-benar ada >1 tenant, baris `null` akan terlihat oleh semua tenant secara default, termasuk baris yang seharusnya privat jika developer lupa mengisi tenant saat insert |
| **Cross tenant read** | **Tinggi** | Grep membuktikan mayoritas query di service **tidak** memfilter tenant sama sekali — hanya sebagian kecil (`packageManagerService.ts`) yang konsisten |
| **Cross tenant write** | **Sedang–Tinggi** | `marketplace.ts` menerima `tenantId` langsung dari body/query request — pemanggil bisa mengklaim tenant apa pun tanpa validasi, secara teori bisa menulis data mengatasnamakan tenant lain |
| **Background leak (worker/scheduler)** | **Sedang** | `AiJob`/schedule tidak punya field tenant resmi — jika payload berisi id yang salah/dipalsukan, tidak ada pemeriksaan yang mencegah job memproses data tenant lain (dibuktikan konkret di export pipeline, Bagian 1 & 10) |
| **Cache leak** | **Tidak teridentifikasi cache layer eksplisit di service yang diaudit** — dicatat sebagai asumsi terbuka: jika caching (in-memory/Redis) ditambahkan di masa depan tanpa mempertimbangkan tenant sebagai bagian dari cache key, ini akan menjadi vektor baru. Perlu ditegaskan sebagai aturan desain sejak awal setiap kali caching diperkenalkan. |
| **SSE leak** | **Rendah untuk kondisi single-tenant hari ini**, **Sedang** begitu multi-tenant aktif | Channel dikunci per-project (aman untuk model sekarang), tapi tidak ada pemeriksaan tenant eksplisit — begitu satu tenant punya lebih dari satu customer/project dan sistem benar-benar multi-tenant, risiko munculnya bug yang membocorkan channel antar-tenant meningkat tanpa lapisan pemeriksaan tambahan |
| **AI leak** (konteks/memori AI bocor antar tenant) | **Sedang** | `ai_client_memory` dan konteks yang dikumpulkan `intelligentRouter`/`memoryService` belum terbukti punya isolasi tenant — risiko prompt satu tenant "mengingat" atau tercampur konteks tenant lain jika memory service dipakai lintas-tenant tanpa filter |

---

## 14. Migration Strategy (Tanpa Implementasi)

### Phase 1 — Foundation (Shadow Mode, tanpa enforcement)
- Tambahkan kolom `tenant_id` (nullable, default `'default'`) ke seluruh tabel tenant-eligible yang belum memilikinya (termasuk `creative_projects`, `creative_project_quotations`, `ai_jobs`, `ai_schedules`, `ai_audit_logs`).
- Backfill seluruh data yang sudah ada dengan `tenant_id = 'default'` — merepresentasikan satu tenant tunggal yang mewakili seluruh data historis platform saat ini.
- Bangun middleware `resolveTenantContext` (Bagian 6) tapi jalankan dalam **mode shadow**: hitung dan catat (log) tenant yang teresolusi, **tanpa** menegakkan apa pun — tujuannya memvalidasi bahwa logika resolusi benar sebelum dipakai untuk membatasi akses sungguhan.
- Tambahkan field tenant eksplisit ke `AiJob`/`aiSchedulesTable` (nullable dulu), diisi dari context yang sama saat enqueue.

### Phase 2 — Progressive Enforcement (Per Domain Tabel)
- Aktifkan enforcement repository layer (Bagian 7) **secara bertahap per domain tabel**, dimulai dari risiko terendah ke tertinggi:
  1. Katalog & pricing (`ai_services`, `ai_service_categories`, `ai_service_price_rules`) — sudah punya kebiasaan tenant sebagian
  2. Marketplace/package installations (`ai_installed_packages`) — perbaiki pola `parseTenantId` yang saat ini mempercayai input request mentah, gantikan dengan tenant context dari Bagian 6
  3. Commercial layer (`ai_quotations`, `ai_commercial_gates`) — sinkron dengan keputusan canonical quotation (lihat P0-4 blueprint)
  4. Data inti project/customer (`creative_projects` dan seluruh tabel turunannya) — risiko tertinggi, dikerjakan setelah pola sudah tervalidasi di domain-domain sebelumnya
  5. Job/scheduler/SSE/export (Bagian 8–11) — enforcement validasi kepemilikan tenant di titik eksekusi
  6. Audit log (Bagian 12) — field tenant menjadi wajib diisi di setiap pemanggilan
- Setiap domain diaktifkan di belakang *feature flag* per-domain (konsep, bukan implementasi) — memungkinkan enforcement dinyalakan/dimatikan tanpa deploy ulang jika ditemukan masalah.

### Phase 3 — Hardening
- Setelah seluruh domain di Phase 2 stabil melewati periode observasi (soak period) tanpa insiden, ubah kolom `tenant_id` dari nullable+default menjadi **NOT NULL** tanpa default (memaksa setiap insert baru secara eksplisit menyertakan tenant, tidak lagi jatuh ke `'default'` secara implisit).
- Aktifkan **PostgreSQL RLS** sebagai lapisan kedua independen di atas seluruh tabel tenant-scoped, memakai tenant context yang sama yang sudah divalidasi di Phase 1–2.
- Aktifkan audit log wajib untuk setiap akses cross-tenant superadmin (Bagian 6 & 12).

### Rollback Strategy
- Karena setiap fase bersifat **aditif** (tambah kolom nullable, tambah middleware yang berjalan shadow dulu, enforcement di belakang flag per-domain), rollback pada Phase 1–2 semudah **menonaktifkan flag domain terkait** — tidak perlu rollback skema, karena kolom baru bersifat backward-compatible (nullable/berdefault).
- Rollback Phase 3 (NOT NULL constraint, RLS aktif) memerlukan kehati-hatian lebih: sebelum constraint NOT NULL diberlakukan, harus ada verifikasi 100% baris sudah terisi tenant yang valid; RLS policy harus diuji bisa dinonaktifkan cepat (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY`) sebagai jalur darurat tanpa mengubah data, bila ditemukan RLS memblokir akses yang seharusnya sah.
- **Tidak ada fase yang bersifat destruktif** (tidak ada penghapusan kolom/data) sampai seluruh Phase 3 dinyatakan stabil dalam periode observasi yang disepakati.

---

## 15. Compatibility Analysis

| Area | Terpengaruh? | Dampak |
|---|---|---|
| Customer Portal | Ya, ringan | Tenant diturunkan dari session/token yang sudah ada (Bagian 4) — tidak perlu perubahan alur login/token, hanya penambahan resolusi di belakang layar |
| Admin Portal | Ya, signifikan | Staf internal butuh definisi jelas: apakah setiap staf terikat satu tenant (workspace), atau ada mode superadmin lintas-tenant — ini keputusan produk yang harus diambil sebelum Phase 2 dimulai untuk domain project inti |
| Worker | Ya, sedang | Perlu field tenant baru di `AiJob`, diisi saat enqueue — backward compatible karena nullable di Phase 1 |
| Scheduler | Ya, sedang | Sama seperti worker — field tenant baru di `aiSchedulesTable` |
| AI | Ya, sedang | Mengikuti tenant context dari project yang memicu (via worker) — perlu perhatian khusus pada `ai_client_memory` (Bagian 9 & 13) |
| Presentation/Document (Export) | Ya, sedang | Perlu validasi kepemilikan tenant sebelum generate — perubahan logika di titik masuk worker export, bukan perubahan format dokumen |
| Quotation | Ya, signifikan — **terkait langsung dengan P0-4** | Kedua jalur quotation (legacy & canonical) perlu tenant context; keputusan canonical path harus selaras dengan urutan migrasi tenant, lihat P0-4 blueprint |
| Authentication | Ya, ringan–sedang | `adminAuth`/`internalAuth` tidak diganti, hanya diberi middleware tambahan setelahnya (Bagian 6) — perubahan aditif, bukan penggantian |

---

## 16. Risk Analysis & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Enforcement terlalu cepat memutus akses staf/klien ke data mereka sendiri (regresi akses) | Shadow mode di Phase 1 wajib dijalankan cukup lama untuk memverifikasi resolusi tenant benar sebelum enforcement apa pun dinyalakan |
| Semantik "shared/null tenant" pada katalog rusak karena tergesa dianggap harus selalu terisi | Domain katalog/pricing tetap mempertahankan jalur query khusus untuk data shared (Bagian 7) — tidak dipaksa NOT NULL sampai keputusan produk eksplisit dibuat tentang apakah katalog akan tetap shared secara permanen |
| Superadmin cross-tenant disalahgunakan tanpa jejak audit | Wajibkan audit log untuk setiap akses cross-tenant sejak awal (Bagian 6 & 12), bukan ditambahkan belakangan |
| Migrasi berhenti di tengah jalan karena skala kerja diremehkan | Struktur per-domain dengan flag independen (Bagian 14) memastikan setiap domain yang sudah selesai tetap bernilai meski domain lain belum, tidak all-or-nothing |
| RLS di Phase 3 memblokir query sah karena bug policy | Jalur disable cepat tanpa mengubah data (rollback strategy Bagian 14) sebagai jaring pengaman |
| Job/worker lama yang belum punya tenant field menyebabkan job "yatim" tanpa tenant context saat migrasi | Backfill Phase 1 memberi default `'default'` tenant ke seluruh data historis termasuk job yang mungkin masih tertunda saat migrasi berjalan |

---

## 17. Implementation Order (Urutan Paling Aman)

1. Bangun middleware `resolveTenantContext` dalam mode shadow (logging saja) — validasi logika resolusi tanpa risiko apa pun ke traffic produksi.
2. Tambah kolom `tenant_id` nullable+default ke seluruh tabel (Phase 1 skema) — aditif, tidak mengubah perilaku yang ada.
3. Tambah field tenant ke `AiJob`/`aiSchedulesTable`, diisi dari context resolusi shadow saat enqueue.
4. Aktifkan enforcement repository layer untuk domain katalog/pricing (risiko terendah) di belakang flag.
5. Perbaiki pola `parseTenantId` di `marketplace.ts` agar memakai tenant context tepercaya, bukan input request mentah.
6. Aktifkan enforcement untuk domain commercial (quotation/commercial gates), diselaraskan dengan keputusan canonical path (P0-4).
7. Aktifkan enforcement untuk domain project inti (risiko tertinggi) — hanya setelah langkah 4–6 terbukti stabil.
8. Aktifkan validasi kepemilikan tenant di worker export, SSE subscriber registration, dan AI client memory.
9. Jadikan tenant field wajib di audit log untuk seluruh pemanggilan baru.
10. Ubah kolom tenant menjadi NOT NULL (Phase 3) setelah seluruh domain di atas stabil dalam periode observasi.
11. Aktifkan RLS sebagai lapisan kedua independen.

---

## 18. Acceptance Criteria

- Setiap tabel tenant-eligible memiliki `tenant_id` terisi valid untuk 100% baris (kecuali tabel yang secara sadar didokumentasikan sebagai shared/global).
- Tidak ada satu pun jalur kode yang bisa mengeksekusi query ke tabel tenant-scoped tanpa tenant context eksplisit yang berasal dari sumber tepercaya (session/token-derived), dibuktikan lewat code review checklist yang menjadi bagian dari definition-of-done implementasi.
- `marketplace.ts` tidak lagi menerima `tenantId` langsung dari body/query request tanpa validasi terhadap identitas pemanggil.
- Seluruh job/schedule yang dibuat setelah Phase 1 membawa tenant context eksplisit yang diverifikasi konsisten dengan resource yang diprosesnya sebelum eksekusi.
- Worker export memverifikasi kepemilikan tenant sebelum menghasilkan dokumen/presentasi/ZIP/thumbnail/preview apa pun.
- SSE subscriber registration menolak permintaan yang tenant-nya tidak cocok dengan channel yang diminta.
- Audit log mencatat tenant context di setiap entri baru, dan setiap akses cross-tenant superadmin menghasilkan entri audit tersendiri.
- RLS aktif dan terbukti secara independen memblokir akses cross-tenant bahkan bila filter aplikasi (secara sengaja untuk keperluan pengujian) dilewati.
- Tersedia jalur rollback yang teruji untuk setiap fase tanpa risiko kehilangan data.

---

## 19. Testing Strategy

**Unit Test**
- Middleware `resolveTenantContext` — setiap jalur resolusi (session internal, session customer, token publik → project → tenant, superadmin) diuji terpisah, termasuk kasus gagal resolusi.
- Repository layer helper — memastikan setiap fungsi query menolak/tidak mengeksekusi jika tenant context tidak disertakan (untuk tabel tenant-scoped), dan tetap mengizinkan jalur shared/global bekerja seperti sediakala.

**Integration Test**
- End-to-end alur customer portal & token publik: memverifikasi hanya data milik tenant/project yang sesuai token yang pernah muncul di response, mencakup seluruh endpoint yang mengembalikan data project.
- Alur admin: memverifikasi staf non-superadmin hanya melihat data tenant mereka; superadmin bisa melihat lintas-tenant dan aksinya tercatat di audit log.

**Security Test (Adversarial)**
- Mencoba membaca/menulis data tenant lain dengan memanipulasi id (`projectId`, `tenantId` di body request seperti pola `marketplace.ts` lama) — harus ditolak.
- Mencoba subscribe SSE ke channel project milik tenant lain menggunakan token/session tenant sendiri — harus ditolak.
- Mencoba men-enqueue job atau schedule yang menargetkan resource milik tenant lain — harus ditolak sebelum job diklaim/dieksekusi.

**Tenant Isolation Test (Dedicated Suite)**
- Seed dua atau lebih tenant sintetis dengan struktur data yang tumpang tindih (nama project/klien yang mirip secara sengaja untuk menghindari isolasi "kebetulan" karena data berbeda bentuk).
- Jalankan seluruh permukaan yang dipetakan di blueprint ini (service, repository, route, middleware, worker, scheduler, SSE, export, AI workflow, audit log) dan pastikan nol kebocoran silang di setiap permukaan.

**Regression Test**
- Jalankan seluruh test suite yang sudah ada plus smoke test khusus untuk memverifikasi semantik "shared/global" pada katalog & pricing tetap berfungsi benar selama dan setelah migrasi (tidak tiba-tiba ter-scope ke satu tenant secara tidak sengaja).

---

*Blueprint ini murni perencanaan teknis berdasarkan bukti source code aktual dan hasil audit/validasi sebelumnya. Tidak ada kode, migration, atau perubahan konfigurasi apa pun yang dibuat dalam penyusunan dokumen ini.*
