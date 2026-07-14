# Implementation Blueprint — P0-4: Canonical Quotation Workflow
**Tanggal:** 14 Juli 2026
**Sifat:** Blueprint teknis murni. **Tidak ada source code, migration, atau commit yang dibuat/diubah dalam penyusunan dokumen ini.**
**Basis:** Audit Enterprise Readiness, Validation Audit (dua jalur quotation paralel — BENAR, 100% confidence), Roadmap Enterprise (P0.4, Appendix C), pembacaan source code aktual.

---

## 1. Current Architecture — Bagaimana Quotation Bekerja Sekarang

Dua jalur quotation hidup **bersamaan**, keduanya aktif dan ter-mount di server:

| Jalur | Tabel | Route | Service Pendukung | Status |
|---|---|---|---|---|
| **Legacy** | `creative_project_quotations` | `routes/quotations.ts` (`index.ts` L101) | Terhubung langsung ke `runCreativeBriefWorkflow` saat approval | **LEGACY-STILL-LIVE** — masih entry point utama untuk project non-katalog (`serviceRequestId` null) |
| **Service-Catalog (aktif)** | `ai_quotations` (+ `ai_quotation_items`) | `routes/aiQuotations.ts` (`index.ts` L104) | `aiQuotationService.ts`, terintegrasi `commercialGateService.ts` & `serviceRequestConversionService.ts` | **AKTIF** — disebut eksplisit "service-catalog flow" di kode |

**Bukti percabangan sudah ada di kode:** `serviceRequestConversionService.ts` (L116, L139) sudah punya blok eksplisit yang membedakan "Legacy path: creative_project_quotations" vs "Service-catalog path: ai_quotations" — titik keputusan arsitektural **sudah dikenali oleh tim**, hanya belum ditegakkan sebagai kebijakan resmi dengan jalur pensiun yang jelas.

**Reachability publik:**
- Legacy: `/api/creative-ai/projects/:projectId/quotation`, `/api/public/customer/quotation/:token`
- Aktif: `/api/ai/quotations`, `/api/public/quotations/:token`

**Tidak ada flag yang menonaktifkan jalur legacy** — meski disebut "legacy" di banyak komentar kode (`ai-quotations.ts:8`, `commercialGates.ts:27`, `serviceRequestConversionService.ts:116`), jalur ini tetap menerima data baru untuk project non-katalog.

---

## 2. Target Architecture — Bagaimana Quotation Seharusnya Bekerja

**Satu canonical workflow: `ai_quotations` (service-catalog flow).** Ini sudah diputuskan sebagai rekomendasi di roadmap enterprise (Appendix C) berdasarkan justifikasi: jalur ini terintegrasi dengan `commercialGateService.ts` dan `serviceRequestConversionService.ts` modern — infrastruktur komersial yang lebih baru dan lebih lengkap dibanding jalur legacy.

Target akhir:
```
Setiap permintaan quotation baru (apa pun asal projectnya)
  ↓
ai_quotations (satu sumber kebenaran)
  ↓
commercialGateService.ts (gate pembayaran/verifikasi)
  ↓
Trigger produksi AI (runCreativeBriefWorkflow ATAU jalur setara yang sudah dikonsolidasi sesuai P1.1 roadmap)
```

`creative_project_quotations` **dipensiunkan bertahap** (freeze input baru dulu — bukan dihapus langsung), tetap dipertahankan sebagai data historis read-only untuk keperluan laporan/audit project-project lama yang sudah selesai lewat jalur itu.

---

## 3. Tenant Context Flow untuk Quotation

Karena P0-1 menetapkan setiap tabel komersial (termasuk `ai_quotations`, dan secara historis `creative_project_quotations`) harus punya tenant context, jalur canonical yang baru **harus selaras dengan tenant isolation** sejak awal:

```
Request (buat/approve/reject quotation)
  ↓
Tenant Resolution (P0-1 Bagian 4 — dari session staf/klien, atau token publik → project → tenant)
  ↓
Quotation Service (ai_quotations, tenant-scoped)
  ↓
Commercial Gate (verifikasi pembayaran, dalam scope tenant yang sama)
  ↓
Trigger Produksi AI (job dengan tenant context terlampir, sesuai P0-1 Bagian 8)
```

---

## 4. Keputusan Kanonik: Analisis Mana yang Canonical, Mana yang Dipensiunkan, Mana yang Dimigrasikan

**Canonical: `ai_quotations`.**
Alasan: (1) satu-satunya jalur yang terhubung ke `commercialGateService.ts` modern; (2) satu-satunya jalur yang sudah dirancang dengan kolom `tenantId` (walau saat ini nullable/placeholder, tetap secara struktural sudah siap menerima enforcement P0-1); (3) satu-satunya jalur yang disebut eksplisit di kode sebagai arah "service-catalog" yang menjadi model bisnis target (katalog layanan terstruktur, bukan proyek ad-hoc).

**Dipensiunkan: `creative_project_quotations` (legacy flow).**
Alasan: tidak terhubung ke infrastruktur komersial modern (`commercialGateService.ts`), tidak punya kolom tenant, dan sudah disebut "legacy" secara konsisten di banyak titik kode oleh tim sendiri — pensiun ini adalah formalisasi dari arah yang sudah dikenali, bukan keputusan baru yang mengejutkan.

**Yang harus dimigrasikan:** Project non-katalog yang **masih aktif berjalan** (belum selesai, `serviceRequestId` null, masih mungkin butuh quotation baru/perubahan) lewat jalur legacy — project ini perlu jalur transisi agar tetap bisa menerima quotation baru **lewat jalur canonical**, bukan lewat legacy yang dibekukan. Ini butuh keputusan bisnis eksplisit: apakah seluruh tipe project non-katalog akan "dinaikkan" (upgrade) menjadi entitas berbasis katalog layanan, atau jalur canonical `ai_quotations` diperluas untuk tetap mendukung quotation non-katalog (tanpa `serviceRequestId`) sebagai kategori sah di dalamnya.

**Yang TIDAK perlu dimigrasikan (tetap read-only historis):** quotation lama yang project-nya sudah `completed`/selesai secara penuh — data ini hanya dibutuhkan untuk laporan/audit historis, tidak perlu "hidup" di jalur baru.

---

## 5. Data Isolation & Repository Strategy

Sejalan dengan P0-1 Bagian 7: begitu `creative_project_quotations` dibekukan (tidak menerima insert baru) dan `ai_quotations` menjadi satu-satunya jalur tulis, repository layer untuk quotation menjadi **lebih sederhana** dibanding skenario mempertahankan dua jalur aktif selamanya — ini salah satu manfaat langsung dari konsolidasi P0-4: mengurangi permukaan yang perlu diberi enforcement tenant isolation dan soft-delete secara paralel di dua tempat.

Query baca (read) untuk keperluan laporan historis tetap diizinkan menyentuh `creative_project_quotations`, tapi **selalu lewat jalur repository khusus "legacy read-only"** yang secara eksplisit tidak memiliki fungsi tulis — mencegah kebiasaan lama (menulis ke tabel legacy) tanpa sengaja berlanjut karena "masih ada fungsinya di kode".

---

## 6. Middleware Strategy (Blueprint, Tanpa Implementasi)

Tambahkan satu middleware/guard tipis pada route legacy (`routes/quotations.ts`): setelah freeze diberlakukan, setiap permintaan **create** baru ke jalur ini harus ditolak dengan pesan jelas yang mengarahkan ke jalur canonical (bukan dihapus routingnya secara tiba-tiba, yang akan mematahkan integrasi klien/staf yang mungkin masih memanggilnya dari cache/bookmark lama) — permintaan **read** ke data historis tetap diizinkan tanpa perubahan.

---

## 7. Worker & AI Workflow Strategy

`runCreativeBriefWorkflow` saat ini dipicu dari dua arah berbeda (approval quotation legacy langsung memicunya; approval quotation canonical melalui `commercialGateService.ts`/`serviceRequestConversionService.ts`). Setelah konsolidasi, hanya **satu jalur pemicu** yang tersisa (dari canonical), menyederhanakan pemetaan "siapa yang boleh memicu produksi AI" — ini juga mengurangi permukaan tumpang tindih dengan temuan roadmap P1.1 (konsolidasi `aiCeoService` vs `creativeWorkflowRunner`), karena kedua konsolidasi ini pada akhirnya menyederhanakan titik masuk yang sama.

---

## 8. Export & Presentation Strategy

Deliverable (dokumen/presentasi) yang dihasilkan dari project yang lahir lewat jalur legacy tetap valid dan bisa diakses (tidak terpengaruh freeze — freeze hanya menghentikan pembuatan quotation *baru*, bukan menghapus project/deliverable yang sudah ada). Tidak ada perubahan pada worker export akibat P0-4 ini secara langsung, selain memastikan `tenantId` yang dipropagasi ke job export (P0-1 Bagian 10) tetap benar untuk project yang berasal dari jalur legacy setelah backfill tenant.

---

## 9. SSE Strategy

Notifikasi status quotation lewat SSE (jika ada) harus mengikuti sumber data canonical setelah migrasi — klien yang memantau status quotation project lama (jalur legacy) tetap menerima update selama datanya masih dibaca dari `creative_project_quotations` secara read-only; tidak ada perubahan arsitektur SSE yang dibutuhkan khusus untuk P0-4.

---

## 10. Audit Log Strategy

Setiap transisi status quotation (create/approve/reject/convert) — baik di jalur legacy (selama masa freeze read-only) maupun canonical — harus tercatat di audit log/Canonical Event Model (P0-3) dengan `resourceType` yang membedakan `legacy_quotation` vs `catalog_quotation`, agar investigasi historis pasca-konsolidasi tetap bisa membedakan asal jalur sebuah keputusan komersial.

---

## 11. Security Analysis

| Risiko | Penjelasan | Mitigasi |
|---|---|---|
| **Cross-path inconsistency** | Bug diperbaiki di satu jalur (mis. validasi harga) tapi lupa diterapkan ke jalur lain, selama kedua jalur masih hidup bersamaan | Freeze secepat mungkin setelah paritas fungsional diverifikasi (Bagian 4) — mengurangi *window* waktu di mana dua jalur aktif sekaligus |
| **Status quotation ganda/tidak sinkron** | Sebuah project secara keliru memiliki entri di kedua tabel akibat migrasi yang tidak bersih | Migrasi harus memastikan setiap project punya **satu** sumber quotation aktif yang jelas, diverifikasi lewat query rekonsiliasi sebelum freeze final |
| **Kebocoran finansial akibat tenant belum konsisten** | Karena `ai_quotations.tenantId` masih nullable/placeholder hari ini, sebelum P0-1 selesai, isolasi tenant pada data quotation belum benar-benar tegak | Urutan implementasi (Bagian 13) menempatkan P0-4 selaras, bukan mendahului, penegakan tenant P0-1 untuk domain commercial |
| **Klien/staf lama mengakses jalur legacy yang sudah dibekukan mengira masih berfungsi normal** | UX membingungkan bila permintaan create ditolak tanpa penjelasan | Middleware guard (Bagian 6) wajib mengembalikan pesan jelas + arahan ke jalur canonical, bukan error generik |

---

## 12. Migration Strategy (Tanpa Implementasi)

**Phase 1 — Paritas Fungsional & Rekonsiliasi Data:**
- Verifikasi bahwa seluruh kapabilitas yang hanya ada di jalur legacy (jika ditemukan ada) sudah tersedia paritasnya di `ai_quotations`/`commercialGateService.ts` — bila ditemukan gap, gap ini harus ditutup **sebelum** freeze, bukan sesudah.
- Jalankan query rekonsiliasi: identifikasi seluruh project dengan quotation aktif di jalur legacy yang **masih berjalan** (belum selesai) — inilah populasi yang butuh keputusan migrasi eksplisit (Bagian 4).

**Phase 2 — Freeze Input Baru di Jalur Legacy:**
- Aktifkan guard (Bagian 6) yang menolak **create** baru di `routes/quotations.ts`, sambil tetap mengizinkan **read** dan operasi terhadap quotation yang sudah ada di tabel legacy (approve/reject untuk quotation yang sudah terlanjur dibuat sebelum freeze, agar project yang sedang berjalan di tengah proses tidak macet).
- Project yang butuh quotation baru setelah freeze diarahkan seluruhnya ke jalur canonical (baik project katalog maupun non-katalog, sesuai keputusan Bagian 4).

**Phase 3 — Migrasi Data Historis (Opsional, sesuai kebutuhan bisnis):**
- Jika keputusan bisnis memutuskan seluruh riwayat perlu terlihat menyatu di satu tempat (mis. untuk dashboard pelaporan finansial terpadu), data historis `creative_project_quotations` dapat disalin (bukan dipindah/dihapus dari sumber asal) ke struktur yang setara di `ai_quotations` sebagai entri bertanda `migrated_from_legacy` — ini murni untuk kebutuhan pelaporan, tabel legacy tetap dipertahankan sebagai sumber asal yang otoritatif untuk data pra-migrasi.

**Rollback Strategy:**
- Phase 1–2 aditif dan reversibel — guard freeze bisa dinonaktifkan instan (kembali menerima create di jalur legacy) tanpa risiko kehilangan data apa pun, bila ditemukan gap paritas yang terlewat saat Phase 1.
- Phase 3 (migrasi data historis) bersifat opsional dan additive (copy, bukan move) — bisa dihentikan/dibatalkan tanpa risiko terhadap data sumber asli.

---

## 13. Implementation Order (Selaras dengan P0-1 dan Roadmap)

1. Verifikasi paritas fungsional jalur canonical vs legacy (Phase 1).
2. Jalankan rekonsiliasi data — identifikasi project aktif di jalur legacy.
3. **Tunggu hingga domain commercial di P0-1 (tenant isolation) mencapai tahap enforcement** — Bagian 11 menunjukkan risiko finansial jika P0-4 mendahului P0-1 untuk domain ini; sebaiknya kedua pekerjaan disinkronkan sehingga `ai_quotations` sudah punya tenant enforcement yang benar tepat saat menjadi satu-satunya jalur aktif.
4. Aktifkan guard freeze di jalur legacy (Phase 2).
5. Arahkan seluruh permintaan quotation baru ke jalur canonical.
6. (Opsional) Migrasi salinan data historis untuk pelaporan terpadu (Phase 3).
7. Update audit log untuk membedakan asal jalur (Bagian 10) selama masa transisi dan setelahnya.

---

## 14. Compatibility Analysis

| Area | Dampak |
|---|---|
| Customer Portal | Klien dengan project lama (jalur legacy) tetap bisa melihat status quotation mereka (read tetap berfungsi); klien baru otomatis lewat jalur canonical — tidak ada perubahan terlihat bagi klien yang sudah settled |
| Admin Portal | Staf perlu panduan jelas kapan menggunakan jalur mana selama masa transisi Phase 1–2; setelah freeze, hanya satu jalur yang relevan untuk kerja baru |
| Worker | `runCreativeBriefWorkflow` disederhanakan menjadi satu titik pemicu (Bagian 7) |
| Scheduler | Tidak terpengaruh langsung |
| AI | Tidak ada perubahan pada pipeline AI itu sendiri — hanya titik pemicu masuknya yang dikonsolidasi |
| Presentation/Document | Tidak terpengaruh (Bagian 8) |
| Authentication | Tidak terpengaruh |
| **Tenant Isolation (P0-1)** | **Dependency dua arah** — P0-4 idealnya menunggu P0-1 mencapai domain commercial, tapi P0-1 juga lebih sederhana diterapkan begitu P0-4 mengurangi dua jalur menjadi satu (Bagian 5) |

---

## 15. Risk Analysis & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Freeze terlalu cepat sebelum paritas fungsional benar-benar lengkap | Phase 1 wajib selesai dan diverifikasi sebelum Phase 2 (freeze) dimulai — bukan paralel |
| Project yang sedang berjalan di jalur legacy "macet" karena tidak bisa lagi menerima quotation baru pasca-freeze | Guard freeze hanya menolak **create baru**, operasi lain (approve/reject) terhadap quotation yang sudah ada tetap berfungsi (Bagian 12 Phase 2) |
| Data pelaporan finansial pecah antara dua sumber selama masa transisi | Dashboard pelaporan sementara perlu menggabungkan kedua sumber secara eksplisit selama Phase 1–2, dengan label jelas asal jalur, sampai Phase 3 (jika dijalankan) menyatukan tampilan |
| Keputusan migrasi non-katalog (Bagian 4) tertunda karena butuh keputusan bisnis, menghambat freeze | Freeze tetap bisa berjalan untuk kategori project katalog terlebih dahulu, sementara kategori non-katalog menyusul setelah keputusan bisnis final — freeze tidak harus all-or-nothing di semua tipe project sekaligus |

---

## 16. Acceptance Criteria

- Tidak ada lagi kemampuan membuat quotation baru lewat `routes/quotations.ts` (jalur legacy) — seluruh permintaan create baru diarahkan/ditolak dengan jelas ke jalur canonical.
- Seluruh project baru (tanpa terkecuali kategori) menghasilkan quotation lewat `ai_quotations`.
- Data historis jalur legacy tetap dapat diakses read-only untuk keperluan pelaporan/audit, tanpa terhapus.
- Tidak ditemukan project dengan status quotation ambigu/ganda antara dua tabel setelah proses rekonsiliasi (Phase 1) selesai.
- Audit log secara jelas membedakan entri yang berasal dari jalur legacy vs canonical selama dan setelah masa transisi.

---

## 17. Testing Strategy

**Unit Test:** guard freeze pada route legacy — memverifikasi request create ditolak dengan pesan yang jelas, request read/approve/reject terhadap data existing tetap berfungsi.

**Integration Test:** flow penuh pembuatan quotation baru (kategori katalog dan non-katalog) — memverifikasi keduanya berakhir di `ai_quotations`, memicu `commercialGateService.ts` dan produksi AI dengan benar.

**Regression Test:** project-project lama yang lahir dari jalur legacy — memverifikasi status, deliverable, dan riwayatnya tetap dapat diakses normal setelah freeze diberlakukan (tidak ada regresi terhadap data historis).

**Security Test:** mencoba memaksa create baru ke endpoint legacy setelah freeze lewat pemanggilan API langsung (bukan lewat UI) — harus konsisten ditolak di level route/service, tidak hanya disembunyikan di UI.

**Reconciliation Test (khusus P0-4):** query rekonsiliasi (Bagian 12 Phase 1) dijalankan sebagai bagian dari test — memverifikasi tidak ada project yang "hilang" atau memiliki status quotation ganda pasca-migrasi/freeze.

---

*Blueprint ini murni perencanaan teknis berdasarkan bukti source code aktual dan hasil audit/validasi sebelumnya. Tidak ada kode, migration, atau perubahan konfigurasi apa pun yang dibuat dalam penyusunan dokumen ini.*
