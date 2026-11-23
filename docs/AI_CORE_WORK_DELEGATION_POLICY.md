# Kebijakan Pembagian Pekerjaan ChatGPT dan AI Core

## Jalur utama

- **Coding / perubahan source code:** ChatGPT mengerjakan langsung melalui GitHub (branch, commit, pull request, CI, merge setelah pemeriksaan wajib hijau, deployment, dan verifikasi produksi). Jangan membuat task Coding Orchestrator secara implisit.
- **Non-coding / operasi dan monitoring:** ChatGPT boleh langsung meminta bantuan AI Core tanpa bertanya ulang kepada pengguna untuk tindakan operasional yang telah diotorisasi, termasuk pemeriksaan status layanan, worker, VPS, koneksi, dan troubleshooting non-destruktif.
- **Ollama:** Alokasikan hanya untuk permintaan render gambar/video sesuai kebijakan pengguna, bukan untuk coding rutin.
- **OpenClaw:** Kendali PC/VPS yang telah diotorisasi melalui jalur operasional aman.

## Routing, metadata, dan pengamanan

1. Setiap perintah harus mengidentifikasi **jenis pekerjaan** (`CODING_GITHUB` atau `OPERATIONS_AI_CORE`), **target** (repository/host/task ID), **aksi**, dan **status verifikasi**.
2. Perintah `retry`, `requeue`, `recover`, atau `resume` untuk task existing harus menyertakan task ID asli, tidak menciptakan task baru, dan melaporkan `operation`, `taskId`, `accepted`, serta status tersimpan. Jangan mengklaim berhasil hanya karena perintah diterima.
3. Jika GitHub connector timeout, coba jalur Git alternatif yang tersedia. AI Core dapat dimintai bantuan untuk akses/diagnostik operasional, tetapi **jangan mengalihkan coding secara diam-diam** ke Coding Orchestrator.
4. Terapkan aturan keamanan dan persetujuan yang diwajibkan untuk tindakan berisiko tinggi (penghapusan data, perubahan akses/secret, migrasi destruktif, dan tindakan produksi kritis yang memerlukan approval).
5. Uji CI dan verifikasi hasil deployment sebelum melaporkan selesai. Perintah berhasil diterima bukan bukti bahwa pekerjaan selesai.
6. Saat suatu CWS dibatalkan karena coding dipindahkan ke GitHub, pastikan autonomous disabled dan hindari retry atau membuat CWS duplikat.

## Delegasi penerbit rilis CST-DEV untuk Task #189

Owner menunjuk akun layanan `openclaw-vps-dev-consumer` sebagai calon penerbit satu izin rilis untuk mengaktifkan layanan penanda tangan persiapan kedua GPT02. Permintaan akses tercatat di [tiket operasional #208](https://github.com/Travelintrips/AI-Task-Hub/issues/208). Pengelola rilis CST-DEV mengaktifkan delegasi melalui mekanisme perubahan akses yang memverifikasi identitas penerima dan merekam perubahan. Sampai ada bukti aktivasi, statusnya tetap diajukan.

| Batas delegasi | Nilai |
| --- | --- |
| Lingkungan dan tenant | CST-DEV, perusahaan `default` |
| Penerima | Identitas layanan DEV terautentikasi `openclaw-vps-dev-consumer` |
| Objek | Task Hub #189, job `816767f4-4264-4931-9a82-3d9496d3da3c`, permintaan pemulihan `66ae915fde2dc1aab68b55272a7107cb3e4b` |
| Tindakan | Menerbitkan satu izin untuk layanan penanda tangan persiapan kedua, dengan masa berlaku eksplisit dan satu kali pemakaian |
| Keputusan Owner | Owner menandatangani persetujuan persiapan melalui aplikasi dengan sesi pribadinya |

Sebelum penerbitan, sistem rilis harus mencocokkan identitas layanan, lingkungan, job, permintaan, dan status delegasi. Delegasi berakhir setelah satu penerbitan, kedaluwarsa, atau pencabutan. Permintaan ulang untuk objek yang sama harus mengembalikan referensi penerbitan semula tanpa membuka kesempatan kedua. Persetujuan Owner, pengiriman job, dan konfirmasi hasil tetap memakai pemeriksaan masing-masing.

Pengelola mencatat referensi delegasi dan referensi izin yang dapat diperiksa pada tiket #208. Verifikasi pada VPS harus membuktikan izin berlaku untuk #189. Nama peran dalam dokumen ini saja tidak mengaktifkan hak akses di VPS.

### Registrasi dan penerbitan teknis di Core DEV

Rute Core DEV berada di `/api/ai/agent-runtime/dev/task189-release`. Rute hanya tersedia pada host DEV saat pool database cocok dengan proyek CST-DEV dan pengelola rilis telah mengaktifkan `CST_DEV_TASK189_DELEGATION_ENABLED`. Migrasi manual `20261124_task189_release_delegation.sql` menyimpan riwayat dalam skema terpisah. Pengelola rilis memasang kunci publik Ed25519 otoritas independen pada konfigurasi terlindung `CST_DEV_TASK189_REGISTRAR_PUBLIC_DER_B64` (SPKI DER, base64). Kunci privat tetap pada otoritas tersebut.

| Operasi | Pelaku dan hasil |
| --- | --- |
| `GET` | Admin internal membaca target, ID dan sidik kredensial aktif, serta catatan penerbitan. |
| `POST /register` | Admin internal menyerahkan paket `{mandate, signature}` yang telah ditandatangani otoritas rilis. Mandat mencantumkan ID dan sidik kredensial, ID admin penukar, batas waktu UTC (epoch milidetik), dan seluruh target di atas. Format byte mengikuti urutan kolom dalam `verifyMandate`, dengan tanda tangan base64url tanpa padding. |
| `POST /issue` | OpenClaw memakai kredensial layanannya sendiri dan mengirim `grantId`. Percobaan ulang atas mandat yang sama mengembalikan ID izin pertama. |
| `POST /redeem` | Admin yang ditunjuk dalam mandat mengirim `grantId` dan `permitId`. Pencatatan pemakaian bersifat atomik dan hanya dapat berhasil sekali. |
| `POST /revoke` | Admin internal mencabut `grantId`. Pencabutan permanen, termasuk untuk izin yang telah diterbitkan dan belum dipakai. |

Masa berlaku maksimum izin tiga menit dan berakhir lebih awal bila mandat kedaluwarsa. Perubahan kredensial OpenClaw membatalkan kecocokan mandat. Menonaktifkan flag menghentikan seluruh rute dan mempertahankan riwayat. Pemasangan kode dan pencatatan izin pada Core belum membuka jendela VPS. Kontrol rilis independen pada VPS, relock, serta persetujuan Owner melalui Task Hub tetap diperlukan sebelum pengujian job dilanjutkan.

## Pelaporan

Laporan ringkas berisi perubahan konkret, tautan commit/PR atau bukti operasi, CI, hasil deployment, dan blocker yang belum selesai. Jangan mengubah status menjadi COMPLETED tanpa bukti terminal yang sah.
