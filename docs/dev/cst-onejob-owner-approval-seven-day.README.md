# CST-DEV — persetujuan satu kali dengan masa tunggu QA 7 hari

**Status: kandidat source/SQL. Belum diterapkan ke Supabase CST-DEV atau PROD.**

Masalah: Super Admin menyetujui satu job WAITING sekali. Bukti QA yang
bergantung pada jobId dan approvalId baru dapat diterbitkan setelah itu.
Masa 20 menit sebelumnya dapat habis sebelum QA admission selesai.

Desain: persetujuan bisnis untuk **satu job yang terikat identitas** tetap
berlaku maksimal 7 hari saat QA menyiapkan admission. Owner aktif, source SHA,
worker, model, requestId, company 1, job WAITING, nonce satu kali, dan
bukti QA bertanda tangan independen tetap diverifikasi saat admission.
Persetujuan ini bukan izin untuk dispatch, signer, atau Final ACK.

Batas keamanan lain tidak diubah:
- Izin teknis database Gate A JIT LOGIN maksimal 10 menit dan tetap wajib relock.
- QA signed receipt hanya beberapa menit pada saat admission.
- Sesi aplikasi Owner mengikuti TTL normal 12 jam, bukan login ulang tiap 20 menit.
- Durasi job tidak ditentukan oleh lamanya menunggu admission.
- Model-call runtime timeout internal tetap terpisah dan belum diubah.

Supabase CST-DEV saat audit masih memakai CHECK dan RLS yang membatasi
expires_at hingga 30 menit dari approved_at. Karena itu source baru yang
menulis 7 hari **tidak boleh dideploy sebelum migrasi disetujui dan PASS**.

Migration kandidat:
- docs/dev/cst-onejob-owner-approval-seven-day.CSTDEV-ONLY.sql
- docs/dev/cst-onejob-owner-approval-seven-day.ROLLBACK-CSTDEV-ONLY.sql

Migrasi membutuhkan project CST-DEV xssrfshdrtdfupgqwfdw yang terverifikasi,
role staging NOLOGIN dan nol sesi/approval aktif, serta schema/policy semula
yang cocok. Tidak menambah role atau GRANT, tidak mengubah PROD, dan
mempertahankan RLS, pencegahan replay, serta indeks unik satu approval.
Rollback ditolak jika persetujuan berdurasi panjang masih ada.

Bukti disposable PostgreSQL16 jaringan none: 7 hari diterima setelah
migrasi, 8 hari/worker salah/job salah ditolak, rollback saat ada approval
7 hari ditolak, rollback setelah penghapusan data QA PASS.

Status operasional tetap NO-GO sampai watchdog, kredensial resmi, Supavisor,
dan transaksi WAITING sampai Final ACK yang sah terbukti lulus.