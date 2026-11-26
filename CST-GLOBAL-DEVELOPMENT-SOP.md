# CST Global Development SOP & Auto-Recovery

Versi 1.0.0 · 21 November 2026 · Pemilik: CST

## Sumber resmi dan cakupan

Core AI Foundation menyimpan standar ini. GPT02, OpenClaw, dan sesi ChatGPT yang diberi akses membaca versi aktif dari branch default dan mencatat versi serta commit sumber pada setiap job. Saat melanjutkan job, baca checkpoint dan periksa apakah perubahan standar memengaruhi izin atau langkah selanjutnya. Gunakan [SOP komunikasi Core AI](docs/SOP_AI_CORE_CHATGPT_OPENCLAW_COMMUNICATION.md) untuk otoritas, transport, callback, dan bukti penerimaan. Gunakan [protokol job Core AI](docs/ai-core-autonomous-job-protocol-v1.md) untuk identitas pesan, status dan handoff.

Standar ini berlaku untuk Core AI, AI Task, Sport Center, BizPortal, Fleet, WA Gateway, dan Tenant POS. Validasi alur pada Core AI, GPT02 dan OpenClaw DEV sebelum adopsi repo aplikasi lain.

## Penerimaan dan klasifikasi

Catat job ID, aplikasi, repo, lingkungan tujuan, identitas pemohon, izin tindakan, dan kriteria selesai. Periksa commit aktif, workflow, konfigurasi, serta bukti PASS sebelumnya. Gunakan kembali hasil yang masih relevan dengan commit dan konfigurasi yang diuji. Batasi perubahan pada penyebab masalah dan pertahankan perilaku yang sudah lulus.

| Jenis | Jalur |
| --- | --- |
| Operasional | Gunakan prosedur dan konektor yang sah. Catat hasil. PR, CI, dan deployment berlaku bila pekerjaan menghasilkan perubahan yang memerlukannya. |
| Bugfix | Perbaiki titik gagal, jalankan uji regresi dan CI yang relevan. Buktikan jalur pengguna yang terdampak pada runtime DEV. |
| Fitur baru | Gunakan komponen yang ada, uji alur utama dan penolakan, jalankan CI dan E2E DEV. |
| Konfigurasi | Catat target dan perbedaan konfigurasi tanpa nilai rahasia. Uji startup, readiness dan alur terkait. Siapkan pemulihan konfigurasi. |
| Kritis | Autentikasi, database, pengamanan, dan tindakan berisiko mengikuti gerbang izin yang berlaku. Perubahan PROD selalu memerlukan persetujuan eksplisit pemilik untuk versi, target dan tindakan terkait. |

## Fastlane DEV

1. Cocokkan perubahan dengan workflow resmi aplikasi dan periksa trigger, branch, dan environment. Gunakan workflow yang sudah ada dan pertahankan pemeriksaan yang masih berlaku. Untuk Core AI, `dev-fast-verify.yml` menjalankan typecheck pada `develop` atau melalui dispatch yang sah.
2. Catat patch dan commit. Jalankan pemeriksaan sumber dan CI yang relevan pada SHA kandidat. Gunakan PR ketika perubahan perlu ditinjau atau diintegrasikan. Ikuti branch protection dan gerbang persetujuan.
3. Deploy kandidat ke DEV yang ditetapkan. Catat SHA/image yang benar-benar aktif, readiness, identitas lingkungan dan rujukan rollback. Verifikasi E2E melalui entry point biasa dengan data QA.
4. Simpan bukti sebelum merge atau menyatakan siap rilis. Bila merge menghasilkan artefak berbeda, verifikasi kandidat rilis yang dihasilkan sesuai kebijakan. Untuk kegagalan, perbaiki penyebab, jalankan ulang pemeriksaan yang terdampak dan perbarui bukti.

Sport Center DEV memakai pembayaran, WhatsApp, dan X904 yang terisolasi dari operasi nyata. BizPortal memakai data QA dan jurnal DEV. GPT02 DEV memakai layanan dan role yang diizinkan untuk job dan tidak mengaktifkan signer, dispatch, atau writer PROD.

## Recovery dan OpenClaw

Gunakan operasi berizin yang sudah ada. Klasifikasikan gangguan sebagai koneksi, kredensial kedaluwarsa, izin, autentikasi interaktif, atau kebijakan platform. Untuk gangguan sementara gunakan maksimal tiga percobaan total dengan jeda meningkat, atau batas yang lebih ketat dari konektor. Mutasi dengan hasil belum diketahui harus direkonsiliasi melalui ID operasi sebelum retry. Hentikan retry otomatis saat izin ditolak, verifikasi pengguna dibutuhkan, atau platform membatasi tindakan.

Gunakan alternatif resmi yang telah diberi izin. Bila perlu OpenClaw, simpan permintaan sebelum dikirim melalui transport terautentikasi. Sertakan job, command, dan correlation ID, target, tindakan yang diizinkan, alasan dan bukti kegagalan, serta kriteria penerimaan. Pakai ID command yang sama pada retry dan deduplikasi event. Worker mengembalikan status, identitas worker, hasil eksekusi, dan referensi bukti. Catat penerimaan hasil dan lanjutkan dari checkpoint setelah memverifikasi korelasi serta kepemilikan lease. Jika terjadi handoff, fence pemilik lama sebelum melanjutkan.

Gunakan profil khusus OpenClaw yang telah diberi izin untuk layanan CST. Pakai sesi sah dan pengelola sandi browser yang disetujui. Pemilik menangani OTP, CAPTCHA, dan verifikasi kehadiran ketika diminta layanan. Setelah sesi pulih, lanjutkan dari checkpoint. Jalur alternatif tidak boleh mengabaikan pembatasan akses. Worker hanya menerima izin minimum untuk tindakan yang disetujui.

## Checkpoint lintas sesi

Simpan dalam penyimpanan job persisten Core AI melalui API atau konektor yang dibatasi per role. Catat job ID, aplikasi, repo, versi/commit SOP, status, langkah terakhir berhasil, bukti PASS yang masih berlaku, commit/PR, CI, deployment DEV, E2E, koneksi yang digunakan, hambatan, tindakan berikutnya, dan status persetujuan pemilik. Simpan sebelum dispatch, setelah side effect terverifikasi, dan ketika pekerjaan berhenti. Bukti mencakup sumber, waktu, dan referensi serta tidak memuat kredensial. Sesi yang melanjutkan membaca job yang sama dan memperoleh lease sebelum menulis atau mengeksekusi.

## Kriteria penerimaan integrasi

Jalankan satu job baca-saja melalui GPT02 DEV. Buktikan klasifikasi, pembacaan versi SOP, dan konektivitas normal. Simulasikan gangguan sementara di DEV, verifikasi klasifikasi, kirim handoff ke OpenClaw yang terautentikasi dan periksa hasil kembali ke GPT02. Buktikan pemulihan dari checkpoint, deduplikasi request, penyimpanan bukti, pembacaan lintas sesi berizin dan penolakan tanpa izin. Catat target DEV dan bukti bahwa alur uji tidak melakukan mutasi PROD.

Bedakan uji unit, verifikasi source, simulasi, CI, dan E2E runtime. Status selesai memerlukan bukti untuk seluruh kriteria job. Ketika akses benar-benar terblokir, simpan penyebab, hasil pemeriksaan dan satu tindakan yang dibutuhkan untuk melanjutkan.
