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

## Pelaporan

Laporan ringkas berisi perubahan konkret, tautan commit/PR atau bukti operasi, CI, hasil deployment, dan blocker yang belum selesai. Jangan mengubah status menjadi COMPLETED tanpa bukti terminal yang sah.
