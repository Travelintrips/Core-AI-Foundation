# GPT02 DELL DEV — snapshot source kandidat (release hold)

**Status: kandidat audit, bukan source release aktif.** Berkas ini adalah salinan kode DEV DELL yang telah menghasilkan bukti browser-wake E2E, dinormalisasi ke LF untuk Git. Direktori ini **tidak** dipanggil oleh jalur deployment atau worker operasional, tidak membuat job baru, dan tidak boleh menggantikan source canonical tanpa review.

## Bukti DEV yang sudah ada

Ledger Supabase DEV mencatat tiga command melalui jalur `authorized-dev-browser-wake` → OpenClaw DELL → verified Ed25519 callback → acknowledged Final ACK (`E2E_VERIFIED`):
- `41eb9f27-3ab1-4a8e-9615-3cc338428af4`
- `798bb8df-c380-4e00-8ec6-8bc3d176db60`
- `057d9f3c-f74c-4c4c-ab51-fa43a65dea69`

Satu command lain, `e5e1d428-1ef1-45bb-8041-603d31ee8bf2`, tetap `FAILED`. Dua belas kontrak sintetik dan pengujian native/reader telah memverifikasi pemisahan marker, idempotensi, serta fail-closed pada kasus salah. Bukti live tersebut bukan bukti bahwa snapshot ini sudah siap deploy.

**Pembatasan lineage:** ketiga command browser-wake itu memiliki `bridge.task_id=NULL` dan tidak cocok dengan `gpt02_private.issuer_evidences`. Issuer Task #166 tetap hanya `NO_DISPATCH`. Jangan mengklaim Task Hub → issuer → command yang sama → Final ACK telah PASS.

## Kebijakan sumber dan deploy

- Source canonical `scripts/windows/ai-core/dev_chatgpt_native_transport.py` serta tes warisannya **tidak diubah** oleh PR ini. Dengan demikian jalur terpasang dan CI lama tetap stabil.
- Snapshot Windows asli mengalami normalisasi line ending CRLF menjadi LF untuk review. Hash di `source-manifest.json` berlaku untuk **byte Git LF**, bukan byte Windows yang otomatis menjadi CRLF setelah checkout. Hash pin runtime harus direkonsiliasi secara eksplisit sebelum deployment.
- `dell-wake-executor-once.mjs` adalah snapshot referensi, bukan program portable/mandiri. Ia mengandalkan konfigurasi, attestation custody, dan layanan DEV lain yang **tidak** ditransfer ke Git.
- Tidak ada `auth.json`, token, API key, private key, transcript percakapan, atau file log dalam snapshot.
- Tidak boleh memulihkan command terminal lama melalui Send kedua, menghapus 429, mengubah `dispatch_allowed=false`, menyetel callback manual, atau menyentuh PROD.
- Monitor GET lama harus tetap mencatat circuit 429 historis. Rute cache lokal hanya dinyatakan siap setelah sumber, binding, hash, lease, dan pemilik otorisasi yang tepat dibuktikan.

## Tahapan sebelum promosi

1. Rekonsiliasi seluruh dependensi ke struktur instalasi canonical, bukan melakukan copy langsung dari snapshot.
2. Harness Windows native snapshot kini sudah diadaptasi sebagai tes terpisah `test_gpt02_native_legacy_compatibility_20261113.py` (35/35 PASS pada Linux; CI Windows wajib PASS juga). Tes ini memakai mock CDP baru dan log rate-limit 200 sintetis dalam tempdir; source canonical beserta 35 tes aslinya tetap tidak diubah. Sebelum promosi, tetap butuh audit integrasi Windows native, hash pinned runtime, dan uji kegagalan cache.
3. Verifikasi dengan CI Windows dan DEV E2E **baru yang terotorisasi**, dengan satu command ID, satu tanda tangan callback, satu Final ACK; larang requeue lama.
4. Jalankan backport melalui PR review terpisah dengan pemeriksaan rollback dan satu listener aktif. Jangan deploy PROD sebelum lineage Task Hub/issuer/dispatch punya bukti satu-command-ID yang sah.

Kandidat ini bertujuan menghindari hilangnya perubahan yang terbukti PASS di DELL pada deployment source berikutnya. **Bukan persetujuan rilis**.

**Source-custody note:** Diagnostic outputs and secret/auth stores are excluded via .gitignore. The review branch was rewritten to remove a diagnostic log from its prior Git history before CI/review; do not link or publish legacy objects.
