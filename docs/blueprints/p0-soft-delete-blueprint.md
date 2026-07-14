# Implementation Blueprint — P0-2: Soft Delete, Restore, Archive, Retention & Purge
**Tanggal:** 14 Juli 2026
**Sifat:** Blueprint teknis murni. **Tidak ada source code, migration, atau commit yang dibuat/diubah dalam penyusunan dokumen ini.**
**Basis:** Audit Enterprise Readiness, Validation Audit (soft delete BENAR, 95% confidence), Roadmap Enterprise (Appendix B), pembacaan source code aktual.

---

## 1. Current Architecture — Bagaimana Penghapusan Bekerja Sekarang

**Tidak ada mekanisme soft-delete sistemik di platform ini.** Temuan dari validasi audit dan konfirmasi ulang:
- Tidak ada kolom `deleted_at`, `deletedBy`, `is_deleted` di manapun dalam `lib/db/src/schema`.
- **Hard delete aktif dan nyata di produksi:** `artifacts/api-server/src/routes/cp-review.ts` (baris 611) memanggil `db.delete()` langsung untuk data komentar klien — penghapusan permanen, tanpa jejak, tanpa kemungkinan recovery.
- Beberapa tabel punya status enum yang **terlihat** seperti mekanisme arsip (`archived`, `revoked` pada `cp-page-comments.ts`, `creative-ai-client-comments.ts`, `ai_service_catalog`, `ai_service_portfolios`) — namun ini adalah **state-machine flag biasa**, bukan mekanisme soft-delete sistemik: tidak ada middleware/repository yang otomatis menyaring baris berstatus ini dari query normal.
- Kata "archive" pada `workerClusterService.ts`/`portfolio-batch.ts` (`LIFECYCLE_JOB_TYPES`) merujuk pada pemrosesan **file ZIP/object storage**, bukan penghapusan/pengarsipan record database — perlu dibedakan tegas agar tidak disalahartikan sebagai fondasi soft-delete yang sudah ada.

**Implikasi bisnis:** data klien (proyek, dokumen, komentar review, quotation) bisa hilang permanen akibat kesalahan staf, bug, atau tindakan API yang tidak sengaja — tidak ada jaring pengaman apa pun hari ini.

---

## 2. Target Architecture — Bagaimana Penghapusan Seharusnya Bekerja

Prinsip target: **tidak ada penghapusan permanen langsung dari operasi pengguna/API normal** untuk entitas bernilai bisnis. Penghapusan permanen (purge) hanya terjadi lewat proses terjadwal yang mengikuti kebijakan retensi eksplisit, dengan jejak audit penuh.

Alur target:
```
Permintaan "hapus" dari user/API
  ↓
Soft Delete (set deleted_at + deleted_by, bukan DELETE)
  ↓
Data tersembunyi dari query normal (repository layer menyaring otomatis)
  ↓
Tersedia untuk Restore selama periode retensi
  ↓
Setelah periode retensi terlampaui → kandidat Purge
  ↓
Purge terjadwal (job terkontrol, bukan trigger manual sembarangan) → penghapusan permanen sesungguhnya
  ↓
Audit trail mencatat setiap tahap (soft delete, restore, purge)
```

---

## 3. Klasifikasi Entitas

Tidak semua tabel butuh soft-delete — memaksakan pola ini ke semua tabel akan menambah kompleksitas tanpa nilai. Klasifikasi berdasarkan nilai bisnis/legal data:

| Kategori | Contoh Entitas | Perlu Soft Delete? |
|---|---|---|
| **Data bernilai bisnis/legal tinggi** | `creative_projects`, dokumen/asset deliverable (`creative_ai_assets`), quotation (`ai_quotations`, `creative_project_quotations`), komentar klien (`cp-page-comments`, `creative-ai-client-comments`) | **Ya — wajib** |
| **Data transaksional yang berelasi ke data di atas** | Item quotation, review, riwayat approval | **Ya** — mengikuti siklus hidup entitas induknya (soft delete berjenjang, lihat Bagian 4) |
| **Data teknis/operasional berumur pendek** | Log eksekusi job (`ai_execution_logs`), event bus mentah, cache | **Tidak** — retensi dikelola lewat kebijakan pruning terjadwal biasa, bukan soft-delete (kebutuhan berbeda: ini butuh dibuang otomatis demi performa, bukan disimpan untuk kemungkinan restore) |
| **Data konfigurasi/katalog** | `ai_services`, `ai_service_price_rules` | **Opsional** — status `archived` yang sudah ada saat ini sudah cukup mendekati kebutuhan (item tidak lagi ditawarkan tapi historinya tetap valid untuk quotation lama) — cukup diperkuat menjadi pola soft-delete resmi, tidak perlu kolom baru bila status `archived` diformalkan |

---

## 4. Pola Kolom Standar

Konvensi yang harus konsisten di seluruh tabel yang diklasifikasikan butuh soft-delete (Bagian 3):
- Kolom penanda waktu penghapusan (nullable; `null` berarti record aktif).
- Kolom penanda siapa yang menghapus (opsional tapi direkomendasikan untuk keperluan audit — terhubung dengan aktor di P0-3 Audit Log Blueprint).
- **Tidak** mencampur semantik ini dengan kolom status enum yang sudah ada (`archived`, `revoked`) — status enum tetap berfungsi sebagai *state bisnis* (mis. "quotation ditolak"), sedangkan soft-delete adalah *state keberadaan record* (mis. "record ini dihapus pengguna"). Keduanya independen: sebuah quotation bisa berstatus `rejected` (state bisnis) dan tetap **tidak** dihapus (masih ada di semua listing riwayat), atau bisa juga di-soft-delete (dihapus pengguna) terlepas dari status bisnisnya.
- **Soft delete berjenjang (cascading):** ketika entitas induk (mis. `creative_projects`) di-soft-delete, seluruh entitas anak yang terikat padanya (asset, quotation, komentar) harus ikut ter-soft-delete secara logis dalam satu operasi atomik — bukan dibiarkan menjadi data "yatim" yang induknya sudah tak terlihat tapi anaknya masih muncul di listing lain.

---

## 5. Query Filtering Otomatis

Kondisi hari ini: tidak ada repository layer (temuan yang sama dengan P0-1) — setiap service memanggil drizzle langsung.

**Strategi target:** dibangun **bersamaan** dengan repository layer yang diusulkan di P0-1 Tenant Isolation Blueprint (Bagian 7 dokumen tersebut) — satu lapisan repository yang sama bertanggung jawab menyisipkan **dua** predikat wajib untuk tabel yang relevan: filter tenant **dan** filter "belum dihapus" (`deleted_at IS NULL`), kecuali query yang secara eksplisit meminta termasuk data terhapus (mis. halaman "Trash"/"Recently Deleted" di admin, atau proses restore itu sendiri).

Ini penting secara arsitektur: membangun dua lapisan filter wajib ini secara terpisah (satu untuk P0-1, satu untuk P0-2) akan menghasilkan dua mekanisme paralel yang mudah tidak sinkron. Direkomendasikan **satu repository layer, dua predikat**, dirancang bersama sejak awal.

---

## 6. Restore Flow

Prinsip: restore hanya mungkin dilakukan **dalam periode retensi** (Bagian 7), dan hanya oleh aktor dengan hak yang sesuai (staf internal dengan role tertentu — terhubung dengan RBAC `internalAuth` yang sudah ada; untuk data yang di-soft-delete oleh klien sendiri lewat customer portal, restore idealnya juga tersedia untuk klien itu sendiri dalam window waktu singkat sebelum benar-benar dianggap final).

Restore berjenjang mengikuti arah yang sama seperti soft-delete berjenjang (Bagian 4): merestore entitas induk **tidak otomatis** merestore entitas anak yang mungkin telah dihapus secara independen sebelum induknya dihapus — perlu aturan eksplisit apakah restore induk membawa seluruh anak yang met waktu penghapusan sama, atau memerlukan konfirmasi terpisah. Ini keputusan produk yang harus diputuskan sebelum implementasi restore dimulai, bukan diasumsikan.

---

## 7. Retention & Purge Policy

Kebijakan retensi adalah **keputusan bisnis**, bukan keputusan teknis murni — namun kerangka teknis yang direkomendasikan:

| Kategori Entitas | Retensi Soft-Delete yang Disarankan | Alasan |
|---|---|---|
| Project & deliverable klien | Periode retensi lebih panjang (kebutuhan bisnis/kontrak — mis. cukup lama untuk menampung kasus klien "berubah pikiran" atau sengketa) | Nilai bisnis tinggi, biaya penyimpanan lanjutan relatif rendah dibanding risiko kehilangan data bernilai kontraktual |
| Komentar/review klien | Retensi mengikuti retensi project induk (Bagian 4 — cascading) | Tidak bermakna berdiri sendiri tanpa project induknya |
| Quotation | Retensi lebih panjang dari data operasional biasa, mengikuti kebutuhan pembukuan/pajak/audit finansial | Implikasi finansial/legal |

**Purge terjadwal:** dijalankan lewat mekanisme scheduler yang sudah ada (`aiSchedulerService.ts`) sebagai satu `targetType` baru khusus purge, bukan proses ad-hoc manual — memberi jejak eksekusi otomatis yang konsisten dengan pola scheduler lain di sistem, dan memudahkan audit kapan purge terjadi.

**Purge harus butuh dua kondisi sekaligus:** (1) periode retensi soft-delete terlampaui, dan (2) tidak ada dependensi aktif yang masih membutuhkan record ini (mis. quotation yang masih dirujuk laporan finansial berjalan) — purge yang ceroboh terhadap dependensi bisa merusak integritas laporan historis.

---

## 8. Audit Trail Penghapusan

Setiap transisi (soft-delete, restore, purge) **wajib** tercatat di audit log/canonical event model (lihat P0-3 Audit Log Blueprint) dengan minimal: aktor, waktu, entitas & id, dan alasan bila tersedia (terutama untuk purge — kebijakan retensi mana yang memicu purge tersebut harus tercantum agar bisa direkonstruksi ulang jika ada pertanyaan compliance di kemudian hari).

---

## 9. Middleware & Repository Strategy (Blueprint, Tanpa Implementasi)

Tidak dibutuhkan middleware baru yang berdiri sendiri untuk soft-delete — cukup diperlakukan sebagai **tanggung jawab tambahan** pada repository layer yang sama yang diusulkan P0-1 (Bagian 5–7 dokumen ini). Ini menjaga jumlah lapisan abstraksi tetap minimal, sesuai prinsip "tanpa membangun ulang platform" dari instruksi awal.

Route handler yang saat ini memanggil `db.delete()` langsung (mis. `cp-review.ts` L611) perlu diganti memanggil fungsi repository "soft delete" yang setara — perubahan ini dicatat sebagai kebutuhan implementasi fase berikutnya, **tidak dieksekusi di blueprint ini**.

---

## 10. Worker & AI Workflow Strategy

- Job/worker yang memproses data (export, AI pipeline) harus menghormati status soft-delete: job yang menargetkan entitas yang sudah di-soft-delete (mis. karena race condition antara permintaan hapus dan job yang sedang berjalan) harus gagal secara terkendali (ditandai gagal dengan alasan jelas), bukan tetap memproses dan menghasilkan output untuk data yang seharusnya sudah "tidak ada".
- Job purge terjadwal (Bagian 7) sendiri adalah kandidat AI-workflow-adjacent yang berjalan lewat scheduler — perlu memastikan job ini punya prioritas/isolasi yang tidak bersaing dengan job bisnis utama (AI generation) untuk resource worker.

---

## 11. Export Strategy

Worker export (PDF/Presentation/ZIP/thumbnail/preview — sama seperti yang dibahas di P0-1 Bagian 10) harus menyaring data yang sudah di-soft-delete dari hasil akhir dokumen: mis. jika sebuah asset gambar di-soft-delete oleh klien setelah disetujui tapi sebelum PDF final digenerate ulang, PDF hasil generate baru **tidak boleh** menyertakan asset yang sudah dihapus tersebut.

---

## 12. Security & Data Integrity Analysis

| Risiko | Penjelasan | Mitigasi |
|---|---|---|
| **Data recovery tanpa otorisasi** | Restore bisa disalahgunakan untuk mengembalikan data yang seharusnya tetap terhapus (mis. konten yang dihapus atas permintaan klien untuk alasan privasi) | Restore harus melalui RBAC yang sama ketatnya dengan operasi hapus, dan tercatat di audit trail |
| **Purge yang salah sasaran** | Purge menghapus data yang ternyata masih dirujuk laporan/relasi aktif | Syarat ganda di Bagian 7 (retensi terlampaui DAN tidak ada dependensi aktif) sebelum purge dieksekusi |
| **Inkonsistensi status bisnis vs status keberadaan** | Developer baru bingung antara `archived` (state bisnis) dan soft-delete (state keberadaan) sehingga salah menerapkan filter | Dokumentasi konvensi tegas (Bagian 4) dan pemisahan jelas di level skema/kode |
| **Soft-delete berjenjang tidak lengkap** | Entitas anak menjadi "yatim" — induk terhapus tapi anak masih muncul di listing lain yang tidak melalui relasi induk | Operasi soft-delete berjenjang harus atomik (Bagian 4), diuji eksplisit di test suite (Bagian 14) |

---

## 13. Migration Strategy (Tanpa Implementasi)

**Phase 1 — Foundation:** Tambahkan kolom soft-delete (nullable) ke tabel yang diklasifikasikan di Bagian 3 sebagai butuh soft-delete. Tidak ada perubahan perilaku — seluruh kolom baru default `null` (aktif), sehingga tidak ada dampak terhadap sistem yang berjalan.

**Phase 2 — Repository Enforcement:** Aktifkan filter otomatis "belum dihapus" di repository layer (dibangun bersamaan dengan tenant filter P0-1) secara bertahap per domain tabel, dimulai dari yang risiko regresinya paling rendah (komentar/review) menuju yang paling tinggi (project inti).

**Phase 3 — Ganti Hard-Delete → Soft-Delete di Route Handler:** Titik hard-delete yang sudah teridentifikasi (`cp-review.ts` L611, dan kemungkinan titik lain yang perlu disisir ulang saat implementasi) diganti memanggil repository soft-delete. Ini fase paling sensitif karena mengubah perilaku nyata yang sudah berjalan — harus dilakukan satu titik hard-delete pada satu waktu, diverifikasi, baru lanjut ke titik berikutnya.

**Phase 4 — Restore & Purge Aktif:** Bangun endpoint/flow restore, dan aktifkan job purge terjadwal setelah kebijakan retensi final disetujui secara bisnis (Bagian 7).

**Rollback Strategy:** Phase 1–2 aditif dan aman untuk dibalik (nonaktifkan filter, kolom tetap ada tanpa efek). Phase 3 memerlukan feature flag per titik hard-delete yang diganti, agar bisa dikembalikan ke perilaku lama secepatnya jika ditemukan masalah tanpa perlu deploy ulang. Phase 4 (purge) harus punya jalur "dry-run" (menghitung apa yang *akan* dipurge tanpa benar-benar mengeksekusi) sebagai validasi wajib sebelum purge sungguhan pertama kali dijalankan di produksi.

---

## 14. Compatibility Analysis

| Area | Dampak |
|---|---|
| Customer Portal | Klien yang menghapus komentar/asset melihat perilaku baru (recoverable sementara) — perubahan UX positif, minim risiko |
| Admin Portal | Perlu UI baru untuk "Trash"/"Recently Deleted" dan aksi restore — cakupan kerja tambahan di sisi admin |
| Worker | Perlu penghormatan status soft-delete sebelum memproses (Bagian 10) |
| Export | Perlu penyaringan data soft-deleted dari output dokumen (Bagian 11) |
| Quotation | Soft-delete pada quotation harus diselaraskan dengan keputusan canonical path P0-4 — sebaiknya diterapkan setelah P0-4 menetapkan jalur mana yang aktif, agar tidak membangun soft-delete dua kali di dua jalur yang salah satunya akan dipensiunkan |

---

## 15. Risk Analysis & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Query lama yang lupa memfilter status terhapus (bug lolos deteksi) | Repository layer terpusat (bukan filter manual per query) — satu titik yang perlu benar, bukan lusinan |
| Volume data historis membengkak karena tidak pernah benar-benar dihapus | Kebijakan retensi & purge terjadwal (Bagian 7) memastikan data akhirnya benar-benar dibersihkan, bukan disimpan selamanya |
| Restore disalahgunakan | RBAC ketat + audit trail wajib (Bagian 6, 8, 12) |
| Perubahan hard-delete → soft-delete di titik yang sudah berjalan lama menimbulkan efek samping tak terduga di fitur yang bergantung padanya | Migrasi satu titik pada satu waktu (Phase 3), diverifikasi sebelum lanjut ke titik berikutnya, bukan big-bang |

---

## 16. Implementation Order (Urutan Paling Aman)

1. Finalisasi klasifikasi entitas (Bagian 3) sebagai keputusan produk — bukan asumsi teknis semata.
2. Tambah kolom soft-delete nullable ke tabel terklasifikasi (Phase 1 skema).
3. Bangun repository layer bersama dengan P0-1 (tenant filter + soft-delete filter dalam satu lapisan).
4. Aktifkan filter otomatis per domain, mulai dari komentar/review (risiko rendah).
5. Ganti titik hard-delete yang sudah teridentifikasi (`cp-review.ts`) menjadi soft-delete, satu per satu.
6. Bangun restore flow dengan RBAC dan audit trail.
7. Finalisasi kebijakan retensi bersama pemangku bisnis.
8. Bangun job purge terjadwal dengan mode dry-run wajib sebelum eksekusi nyata pertama.
9. Perluas ke domain quotation setelah keputusan canonical path (P0-4) selesai.

---

## 17. Acceptance Criteria

- Tidak ada lagi pemanggilan `db.delete()` langsung untuk entitas terklasifikasi bernilai bisnis (Bagian 3) di luar job purge terjadwal itu sendiri.
- Setiap entitas yang di-soft-delete otomatis tersembunyi dari seluruh listing/query normal tanpa terkecuali, kecuali secara eksplisit diminta.
- Restore berfungsi dan menghasilkan entitas kembali terlihat identik dengan sebelum dihapus, tercatat di audit trail.
- Purge hanya berjalan lewat job terjadwal dengan syarat retensi + tidak ada dependensi aktif, dan selalu didahului mode dry-run saat pertama kali diaktifkan.
- Soft-delete berjenjang teruji tidak meninggalkan entitas anak "yatim".

---

## 18. Testing Strategy

**Unit Test:** fungsi repository soft-delete/restore/filter — memverifikasi predikat filter selalu tersisip untuk tabel terklasifikasi, dan tidak tersisip untuk tabel yang sengaja dikecualikan (mis. saat proses purge/restore itu sendiri butuh melihat data terhapus).

**Integration Test:** flow penuh hapus → cek hilang dari listing → restore → cek muncul lagi, mencakup entitas induk dan anak (cascading, Bagian 4).

**Security Test:** mencoba restore/purge tanpa role yang sesuai — harus ditolak; mencoba mengakses entitas soft-deleted lewat endpoint yang seharusnya tidak menampilkannya.

**Regression Test:** memverifikasi status bisnis (`archived`/`revoked`) tetap berfungsi independen dari status soft-delete setelah migrasi — tidak tercampur maknanya.

**Purge Dry-Run Test:** wajib sebelum purge nyata pertama diaktifkan di produksi — memverifikasi hasil dry-run (daftar record yang *akan* dipurge) sesuai ekspektasi kebijakan retensi sebelum benar-benar dieksekusi.

---

*Blueprint ini murni perencanaan teknis berdasarkan bukti source code aktual dan hasil audit/validasi sebelumnya. Tidak ada kode, migration, atau perubahan konfigurasi apa pun yang dibuat dalam penyusunan dokumen ini.*
