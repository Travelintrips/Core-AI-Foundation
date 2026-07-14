# Implementation Blueprint — P0-3: Enterprise Audit Log
**Tanggal:** 14 Juli 2026
**Sifat:** Blueprint teknis murni. **Tidak ada source code, migration, atau commit yang dibuat/diubah dalam penyusunan dokumen ini.**
**Basis:** Audit Enterprise Readiness, Validation Audit, Roadmap Enterprise (P0.2), pembacaan source code aktual (`aiAuditService.ts`, `ai_audit_logs`, `customerWorkspaceService.ts`).

---

## 1. Current Architecture — Bagaimana Audit Log Bekerja Sekarang

- **Implementasi terpusat** di `artifacts/api-server/src/services/aiAuditService.ts`, menulis ke tabel `ai_audit_logs`.
- **Skema field yang tercatat:** `module` (nama service/engine, mis. `"creative-document-engine"`), `action` (mis. `"pdf_generated"`), `resourceId`, `resourceType`, `status` (`"success"`/`"failure"`), `details` (JSONB bebas-bentuk untuk metadata seperti `assetId`, `jobId`, `fileSizeBytes`, `error`).
- **Field yang secara eksplisit TIDAK ada:** tidak ada kolom `actorId`/`actor` (siapa yang melakukan aksi) dan tidak ada kolom `tenantId` di level skema — keduanya, jika ada, hanya mungkin terselip tidak konsisten di dalam `details` JSON.
- **Pola pemanggilan:** "fire and forget" — dibungkus try-catch agar kegagalan penulisan audit log tidak pernah mengganggu logika bisnis utama. Dipanggil konsisten di akhir job export (`creativeDocumentWorkerService.ts`, `creativePresentationWorkerService.ts`).
- **Sinyal arah migrasi yang sudah ada:** `customerWorkspaceService.ts` menyebut adanya **"Canonical Runtime Event Model" (v4.0C)** sebagai penerus konseptual — mengindikasikan tim sudah mulai bergerak dari model audit log klasik menuju model event yang lebih terstruktur, meski `ai_audit_logs` tetap dipakai aktif hari ini. Aktivity feed customer workspace saat ini membaca dari model event ini, bukan lagi langsung dari `ai_audit_logs` mentah untuk permukaan yang sudah dimigrasikan.
- **Konsistensi pemanggilan tidak terjamin sistemik** — audit log ditulis di titik-titik yang developer secara manual memilih untuk memanggilnya, bukan otomatis terpicu oleh setiap mutasi data penting.

---

## 2. Target Architecture — Bagaimana Audit Log Seharusnya Bekerja

1. **Satu model kanonik**, bukan dua paralel. Karena "Canonical Runtime Event Model" v4.0C sudah mulai dibangun dan dipakai untuk activity feed, target jangka panjang adalah **menjadikan model event ini sebagai satu-satunya sumber kebenaran audit**, dengan `ai_audit_logs` klasik diperlakukan sebagai jalur legacy yang dipensiunkan bertahap (bukan dua sumber kebenaran yang terus dipelihara bersamaan selamanya).
2. **Field wajib tingkat pertama** (kolom skema, bukan terselip di JSON): `actorId` (siapa), `tenantId` (milik siapa — terhubung langsung ke P0-1), `resourceType`+`resourceId` (apa), `action` (aksi apa), `status`, `occurredAt`, dan `details` tetap ada sebagai JSONB untuk metadata tambahan yang benar-benar kontekstual (bukan field inti yang seharusnya terstruktur).
3. **Penulisan audit log tidak lagi murni manual per titik kode** — idealnya terpicu otomatis dari lapisan repository (yang sama dengan yang diusulkan di P0-1/P0-2) untuk mutasi data (create/update/delete/soft-delete/restore), sehingga developer tidak bisa "lupa" menambahkan audit log untuk operasi baru.
4. **Immutable & append-only** — entri audit log, setelah ditulis, tidak pernah diubah atau dihapus lewat jalur aplikasi normal (termasuk oleh mekanisme soft-delete P0-2 — audit log adalah salah satu dari sedikit kategori data yang *tidak* mengikuti pola soft-delete, karena tujuannya justru menjadi jejak permanen).

---

## 3. Skema yang Direkomendasikan (Konsep, Bukan DDL)

| Field | Wajib? | Keterangan |
|---|---|---|
| `id` | Ya | Identifier unik entri |
| `occurredAt` | Ya | Waktu kejadian aktual (bukan waktu tulis, bila berbeda karena antrian async) |
| `tenantId` | Ya (setelah P0-1 selesai) | Terhubung ke tenant context — tanpa ini, audit log lintas-tenant tidak bisa disaring saat investigasi |
| `actorId` | Ya, kecuali aksi sistem murni | Staf internal, klien, atau `"system"`/`"scheduler"` untuk aksi otomatis |
| `actorType` | Ya | `internal_staff` / `customer` / `system` / `superadmin_cross_tenant` — kategori ini penting untuk membedakan akses cross-tenant (P0-1 Bagian 6) dari aksi normal |
| `module` | Ya | Dipertahankan dari skema lama — sudah berguna untuk pengelompokan by-service |
| `action` | Ya | Dipertahankan dari skema lama |
| `resourceType` / `resourceId` | Ya | Dipertahankan dari skema lama |
| `status` | Ya | Dipertahankan dari skema lama |
| `details` | Opsional | JSONB untuk metadata kontekstual tambahan yang tidak butuh jadi kolom terstruktur |

---

## 4. Tenant Context Flow untuk Audit Log

```
Mutasi data (create/update/delete/soft-delete/restore)
  ↓
Repository layer (P0-1/P0-2) sudah memegang tenant context + actor context
  ↓
Repository memicu penulisan audit log otomatis dengan context yang SAMA
  (tidak direkonstruksi ulang di titik terpisah — mencegah drift/inkonsistensi)
  ↓
Audit log tersimpan sebagai entri immutable, append-only
  ↓
Dibaca kembali lewat query terpisah (mis. dashboard investigasi admin) — TIDAK PERNAH ditulis ulang
```

---

## 5. Middleware Strategy (Blueprint, Tanpa Implementasi)

Tidak dibutuhkan middleware HTTP baru — audit logging idealnya dipicu di **repository layer** (tempat tenant context dan actor context sudah tersedia dari P0-1/P0-2), bukan di middleware request/response. Middleware HTTP hanya bertanggung jawab meletakkan actor context ke request (`req.internalUser`/session customer) — repository yang kemudian menerjemahkannya menjadi entri audit log otomatis untuk setiap mutasi yang lewat lapisan tersebut.

Untuk aksi yang tidak lewat repository standar (mis. operasi database langsung yang tersisa dari kode lama sebelum migrasi P0-1/P0-2 tuntas), audit log tetap dipanggil manual sebagai jalur sementara — tapi ini harus ditandai sebagai *technical debt sementara* yang hilang begitu migrasi repository selesai, bukan pola permanen.

---

## 6. Worker & Scheduler Strategy

Job worker dan scheduler (`jobWorkerService.ts`, `aiSchedulerService.ts`) beroperasi sebagai `actorType: system` atau `actorType: scheduler` — audit log untuk aksi yang dipicu job harus tetap membawa **tenant context dan resource context** yang sama dengan yang tercatat di job record (P0-1 Bagian 8), bukan kosong hanya karena tidak ada "manusia" yang memicunya secara langsung. Ini penting untuk investigasi: staf perlu bisa membedakan "AI job X memproses project Y milik tenant Z" secara utuh dari audit trail, tanpa harus menggabungkan data dari beberapa tabel terpisah secara manual.

---

## 7. AI Workflow Strategy

Setiap keputusan AI yang berdampak pada data bisnis (approve/reject otomatis, keputusan routing model, keputusan `aiCeoService`) harus tercatat sebagai entri audit dengan `actorType: system`/`ai_agent`, menyertakan identifier model/agent yang membuat keputusan tersebut di `details` — ini penting khususnya untuk kasus di mana keputusan AI perlu ditelusuri ulang (mis. klien mempertanyakan mengapa sebuah deliverable ditolak QC otomatis).

---

## 8. Export & Presentation Strategy

Dipertahankan dari pola yang sudah baik hari ini: audit log dipanggil konsisten di akhir setiap job export (`creativeDocumentWorkerService.ts`, `creativePresentationWorkerService.ts`) — target ke depan hanya menambahkan `tenantId`/`actorId` terstruktur ke pemanggilan yang sudah ada ini, tidak perlu mengubah *titik* pemanggilannya.

---

## 9. SSE Strategy

Audit log **tidak perlu** dikirim lewat SSE (SSE untuk notifikasi real-time ke klien, audit log untuk investigasi internal — dua kebutuhan berbeda). Yang perlu dipastikan: aktivitas yang dikirim lewat SSE ke klien (`sseManager.ts`) dan entri audit log untuk aktivitas yang sama berasal dari **sumber data yang konsisten** (idealnya Canonical Event Model yang sama, sesuai arah v4.0C yang sudah dimulai) — bukan dua pencatatan independen yang bisa saling tidak sinkron.

---

## 10. Security Analysis

| Risiko | Penjelasan | Mitigasi |
|---|---|---|
| **Audit log tidak lengkap (blind spot)** | Karena penulisan manual per titik kode, mutasi baru yang ditambahkan developer bisa lupa disertai audit log | Pemicu otomatis dari repository layer (Bagian 2, 5) menghilangkan ketergantungan pada disiplin manual |
| **Audit log dipalsukan/actor tidak jelas** | Tanpa kolom `actorId` terstruktur, klaim "siapa melakukan apa" tidak bisa diverifikasi andal | Kolom `actorId`/`actorType` wajib, diisi dari context tepercaya (session/token), bukan dari input request |
| **Audit log lintas-tenant bercampur** | Tanpa `tenantId`, investigasi satu tenant bisa "melihat" data entri tenant lain secara tidak sengaja saat query | `tenantId` wajib (Bagian 3), disaring sesuai aturan P0-1 saat query investigasi, kecuali oleh superadmin yang aksinya sendiri tercatat |
| **Audit log diubah/dihapus setelah ditulis** | Jika ada jalur yang mengizinkan update/delete entri audit, integritas jejak investigasi rusak | Audit log harus immutable & append-only secara desain (Bagian 2) — tidak ada endpoint update/delete untuk tabel ini |
| **Dua model paralel (legacy `ai_audit_logs` vs Canonical Event v4.0C) menyebabkan investigasi harus mengecek dua tempat** | Ditemukan indikasi transisi yang belum tuntas | Migrasi terarah menuju satu model kanonik (Bagian 2 poin 1), bukan dibiarkan dua-duanya hidup permanen |

---

## 11. Migration Strategy (Tanpa Implementasi)

**Phase 1 — Perkuat Skema:** Tambahkan kolom `tenantId`, `actorId`, `actorType` (nullable dulu) ke `ai_audit_logs` (atau tabel Canonical Event yang menjadi penerusnya, sesuai keputusan arsitektur mana yang dijadikan target akhir). Backfill data historis dengan nilai terbaik yang bisa direkonstruksi dari `details` JSON yang ada (untuk entri yang memang menyimpan info ini secara tidak konsisten di JSON), sisanya ditandai `unknown` secara eksplisit — bukan dibiarkan `null` tanpa makna jelas.

**Phase 2 — Pemicu Otomatis di Repository:** Begitu repository layer P0-1/P0-2 dibangun, sambungkan pemicu audit log otomatis padanya, dimulai dari domain risiko rendah menuju tinggi (pola yang sama seperti P0-1 Bagian 14).

**Phase 3 — Konsolidasi ke Satu Model Kanonik:** Setelah Canonical Event Model (v4.0C) terbukti stabil menampung seluruh kategori aksi yang selama ini dicatat `ai_audit_logs` klasik, jadikan model itu satu-satunya sumber kebenaran. `ai_audit_logs` klasik dipertahankan sebagai arsip read-only historis (tidak dihapus — punya nilai investigasi/legal), tapi tidak lagi menerima entri baru.

**Rollback Strategy:** Phase 1–2 aditif dan aman dibalik (kolom baru nullable, pemicu otomatis di belakang flag per-domain seperti pola P0-1/P0-2). Phase 3 (konsolidasi) harus dilakukan hanya setelah periode paralel-run yang cukup panjang di mana kedua model dibandingkan menghasilkan data yang konsisten — bukan langsung memutus penulisan ke model lama sebelum yakin model baru menangkap seluruh kategori aksi yang setara.

---

## 12. Compatibility Analysis

| Area | Dampak |
|---|---|
| Customer Portal | Aktivitas klien (approve/reject/komentar) perlu tercatat dengan `actorType: customer` — activity feed yang sudah membaca dari Canonical Event Model tetap konsisten, tidak perlu perubahan besar di sisi tampilan |
| Admin Portal | Butuh dashboard investigasi audit baru yang bisa memfilter by tenant/actor/resource — kebutuhan UI tambahan |
| Worker/Scheduler | Perlu memastikan job/schedule membawa context yang cukup untuk mengisi audit log otomatis (Bagian 6) |
| AI | Keputusan otomatis AI perlu tercatat dengan actor jelas (Bagian 7) |
| Presentation/Document | Tidak ada perubahan titik pemanggilan, hanya perkayaan field (Bagian 8) |
| Quotation | Perubahan status quotation (baik jalur legacy maupun canonical, P0-4) harus tercatat audit dengan actor & tenant jelas — penting karena ini menyentuh langsung data finansial |
| Authentication | Percobaan login gagal/berhasil sebaiknya juga masuk kategori yang dicatat (saat ini tidak jelas apakah `rateLimiter`'s Login tier terhubung ke audit log) — dicatat sebagai area yang perlu diverifikasi saat implementasi |

---

## 13. Risk Analysis & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Volume audit log tumbuh sangat besar seiring waktu, membebani database | Kebijakan retensi terpisah untuk audit log (lebih panjang dari retensi data bisnis biasa, karena nilai investigasi/legal) — bukan soft-delete/purge yang sama seperti P0-2, karena audit log secara filosofis tidak boleh "dihapus" seperti data bisnis |
| Backfill data historis actor/tenant tidak akurat | Ditandai eksplisit sebagai `unknown` bila tidak bisa direkonstruksi, bukan dipaksa menebak nilai yang berpotensi salah |
| Dua model paralel (legacy + Canonical Event) menyebabkan kebingungan investigasi selama masa transisi | Dokumentasikan dengan jelas periode transisi dan sumber mana yang otoritatif untuk rentang waktu tertentu |

---

## 14. Implementation Order

1. Tambah kolom `tenantId`/`actorId`/`actorType` (nullable) ke skema audit log yang ada.
2. Backfill data historis sebaik mungkin, sisanya `unknown` eksplisit.
3. Bangun pemicu otomatis di repository layer (bersamaan dengan P0-1/P0-2), dimulai domain risiko rendah.
4. Perluas pemicu otomatis ke seluruh domain (mengikuti urutan P0-1 Bagian 17).
5. Bangun dashboard investigasi admin dengan kemampuan filter tenant/actor/resource/waktu.
6. Evaluasi kesiapan Canonical Event Model (v4.0C) menggantikan `ai_audit_logs` klasik secara penuh.
7. Jalankan periode paralel-run untuk verifikasi konsistensi sebelum konsolidasi final (Phase 3).

---

## 15. Acceptance Criteria

- Setiap mutasi data penting (create/update/delete/soft-delete/restore/status komersial) menghasilkan tepat satu entri audit log yang lengkap (`tenantId`, `actorId`, `actorType`, `resourceType`/`resourceId`, `action`, `status`).
- Tidak ada jalur update/delete pada tabel audit log dari aplikasi normal — hanya insert.
- Dashboard investigasi admin bisa memfilter entri berdasarkan tenant, actor, resource, dan rentang waktu, dan superadmin cross-tenant access selalu terlihat sebagai kategori actor tersendiri.
- Backfill data historis terverifikasi — tidak ada entri yang secara diam-diam kehilangan makna karena tenant/actor tidak terisi tanpa penjelasan.

---

## 16. Testing Strategy

**Unit Test:** fungsi pemicu audit log di repository layer — memverifikasi setiap jenis mutasi menghasilkan entri audit dengan field lengkap sesuai skema Bagian 3.

**Integration Test:** flow penuh (mis. approve quotation) menghasilkan entri audit yang bisa ditelusuri kembali ke actor dan tenant yang benar.

**Security Test:** mencoba mengubah/menghapus entri audit log lewat endpoint mana pun — harus tidak mungkin secara desain; mencoba membaca entri audit tenant lain tanpa hak superadmin — harus ditolak.

**Regression Test:** memverifikasi activity feed customer workspace (yang sudah membaca Canonical Event Model) tidak terganggu selama masa transisi paralel-run.

---

*Blueprint ini murni perencanaan teknis berdasarkan bukti source code aktual dan hasil audit/validasi sebelumnya. Tidak ada kode, migration, atau perubahan konfigurasi apa pun yang dibuat dalam penyusunan dokumen ini.*
