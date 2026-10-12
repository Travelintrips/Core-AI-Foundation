# DEV Control Center foundation — audit dan kontrak implementasi

## Bukti yang diverifikasi (10 Oktober 2026)
- Repository `Travelintrips/Core-AI-Foundation` tersedia dan dapat ditulis via GitHub connector.
- Root `package.json` adalah monorepo pnpm dengan `artifacts/*`, API server, AI platform, customer portal, skrip verifikasi dan deployment Hostinger.
- Belum ada bukti terverifikasi tentang readiness DNS, isolasi DEV/PROD, worker, Temporal, atau API control-plane.
- Jawaban naratif AI Core tidak dianggap bukti uji; perlu pemeriksaan API dan infrastruktur langsung.

## Yang diimplementasikan
- `dev-control-center/index.html` berisi preview mandiri untuk sembilan aplikasi, pencarian, filter kategori, panel kontrol job, dan formulir chat.
- Tidak ada akses rahasia atau endpoint produksi, dan tidak ada perintah mutasi. Tombol berisiko sengaja disabled.
- Halaman ini BELUM production-ready dan tidak boleh dipublikasi tanpa autentikasi.

## Kontrak minimal backend sebelum fitur live
- `GET /api/dev-center/apps`: daftar aplikasi diizinkan untuk user terautentikasi.
- `GET /api/dev-center/jobs?appId=&status=&cursor=`: daftar job serta sumber status authoritative.
- `GET /api/dev-center/jobs/{id}/events`: stream event berurutan, redaksi secret, reconnect cursor.
- `POST /api/dev-center/jobs/{id}/actions`: stop/retry/restart, require authorization, idempotency key, audit trail.
- `POST /api/dev-center/requests`: perintah coding terikat identitas pengirim, project, environment, dan quota.
- `POST /api/dev-center/releases/{id}/approve`: cek target SHA, environment, CI/security/QA gates, role approval, anti-replay.
- DEV dan PROD wajib menggunakan kredensial dan database yang terpisah; tidak boleh menulis PROD lewat API DEV.

## Gate wajib sebelum deployment
1. Validasi autentikasi, RBAC, CSRF, audit log, dan rate limit.
2. Verifikasi registry aplikasi, GitHub workflows, AI Task routing, AI Core worker health, log streaming, dan Temporal di lingkungan sebenarnya.
3. Lakukan test unit, lint, typecheck, E2E, dan security scans; dokumentasikan hasil CI.
4. Jalankan uji QA preview pada subdomain terlindungi. Pastikan tidak ada perubahan production.
5. Uji cancellation idempotent, retry bounded, stale job recovery, serta rollback.
6. Untuk PROD wajib persetujuan eksplisit dan commit SHA immutable. Jangan menganggap ACK/queued sebagai successful execution.

## Operasional
Branch ini hanya fondasi nonaktif, tidak mengubah routes existing, dependencies, atau workflow deployment. Implementasi API live dan DNS/HTTPS masih pekerjaan berikutnya.
