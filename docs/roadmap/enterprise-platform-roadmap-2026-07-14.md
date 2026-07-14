# Roadmap Implementasi Enterprise — Creative Agency AI Platform
**Tanggal:** 14 Juli 2026
**Disusun oleh:** Principal Product/Solution Architect (peran audit)
**Basis:** `docs/audit/enterprise-readiness-audit-2026-07-14.md` + `docs/audit/enterprise-readiness-audit-validation-2026-07-14.md`
**Sifat dokumen:** Roadmap perencanaan murni. **Tidak ada source code, migration, atau commit yang diubah dalam penyusunan dokumen ini.**

---

## 1. Executive Summary

Platform ini adalah **Creative Agency AI Enterprise** dengan fondasi teknis yang jauh lebih matang dari kesan awal — job engine dengan atomic locking, SSE real-time, cost tracking granular per model AI, 6 deliverable aktif (termasuk Presentation Engine/Pitch Deck yang sempat terlewat di audit pertama), dan security middleware dasar (rate limiting, SSRF guard, payment gate) semuanya nyata dan berfungsi.

Namun, tiga defisiensi struktural menghalangi platform ini disebut *enterprise-ready* secara penuh: **(1) tidak ada isolasi multi-tenant yang ditegakkan sistem** (kolom `tenant_id` ada di skema tapi nol dipakai dalam query filtering — dikonfirmasi di audit validasi dengan confidence 100%), **(2) tidak ada soft-delete/retention policy** (hard-delete masih terjadi aktif di produksi), dan **(3) dua jalur quotation paralel** yang hidup bersamaan tanpa jalur pensiun yang jelas.

Selain itu, fitur andalan "Creative Consultant" saat ini secara fungsional adalah **agregator terformat**, bukan konsultan strategis sungguhan — gap ini penting karena nama fitur menjanjikan nilai bisnis (analisis strategis) yang belum benar-benar dikirim ke klien.

Roadmap ini menyusun jalur perbaikan dalam 5 fase (P0–P4), diprioritaskan sesuai urutan bisnis yang diminta: **Security → Architecture → Scalability → Business Value → Customer Experience → Admin Experience → AI Quality → Enterprise Readiness**. Setiap rekomendasi diverifikasi kembali terhadap bukti kode aktual dari kedua audit sebelumnya — bukan asumsi.

---

## 2. Current Platform Position

**Yang sudah solid (jangan disentuh, jadi fondasi):**
- Job engine (`jobWorkerService.ts`, `queueManagerService.ts`) — atomic claiming, exponential backoff
- SSE real-time (`sseManager.ts`) — fan-out, heartbeat, connection limit
- Cost tracking granular (`costService.ts`, tabel `ai_cost_records`)
- 6 deliverable aktif: Company Profile, Brand Strategy, Copywriting, Creative Consultation, Brand Identity Guideline (PDF) + **Pitch Deck (PPTX, via `services/presentation/`)**
- Payment gate, rate limiting, SSRF guard, auth hybrid (API key + session) — semua nyata di middleware layer
- 4-step Creative AI pipeline (Brand Strategist → Creative Director → Copywriter → QC) dengan model AI sungguhan (`executeAI` via `aiExecutionService.ts`)
- Human Task Center, Event Bus, Workforce/Org Chart — siklus penuh dan live

**Yang jadi ganjalan struktural (fokus roadmap ini):**
- Tenant isolation nol enforcement di level query
- Soft delete tidak ada — hard delete aktif di produksi
- Dua jalur quotation paralel (`creative_project_quotations` legacy vs `ai_quotations` aktif)
- Creative Consultant = agregator, bukan konsultan strategis
- Duplikasi struktur pipeline antara `aiCeoService` dan `creativeWorkflowRunner` (arsitektur bloat, walau **tidak** menyebabkan duplicate AI call — sudah dikonfirmasi di audit validasi)
- Beberapa fitur berstatus scaffolded (`client-memory`) yang belum jelas arah pengembangannya

**Skor overall dari audit: 61/100.** Roadmap ini dirancang untuk menaikkan skor tersebut secara terukur per fase, dengan fokus dampak bisnis terbesar lebih dulu.

---

## 3. Critical Findings (terverifikasi, sudah dikoreksi dari validation audit)

| # | Temuan | Status Verifikasi | Dampak |
|---|---|---|---|
| 1 | Tenant isolation nol enforcement — `tenant_id` text tanpa filter query manapun | ✅ Benar, 100% | Risiko kebocoran data lintas klien — **blocker utama untuk menjual ke banyak klien enterprise sekaligus** |
| 2 | Tidak ada soft-delete — hard delete aktif (`cp-review.ts` L611) | ✅ Benar, 95% | Risiko kehilangan data permanen, gagal memenuhi ekspektasi audit/compliance enterprise |
| 3 | Dua jalur quotation paralel hidup bersamaan | ✅ Benar, 100% | Risiko bug inkonsistensi status, beban maintenance ganda |
| 4 | Creative Consultant = agregator, bukan konsultan strategis (nol AI call khusus) | ⚠ Sebagian benar, 65% | Gap antara janji fitur dan realita — risiko reputasi jika dijual sebagai "AI consultant" penuh |
| 5 | Duplikasi struktur pipeline `aiCeoService` vs `creativeWorkflowRunner` | ⚠ Sebagian benar — overlap arsitektur nyata, TAPI **tidak** ada duplicate AI call/pemborosan biaya (dikoreksi di validasi) | Kembung arsitektur, bukan pemborosan biaya — prioritas lebih rendah dari yang dikira awal |
| 6 | Presentation Engine ternyata **sudah ada dan aktif** (false negative audit pertama) | ❌ Klaim awal salah | Platform lebih lengkap dari kesan awal — reposisi fokus roadmap ke *kualitas* & *penemuan fitur*, bukan pembuatan dari nol |
| 7 | 7 workflow AI tambahan luput dari audit pertama (Brief Intelligence, Live Preview, Demo Portfolio Generator, dll) | Ditemukan di validasi | Perlu katalogisasi resmi agar tidak ada fitur "tersembunyi" yang tidak terkelola |

---

## 4. Priority Matrix

| Kategori Prioritas Bisnis | P0 | P1 | P2 | P3 | P4 |
|---|---|---|---|---|---|
| **Security** | Tenant isolation enforcement, Audit log konsisten | Secrets/permission hardening | — | — | — |
| **Architecture** | Konsolidasi quotation (canonical path) | Konsolidasi orkestrasi AI CEO vs Workflow Runner | Feature registry resmi (client-memory, dll) | — | — |
| **Scalability** | — | Index database hot-path, job progress granular | Multi-region considerations | — | Horizontal worker scaling |
| **Business Value** | — | Creative Consultant upgrade tahap 1 (Executive Summary + Recommendation asli) | Deliverable baru sesuai riset permintaan (Proposal, Landing Page) | Investor deck template | Vertical industry packages |
| **Customer Experience** | — | Migrasi polling → SSE di Commercial Gate | Unifikasi Public Flow vs Workspace Flow, Export History global | Personalisasi UX per industri | — |
| **Admin Experience** | — | Progress job granular, edit inline hasil AI | Dashboard reasoning trace terpusat | — | — |
| **AI Quality** | — | Creative Consultant sintesis asli (tahap 2) | Optimasi cost (payload vision-QC, prompt size) | Model routing lanjutan | Continuous QC feedback loop |
| **Enterprise Readiness** | Soft delete + retention policy | RLS/tenant context di DB layer | SOC2-style audit trail lengkap | — | Multi-region deployment |

---

## 5. Roadmap P0 — Critical

### P0.1 — Tenant Isolation Enforcement
- **Tujuan:** Menegakkan isolasi data antar klien/tenant secara sistemik, bukan konvensi manual.
- **Alasan bisnis:** Platform ini menjual jasa ke banyak klien berbeda sekaligus (agency model) — kebocoran data satu klien ke klien lain adalah risiko reputasi dan legal yang fatal, serta blocker keras untuk kontrak enterprise mana pun yang mensyaratkan audit keamanan data.
- **Alasan teknis:** `tenant_id` ada di skema tapi dikonfirmasi **nol dipakai** dalam filter query (`where.*tenant_id` = 0 hasil pencarian). Middleware tenant-scoping tidak ada sama sekali.
- **Risiko bila tidak dikerjakan:** Query yang lupa filter tenant akan membocorkan data lintas klien tanpa terdeteksi — bug kelas "silent data leak" yang paling mahal untuk ditemukan setelah insiden terjadi.
- **Impact:** Sangat tinggi (keamanan data + syarat mutlak kontrak enterprise)
- **Complexity:** Tinggi (menyentuh hampir semua query layer)
- **Dependencies:** Tidak ada — ini fondasi, harus dikerjakan sebelum fitur besar lain yang menambah lebih banyak tabel bertenant.
- **Estimasi effort:** Besar (multi-sprint)
- **Estimasi risk:** Tinggi bila dikerjakan tergesa (regresi akses data) — mitigasi dengan strategi bertahap (lihat Appendix A).

### P0.2 — Audit Log Konsisten & Terpusat
- **Tujuan:** Memastikan setiap mutasi data penting (create/update/delete) tercatat di `ai_audit_logs` secara seragam, bukan tergantung disiplin masing-masing service.
- **Alasan bisnis:** Syarat dasar kepercayaan enterprise (siapa mengubah apa, kapan) — dibutuhkan untuk investigasi sengketa klien dan compliance.
- **Alasan teknis:** Audit log sudah ada sebagai tabel, tapi ditulis manual per service — konsistensinya tidak terjamin secara sistemik.
- **Risiko bila tidak dikerjakan:** Investigasi insiden/sengketa data menjadi tidak mungkin dilakukan secara andal.
- **Impact:** Tinggi
- **Complexity:** Sedang
- **Dependencies:** Idealnya berjalan seiring P0.1 (tenant context yang sama bisa dipakai untuk audit context).
- **Estimasi effort:** Sedang
- **Estimasi risk:** Rendah

### P0.3 — Soft Delete & Retention Foundation
- **Tujuan:** Mengganti hard-delete pada entitas bernilai bisnis (project, dokumen, komentar klien) dengan soft-delete + kebijakan retensi.
- **Alasan bisnis:** Klien enterprise mengharapkan kemampuan recovery data dan audit trail penghapusan — kehilangan data klien secara permanen karena bug adalah risiko kontraktual.
- **Alasan teknis:** Dikonfirmasi hard-delete aktif di produksi (`cp-review.ts` L611: `db.delete()` langsung). Tidak ada `deleted_at`/`is_deleted` di manapun.
- **Risiko bila tidak dikerjakan:** Data hilang permanen tanpa recovery, termasuk akibat human error staf internal.
- **Impact:** Tinggi
- **Complexity:** Sedang–Tinggi (perlu strategi migrasi skema untuk tabel yang sudah punya hard-delete path aktif)
- **Dependencies:** Tidak bergantung P0.1, bisa paralel.
- **Estimasi effort:** Sedang
- **Estimasi risk:** Sedang (perlu hati-hati agar tidak mengubah semantik status yang sudah dipakai seperti `archived`)

### P0.4 — Quotation Canonical Path Decision & Freeze
- **Tujuan:** Menetapkan `ai_quotations` (service-catalog flow) sebagai **canonical workflow**, dan membekukan (freeze, bukan hapus) jalur legacy `creative_project_quotations` agar tidak menerima data baru.
- **Alasan bisnis:** Dua sumber kebenaran untuk status komersial adalah risiko langsung ke pendapatan — kesalahan status quotation bisa berarti klien membayar tapi produksi tidak dimulai, atau sebaliknya.
- **Alasan teknis:** Dikonfirmasi kedua jalur live bersamaan tanpa flag nonaktif; `serviceRequestConversionService.ts` sudah punya percabangan eksplisit legacy vs service-catalog — titik keputusan sudah ada di kode, tinggal ditegakkan sebagai kebijakan resmi.
- **Risiko bila tidak dikerjakan:** Bug fix di satu jalur terus-menerus lupa diterapkan ke jalur lain; developer baru bingung jalur mana yang harus dipakai untuk fitur baru.
- **Impact:** Tinggi
- **Complexity:** Sedang (keputusan governance dulu, migrasi data setelahnya — lihat Appendix C)
- **Dependencies:** Sebaiknya sebelum menambah deliverable baru yang menyentuh sisi komersial.
- **Estimasi effort:** Kecil untuk keputusan governance; Sedang untuk migrasi data historis.
- **Estimasi risk:** Sedang (data quotation lama harus tetap bisa diakses/dilaporkan meski jalur baru tidak lagi menerima input)

---

## 6. Roadmap P1 — High Priority

### P1.1 — Konsolidasi Orkestrasi: aiCeoService vs creativeWorkflowRunner
- **Tujuan:** Menyatukan definisi pipeline 4-langkah yang saat ini didefinisikan dua kali (di `PIPELINE` constant runner dan `steps` array CEO) menjadi satu sumber kebenaran.
- **Alasan bisnis:** Mengurangi risiko dua tempat berbeda memberi informasi progres/plan yang tidak sinkron ke admin.
- **Alasan teknis:** Dikonfirmasi tidak menyebabkan duplicate AI call (jadi bukan soal biaya), tapi tetap kembung arsitektur — dua "otak" untuk alur yang sama menyulitkan maintenance jangka panjang.
- **Risiko bila tidak dikerjakan:** Setiap perubahan pipeline (menambah langkah, mengubah urutan) harus diubah di dua tempat — risiko drift semakin besar seiring waktu.
- **Impact:** Sedang–Tinggi (maintainability jangka panjang)
- **Complexity:** Sedang
- **Dependencies:** Tidak ada
- **Estimasi effort:** Sedang
- **Estimasi risk:** Rendah–Sedang

### P1.2 — Migrasi Polling → SSE di Commercial Gate
- **Tujuan:** Mengganti `setInterval` polling 5 detik di `CommercialGatePage` dengan koneksi SSE yang sudah tersedia matang di sistem (`sseManager.ts`).
- **Alasan bisnis:** Pengalaman klien menunggu verifikasi pembayaran terasa lebih instan — momen kritis dalam funnel konversi (transisi dari calon klien ke klien berbayar).
- **Alasan teknis:** Infrastruktur SSE sudah ada dan matang (heartbeat, connection limit) — pekerjaan murni "pemakaian ulang", bukan membangun dari nol.
- **Risiko bila tidak dikerjakan:** Kesan lambat di titik paling sensitif secara komersial (pasca-bayar), berpotensi meningkatkan drop-off klien.
- **Impact:** Sedang–Tinggi (dampak langsung ke conversion)
- **Complexity:** Rendah
- **Dependencies:** Tidak ada
- **Estimasi effort:** Kecil
- **Estimasi risk:** Rendah

### P1.3 — Admin: Progress Job Granular & Edit Inline
- **Tujuan:** Menambah indikator progres persentase (bukan hanya status biner running/completed) dan kemampuan edit langsung hasil AI tanpa retry job penuh.
- **Alasan bisnis:** Staf operasional saat ini harus menunggu buta tanpa tahu seberapa jauh sebuah job berjalan, dan harus retry seluruh job hanya untuk memperbaiki satu kalimat — ini beban operasional harian nyata.
- **Alasan teknis:** `jobs.ts` saat ini hanya punya `startedAt` + `status`; tidak ada granularity progres. Override job hanya untuk prioritas/re-queue, bukan edit konten.
- **Risiko bila tidak dikerjakan:** Beban kerja staf tetap tinggi, waktu turnaround pengerjaan revisi kecil menjadi lambat karena harus full retry.
- **Impact:** Sedang (efisiensi operasional)
- **Complexity:** Sedang
- **Dependencies:** Sebaiknya setelah P1.1 (struktur pipeline yang bersih memudahkan pelaporan progres per langkah)
- **Estimasi effort:** Sedang
- **Estimasi risk:** Rendah

### P1.4 — Creative Consultant Upgrade Tahap 1 (lihat detail di Bagian 10)
- **Tujuan:** Menambahkan Executive Summary dan Recommendation yang benar-benar disintesis (bukan re-format field lama).
- **Alasan bisnis:** Ini deliverable yang paling langsung dilihat klien sebagai "nilai konsultasi" — meningkatkan kualitasnya berdampak langsung ke persepsi kualitas layanan dan potensi upsell.
- **Alasan teknis:** Saat ini nol AI call khusus untuk dokumen ini — semua data sudah tersedia dari 4-step pipeline, jadi menambah satu langkah sintesis LLM tambahan adalah perubahan yang terukur dan bertahap.
- **Risiko bila tidak dikerjakan:** Gap antara nama fitur ("Creative Consultant") dan isi sesungguhnya tetap ada — risiko kekecewaan klien bila ekspektasi tidak dikelola.
- **Impact:** Tinggi (business value langsung)
- **Complexity:** Sedang
- **Dependencies:** Tidak bergantung pada P0
- **Estimasi effort:** Sedang
- **Estimasi risk:** Rendah–Sedang (biaya AI tambahan per dokumen, perlu diukur di cost tracking yang sudah ada)

### P1.5 — Database Indexing untuk Hot-Path
- **Tujuan:** Menambahkan index pada kolom yang sering dipakai untuk filter (`ai_audit_logs.resource_id`, `customer_support_tickets.status`, dsb).
- **Alasan bisnis:** Latensi yang lebih rendah di dashboard admin dan portal klien saat data bertambah besar seiring pertumbuhan jumlah klien.
- **Alasan teknis:** Dikonfirmasi di audit awal kolom-kolom ini dipakai aktif untuk filter tapi belum terindeks.
- **Risiko bila tidak dikerjakan:** Query melambat secara bertahap seiring pertumbuhan data, tanpa gejala jelas sampai tiba-tiba jadi masalah performa besar.
- **Impact:** Sedang (scalability jangka menengah)
- **Complexity:** Rendah
- **Dependencies:** Tidak ada
- **Estimasi effort:** Kecil
- **Estimasi risk:** Rendah

---

## 7. Roadmap P2 — Medium Priority

### P2.1 — Feature Registry Resmi & Status Fitur Scaffolded
- **Tujuan:** Mendokumentasikan status resmi setiap fitur (LIVE/PARTIAL/SCAFFOLDED) berdasarkan feature registry hasil audit validasi (§10 validation audit), termasuk keputusan eksplisit untuk `client-memory` (scaffolded) — lanjutkan, hentikan, atau alihkan resource.
- **Alasan bisnis:** Mencegah developer baru menghabiskan waktu di fitur yang sebenarnya tidak jadi prioritas, atau sebaliknya, mengabaikan fitur yang sudah setengah jadi dan berharga.
- **Alasan teknis:** 7 workflow AI ditemukan tidak tercatat resmi di audit pertama — indikasi tidak ada katalog fitur terpusat yang dipelihara.
- **Risiko bila tidak dikerjakan:** Technical debt "tersembunyi" terus bertambah tanpa visibilitas.
- **Impact:** Sedang
- **Complexity:** Rendah (dokumentasi, bukan kode)
- **Dependencies:** Tidak ada
- **Estimasi effort:** Kecil
- **Estimasi risk:** Rendah

### P2.2 — Unifikasi Public Flow vs Workspace Flow (Customer Portal)
- **Tujuan:** Menyatukan alur berbasis token publik (`/review/:token`) dengan alur akun workspace persisten (`/workspace/:token/projects/:number`) agar transisi terasa mulus.
- **Alasan bisnis:** Klien yang kembali (repeat business) saat ini mengalami pengalaman terpecah antara mode "sekali pakai" dan mode "akun" — ini menghambat retensi.
- **Alasan teknis:** Dikonfirmasi di audit UX bahwa kedua flow ada tapi transisinya di frontend routing belum benar-benar mulus.
- **Risiko bila tidak dikerjakan:** Klien lama bingung navigasi, berpotensi menambah beban support.
- **Impact:** Sedang
- **Complexity:** Sedang
- **Dependencies:** Tidak ada
- **Estimasi effort:** Sedang
- **Estimasi risk:** Rendah

### P2.3 — Export History Global
- **Tujuan:** Satu halaman untuk klien mengunduh semua deliverable dari seluruh project mereka, bukan per-project.
- **Alasan bisnis:** Kemudahan akses ulang dokumen tanpa harus mencari-cari per project — relevan untuk klien dengan banyak project berjalan (mis. agency yang mewakili banyak brand).
- **Alasan teknis:** Data metadata sudah lengkap di `creative_ai_assets` — ini murni agregasi tampilan, bukan pekerjaan backend besar.
- **Risiko bila tidak dikerjakan:** Pengalaman kurang nyaman untuk klien dengan volume project tinggi (segmen bernilai tinggi).
- **Impact:** Rendah–Sedang
- **Complexity:** Rendah
- **Dependencies:** Tidak ada
- **Estimasi effort:** Kecil
- **Estimasi risk:** Rendah

### P2.4 — Optimasi Biaya AI (Vision QC Payload & Prompt Size)
- **Tujuan:** Mengurangi ukuran payload yang dikirim ke model vision untuk QC gambar (saat ini full image buffer sebagai `data:image` URI) dan membatasi ukuran JSON yang di-serialize ke prompt lanjutan di `creativeAiService.ts`.
- **Alasan bisnis:** Margin lebih sehat per project seiring skala — biaya AI adalah COGS langsung untuk model bisnis ini.
- **Alasan teknis:** Dikonfirmasi di audit sebagai potensi token-heavy tanpa mekanisme caching atau downscale.
- **Risiko bila tidak dikerjakan:** Biaya AI tumbuh linear atau lebih cepat dari pendapatan seiring skala volume project.
- **Impact:** Sedang (margin bisnis)
- **Complexity:** Sedang
- **Dependencies:** Tidak ada
- **Estimasi effort:** Sedang
- **Estimasi risk:** Rendah

### P2.5 — Deliverable Baru Berbasis Riset Permintaan (Proposal, Landing Page)
- **Tujuan:** Menambah 1–2 deliverable baru **hanya** yang terbukti diminta oleh basis klien saat ini (bukan menambah semua 8 jenis yang disebutkan di visi produk sekaligus).
- **Alasan bisnis:** Meningkatkan cakupan layanan tanpa membangun kapasitas yang tidak terpakai (nice-to-have berlebihan justru menambah beban maintenance tanpa ROI jelas).
- **Alasan teknis:** Pola registry (`creativeDocumentRegistry.ts`, `creativePresentationRegistry.ts`) sudah terbukti extensible — menambah deliverable baru adalah pekerjaan yang well-understood, bukan riset ulang arsitektur.
- **Risiko bila tidak dikerjakan:** Kompetitor dengan cakupan lebih luas bisa mengambil klien yang butuh deliverable spesifik ini.
- **Impact:** Sedang (tergantung hasil riset permintaan riil)
- **Complexity:** Sedang per deliverable
- **Dependencies:** Sebaiknya setelah P0.4 (quotation canonical) agar deliverable baru langsung terhubung ke jalur komersial yang benar
- **Estimasi effort:** Sedang per deliverable
- **Estimasi risk:** Rendah

---

## 8. Roadmap P3 — Low Priority

### P3.1 — Investor Deck Template Khusus
- **Tujuan:** Varian Pitch Deck yang disesuaikan untuk kebutuhan pitching ke investor (struktur konten berbeda dari pitch deck klien komersial biasa).
- **Alasan bisnis:** Membuka segmen startup/SME yang butuh fundraising deck, memanfaatkan Presentation Engine yang sudah ada.
- **Alasan teknis:** Bisa memakai ulang `pitchDeckPresentationMapper.ts` dengan template konten berbeda — bukan membangun engine baru.
- **Risiko bila tidak dikerjakan:** Peluang segmen niche terlewat, tapi bukan blocker bisnis inti.
- **Impact:** Rendah–Sedang (segmen niche)
- **Complexity:** Rendah–Sedang
- **Dependencies:** Presentation Engine (sudah ada)
- **Estimasi effort:** Kecil–Sedang
- **Estimasi risk:** Rendah

### P3.2 — Personalisasi UX per Industri
- **Tujuan:** Menyesuaikan copy/istilah/contoh di brief wizard berdasarkan industri klien (manufaktur vs hospitality vs healthcare, dsb).
- **Alasan bisnis:** Relevansi lebih tinggi meningkatkan completion rate brief wizard.
- **Alasan teknis:** Bisa dibangun di atas `companyProfileBriefIntelligence.ts` yang sudah ada.
- **Risiko bila tidak dikerjakan:** Brief generik terasa kurang relevan untuk industri spesifik — dampak konversi kecil-menengah.
- **Impact:** Rendah–Sedang
- **Complexity:** Sedang
- **Dependencies:** Feature registry (P2.1) untuk memetakan titik personalisasi
- **Estimasi effort:** Sedang
- **Estimasi risk:** Rendah

---

## 9. Roadmap P4 — Future

### P4.1 — Horizontal Worker Scaling
- **Tujuan:** Menyiapkan job worker untuk berjalan di banyak instance/node, bukan hanya scaling vertikal.
- **Alasan bisnis:** Diperlukan hanya jika volume job sudah pada titik yang membutuhkan — bukan kebutuhan hari ini, tapi arsitektur `SELECT FOR UPDATE SKIP LOCKED` yang sudah ada memang dirancang untuk mendukung ini di masa depan.
- **Risiko bila tidak dikerjakan:** Tidak ada risiko saat ini; menjadi risiko hanya jika volume tumbuh signifikan.
- **Impact:** Rendah saat ini, Tinggi di masa depan jika volume tumbuh
- **Complexity:** Tinggi
- **Dependencies:** P0.1 (tenant isolation) harus selesai dulu agar scaling tidak memperbesar risiko kebocoran data
- **Estimasi effort:** Besar
- **Estimasi risk:** Sedang

### P4.2 — Multi-Region Deployment
- **Tujuan:** Mendukung klien enterprise dengan syarat data residency regional.
- **Dependencies:** Seluruh P0 dan sebagian besar P1 harus selesai.
- **Impact:** Tinggi hanya untuk segmen enterprise besar tertentu
- **Complexity:** Sangat tinggi
- **Estimasi effort:** Besar
- **Estimasi risk:** Tinggi

### P4.3 — Continuous QC Feedback Loop
- **Tujuan:** Menggunakan histori keputusan approve/reject/revisi klien untuk secara bertahap menyempurnakan prompt/model routing (bukan retraining model, tapi prompt/heuristic tuning berbasis data historis).
- **Impact:** Sedang–Tinggi jangka panjang (kualitas AI meningkat otomatis dari waktu ke waktu)
- **Complexity:** Tinggi
- **Dependencies:** Data historis approval yang cukup banyak (sudah terkumpul via `creative_ai_client_reviews`)
- **Estimasi effort:** Besar
- **Estimasi risk:** Sedang

### P4.4 — Vertical Industry Packages
- **Tujuan:** Paket layanan siap pakai per industri (mis. paket khusus Manufacturing, paket khusus Healthcare) yang menggabungkan deliverable + brief template + pricing khusus.
- **Dependencies:** P3.2 (personalisasi UX per industri), P2.5 (deliverable tambahan)
- **Impact:** Tinggi untuk ekspansi pasar vertikal
- **Complexity:** Sedang (lebih ke konfigurasi/paket daripada kode baru)
- **Estimasi effort:** Sedang per vertikal
- **Estimasi risk:** Rendah

---

## 10. Creative Consultant Roadmap — Strategic Creative Consultant AI

**Kelayakan upgrade: LAYAK**, dengan justifikasi: seluruh data mentah yang dibutuhkan untuk sintesis strategis (brand strategy, creative direction, copywriting, QC review) **sudah tersedia** dari pipeline yang ada — pekerjaan intinya adalah menambah **satu langkah sintesis LLM baru** yang membaca keempat output tadi dan menghasilkan analisis strategis asli, bukan membangun pipeline data dari nol.

**Rekomendasi bertahap (bukan sekaligus):**

**Tahap 1 (selaras P1.4):** Tambahkan sintesis untuk elemen yang paling berdampak langsung ke persepsi klien:
- Executive Summary (ringkasan strategis 1 paragraf, disintesis, bukan disalin dari goal proyek)
- Business Analysis yang benar-benar menganalisis (bukan hanya "Client Context" mentah)
- Recommendation yang divalidasi ulang oleh sintesis (bukan hanya field yang sudah ada)

**Tahap 2:** Tambahkan elemen yang butuh perbandingan/analisis lebih dalam:
- Marketing Audit (analisis kesiapan materi marketing klien, bukan sekadar brand audit)
- Competitive Insight (butuh input tambahan — data kompetitor dari brief atau riset eksternal)
- Gap Analysis (kondisi saat ini vs target yang dinyatakan klien di brief)
- Risk Analysis versi lebih dalam (saat ini sudah ada versi dasar — perkuat dengan analisis dari data project)

**Tahap 3:** Elemen yang butuh data historis/lintas-proyek:
- ROI Recommendation (butuh data biaya vs hasil — bisa dikaitkan dengan `ai_cost_records` dan data konversi klien jika tersedia)
- Implementation Checklist yang benar-benar actionable dan spesifik proyek (bukan daftar trait generik seperti saat ini)
- Roadmap dinamis (bukan "Next Steps" statis) — disesuaikan dengan timeline dan status project sebenarnya
- Decision Support analitis (opsi keputusan dengan trade-off, bukan sekadar skor QC)
- Expected Outcome (proyeksi hasil yang realistis berdasarkan data historis project sejenis)
- Next Consultation (rekomendasi kapan dan tentang apa sesi lanjutan sebaiknya dilakukan)

**Alasan pentahapan:** Tahap 1 memberi dampak persepsi klien paling cepat dengan effort paling kecil (murni tambahan 1 langkah LLM). Tahap 2 dan 3 butuh data tambahan (kompetitor, histori lintas-proyek) yang belum tentu tersedia hari ini — memaksakan semuanya sekaligus berisiko menghasilkan konten yang terdengar meyakinkan tapi tidak akurat (halusinasi AI tanpa data pendukung nyata).

**Catatan penting:** setiap penambahan sintesis LLM baru menambah biaya AI per dokumen — ini harus diukur lewat `costService.ts` yang sudah ada, dan idealnya dijadikan bagian dari harga paket "Creative Consultation" yang lebih premium dibanding paket dasar.

---

## Appendix A — Roadmap Khusus Multi-Tenant

Bertahap, tanpa implementasi:

1. **Tenant Context Foundation:** Definisikan bagaimana tenant context ditentukan di setiap request (dari token/session yang sudah ada, bukan struktur baru) — ini keputusan desain, bukan kode.
2. **Middleware Tenant Resolver:** Titik tunggal di request lifecycle yang menetapkan tenant context, sejalan dengan `adminAuth`/`internalAuth` yang sudah ada polanya.
3. **Query Isolation di Repository Layer:** Setiap fungsi akses data melalui titik yang otomatis menyertakan filter tenant — bukan mengandalkan setiap developer mengingat menambahkan `WHERE tenant_id = ?` secara manual.
4. **Authorization Layer:** Menyatukan pengecekan tenant dengan role-based access yang sudah ada (`internalAuth`'s `requireInternalRole`) agar satu request diperiksa dari dua sisi (siapa dia + tenant mana dia boleh akses).
5. **RLS sebagai Lapisan Pertahanan Kedua:** Setelah query isolation di level aplikasi solid, tambahkan Postgres RLS sebagai jaring pengaman terakhir (defense in depth) — bukan pengganti isolasi di level aplikasi.
6. **Audit Log Terintegrasi Tenant Context:** Setiap entri audit log menyertakan tenant context secara otomatis dari langkah 2, bukan diisi manual per service (selaras P0.2).

**Urutan ini penting:** tenant context dan middleware harus ada dulu sebelum RLS dipasang, karena RLS butuh mekanisme untuk mengetahui "siapa yang sedang bertanya" di level koneksi database.

---

## Appendix B — Roadmap Khusus Soft Delete

Bertahap, tanpa implementasi:

1. **Klasifikasi Entitas:** Tentukan mana entitas yang butuh soft-delete (project, dokumen, komentar klien — data bernilai bisnis/legal) vs mana yang boleh tetap hard-delete (data teknis/cache/log sementara).
2. **Pola Kolom Standar:** Tetapkan konvensi kolom (`deleted_at`, opsional `deleted_by`) yang dipakai konsisten di semua tabel yang diklasifikasi butuh soft-delete di langkah 1 — bukan pola ad-hoc per tabel.
3. **Query Filtering Otomatis:** Titik tunggal yang menyaring record ber-status "deleted" dari hasil query normal, sejalan dengan pola query isolation di Appendix A (bisa dibangun bersamaan).
4. **Restore Flow:** Mekanisme mengembalikan record yang di-soft-delete, dengan batas waktu tertentu (selaras kebijakan retensi di langkah 5).
5. **Retention & Purge Policy:** Kebijakan bisnis eksplisit — berapa lama record soft-deleted disimpan sebelum benar-benar dihapus permanen (purge), disesuaikan dengan kebutuhan compliance/kontrak klien.
6. **Audit Trail Penghapusan:** Setiap soft-delete dan purge tercatat di audit log (terhubung dengan P0.2) — termasuk siapa yang menghapus dan kapan purge terjadwal terjadi.

**Catatan:** migrasi tabel yang sudah punya hard-delete aktif (mis. `cp-review.ts`) harus dilakukan hati-hati — perilaku yang sudah ada tidak boleh berubah drastis tanpa kajian dampak ke fitur yang bergantung padanya.

---

## Appendix C — Keputusan Konsolidasi Quotation

- **Canonical workflow:** `ai_quotations` (service-catalog flow) — karena ini yang terintegrasi dengan `commercialGateService.ts` dan `serviceRequestConversionService.ts` modern, dan sudah eksplisit disebut sebagai jalur "service-catalog" di kode.
- **Yang harus dipensiunkan:** `creative_project_quotations` (legacy flow) — **dipensiunkan secara bertahap** (freeze input baru dulu, bukan dihapus langsung), karena masih jadi entry point aktif untuk project non-katalog yang sudah berjalan.
- **Yang harus dimigrasikan:** Data historis di `creative_project_quotations` untuk project yang masih aktif/berjalan perlu dipetakan ke struktur `ai_quotations` (atau tetap dibiarkan read-only untuk keperluan laporan historis) — keputusan ini butuh masukan bisnis: apakah ada project lama yang masih harus bisa menerima quotation baru lewat jalur legacy, atau semua project baru wajib lewat jalur service-catalog mulai tanggal tertentu.
- **Prasyarat sebelum freeze:** pastikan semua kapabilitas komersial yang saat ini hanya ada di jalur legacy (jika ada) sudah tersedia paritas fungsional di jalur `ai_quotations`, agar freeze tidak menghilangkan kapabilitas yang masih dipakai.

---

## 11. Deliverable Evolution

| Deliverable | Status | Catatan |
|---|---|---|
| Company Profile (PDF) | **Production Ready** | End-to-end lengkap, versioning ada |
| Brand Strategy (PDF) | **Production Ready** | End-to-end lengkap |
| Copywriting Package (PDF) | **Production Ready** | End-to-end lengkap |
| Brand Identity Guideline (PDF) | **Production Ready** | Butuh logo asset — sudah tervalidasi jalannya |
| Pitch Deck (PPTX) | **Needs Improvement** | Sudah aktif & wired, tapi perlu verifikasi kualitas output dan cakupan pemakaian nyata (customer-facing exposure perlu dikonfirmasi lebih lanjut di lapangan) |
| Creative Consultation (PDF) | **Needs Improvement** | Fungsional tapi belum benar-benar strategis (lihat Bagian 10) |
| Investor Deck variant | **Planned** (P3.1) | Varian dari Pitch Deck yang sudah ada |
| Proposal, Landing Page | **Planned** (P2.5, kondisional riset permintaan) | Belum ada, ditambah hanya jika terbukti dibutuhkan |
| Social Media asset mandiri, Packaging, Banner, Poster, Logo generator | **Missing** | Tidak direkomendasikan dikerjakan tanpa bukti permintaan riil — lihat prinsip "jangan menambahkan fitur sembarangan" |
| Quotation Legacy (`creative_project_quotations`) sebagai jalur | **Deprecated** (rencana, lihat Appendix C) | Bukan deliverable dokumen, tapi jalur workflow yang perlu dipensiunkan |

---

## 12. AI Evolution Roadmap

| Komponen AI | Klasifikasi | Catatan |
|---|---|---|
| 4-step Creative Pipeline (Brand Strategist, Creative Director, Copywriter, QC Text) | **Stable** | Berfungsi baik, sudah ada cost tracking |
| Image Designer Pipeline (Prompt Generator, Image Designer, Image QC) | **Needs Optimization** | Payload vision-QC token-heavy (P2.4) |
| Intelligent Router | **Stable** | Sudah memilih model berdasarkan kapabilitas/biaya/latensi |
| aiCeoService | **Needs Refactor** | Overlap struktural dengan Workflow Runner (P1.1); saat ini murni deterministik, bisa disederhanakan atau digabung |
| Creative Consultation synthesis | **Needs Refactor** menuju **Future AI** | Perlu ditingkatkan jadi sintesis LLM asli (Bagian 10) |
| Company Profile Brief Intelligence, Document Mapper, QC Service | **Stable** (perlu dikonfirmasi cakupan pemakaian) | Ditemukan di audit validasi, belum tercatat resmi sebelumnya — masuk ke feature registry (P2.1) |
| Live AI Preview | **Needs Refactor/Klarifikasi Status** | Fungsinya untuk storefront preview — perlu dipastikan masih relevan dengan arah bisnis saat ini |
| Demo Portfolio Generator | **Stable** | Dipakai untuk seeding portofolio |
| AI Scheduler & Automation | **Stable** | Bagian dari otomasi komersial |
| Continuous QC Feedback Loop | **Future AI** | P4.3 — memanfaatkan data historis approval/revisi |

---

## 13. Architecture Evolution

**Sekarang → P0/P1:** dari "banyak service dengan overlap implisit" menuju "satu source of truth per domain" — konsolidasi orkestrasi pipeline (P1.1), tenant context terpusat (Appendix A), dan canonical quotation path (Appendix C/P0.4).

**P1/P2 → P2/P3:** dari "fitur tercatat sebagian" menuju "feature registry resmi yang dipelihara" (P2.1), sehingga setiap fitur baru punya status jelas sejak awal, bukan ditemukan lewat audit setelah bertahun-tahun.

**P3/P4:** dari "single-region, scaling vertikal" menuju kesiapan horizontal scaling dan multi-region — tapi **hanya jika** kebutuhan bisnis (volume klien, syarat data residency) sudah nyata, bukan dibangun spekulatif.

---

## 14. Security Evolution

**P0:** Tenant isolation enforcement + audit log konsisten + soft delete/retention — tiga fondasi keamanan data yang harus selesai sebelum platform disebut siap untuk klien enterprise majemuk.

**P1:** Hardening tambahan pada middleware yang sudah ada (review ulang cakupan `adminAuth`, `internalAuth`, `paymentGate`, `ssrfGuard`, `rateLimiter` terhadap skenario yang dibawa oleh perubahan P0 — mis. pastikan middleware baru untuk tenant tidak membuka celah baru).

**P2 ke atas:** Audit trail lengkap gaya SOC2 (menghubungkan seluruh mutasi data ke satu jejak yang bisa diekspor untuk keperluan audit eksternal klien enterprise), sebagai kelanjutan alami dari P0.2.

---

## 15. Business Evolution — Menuju Enterprise Creative Agency AI

Platform saat ini paling kuat melayani: **Branding, Agency, SME, Startup** (deliverable inti: Company Profile, Brand Strategy, Brand Identity, Copywriting, Creative Consultation, Pitch Deck).

Untuk berkembang melayani segmen tambahan yang disebutkan (Marketing, Sales, Investor, Corporate, Manufacturing, Trading, Logistics, Hospitality, Healthcare, Education, Government), pendekatan yang **sesuai prinsip "jangan menambahkan fitur sembarangan"** adalah:

1. **Investor:** paling dekat dicapai — cukup varian template dari Pitch Deck yang sudah ada (P3.1), bukan engine baru.
2. **Marketing/Sales:** butuh deliverable tambahan yang **harus divalidasi permintaan riil dulu** (P2.5) sebelum dibangun — jangan membangun Landing Page/Banner/Poster generator hanya karena disebut di visi produk, tanpa bukti klien benar-benar memintanya.
3. **Corporate, Manufacturing, Trading, Logistics, Hospitality, Healthcare, Education, Government:** ini adalah segmen vertikal yang lebih tepat didekati lewat **Vertical Industry Packages** (P4.4) — mengombinasikan deliverable yang *sudah ada* dengan personalisasi brief per industri (P3.2), bukan membangun fitur unik per industri dari nol. Setiap vertikal butuh validasi permintaan pasar sebelum investasi dilakukan.

**Prinsip pengembangan bisnis:** perluasan ke segmen baru harus mengikuti fondasi yang sudah solid (P0/P1) dan deliverable yang sudah production-ready — bukan menambah kapabilitas baru di atas platform yang isolasi datanya sendiri belum tuntas.

---

## 16. Enterprise Readiness Roadmap

| Dimensi | Kondisi Sekarang | Target Setelah P0–P1 | Target Setelah P2–P4 |
|---|---|---|---|
| Security | Rate limit/SSRF/payment gate ada, tenant isolation nol | Tenant isolation + audit log + soft delete selesai | SOC2-style audit trail lengkap |
| Scalability | Job engine matang, index kurang | Index hot-path selesai, progress granular | Horizontal scaling siap jika volume butuh |
| Multi-Tenant | Ad-hoc, tidak ditegakkan | Middleware + query isolation tegak | RLS sebagai lapisan kedua |
| Maintainability | Overlap orkestrasi & jalur ganda | Konsolidasi pipeline & quotation selesai | Feature registry terpelihara aktif |
| Business Value | Kuat di branding, lemah di sales collateral | Creative Consultant tahap 1 selesai | Deliverable tervalidasi permintaan + vertical packages |
| AI Quality | Pipeline stabil, consultant masih agregator | Consultant sintesis asli tahap 1–2 | Continuous QC feedback loop aktif |

---

## 17. Estimated Development Sequence

Urutan ini memperhitungkan dependency teknis dan prioritas bisnis (Security → Architecture → Scalability → Business Value → CX → AX → AI Quality → Enterprise Readiness):

1. **P0.1 Tenant Isolation** (fondasi, harus lebih dulu dari fitur besar apa pun)
2. **P0.2 Audit Log Konsisten** (paralel dengan P0.1, memakai tenant context yang sama)
3. **P0.3 Soft Delete Foundation** (paralel, tidak bergantung P0.1/P0.2)
4. **P0.4 Quotation Canonical Decision** (paralel, murni keputusan governance dulu)
5. **P1.1 Konsolidasi Orkestrasi AI** (setelah fondasi data aman)
6. **P1.5 Database Indexing** (cepat, bisa disisipkan kapan saja setelah P0 selesai)
7. **P1.2 SSE Migration di Commercial Gate** (independen, quick win)
8. **P1.4 Creative Consultant Tahap 1** (business value tinggi, bisa mulai begitu P1.1 selesai agar data pipeline stabil)
9. **P1.3 Admin Progress Granular & Edit Inline**
10. **P2.1 Feature Registry Resmi**
11. **P2.2–P2.3 Unifikasi UX & Export History**
12. **P2.4 Optimasi Biaya AI**
13. **P2.5 Deliverable Baru (kondisional riset)**
14. **Creative Consultant Tahap 2–3** (menyusul setelah data pendukung — kompetitor, histori — tersedia)
15. **P3.x dan P4.x** sesuai kebutuhan pasar yang tervalidasi

---

## 18. Risks

- **Risiko terbesar jika P0 ditunda:** kebocoran data lintas klien (tenant isolation) — ini risiko reputasi dan legal, bukan sekadar risiko teknis.
- **Risiko migrasi tenant isolation terlalu cepat/tergesa:** regresi akses data (klien tiba-tiba tidak bisa akses data miliknya sendiri) — mitigasi dengan rollout bertahap per domain tabel, bukan big-bang.
- **Risiko konsolidasi quotation:** jika migrasi data historis tidak dikerjakan hati-hati, laporan keuangan/komersial historis bisa terputus atau tidak konsisten.
- **Risiko Creative Consultant upgrade:** menambah sintesis LLM tanpa data pendukung yang cukup (terutama Tahap 2–3: Competitive Insight, ROI) berisiko menghasilkan konten yang terdengar meyakinkan tapi tidak akurat — harus dipagari dengan sumber data yang jelas per elemen.
- **Risiko menambah deliverable baru sembarangan:** setiap deliverable baru menambah beban maintenance permanen (mapper, worker, QC, export) — validasi permintaan pasar wajib sebelum P2.5/P3.1/P4.4 dieksekusi.

---

## 19. Final Recommendation

Platform ini **tidak perlu dibangun ulang** — fondasi (job engine, SSE, cost tracking, deliverable registry pattern) sudah terbukti solid dan bisa terus dipakai. Prioritas mutlak adalah menyelesaikan **tiga fondasi P0** (tenant isolation, soft delete, quotation canonical) sebelum menambah kapabilitas bisnis baru apa pun — ini murni soal urutan risiko, bukan soal kemampuan tim membangun fitur baru.

Setelah P0 tuntas, **investasi paling bernilai bisnis** adalah mengangkat Creative Consultation dari agregator menjadi konsultan strategis sungguhan (P1.4 dan Bagian 10 Tahap 1) — ini deliverable yang paling langsung dilihat dan dinilai klien, dan datanya sudah tersedia, sehingga ROI implementasinya tinggi relatif terhadap effort-nya.

Yang sebaiknya **dihindari**: menambah deliverable baru (Landing Page, Banner, Poster, Logo generator, dll) sebelum permintaan pasarnya tervalidasi — setiap deliverable baru menjadi beban maintenance permanen, dan prinsip "jangan menambahkan fitur sembarangan" harus dipegang ketat, terutama karena audit menunjukkan platform sudah punya lebih banyak kapasitas tersembunyi (Presentation Engine, 7 workflow AI tambahan) daripada yang disadari — konsolidasi dan penemuan ulang apa yang sudah ada lebih mendesak daripada membangun yang baru.

---

*Roadmap ini disusun murni berdasarkan bukti dari audit dan validasi audit yang sudah dilakukan sebelumnya terhadap source code aktual. Tidak ada kode, skema database, konfigurasi, atau dokumen implementasi lain yang diubah dalam penyusunan roadmap ini.*
