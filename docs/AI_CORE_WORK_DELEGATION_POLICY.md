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

Owner menerbitkan mandat untuk satu izin teknis di CST-DEV. OpenClaw menerbitkan izin berdasarkan mandat tersebut melalui akun layanan `openclaw-vps-dev-consumer`. Mandat hanya berlaku untuk tenant `default`, Task Hub #189, job `816767f4-4264-4931-9a82-3d9496d3da3c`, dan permintaan `66ae915fde2dc1aab68b55272a7107cb3e4b`. [Tiket operasional #208](https://github.com/Travelintrips/AI-Task-Hub/issues/208)

Rute berada di `/api/ai/agent-runtime/dev/task189-release`. Aktivasi memerlukan dua migrasi skema `20261124_task189_release_delegation.sql` dan `20261124_task189_owner_mandate.sql`, serta konfigurasi DEV terlindung `CST_DEV_TASK189_OWNER_USER_ID` yang berisi ID akun Core milik Owner yang sudah diverifikasi. Rute tetap nonaktif sampai pengelola mengatur `CST_DEV_TASK189_DELEGATION_ENABLED=true`. Sistem mencocokkan sesi, ID, jabatan, dan status aktif Owner. Sistem menyimpan identitas penerbit dan waktu penerbitan dalam riwayat yang terlindung.

| Operasi | Pelaku dan hasil |
| --- | --- |
| `GET` | Owner membaca kesiapan dan riwayat mandat. |
| `POST /register` | Owner mengirim `{grantId}` berupa UUID baru melalui sesi dan origin Core DEV. Server mengikat sesi Owner, target, dan kredensial OpenClaw. Gunakan UUID yang sama ketika mengulangi permintaan yang hasilnya belum diketahui. |
| `POST /issue` | OpenClaw mengirim `{grantId}` dengan kredensial layanannya. |
| `POST /redeem` | Owner yang sama mengirim `{grantId, permitId}`. |
| `POST /revoke` | Owner mencabut `{grantId}`. |

Mandat berlaku 15 menit dan izin berlaku maksimal tiga menit. Pencabutan, perubahan kredensial dan penonaktifan akun Owner mencegah pemakaian berikutnya. Riwayat mandat lama dipertahankan dan izin yang sudah tercatat menghabiskan jatah satu kali. Kontrol penandatangan VPS dan keputusan eksekusi Task Hub tetap diverifikasi melalui layanan masing-masing.

## Pelaporan

Laporan ringkas berisi perubahan konkret, tautan commit/PR atau bukti operasi, CI, hasil deployment, dan blocker yang belum selesai. Jangan mengubah status menjadi COMPLETED tanpa bukti terminal yang sah.
