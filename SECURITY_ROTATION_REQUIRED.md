# SECURITY_ROTATION_REQUIRED

Plaintext credentials telah dihapus dari `.replit` pada HEAD ini.

Karena credential sebelumnya pernah tersimpan di git-tracked file,
seluruh credential di bawah ini **wajib dirotasi** sebelum platform
dinyatakan aman untuk production.

Setelah dirotasi, simpan nilai baru di **Replit Secrets**
(bukan di `.replit` atau file manapun yang di-track oleh git).

---

## Wajib Dirotasi: AI Provider Keys

| Nama Secret | Keterangan |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `MISTRAL_API_KEY` | Mistral AI API key |
| `COHERE_API_KEY` | Cohere API key |
| `REPLICATE_API_TOKEN` | Replicate image generation token |

---

## Wajib Dirotasi: Autentikasi & Admin

| Nama Secret | Keterangan |
|---|---|
| `ADMIN_API_KEY` | Internal admin API authentication key |
| `VITE_ADMIN_API_KEY` | Frontend admin authentication key (nilai sama dengan ADMIN_API_KEY) |
| `SESSION_SECRET` | Express session signing secret |

---

## Wajib Dirotasi: Database (Supabase Development)

| Nama Secret | Keterangan |
|---|---|
| `SUPABASE_DATABASE_URL_DEV` | PostgreSQL connection string (dev) — mengandung password |
| `SUPABASE_DEV_DATABASE_URL` | Alias dari DATABASE_URL_DEV |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | Supabase service role JWT (dev) — mem-bypass RLS |
| `SUPABASE_ANON_KEY_DEV` | Supabase anon JWT (dev) |

---

## Wajib Dirotasi: Database (Supabase Production)

| Nama Secret | Keterangan |
|---|---|
| `SUPABASE_DATABASE_URL` | PostgreSQL connection string (prod) — mengandung password |
| `SUPABASE_PROD_DATABASE_URL` | Alias dari DATABASE_URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role JWT (prod) — mem-bypass RLS |
| `SUPABASE_ANON_KEY` | Supabase anon JWT (prod) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon JWT untuk frontend (prod) |

---

## Wajib Dirotasi: Email & Notifikasi

| Nama Secret | Keterangan |
|---|---|
| `SMTP_PASS` | Password akun email SMTP (Hostinger) |
| `FONNTE_TOKEN` | WhatsApp API token (Fonnte) |

---

## Wajib Diset Ulang: Admin Account

| Nama Secret | Keterangan |
|---|---|
| `INITIAL_INTERNAL_ADMIN_EMAIL` | Email admin pertama (tidak boleh menggunakan email lama yang pernah ter-expose di git) |
| `INITIAL_INTERNAL_ADMIN_PASSWORD` | Password admin pertama |

---

## Tidak Perlu Dirotasi (Non-Secret)

Nilai berikut bukan credential dan tetap ada di `.replit`:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`
- `ALLOWED_ORIGINS`
- `DESIGN_AI_MULTI_AGENT_ENABLED`
- `PUBLIC_APP_URL`
- `SUPABASE_URL_DEV`, `SUPABASE_URL`
- `SUPABASE_STORAGE_BUCKET_DEV`, `SUPABASE_STORAGE_BUCKET`
- `VITE_SUPABASE_URL_DEV`

---

## Langkah Selanjutnya

1. **Rotasi semua credential** di platform masing-masing (OpenAI, Anthropic, Google, dll.)
2. **Rotasi Supabase service role keys** dari Supabase Dashboard → Project Settings → API
3. **Rotasi SMTP password** dari Hostinger panel
4. **Simpan nilai baru** sebagai Replit Secrets (bukan di file)
5. **Jalankan history rewrite** pada repository GitHub menggunakan `git-filter-repo`
   untuk menghapus credential dari seluruh git history
6. **Force-push** ke GitHub setelah rewrite selesai

---

*Dibuat: 2026-07-24*
*Alasan: Credential production ditemukan dalam git-tracked file `.replit` — lihat Final Security Validation Report.*
