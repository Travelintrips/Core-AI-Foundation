# Creative Studio — UX Blueprint v2.0
**AI Enterprise Marketplace · UX Architecture & Interaction Specification**
Companion to Design Master v1.0 · For Approval

---

## TABLE OF CONTENTS

1. UX Philosophy & Principles
2. User Personas
3. User Journey Maps
4. Information Architecture
5. Screen Wireframe Specifications
6. Interaction Design Patterns
7. Microcopy & Content Strategy
8. Component State Matrix
9. Accessibility & Inclusive Design
10. Performance UX Guidelines
11. Design Token Export Format
12. Developer Handoff Checklist

---

# PART 1 — UX PHILOSOPHY & PRINCIPLES

## The Core Tension

Creative Studio serves two very different mental models simultaneously:

**The Executive (CEO, Finance Director):** Needs confidence, not complexity. Wants to see ROI, not features. Makes a decision once and delegates the rest.

**The Operator (Marketing Manager, Logistics PM):** Needs detail and control. Checks status daily. Wants clear progress, fast answers, and no surprises.

The UX must feel equally authoritative to both — it cannot condescend to the executive or oversimplify for the operator.

## 5 UX Principles

### 1. Clarity Over Cleverness
Every screen has one primary action. The user never has to ask "what do I do next?" The hierarchy is always: what you need to know → what you need to do → what you can explore.

### 2. Progress is Always Visible
The user's order journey (Brief → Analysis → Commercial → Production → Review → Complete) is always one tap away. No dead ends. No wondering "where is my project?"

### 3. AI is a Co-Pilot, Not a Black Box
When AI is working, show it. When AI makes a recommendation, explain why. When AI is unavailable, say so clearly and give alternatives. Demystify without dumbing down.

### 4. Enterprise-Grade Trust Signals
Every interaction that involves money or commitment must feel legally and commercially solid: timestamps, reference numbers, confirmation emails, downloadable records. Never make the user feel uncertain about a transaction.

### 5. Respect the User's Time
Pre-fill what we know. Remember their preferences. Batch decisions intelligently. The ideal flow for a repeat client submitting a new brief should take under 3 minutes.

---

# PART 2 — USER PERSONAS

## Persona 1: The Executive Buyer
**Name:** Budi Santoso
**Title:** CEO / Managing Director
**Company:** Mid-to-large Indonesian enterprise (150–2000 employees)
**Age:** 45–58

**Goals:**
- Understand what Creative Studio can do for his business in 60 seconds
- Trust that the platform is enterprise-grade before he delegates
- Get a clear commercial proposal without going back and forth multiple times
- Have visibility into project status without being in the weeds

**Frustrations:**
- Platforms that require a long learning curve
- Vague pricing ("contact us for pricing")
- No clear SLA or accountability
- Having to download an app to get started

**UX Implications:**
- Landing page must communicate ROI and trust within the first scroll
- Pricing must be transparent (at least ranges)
- Dashboard must answer "what's happening with my money?" in < 10 seconds
- Every handoff moment (payment, approval) must feel legally solid

**Key Screens:** Landing, Pricing, Service Detail, Commercial/Quotation, Dashboard Home, Billing

---

## Persona 2: The Marketing Operator
**Name:** Sari Wulandari
**Title:** Marketing Manager / Brand Manager
**Company:** FMCG, Retail, or Financial Services
**Age:** 28–38

**Goals:**
- Brief a creative project quickly and accurately
- Track production progress without chasing people via WhatsApp
- Download finished assets in the right format
- Repeat the process for the next campaign

**Frustrations:**
- Unclear revision process
- Long turnaround with no status visibility
- Files lost in email chains
- AI tools that produce generic output

**UX Implications:**
- Brief form must be intelligent (guided, not blank)
- Production tracker must be near-real-time
- File management must be clean and versioned
- Revision flow must be frictionless

**Key Screens:** Brief Submission, Production Workspace, Review, Completed, Order History

---

## Persona 3: The Finance/Legal Approver
**Name:** Dewi Kusuma
**Title:** Finance Director / Legal Counsel
**Company:** Corporate, multi-department
**Age:** 38–50

**Goals:**
- Review and approve the commercial quotation before payment
- Download a formal invoice for accounting
- Confirm payment compliance (tax invoice, VAT)
- Audit project spend across teams

**Frustrations:**
- No downloadable formal documents
- Unclear payment terms
- Mixed personal/corporate billing
- No multi-user/team support

**UX Implications:**
- Quotation must be formatted like a formal business proposal
- Invoice must be tax-compliant, downloadable PDF
- Billing section must support PO number input
- Team member management is important for enterprise

**Key Screens:** Quotation, Payment, Billing & Invoices, Settings (Team)

---

## Persona 4: The Logistics/Operations Buyer
**Name:** Ahmad Fauzi
**Title:** Logistics Manager / PPJK Owner
**Company:** Freight forwarder, customs broker, logistics company
**Age:** 35–50

**Goals:**
- Get customs and logistics documentation AI-generated fast
- Verify AI output against actual shipment data
- Ensure compliance and accuracy (not just speed)
- Handle multiple shipment projects simultaneously

**Frustrations:**
- Generic AI tools that don't understand customs terminology
- No audit trail for AI-generated documents
- Can't handle bulk orders

**UX Implications:**
- Service detail page for Logistics/Customs AI must showcase compliance
- Production workspace must show AI confidence scores
- Multi-project dashboard is important
- Audit log access is a trust signal, not a utility feature

**Key Screens:** Marketplace (Logistics/Customs filter), Brief (industry-specific fields), Production, Completed

---

# PART 3 — USER JOURNEY MAPS

## Journey 1: First-Time Enterprise Purchase (Executive)

```
AWARENESS → CONSIDERATION → DECISION → ONBOARDING → ACTIVE USE

Stage 1: AWARENESS
Touchpoint: Google search / LinkedIn ad / referral
Emotion: Curious, skeptical
Action: Lands on homepage
Pain: "Is this credible for my scale?"
UX Opportunity: Hero social proof, client logos, enterprise badge

Stage 2: CONSIDERATION
Touchpoint: Service directory + detail pages
Emotion: Intrigued, evaluating
Action: Browses 2–3 service categories, checks pricing
Pain: "What exactly do I get? Is it worth the price?"
UX Opportunity: Sample output gallery, clear package comparison, FAQ

Stage 3: DECISION
Touchpoint: Brief submission → quotation approval
Emotion: Cautious, needs control
Action: Submits brief, receives quotation, approves
Pain: "I need to be sure before I pay"
UX Opportunity: AI Analysis explains the plan, quotation is formal doc

Stage 4: ONBOARDING
Touchpoint: Payment → production workspace
Emotion: Committed, watching
Action: Pays, receives confirmation, accesses workspace
Pain: "Is anything actually happening?"
UX Opportunity: Instant production start notification, AI team intro card

Stage 5: ACTIVE USE
Touchpoint: Dashboard + delivery
Emotion: Satisfied, becoming loyal
Action: Reviews deliverables, rates, orders again
Pain: "I want this to be repeatable"
UX Opportunity: Repeat order button, saved brief templates, account manager contact
```

---

## Journey 2: Repeat Operator Submitting Next Campaign

```
Login → Dashboard (sees "New Brief" CTA) → 
Selects previous service (pre-filled) → 
Adjusts brief (auto-suggested based on history) → 
Submits in < 3 minutes → 
Gets confirmation → 
Checks workspace on Day 3 → 
Reviews and approves → Done
```

**Key UX Requirement:** The system remembers company name, industry, brand guidelines, preferred output formats. The second brief takes 40% less time than the first.

---

## Journey 3: Finance Approval Flow

```
Operator submits brief
    ↓
AI Analysis complete
    ↓
Quotation generated → Email to Finance Director
    ↓
Finance Director clicks email link → Quotation page (no login required for view-only)
    ↓
Reviews line items → Sees formal document format
    ↓
Approves → Receives VAT invoice link
    ↓
Downloads PDF → Submits to accounting
    ↓
Payment made → Project starts
```

**Key UX Requirement:** Finance Director does not need to create an account to view and approve a quotation. Magic link via email.

---

# PART 4 — INFORMATION ARCHITECTURE

## Global Navigation Structure

```
PUBLIC
├── / (Landing)
├── /layanan (Marketplace)
│   └── /layanan/[slug] (Service Detail)
├── /harga (Pricing)
├── /tentang (About)
├── /blog (Resources — Phase 3)
├── /login
└── /daftar

AUTHENTICATED — CLIENT
├── /dashboard (Home)
├── /proyek (Order List)
│   └── /proyek/[id] (Workspace)
│       ├── /proyek/[id]/brief
│       ├── /proyek/[id]/analisis
│       ├── /proyek/[id]/penawaran
│       ├── /proyek/[id]/produksi
│       ├── /proyek/[id]/review
│       └── /proyek/[id]/selesai
├── /baru (Start New Brief — shortcut)
│   ├── /baru/pilih-layanan
│   ├── /baru/brief
│   ├── /baru/konfirmasi
│   └── /baru/terkirim
├── /profil (Profile)
├── /billing (Billing & Invoices)
└── /pengaturan (Settings)
    ├── /pengaturan/tim
    ├── /pengaturan/keamanan
    ├── /pengaturan/notifikasi
    └── /pengaturan/api

PUBLIC — MAGIC LINK
└── /penawaran/[token] (Quotation View — no auth required)
└── /workspace/[token] (Client Workspace — token-gated)
```

## Content Hierarchy per Page (F-Pattern & Z-Pattern Usage)

- **Landing:** Z-pattern (hero → trust → features → CTA)
- **Marketplace:** F-pattern (filter sidebar + grid scan)
- **Service Detail:** Z-pattern then linear scroll
- **Brief Form:** Linear top-to-bottom (wizard)
- **Dashboard:** F-pattern (top stats → recent activity → quick actions)
- **Production Workspace:** Z-pattern (status top → files → chat)

---

# PART 5 — SCREEN WIREFRAME SPECIFICATIONS

## [01] Landing Page

### Viewport: Desktop 1280px

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOPNAV (64px)                                                                │
│ [◇ Creative Studio]        Layanan ▾    Harga    Blog    [Masuk] [Mulai →]  │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ HERO (100vh)                          Violet radial glow from top-center     │
│                                                                              │
│  ┌─ Announcement pill ──────────────────────────────┐                       │
│  │ ✦ Baru: Customs & PPJK AI kini tersedia →        │                       │
│  └──────────────────────────────────────────────────┘                       │
│                                                                              │
│  Transformasi Bisnis Anda              ← display-xl, Plus Jakarta Sans       │
│  dengan AI Enterprise                                                        │
│  yang Bekerja untuk Anda.                                                    │
│                              ← "AI Enterprise" has violet gradient text-fill │
│                                                                              │
│  From creative campaigns to customs documents —                              │
│  your AI workforce handles it all, professionally.    ← body-lg, secondary  │
│                                                                              │
│  [ Mulai Sekarang →  ]   [ ▷  Lihat Demo ]                                 │
│    ↑ Primary CTA           ↑ Ghost with play icon                            │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│  500+ enterprise clients  ·  15 layanan AI  ·  99.2% kepuasan klien         │
│  ← trust bar, label-sm, text tertiary, dot-separated                        │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────┐               │
│  │                [Dashboard Preview Mockup]                 │               │
│  │          Glass card, tilted -2deg, shadow-xl              │               │
│  │          Shows: active projects, AI status, metrics       │               │
│  └──────────────────────────────────────────────────────────┘               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ PARTNER LOGOS (80px height)                                                  │
│ "Dipercaya oleh perusahaan terkemuka di Indonesia"                           │
│ [Logo1]  [Logo2]  [Logo3]  [Logo4]  [Logo5]  [Logo6]                        │
│ — grayscale, hover reveals color                                             │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ SERVICES GRID (padding-y: 96px)                                              │
│                                                                              │
│  Semua layanan AI yang Anda butuhkan,                                        │
│  dalam satu platform.                 ← display-md, centered                 │
│                                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │🎨Creative│ │📢Marketing│ │💰Finance │ │⚖️Legal   │ │🚛Logistic│          │
│  │   AI     │ │   AI     │ │   AI     │ │   AI     │ │   AI     │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │📊Data    │ │👔HR & Pay │ │🛒Procure │ │📋Tax AI  │ │🤝Sales AI│          │
│  │Analytics │ │   AI     │ │   AI     │ │          │ │          │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                              │
│                    [ Lihat Semua 15 Layanan → ]                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ HOW IT WORKS (padding-y: 96px)                                               │
│                                                                              │
│  Bagaimana Creative Studio Bekerja                                           │
│                                                                              │
│  [1]─────────────────────[2]──────────────────[3]──────────────[4]          │
│  Submit Brief         AI Analysis         Production          Delivered      │
│  5 menit              Otomatis            Termonitor          On time        │
│                                                                              │
│  Each step: icon (40px) + heading-sm + body-sm description                  │
│  Connector: dashed line with animated dot traveling from 1→4                 │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ SOCIAL PROOF — CASE STUDIES (padding-y: 96px)                                │
│                                                                              │
│  Hasil Nyata dari Klien Kami                                                 │
│                                                                              │
│  ┌─────────────────────────┐   ┌─────────────────────────┐                  │
│  │ "Creative AI menghemat  │   │ "Customs docs yang       │                  │
│  │  320 jam kerja per bulan│   │  dulu 3 hari, kini       │                  │
│  │  untuk tim marketing    │   │  selesai dalam 4 jam"    │                  │
│  │  kami."                 │   │                          │                  │
│  │                         │   │  [Avatar] Budi H.        │                  │
│  │  [Avatar] Sari W.       │   │  Logistics Director      │                  │
│  │  Head of Marketing      │   │  PT Maju Logistics       │                  │
│  │  PT Retail Indonesia    │   │                          │                  │
│  └─────────────────────────┘   └─────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ PRICING PREVIEW (padding-y: 96px)                                            │
│                                                                              │
│  Harga Transparan, Tanpa Biaya Tersembunyi                                   │
│                                                                              │
│  [Monthly | Annual ← toggle]                                                 │
│                                                                              │
│  ┌──────────┐   ┌─────────────────────┐   ┌──────────┐                      │
│  │ Starter  │   │   Professional      │   │Enterprise│                      │
│  │          │   │   ← MOST POPULAR    │   │          │                      │
│  │Rp 2.5jt  │   │   Rp 8.5jt/bln     │   │ Custom   │                      │
│  │ /bulan   │   │                     │   │          │                      │
│  │[Coba Gratis]  │[Mulai Sekarang]    │   │[Hubungi] │                      │
│  └──────────┘   └─────────────────────┘   └──────────┘                      │
│                                                                              │
│  [Lihat perbandingan lengkap →]                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ CTA BLOCK                                                                    │
│                                                                              │
│  Siap memulai transformasi AI bisnis Anda?                                   │
│  Konsultasi gratis, tanpa komitmen awal.                                     │
│                                                                              │
│  [Mulai Sekarang →]    [Hubungi Tim Sales]                                   │
│  No credit card required · Respon dalam 2 jam                                │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ FOOTER (240px)                                                               │
│ Logo + tagline | Layanan | Perusahaan | Legal | Kontak                       │
│ © 2024 Creative Studio · Privacy · Terms · ISO 27001 badge                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## [02] Marketplace — Service Directory

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOPNAV (sticky)                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ PAGE HEADER (120px)                                                          │
│ Jelajahi 15 Layanan AI Profesional ← display-md                              │
│ Temukan AI yang tepat untuk setiap kebutuhan bisnis Anda ← body-lg          │
│                                                                              │
│ [🔍 Cari layanan...]  [Filter ▾]  [Urutkan: Terpopuler ▾]                  │
└──────────────────────────────────────────────────────────────────────────────┘

┌────────────────┬─────────────────────────────────────────────────────────────┐
│ FILTER SIDEBAR │ RESULTS AREA                                                │
│ (240px)        │                                                             │
│                │ [Featured: Creative AI] ← Horizontal scroll promo card     │
│ Kategori       │                                                             │
│ ☐ Creative     │ ┌──────────┐ ┌──────────┐ ┌──────────┐                    │
│ ☐ Finance      │ │ Service  │ │ Service  │ │ Service  │                    │
│ ☐ Legal        │ │  Card    │ │  Card    │ │  Card    │                    │
│ ☐ Logistics    │ └──────────┘ └──────────┘ └──────────┘                    │
│ ☐ HR & Payroll │ ┌──────────┐ ┌──────────┐ ┌──────────┐                    │
│ ...            │ │ Service  │ │ Service  │ │ Service  │                    │
│                │ │  Card    │ │  Card    │ │  Card    │                    │
│ Harga          │ └──────────┘ └──────────┘ └──────────┘                    │
│ [─●────] range │                                                             │
│                │ Showing 15 services · Sorted by: Most Popular              │
│ Waktu Delivery │                                                             │
│ ○ 1–3 hari     │                                                             │
│ ○ 3–7 hari     │                                                             │
│ ○ 7+ hari      │                                                             │
│                │                                                             │
│ Rating         │                                                             │
│ ★★★★★ only    │                                                             │
│ ★★★★☆ & up   │                                                             │
│                │                                                             │
│ [Reset Filter] │                                                             │
└────────────────┴─────────────────────────────────────────────────────────────┘
```

### Service Card Anatomy (220px × 300px)
```
┌────────────────────────────┐
│ [TERLARIS]                 │  ← amber badge, top-left, conditional
│                            │
│  ┌──────────────────────┐  │
│  │  [Service Icon 64px] │  │  ← colored background, radius-xl
│  └──────────────────────┘  │
│                            │
│  Creative AI               │  ← heading-sm, text primary
│  Brand Strategy & Content  │  ← body-xs, text secondary
│                            │
│  ★★★★★  4.9 (127 ulasan)  │  ← label-sm, amber stars
│                            │
│  Mulai dari                │  ← label-sm, text tertiary
│  Rp 5.000.000              │  ← heading-md, text primary
│                            │
│  [  Lihat Detail  →  ]     │  ← secondary button, full width
└────────────────────────────┘
```

---

## [03] Service Detail Page

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BREADCRUMB: Marketplace › Creative AI                                        │
└──────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┬─────────────────────────────┐
│ LEFT: SERVICE CONTENT (max 760px)              │ RIGHT: ORDER PANEL (360px)  │
│                                                │ [Sticky on scroll]          │
│ ┌──────────────────────────────────────────┐  │                             │
│ │ [Icon 72px]  Creative AI                 │  │ Paket                       │
│ │              ★★★★★ 4.9 · 127 reviews    │  │ ○ Starter  ● Pro  ○ Enterprise│
│ └──────────────────────────────────────────┘  │                             │
│                                                │ Waktu Pengerjaan            │
│ ─── Sample Output Gallery ───                  │ [3 hr] [5 hr] [7 hr]       │
│ [img] [img] [img] → horizontal scroll          │                             │
│                                                │ ─────────────────────────── │
│ ─── Tentang Layanan ini ───                    │ Total Estimasi              │
│ body-md description, 3 paragraphs             │ Rp 12.500.000               │
│                                                │ (sudah termasuk PPN 11%)   │
│ ─── Yang Anda Dapatkan ───                    │                             │
│ ✓ Brand identity full kit                     │ [  Pesan Sekarang  →  ]     │
│ ✓ 5 social media templates                   │                             │
│ ✓ 1 revision round                           │ ─────────────────────────── │
│ ✓ Source files (AI, PSD)                     │ 🔒 Pembayaran aman          │
│ ✓ Commercial usage rights                    │ ✓ Garansi revisi            │
│                                                │ ✓ SLA 24 jam respons       │
│ ─── Kemampuan AI ───                          │                             │
│ [tag] GPT-4o  [tag] DALL·E 3  [tag] Claude 3 │ Butuh custom?              │
│                                                │ [Hubungi Sales]            │
│ ─── AI Team untuk Proyek Ini ───              │                             │
│ ┌────┐ Content Strategist AI                 │                             │
│ │ AI │ Brand Visual AI                       │                             │
│ │ 🤖 │ Copy Editor AI                        │                             │
│ └────┘                                        │                             │
│                                                │                             │
│ ─── FAQ ───                                   │                             │
│ [Accordion items × 5]                         │                             │
│                                                │                             │
│ ─── Layanan Serupa ───                        │                             │
│ [Card] [Card] [Card] → horizontal scroll      │                             │
└────────────────────────────────────────────────┴─────────────────────────────┘
```

---

## [10] Brief Submission — Wizard Flow

### Step Indicator (persistent top bar)
```
[◉ Pilih Layanan]──[○ Informasi Proyek]──[○ Deliverables]──[○ Review]──[○ Kirim]
   Step 1                Step 2               Step 3          Step 4     Step 5
```

### Step 1: Pilih Layanan
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Layanan apa yang Anda butuhkan?                                              │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  🎨 Creative AI  │  │  📢 Marketing AI │  │  💰 Finance AI  │             │
│  │  ← selected     │  │                 │  │                 │             │
│  │  ✓ border violet│  │                 │  │                 │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│  ... (all 15 service tiles)                                                 │
│                                                                              │
│  Pilih Paket:                                                                │
│  ○ Starter (Rp 5jt)   ● Professional (Rp 12.5jt)   ○ Enterprise (Custom)  │
│                                                                              │
│                                          [Lanjutkan →]                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Step 2: Informasi Proyek
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Ceritakan proyek Anda                                                        │
│                                                                              │
│ Nama Proyek                                                                 │
│ [Campaign Q1 2025 — Brand Refresh              ]                             │
│                                                                              │
│ Nama Perusahaan / Brand                                                     │
│ [PT Maju Bersama Indonesia                     ] ← pre-filled from profile   │
│                                                                              │
│ Industri                                                                    │
│ [FMCG — Makanan & Minuman              ▾]                                    │
│                                                                              │
│ Deskripsi Proyek                                                             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Jelaskan tujuan, konteks, dan harapan Anda...                           │ │
│ │                                                                         │ │
│ │                                                                         │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ 0 / 2000 karakter                                                            │
│                                                                              │
│ ✦ AI Tip: Semakin detail brief Anda, semakin akurat output AI kami.         │
│   ← Inline AI hint card, violet left border                                 │
│                                                                              │
│ Target Audiens                                                               │
│ [Profesional 25–40 tahun, B2B, urban                                    ]   │
│                                                                              │
│ Referensi (opsional)                                                        │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │   📎 Drag & drop file atau klik untuk upload                            │ │
│ │      PDF, PPT, Image, ZIP · Max 50MB per file                          │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ [← Kembali]                              [Lanjutkan →]                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Step 3: Deliverables
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Tentukan output yang Anda inginkan                                           │
│                                                                              │
│ Format Output                                                               │
│ ☑ PDF Report          ☑ Presentasi PPT       ☐ Video (MP4)                 │
│ ☑ File Desain (AI)    ☑ Social Media Pack    ☐ Raw Data Excel               │
│                                                                              │
│ Tone & Style                                                                 │
│ ○ Professional & Formal   ● Modern & Dynamic   ○ Minimalist                 │
│ ○ Playful & Creative      ○ Traditional                                     │
│                                                                              │
│ Bahasa Output                                                               │
│ ○ Bahasa Indonesia   ○ English   ● Bilingual (ID + EN)                      │
│                                                                              │
│ Deadline Preferensi                                                         │
│ ○ ASAP (+ premium 20%)   ● Standar (5 hari kerja)   ○ Fleksibel            │
│                                                                              │
│ Catatan Tambahan                                                            │
│ [Placeholder: Ada hal spesifik yang perlu kami ketahui?]                    │
│                                                                              │
│ [← Kembali]                              [Lanjutkan →]                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Step 4: Review Brief
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Review & konfirmasi brief Anda                                               │
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐│
│ │ 🎨 Creative AI — Professional Package           Rp 12.500.000 est.     ││
│ │                                                                          ││
│ │ Proyek: Campaign Q1 2025 — Brand Refresh                                ││
│ │ Industri: FMCG — Makanan & Minuman                                      ││
│ │ Deadline: Standar (5 hari kerja)                                        ││
│ │ Output: PDF + PPT + Desain AI + Social Pack · Bilingual                 ││
│ │                                                                          ││
│ │ [Edit]                                                                   ││
│ └──────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│ ✦ AI akan menganalisis brief Anda dan mengirim proposal rinci dalam          │
│   < 2 jam kerja. Anda akan dihubungi melalui email & WhatsApp.              │
│                                                                              │
│ ☑ Saya setuju dengan Syarat & Ketentuan dan Kebijakan Privasi               │
│                                                                              │
│ [← Kembali]                       [Kirim Brief →]  ← Primary button        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Step 5: Brief Terkirim (Success)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                    [✓ Animated check — 80px violet]                          │
│                    [Particle burst — violet + gold]                          │
│                                                                              │
│                    Brief Berhasil Dikirim!                                   │
│                                                                              │
│                    No. Referensi: CS-2024-0142                               │
│                                                                              │
│        Tim AI kami akan menganalisis brief Anda dan menghubungi             │
│        dalam 2 jam kerja melalui email dan WhatsApp.                        │
│                                                                              │
│              [🔔 Aktifkan Notifikasi]   [Ke Dashboard →]                    │
│                                                                              │
│        ─────────────────────────────────────────────────────                │
│        Sambil menunggu, pelajari:                                           │
│        [→ Cara kerja AI kami]   [→ FAQ Klien]   [→ Sample hasil]           │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## [11] AI Analysis Phase

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ PROJECT: Campaign Q1 2025   [FASE: AI Analysis]   Status: Sedang Diproses   │
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐│
│ │ ● ● ●  AI sedang menganalisis brief Anda...              ██░░░░ 33%    ││
│ │                                                                          ││
│ │ "Memproses target audiens dan industri..."               ← rotating msg ││
│ └──────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│ [Setelah selesai — Analysis Result Card]                                    │
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐│
│ │ ✦ Hasil Analisis AI                                                      ││
│ │                                                                          ││
│ │ Skor Kelayakan: ████████░░ 85%  Sangat Layak               ││
│ │                                                                          ││
│ │ Tim AI yang Direkomendasikan:                                            ││
│ │ 🤖 Content Strategist AI (GPT-4o)                                       ││
│ │ 🎨 Brand Visual AI (DALL·E 3)                                           ││
│ │ ✍️  Copy Editor AI (Claude 3.5)                                         ││
│ │                                                                          ││
│ │ Estimasi Waktu: 4–5 hari kerja                                          ││
│ │ Estimasi Biaya: Rp 12.500.000 – Rp 14.000.000                          ││
│ │                                                                          ││
│ │ Klarifikasi dari AI (opsional, maks 48 jam untuk menjawab):            ││
│ │ ┌────────────────────────────────────────────────────────────────────┐ ││
│ │ │ 1. Apakah Anda memiliki brand guideline yang sudah ada?            │ ││
│ │ │    ○ Ya, saya upload  ○ Tidak, buat baru                           │ ││
│ │ └────────────────────────────────────────────────────────────────────┘ ││
│ │                                                                          ││
│ │ [Lewati Klarifikasi]          [Setujui & Lanjutkan →]                   ││
│ └──────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## [12] Commercial / Quotation Phase

### Quotation View (Public token-gated, no login required)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [◇ Creative Studio]                                            [Print / PDF] │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                         SURAT PENAWARAN                                      │
│                         No. SPH/CS/2024/0142                                 │
│                         Tanggal: 15 Desember 2024                            │
│                         Berlaku hingga: 22 Desember 2024                    │
│                         Sisa waktu: 6 hari 14 jam  ← countdown             │
│                                                                              │
│ Kepada Yth:                            Dari:                                │
│ PT Maju Bersama Indonesia              Creative Studio                       │
│ Jl. Sudirman No. 123                   Jl. SCBD Lot 8                       │
│ Jakarta Selatan 12190                  Jakarta Selatan 12190                 │
│                                                                              │
│ ─────────────────────────────────────────────────────────────────────────── │
│ RINCIAN LAYANAN                                                              │
│                                                                              │
│ No.  Deskripsi                              Qty   Harga Satuan   Total      │
│ 1.   Creative AI — Professional Package     1     Rp 10.500.000  Rp 10.5jt │
│ 2.   Brand Identity Full Kit                1     Rp  1.500.000  Rp  1.5jt │
│ 3.   Social Media Template Pack (5)         1     Rp    500.000  Rp  0.5jt │
│                                                                              │
│                                             Subtotal:      Rp 12.500.000   │
│                                             PPN 11%:       Rp  1.375.000   │
│                                             TOTAL:         Rp 13.875.000   │
│                                                                              │
│ ─────────────────────────────────────────────────────────────────────────── │
│ SYARAT PEMBAYARAN                                                            │
│ • Down payment 50% sebelum produksi dimulai                                 │
│ • Pelunasan 50% setelah deliverables disetujui                              │
│ • Faktur Pajak diterbitkan setelah pembayaran                               │
│                                                                              │
│            [Minta Revisi Penawaran]    [✓ Setujui Penawaran]                │
│                                        ↑ Primary gold button                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Payment Screen
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Pembayaran Uang Muka                                                         │
│ Invoice #INV/CS/2024/0142-1                                                 │
│                                                                              │
│ Jumlah yang dibayarkan:                                                     │
│ Rp 6.937.500  (50% down payment)  ← display-md                              │
│                                                                              │
│ ─── Pilih Metode Pembayaran ────                                             │
│ ● Transfer Bank                                                              │
│   BCA · Mandiri · BNI · BRI · CIMB                                          │
│   [Tampilkan Nomor VA →]                                                    │
│                                                                              │
│ ○ QRIS                                                                      │
│ ○ Kartu Kredit (tambahan 3%)                                                │
│                                                                              │
│ Nomor PO (opsional)                                                         │
│ [PO-2024-DEC-001                        ]                                   │
│                                                                              │
│ Upload Bukti Transfer (jika bank transfer)                                  │
│ [📎 Drag & drop bukti transfer]                                             │
│                                                                              │
│             [← Kembali]          [Konfirmasi Pembayaran]                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## [13] Production Workspace

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Campaign Q1 2025 — Brand Refresh                   [FASE: Produksi]         │
│ CS-2024-0142 · Creative AI Professional · Deadline: 20 Des 2024             │
│                                                                              │
│ PROGRESS: ████████████████░░░░░░░░░░░ 62%                                  │
│           Estimasi selesai: 19 Des 2024, 17:00                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────┬──────────────────────────┬──────────────────────────┐
│ MILESTONE TRACKER     │ AI TEAM STATUS           │ ACTIVITY LOG             │
│ (33%)                 │ (33%)                    │ (33%)                    │
│                       │                          │                          │
│ ✓ Brief diterima      │ 🤖 Content Strategist    │ 10:24  Brief dianalisis  │
│   15 Des · 09:00      │    ● Aktif · Menulis     │ 10:45  Outline disetujui │
│                       │    copy Campaign          │ 11:30  Desain mulai     │
│ ✓ AI Analysis         │                          │ 14:00  Visual draft 1   │
│   15 Des · 11:00      │ 🎨 Brand Visual AI       │        tersedia          │
│                       │    ● Aktif · Render       │ 14:00  [Lihat draft →] │
│ ✓ Pembayaran OK       │    visual draft 2/5       │                          │
│   15 Des · 13:00      │                          │ 15 Des                   │
│                       │ ✍️  Copy Editor AI        │ 09:00  Proyek dimulai   │
│ ⟳ Produksi           │    ◎ Menunggu output      │                          │
│   15 Des · 14:00 →   │    dari Content AI        │                          │
│   Target: 20 Des      │                          │                          │
│                       │ ─────────────────────    │                          │
│ ○ Review & Delivery   │ [Kirim pesan ke PM]      │                          │
│                       │                          │                          │
└───────────────────────┴──────────────────────────┴──────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ PARTIAL DELIVERABLES (tersedia untuk preview)                                │
│                                                                              │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                        │
│ │  📄 Draft     │  │  🎨 Visual   │  │  🔒 File 3   │                        │
│ │  Copywriting  │  │  Draft #1   │  │  (Belum      │                        │
│ │  [Preview]   │  │  [Preview]  │  │   siap)      │                        │
│ └──────────────┘  └──────────────┘  └──────────────┘                        │
│                                                                              │
│ [Minta Revisi Sekarang]  ← secondary button, opens revision form            │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## [14] Review Phase

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ REVIEW: Campaign Q1 2025 — Brand Refresh                                    │
│ Semua deliverables siap untuk direview. Setujui untuk mulai download.       │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┬────────────────────────┐
│ FILE VIEWER (main)                                  │ REVIEW PANEL           │
│                                                     │                        │
│ [Prev ←] File 1 / 5: Brand Guidelines PDF [→ Next] │ Status: Menunggu       │
│                                                     │ Persetujuan            │
│ ┌─────────────────────────────────────────────────┐ │                        │
│ │                                                 │ │ File 1: Brand Guide   │
│ │   [PDF Viewer / Image Preview]                  │ │ ✓ Setuju              │
│ │                                                 │ │                        │
│ │                                                 │ │ File 2: Visual Kit   │
│ └─────────────────────────────────────────────────┘ │ ○ Review...           │
│                                                     │                        │
│ Tambahkan Catatan / Anotasi:                        │ File 3: Copy Pack    │
│ [Klik area yang ingin Anda komentari]              │ ○ Review...           │
│                                                     │                        │
│ Komentar saat ini (2):                             │ File 4: Social Pack  │
│ 💬 "Warna primary terlalu gelap"   [Balas]          │ ○ Review...           │
│ 💬 "Font heading sudah sesuai"     [Resolved ✓]     │                        │
│                                                     │ File 5: Source Files │
│                                                     │ ○ Review...           │
│                                                     │                        │
│                                                     │ ────────────────────   │
│                                                     │ [Minta Revisi]         │
│                                                     │ [✓ Setujui Semua]     │
└─────────────────────────────────────────────────────┴────────────────────────┘
```

---

## [15] Completed & Delivery

```
┌──────────────────────────────────────────────────────────────────────────────┐
│              [✓ Animated check + confetti]                                   │
│                                                                              │
│              Proyek Selesai! 🎉                                              │
│              Campaign Q1 2025 — Brand Refresh                                │
│              Diselesaikan: 19 Desember 2024, 16:45                          │
│              2 hari lebih cepat dari deadline                               │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ DOWNLOAD FILES                                                               │
│                                                                              │
│ ┌────────────────────────────────────────────────────────────────────────┐  │
│ │ 📁 Brand_Guidelines_CS2024.pdf             12.4 MB   [⬇ Download]     │  │
│ │ 🎨 Visual_Identity_Kit.zip                  84.2 MB   [⬇ Download]     │  │
│ │ ✍️  Copy_Pack_Q1_Campaign.docx                1.2 MB   [⬇ Download]     │  │
│ │ 📱 Social_Media_Templates.zip               22.8 MB   [⬇ Download]     │  │
│ │ 💾 Source_Files_AI_PSD.zip                 156.1 MB   [⬇ Download]     │  │
│ └────────────────────────────────────────────────────────────────────────┘  │
│                                              [⬇ Download Semua (277 MB)]    │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ DOKUMEN                                                                      │
│ [📄 Invoice #INV/CS/2024/0142]    [📋 Project Report PDF]   [⬇ Download]   │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ BERIKAN PENILAIAN                                                            │
│ Bagaimana pengalaman Anda dengan Creative Studio?                            │
│ [★ ★ ★ ★ ★]  ← tap to rate                                                │
│ [Tulis ulasan Anda...]                                                       │
│ [Kirim Ulasan]                                                               │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ LANGKAH BERIKUTNYA                                                           │
│ ┌────────────────────────┐   ┌────────────────────────┐                     │
│ │ 🔁 Pesan Ulang Layanan │   │ 🚀 Coba Marketing AI   │                     │
│ │    yang Sama           │   │    (Cocok untuk kampanye│                     │
│ │    [Pesan Lagi →]      │   │    digital Anda)        │                     │
│ │                        │   │    [Lihat Layanan →]    │                     │
│ └────────────────────────┘   └────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## [20] Dashboard Home

```
┌────────────────┬─────────────────────────────────────────────────────────────┐
│ SIDEBAR        │ DASHBOARD CONTENT                                           │
│ (240px)        │                                                             │
│                │ Selamat datang kembali, Sari 👋          Sabtu, 15 Des 24  │
│ ◇ Creative     │ Berikut ringkasan proyek Anda.                             │
│   Studio       │                                                             │
│                │ ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│ ─ MENU ─────── │ │ Aktif   │  │Menunggu │  │Selesai  │  │Dihemat  │        │
│                │ │ Proyek  │  │Tindakan │  │(30 hari)│  │(est.)   │        │
│ 🏠 Dashboard   │ │   3     │  │   2     │  │   7     │  │320 jam  │        │
│ 📋 Proyek Saya │ └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
│ ➕ Proyek Baru │                                                             │
│ 💳 Billing    │ TINDAKAN YANG DIBUTUHKAN                                    │
│ 👤 Profil     │ ┌────────────────────────────────────────────────────────┐  │
│ ⚙️ Pengaturan │ │ ⚠️ Setujui penawaran untuk "Marketing AI Q1"           │  │
│                │ │    Penawaran berlaku sampai 22 Des · [Lihat →]         │  │
│ ─────────────  │ ├────────────────────────────────────────────────────────┤  │
│ ✦ AI Insight  │ │ 📋 Review deliverables "Brand Refresh"                  │  │
│ Aktif          │ │    4 file menunggu persetujuan Anda · [Review →]       │  │
│                │ └────────────────────────────────────────────────────────┘  │
│ ─────────────  │                                                             │
│ [Upgrade Plan] │ PROYEK AKTIF                                               │
│                │ ┌─────────────────────────────────────────────────────────┐ │
│ [Avatar]       │ │ 🎨 Brand Refresh     Produksi  ████████░░  62%  →      │ │
│ Sari W.        │ │ 📢 Marketing Q1      Review    ██████████  95%  →      │ │
│ Marketing Mgr  │ │ 💰 Finance Report    Analysis  ████░░░░░░  40%  →      │ │
└────────────────┘ └─────────────────────────────────────────────────────────┘ │
                  │                                                             │
                  │ ✦ AI INSIGHT                              [Sembunyikan]    │
                  │ ┌─────────────────────────────────────────────────────────┐│
                  │ │ Berdasarkan pola proyek Anda, Creative AI biasanya     ││
                  │ │ menghasilkan ROI terbaik saat dipadukan dengan         ││
                  │ │ Marketing AI. Coba kombinasi untuk campaign Q2 Anda.  ││
                  │ │ [Pelajari lebih lanjut →]                              ││
                  │ └─────────────────────────────────────────────────────────┘│
                   └─────────────────────────────────────────────────────────────┘
```

---

# PART 6 — INTERACTION DESIGN PATTERNS

## Pattern 1: Progressive Disclosure
Apply to all complex data. Start with the summary, expand for detail.
- Collapsed: key metric + status badge
- Expanded (on click): full breakdown, history, actions
- Indicator: chevron-down icon, rotates 180° on expand

## Pattern 2: Optimistic UI
For actions with high success rate (approve, mark complete), update the UI immediately and roll back if the server returns an error.
- Show new state instantly on click
- If error: red toast + revert with 300ms animation
- Never block the UI waiting for a non-critical API call

## Pattern 3: Inline Validation
- Validate on blur (not on keystroke) for text inputs
- Validate on change for selects, radios, checkboxes
- Show success state (green border + check) only after first error has been fixed
- Never show errors on a pristine (untouched) field

## Pattern 4: Skeleton → Content Transition
1. Page loads → skeletons appear immediately (0ms delay)
2. Data arrives → skeleton fades out (150ms), content fades in (200ms)
3. Stagger if multiple cards: 50ms delay between each
4. Never show a blank white screen, even for 1 frame

## Pattern 5: Contextual Empty State
Never show a generic "No data found." Match the empty state to the specific context:
- No active projects: "Belum ada proyek aktif. Mulai dengan memilih layanan AI."
- No search results: "Tidak ada layanan yang cocok dengan 'X'. Coba kata kunci lain."
- No invoices: "Belum ada invoice. Invoice akan muncul setelah pembayaran pertama."

## Pattern 6: Destructive Action Guard
Any action that is irreversible (cancel order, delete account) requires:
1. Button label is explicit: "Batalkan Proyek" not "Batalkan"
2. Click shows bottom sheet/modal: summarizes what will be lost
3. Confirmation requires typing the project name or clicking a red CTA
4. Success shows what happened and what the user can do next

## Pattern 7: Command + K (Power User Shortcut)
Global command palette for authenticated users:
- `⌘K` opens floating search modal
- Search: pages, projects, services, invoices by number
- Recent items shown before user types
- Keyboard navigation (↑↓ to select, Enter to go)

## Pattern 8: Toast Notifications
- Position: top-right, 24px margin
- Stack: max 3 visible, oldest dismissed first
- Duration: 4s success, 6s warning, 8s error (persistent until dismissed)
- Types: success (green), warning (amber), error (red), info (blue)
- Always include an action link when relevant ("Lihat Detail →")

---

# PART 7 — MICROCOPY & CONTENT STRATEGY

## Voice & Tone Guidelines

**We are:**
- Professional but warm (not cold corporate)
- Confident but not arrogant
- Clear and direct (never ambiguous)
- Indonesian-first, but English for technical terms

**We are NOT:**
- Overly casual or using slang
- Using complex jargon without explanation
- Aggressive in upselling
- Vague about time, money, or responsibility

## Microcopy Rules

### CTAs
| Context | Wrong | Right |
|---|---|---|
| Primary action | Submit | Kirim Brief Saya |
| Completion | Done | Setujui & Lanjutkan |
| Destructive | Cancel | Batalkan Proyek Ini |
| Loading | Loading... | Memproses brief Anda... |
| Empty action | Add | Tambah Layanan Pertama Anda |

### Error Messages
| Context | Wrong | Right |
|---|---|---|
| Required field | This field is required | Kolom ini wajib diisi |
| File too large | File size exceeded | File terlalu besar. Maksimum 50MB. |
| Session expired | Session expired | Sesi Anda berakhir. Silakan login kembali. |
| Network error | Network error | Koneksi bermasalah. Periksa internet Anda. |
| Server error | Internal server error | Terjadi kesalahan. Tim kami sudah diberitahu. Coba lagi dalam beberapa menit. |

### Placeholder Text
Placeholders should be examples, not instructions:
- ❌ "Enter your company name"
- ✓ "cth. PT Maju Bersama Indonesia"

### Success Messages
Be specific. Mention the outcome AND what happens next:
- ❌ "Success!"
- ✓ "Brief terkirim! Anda akan dihubungi dalam 2 jam kerja melalui email dan WhatsApp."

### Number Formatting
- Currency: `Rp 12.500.000` (no decimal for round IDR)
- Date: `15 Desember 2024` (long form) or `15 Des 2024` (short form in tables)
- Time: `14:30 WIB` always include timezone
- Percentage: `62%` no space
- File size: `12.4 MB` with space

---

# PART 8 — COMPONENT STATE MATRIX

Every interactive component must have all states designed and documented.

## Input Field States
| State | Border | Background | Label | Shadow |
|---|---|---|---|---|
| Default | Border Subtle | Surface 1 | Text Secondary | none |
| Hover | Border Default | Surface 2 | Text Secondary | none |
| Focus | Violet | Surface 1 | Violet | 0 0 0 3px violet/15 |
| Filled | Border Default | Surface 1 | Violet (float up) | none |
| Error | Error red | Surface 1 | Error red | 0 0 0 3px red/12 |
| Success | Success green | Surface 1 | Success green | 0 0 0 3px green/12 |
| Disabled | Border Subtle/50 | Surface 1/50 | Text Tertiary | none |
| Read-only | Border Subtle | Surface 2 | Text Tertiary | none |

## Button States
| State | Background | Border | Text | Shadow | Transform |
|---|---|---|---|---|---|
| Default | Gradient Primary | none | White | shadow-primary/50 | none |
| Hover | Gradient +10% | none | White | shadow-primary | translateY(-1px) |
| Active | Gradient -5% | none | White | none | scale(0.97) |
| Loading | Gradient | none | White + spinner | shadow-primary/50 | none |
| Disabled | Gradient/40 | none | White/60 | none | none |
| Success | Success | none | White | none | none (brief) |

## Project Status Badges
| Status | Background | Text | Dot | Label ID |
|---|---|---|---|---|
| Draft | Surface 3 | Text Secondary | Gray static | draft |
| Menunggu Analisis | Info Surface | Info | Blue pulse | pending_analysis |
| Analisis Selesai | Info Surface | Info | Blue static | analysis_done |
| Menunggu Penawaran | Warning Surface | Warning | Amber pulse | pending_quotation |
| Penawaran Dikirim | Warning Surface | Warning | Amber static | quotation_sent |
| Menunggu Pembayaran | Warning Surface | Warning | Amber pulse | pending_payment |
| Pembayaran Diterima | Success Surface | Success | Green static | payment_received |
| Produksi | Violet/10 | Violet | Violet pulse | in_production |
| Review | Info Surface | Info | Blue pulse | in_review |
| Revisi | Warning Surface | Warning | Amber pulse | revision_requested |
| Selesai | Success Surface | Success | Green static | completed |
| Dibatalkan | Error Surface | Error | Gray static | cancelled |

---

# PART 9 — ACCESSIBILITY & INCLUSIVE DESIGN

## WCAG 2.1 Level AA Compliance

### Color Contrast
| Combination | Ratio | Pass? |
|---|---|---|
| Text Primary on Background | 14.5:1 | ✓ AAA |
| Text Secondary on Background | 5.2:1 | ✓ AA |
| Text Tertiary on Background | 3.1:1 | ✗ (use only for decorative) |
| White on Violet (#7C6EFA) | 4.6:1 | ✓ AA |
| Dark on Gold (#F59E0B) | 5.8:1 | ✓ AA |
| White on Error (#F43F5E) | 4.5:1 | ✓ AA |

### Keyboard Navigation
- All interactive elements reachable by Tab
- Tab order: logical, left-to-right, top-to-bottom
- Focus ring: always visible, 3px violet, 2px offset (never remove outline)
- Modals: trap focus inside when open, return to trigger on close
- Dropdown menus: ↑↓ to navigate, Enter to select, Escape to close
- Skip link: "Lewati ke konten utama" — first focusable element on each page

### Screen Reader Support
- All images: descriptive `alt` text (not just file names)
- Icon-only buttons: `aria-label` always required
- Form inputs: always linked to `<label>` via `htmlFor/id`
- Status updates: use `aria-live="polite"` for non-critical, `aria-live="assertive"` for errors
- Progress indicators: `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- Loading states: `aria-busy="true"` on the loading region
- Modals: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`

### Motion & Animation
- Respect `prefers-reduced-motion: reduce`:
  - Disable all transitions and animations
  - Replace animated loading with static spinner
  - No particle effects or confetti
- Never use animation as the sole way to convey information

### Language & Readability
- Document language: `<html lang="id">` for Indonesian pages
- Reading level: max grade 8 equivalent for UI copy
- Avoid idioms that don't translate to other Indonesian regional dialects

---

# PART 10 — PERFORMANCE UX GUIDELINES

## Loading Strategy

### Critical Path (< 1 second perceived load)
- Server-render the topnav + hero shell before any JS loads
- Inline critical CSS (above-fold only)
- Preload: Inter 400/500/600, Plus Jakarta Sans 600/700, hero image

### Progressive Enhancement
- Page is readable without JavaScript (SSR content)
- Interactions enhance, not gate, the content
- If API fails: show cached data with a "memperbarui..." indicator

### Lazy Loading Rules
- Images below the fold: `loading="lazy"`
- Service card images: lazy load, with skeleton placeholder
- Dashboard charts: load after main content, show skeleton
- File previews: load on demand (not preloaded)

## Performance Budgets
| Metric | Target | Maximum |
|---|---|---|
| First Contentful Paint (FCP) | < 1.0s | 1.5s |
| Largest Contentful Paint (LCP) | < 2.0s | 2.5s |
| Total Blocking Time (TBT) | < 150ms | 300ms |
| Cumulative Layout Shift (CLS) | < 0.05 | 0.1 |
| Time to Interactive (TTI) | < 2.5s | 4.0s |

## UX Fallbacks
| Failure | User Sees |
|---|---|
| Image fails to load | Colored placeholder with service icon |
| API times out (> 8s) | Toast: "Koneksi lambat. Sedang mencoba ulang..." |
| API returns 500 | Inline error card with retry button |
| Offline | Toast: "Anda sedang offline. Beberapa fitur tidak tersedia." |
| File download fails | Toast: "Unduhan gagal. Coba lagi atau hubungi support." |

---

# PART 11 — DESIGN TOKEN EXPORT FORMAT

```json
{
  "color": {
    "base": {
      "obsidian":    { "value": "#060B18", "type": "color" },
      "deepNavy":    { "value": "#0D1526", "type": "color" },
      "navy":        { "value": "#131E35", "type": "color" },
      "steel":       { "value": "#1C2A45", "type": "color" },
      "borderSubtle":{ "value": "#243352", "type": "color" },
      "borderDefault":{"value": "#2E4270", "type": "color" }
    },
    "text": {
      "primary":   { "value": "#F0F4FF", "type": "color" },
      "secondary": { "value": "#8B9BC4", "type": "color" },
      "tertiary":  { "value": "#4F6494", "type": "color" },
      "inverse":   { "value": "#080D1B", "type": "color" }
    },
    "accent": {
      "violet":       { "value": "#7C6EFA", "type": "color" },
      "violetHover":  { "value": "#9D91FB", "type": "color" },
      "violetPress":  { "value": "#5F52D0", "type": "color" },
      "cyan":         { "value": "#22D3EE", "type": "color" },
      "gold":         { "value": "#F59E0B", "type": "color" },
      "goldLight":    { "value": "#FDE68A", "type": "color" }
    },
    "semantic": {
      "success":         { "value": "#10B981", "type": "color" },
      "successSurface":  { "value": "#052E1C", "type": "color" },
      "warning":         { "value": "#F59E0B", "type": "color" },
      "warningSurface":  { "value": "#2A1800", "type": "color" },
      "error":           { "value": "#F43F5E", "type": "color" },
      "errorSurface":    { "value": "#2A0A14", "type": "color" },
      "info":            { "value": "#38BDF8", "type": "color" },
      "infoSurface":     { "value": "#031828", "type": "color" }
    }
  },
  "typography": {
    "fontFamily": {
      "display": { "value": "'Plus Jakarta Sans', sans-serif", "type": "fontFamily" },
      "ui":       { "value": "'Inter', sans-serif",            "type": "fontFamily" },
      "mono":     { "value": "'JetBrains Mono', monospace",    "type": "fontFamily" }
    },
    "fontSize": {
      "displayXl": { "value": "56px", "type": "fontSize" },
      "displayLg": { "value": "44px", "type": "fontSize" },
      "displayMd": { "value": "36px", "type": "fontSize" },
      "headingXl": { "value": "24px", "type": "fontSize" },
      "headingLg": { "value": "20px", "type": "fontSize" },
      "headingMd": { "value": "18px", "type": "fontSize" },
      "bodyLg":    { "value": "18px", "type": "fontSize" },
      "bodyMd":    { "value": "16px", "type": "fontSize" },
      "bodySm":    { "value": "14px", "type": "fontSize" },
      "labelLg":   { "value": "14px", "type": "fontSize" },
      "labelMd":   { "value": "13px", "type": "fontSize" },
      "labelSm":   { "value": "11px", "type": "fontSize" }
    }
  },
  "spacing": {
    "1":  { "value": "4px",  "type": "spacing" },
    "2":  { "value": "8px",  "type": "spacing" },
    "3":  { "value": "12px", "type": "spacing" },
    "4":  { "value": "16px", "type": "spacing" },
    "6":  { "value": "24px", "type": "spacing" },
    "8":  { "value": "32px", "type": "spacing" },
    "12": { "value": "48px", "type": "spacing" },
    "16": { "value": "64px", "type": "spacing" },
    "20": { "value": "80px", "type": "spacing" },
    "24": { "value": "96px", "type": "spacing" }
  },
  "borderRadius": {
    "xs":   { "value": "4px",    "type": "borderRadius" },
    "sm":   { "value": "6px",    "type": "borderRadius" },
    "md":   { "value": "8px",    "type": "borderRadius" },
    "lg":   { "value": "12px",   "type": "borderRadius" },
    "xl":   { "value": "16px",   "type": "borderRadius" },
    "2xl":  { "value": "20px",   "type": "borderRadius" },
    "3xl":  { "value": "24px",   "type": "borderRadius" },
    "full": { "value": "9999px", "type": "borderRadius" }
  },
  "shadow": {
    "sm":      { "value": "0 2px 8px rgba(6,11,24,0.5)",  "type": "shadow" },
    "md":      { "value": "0 4px 16px rgba(6,11,24,0.6)", "type": "shadow" },
    "lg":      { "value": "0 8px 32px rgba(6,11,24,0.7)", "type": "shadow" },
    "primary": { "value": "0 4px 20px rgba(124,110,250,0.25)", "type": "shadow" },
    "gold":    { "value": "0 4px 20px rgba(245,158,11,0.20)",  "type": "shadow" },
    "glow":    { "value": "0 0 40px rgba(124,110,250,0.15), 0 0 80px rgba(124,110,250,0.08)", "type": "shadow" }
  },
  "animation": {
    "durationFast":   { "value": "100ms", "type": "time" },
    "durationNormal": { "value": "150ms", "type": "time" },
    "durationMedium": { "value": "200ms", "type": "time" },
    "durationSlow":   { "value": "300ms", "type": "time" },
    "durationPage":   { "value": "400ms", "type": "time" },
    "easingOut":      { "value": "cubic-bezier(0, 0, 0.2, 1)",        "type": "cubicBezier" },
    "easingIn":       { "value": "cubic-bezier(0.4, 0, 1, 1)",        "type": "cubicBezier" },
    "spring":         { "value": "cubic-bezier(0.34, 1.56, 0.64, 1)", "type": "cubicBezier" }
  }
}
```

---

# PART 12 — DEVELOPER HANDOFF CHECKLIST

## Before Implementation Starts

### Design Completeness
- [ ] All 25 screen wireframes approved
- [ ] All component states documented (default, hover, focus, active, error, disabled, loading)
- [ ] All responsive variants documented (mobile 375px, tablet 768px, desktop 1280px)
- [ ] Design tokens exported and confirmed
- [ ] Iconography list finalized (no ambiguous icon choices)
- [ ] Motion spec confirmed for all animated components

### Asset Delivery
- [ ] All icons as SVG (optimized, < 2KB each)
- [ ] Service category icons (15 total) as SVG
- [ ] Logo in SVG + PNG@2x formats (dark and light variants)
- [ ] Empty state illustrations as SVG
- [ ] Hero illustration as SVG (with optional raster fallback)
- [ ] Favicon set (16, 32, 180, 512px)
- [ ] OG image (1200×630px) for social sharing

### Font Delivery
- [ ] Inter: woff2, subsets: latin, latin-ext
- [ ] Plus Jakarta Sans: woff2, weights 600 & 700 only
- [ ] JetBrains Mono: woff2, weight 400 only
- [ ] Preconnect and preload instructions confirmed

## Implementation Standards

### CSS Architecture
```
/styles
  tokens.css        ← All design tokens as CSS custom properties
  reset.css         ← Minimal reset (not full normalize)
  typography.css    ← Font loading + base type styles
  animations.css    ← Keyframe definitions
  components/
    button.css
    input.css
    card.css
    ...
```

### CSS Custom Properties Convention
```css
/* Dark mode default */
:root {
  --color-bg:           #060B18;
  --color-surface-1:    #0D1526;
  --color-surface-2:    #131E35;
  --color-text-primary: #F0F4FF;
  --color-accent:       #7C6EFA;
  /* ... */
}

/* Light mode override */
[data-theme="light"] {
  --color-bg:           #FAFBFF;
  --color-surface-1:    #FFFFFF;
  --color-text-primary: #0D1526;
  /* ... */
}
```

### Component Architecture
- Each UI component lives in its own directory: `ComponentName/index.tsx`, `ComponentName.module.css`
- All components accept a `className` prop for extension
- Never use inline styles except for dynamic values (e.g. progress bar width)
- Skeleton variants co-located with their parent component

### Image Handling
- All images: `<img>` with explicit width and height (prevents CLS)
- Avatars and logos: `loading="eager"` above fold, `loading="lazy"` below
- Service illustrations: SVG inline for above-fold, `<img>` for below-fold

### Form Handling
- Client-side validation on blur, server validation on submit
- Form submission: disable submit button while in-flight
- On error: scroll to first error field, focus it
- On success: optimistic update + success toast

### Routing
- All page transitions: 200ms fade (respects prefers-reduced-motion)
- Scroll to top on route change
- Preserve scroll position on browser back
- Loading state: thin violet progress bar at top (NProgress style)

## QA Sign-off Criteria

Before each screen is marked "ready for production":
- [ ] Renders correctly on Chrome, Safari, Firefox (latest)
- [ ] Renders correctly at 375px, 768px, 1024px, 1280px, 1440px
- [ ] All interactive states correct (keyboard + mouse)
- [ ] Screen reader test: VoiceOver (Mac) or NVDA (Windows)
- [ ] No CLS on initial load
- [ ] Lighthouse score: Performance ≥ 85, Accessibility ≥ 95
- [ ] Dark mode verified
- [ ] All animations respect prefers-reduced-motion
- [ ] All text passes WCAG AA contrast

---

*Creative Studio — UX Blueprint v2.0*
*Companion to Design Master v1.0*
*Total pages covered: 25 · Total components spec'd: 47*
*Awaiting approval before implementation begins.*
