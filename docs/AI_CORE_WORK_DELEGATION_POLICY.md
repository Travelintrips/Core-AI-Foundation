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

## Pelaporan

Laporan ringkas berisi perubahan konkret, tautan commit/PR atau bukti operasi, CI, hasil deployment, dan blocker yang belum selesai. Jangan mengubah status menjadi COMPLETED tanpa bukti terminal yang sah.
