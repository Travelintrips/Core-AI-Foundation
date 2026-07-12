# DESIGN MASTER — Creative Studio
**AI Enterprise Marketplace**
Version 1.0 · For Approval

---

## CONCEPT DIRECTION

### "Apex Intelligence"
*Where executive precision meets AI-powered possibility.*

Creative Studio adalah enterprise AI marketplace yang dijual kepada decision-makers kelas atas — CEO, Finance Director, Marketing Manager, dan Logistic Company. Desain harus memancarkan kepercayaan, otoritas, dan kemampuan tanpa terasa seperti dashboard IT internal.

**Visual Metaphor:** Bayangkan Bloomberg Terminal bertemu Stripe Dashboard bertemu Linear — presisi data, editorial typesetting, dan keanggunan premium dalam satu sistem yang kohesif.

**Design DNA:**
- Dark-first interface (with Light mode option for formal reports)
- Spatial depth melalui layering — bukan flat, bukan skeuomorphic
- Motion yang terasa "bertenaga" bukan "playful"
- Setiap elemen terasa mahal, bukan ramai

---

## 1. COLOR SYSTEM

### Base Palette (Dark Mode — Primary)

| Role | Name | Hex | Usage |
|---|---|---|---|
| Background Base | Obsidian | `#060B18` | App background, deepest layer |
| Surface 1 | Deep Navy | `#0D1526` | Cards, panels, sidebars |
| Surface 2 | Navy | `#131E35` | Hover states, elevated cards |
| Surface 3 | Steel | `#1C2A45` | Borders baseline, input bg |
| Border Subtle | Slate | `#243352` | Dividers, card outlines |
| Border Default | Mist | `#2E4270` | Active borders, focus rings |

### Foreground

| Role | Name | Hex | Usage |
|---|---|---|---|
| Text Primary | White | `#F0F4FF` | Headings, key labels |
| Text Secondary | Silver | `#8B9BC4` | Body copy, metadata |
| Text Tertiary | Dusk | `#4F6494` | Placeholders, disabled |
| Text Inverse | Ink | `#080D1B` | Text on light backgrounds |

### Accent System

| Role | Name | Hex | Rationale |
|---|---|---|---|
| **Primary** | Violet | `#7C6EFA` | Intelligence, trust, premium AI |
| Primary Hover | Violet Bright | `#9D91FB` | Interactive states |
| Primary Press | Violet Deep | `#5F52D0` | Active/press states |
| **Secondary** | Cyan | `#22D3EE` | Data, live feeds, technology |
| **Gold** | Amber | `#F59E0B` | Enterprise tier, premium badges |
| Gold Light | Amber Pale | `#FDE68A` | Gold text on dark |

### Semantic Colors

| Role | Hex | Usage |
|---|---|---|
| Success | `#10B981` | Completed, approved, healthy |
| Success Surface | `#052E1C` | Success toasts, bg |
| Warning | `#F59E0B` | Pending review, near deadline |
| Warning Surface | `#2A1800` | Warning banners |
| Error | `#F43F5E` | Failed, rejected, critical |
| Error Surface | `#2A0A14` | Error states, bg |
| Info | `#38BDF8` | Notes, informational |
| Info Surface | `#031828` | Info panels |

### Light Mode Palette (Secondary — for reports, print)

| Role | Hex |
|---|---|
| Background | `#FAFBFF` |
| Surface 1 | `#FFFFFF` |
| Surface 2 | `#F1F4FD` |
| Border | `#E2E8F0` |
| Text Primary | `#0D1526` |
| Text Secondary | `#475569` |
| Primary Accent | `#6B60EF` |

### Gradient Library

```
Gradient Hero:      linear-gradient(135deg, #060B18 0%, #0D1526 50%, #12163A 100%)
Gradient Primary:   linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)
Gradient Gold:      linear-gradient(135deg, #F59E0B 0%, #D97706 100%)
Gradient AI Aura:   radial-gradient(ellipse at 60% 0%, rgba(124,110,250,0.15) 0%, transparent 60%)
Gradient Surface:   linear-gradient(180deg, rgba(28,42,69,0.8) 0%, rgba(13,21,38,0.95) 100%)
Gradient Mesh:      conic-gradient from #7C6EFA, #22D3EE, #F59E0B (for hero accents only)
```

---

## 2. TYPOGRAPHY

### Type Scale

**Primary Typeface:** `Inter` — UI labels, body, forms, tables
**Display Typeface:** `Plus Jakarta Sans` — hero headings, marketing copy, large numbers
**Mono Typeface:** `JetBrains Mono` — code snippets, IDs, data values

### Scale

| Token | Size | Line Height | Weight | Letter Spacing | Usage |
|---|---|---|---|---|---|
| `display-2xl` | 72px | 80px | 700 | -2.5px | Hero superheading |
| `display-xl` | 56px | 64px | 700 | -2px | Hero heading |
| `display-lg` | 44px | 52px | 600 | -1.5px | Section hero |
| `display-md` | 36px | 44px | 600 | -1px | Page titles |
| `display-sm` | 28px | 36px | 600 | -0.5px | Card headings |
| `heading-xl` | 24px | 32px | 600 | -0.3px | Section headings |
| `heading-lg` | 20px | 28px | 600 | -0.2px | Sub-section titles |
| `heading-md` | 18px | 26px | 500 | -0.1px | Card titles |
| `heading-sm` | 16px | 24px | 500 | 0 | Label headings |
| `body-lg` | 18px | 28px | 400 | 0 | Hero body copy |
| `body-md` | 16px | 24px | 400 | 0 | Standard body |
| `body-sm` | 14px | 20px | 400 | 0 | Secondary body |
| `body-xs` | 13px | 18px | 400 | 0 | Captions |
| `label-lg` | 14px | 20px | 500 | 0.1px | Form labels |
| `label-md` | 13px | 18px | 500 | 0.15px | Metadata labels |
| `label-sm` | 11px | 16px | 600 | 0.5px | Badges, chips |
| `mono-lg` | 16px | 24px | 400 | 0 | Data values |
| `mono-sm` | 13px | 18px | 400 | 0 | IDs, tokens |

### Typography Rules
- Headlines always use Plus Jakarta Sans with negative tracking
- Body copy uses Inter with 0 tracking
- Numbers and data use JetBrains Mono
- Never go below 13px for any visible text
- Minimum contrast ratio: 4.5:1 (WCAG AA)

---

## 3. SPACING SYSTEM

**Base Unit:** 4px

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | Icon padding, micro gaps |
| `space-2` | 8px | Tight inline spacing |
| `space-3` | 12px | Small component padding |
| `space-4` | 16px | Default component padding |
| `space-5` | 20px | Medium spacing |
| `space-6` | 24px | Section sub-spacing |
| `space-8` | 32px | Card padding, section gaps |
| `space-10` | 40px | Large section separators |
| `space-12` | 48px | Major section breaks |
| `space-16` | 64px | Page section padding |
| `space-20` | 80px | Hero padding |
| `space-24` | 96px | Large hero sections |
| `space-32` | 128px | Between major page sections |

**Grid System:**
- Max container: 1280px
- Columns: 12
- Gutter: 24px (mobile: 16px)
- Margin: 48px (desktop), 20px (mobile)

---

## 4. RADIUS SYSTEM

| Token | Value | Usage |
|---|---|---|
| `radius-none` | 0 | Tables, data grids |
| `radius-xs` | 4px | Badges, chips, small tags |
| `radius-sm` | 6px | Buttons (compact), inputs |
| `radius-md` | 8px | Default buttons, small cards |
| `radius-lg` | 12px | Standard cards, modals |
| `radius-xl` | 16px | Feature cards, panels |
| `radius-2xl` | 20px | Large hero cards |
| `radius-3xl` | 24px | Hero panels, pricing cards |
| `radius-full` | 9999px | Pills, avatar, toggle |

---

## 5. SHADOW SYSTEM

All shadows use a cool blue-violet tint (not gray) to feel premium.

| Token | Value | Usage |
|---|---|---|
| `shadow-xs` | `0 1px 2px rgba(6,11,24,0.4)` | Subtle lift |
| `shadow-sm` | `0 2px 8px rgba(6,11,24,0.5), 0 1px 2px rgba(6,11,24,0.3)` | Cards at rest |
| `shadow-md` | `0 4px 16px rgba(6,11,24,0.6), 0 2px 4px rgba(6,11,24,0.4)` | Hover cards |
| `shadow-lg` | `0 8px 32px rgba(6,11,24,0.7), 0 4px 8px rgba(6,11,24,0.5)` | Modals, dropdowns |
| `shadow-xl` | `0 16px 48px rgba(6,11,24,0.8), 0 8px 16px rgba(6,11,24,0.6)` | Hero elements |
| `shadow-primary` | `0 4px 20px rgba(124,110,250,0.25)` | CTA buttons, focus |
| `shadow-gold` | `0 4px 20px rgba(245,158,11,0.20)` | Enterprise/gold elements |
| `shadow-glow` | `0 0 40px rgba(124,110,250,0.15), 0 0 80px rgba(124,110,250,0.08)` | AI widget aura |
| `shadow-inset` | `inset 0 1px 0 rgba(255,255,255,0.04)` | Glassmorphism highlight |

---

## 6. ICON STYLE

**Icon Library:** `Lucide Icons` (primary) + custom AI icons set

**Style Rules:**
- Stroke weight: 1.5px (default), 1.25px (small), 2px (emphasis)
- Corner style: Rounded (matches radius-sm)
- Size scale: 14px, 16px, 18px, 20px, 24px, 32px, 40px, 48px
- Color: Inherits text color — never hardcoded
- Never fill icons except for status indicators (active/selected)
- AI-specific icons use a subtle violet tint in their stroke

**Custom Icon Categories:**
- AI Service icons (one per vertical — Creative, Finance, Legal, etc.)
- Status icons (animated, SVG)
- Navigation icons
- Industry-specific pictograms for Logistics, Customs, Trading

---

## 7. ILLUSTRATION STYLE

**Style:** "Technical Elegance" — line-art illustrations with selective accent fills

- Base: Line art, 1.5px violet/cyan strokes on transparent bg
- Accent fills: Semi-transparent violet/cyan gradients (opacity 10–20%)
- Grid/mesh overlays: Subtle dot grids as texture
- 3D elements: Only for hero sections — low-poly or abstract geometry
- Avoid: Cartoon characters, stock photo styles, excessive detail
- AI concepts: Use abstract network graphs, flowing data streams, connected nodes
- Format: SVG always, optimized, never raster for UI illustrations

**Illustration Types:**
1. Hero illustration — abstract AI brain/network, full-bleed
2. Empty state illustrations — small, minimal, helpful
3. Service category illustrations — one per AI vertical
4. Success/completion illustrations — particle/confetti style

---

## 8. ANIMATION STYLE

**Philosophy:** "Purposeful Motion" — every animation communicates state, never just decoration.

**Easing Curves:**
```
ease-in:        cubic-bezier(0.4, 0, 1, 1)       — elements exiting
ease-out:       cubic-bezier(0, 0, 0.2, 1)        — elements entering (primary)
ease-in-out:    cubic-bezier(0.4, 0, 0.2, 1)      — elements shifting position
spring:         cubic-bezier(0.34, 1.56, 0.64, 1) — success states, confirmations
```

**Duration Scale:**
| Token | Duration | Usage |
|---|---|---|
| `duration-fast` | 100ms | Hover color changes, micro feedback |
| `duration-normal` | 150ms | Button states, icon swaps |
| `duration-medium` | 200ms | Panel opens, tooltip appear |
| `duration-slow` | 300ms | Modal enter, drawer slide |
| `duration-page` | 400ms | Page transitions, hero load |
| `duration-pulse` | 2000ms | AI thinking indicator (loop) |

**Key Animation Patterns:**
- Page enter: fade-up (translateY 16px → 0, opacity 0 → 1), staggered
- Card hover: translateY -2px + shadow-md, 150ms ease-out
- Button press: scale 0.97, 100ms ease-in
- Loading skeleton: shimmer left-to-right, 1.5s loop
- AI thinking: breathing violet glow pulse, 2s loop
- Success: scale 0 → 1.1 → 1 (spring), particle burst
- Number counter: count-up animation for stats
- Sidebar collapse: width + opacity, 200ms ease-in-out

---

## 9. BUTTON STYLE

### Variants

**Primary (filled)**
```
Background:    Gradient Primary (#7C6EFA → #5F52D0)
Text:          White, label-md, 500 weight
Padding:       12px 20px (default) / 10px 16px (sm) / 14px 24px (lg)
Radius:        radius-md (8px)
Shadow:        shadow-primary on hover
Hover:         brightness +10%, translateY -1px
Press:         brightness -5%, translateY 0, scale 0.97
Disabled:      opacity 0.4, cursor not-allowed
```

**Secondary (outlined)**
```
Background:    transparent
Border:        1px solid #243352
Text:          #F0F4FF
Hover:         bg rgba(124,110,250,0.08), border #7C6EFA
```

**Ghost**
```
Background:    transparent, no border
Text:          #8B9BC4
Hover:         bg rgba(255,255,255,0.05), text #F0F4FF
```

**Destructive**
```
Background:    transparent, border #F43F5E at 30% opacity
Text:          #F43F5E
Hover:         bg rgba(244,63,94,0.08), border #F43F5E
```

**Gold / Enterprise Tier**
```
Background:    Gradient Gold (#F59E0B → #D97706)
Text:          #080D1B (dark text on gold)
Shadow:        shadow-gold on hover
```

**Icon Button**
```
Size:          32×32px (sm), 36×36px (md), 40×40px (lg)
Background:    Surface 2 at rest, Surface 3 on hover
Radius:        radius-md
Border:        1px solid Border Subtle
```

### Button Sizes
| Size | Height | Padding H | Font |
|---|---|---|---|
| xs | 28px | 12px | 12px/500 |
| sm | 32px | 14px | 13px/500 |
| md | 36px | 16px | 14px/500 |
| lg | 40px | 20px | 15px/500 |
| xl | 48px | 24px | 16px/600 |

---

## 10. FORM STYLE

**Input Fields**

```
Background:    Surface 1 (#0D1526)
Border:        1px solid Border Subtle (#243352)
Radius:        radius-sm (6px)
Height:        40px (default), 36px (sm), 44px (lg)
Padding:       0 12px
Text:          Text Primary, body-sm
Placeholder:   Text Tertiary
Label:         label-md, Text Secondary, 8px above input
Helper text:   body-xs, Text Tertiary, 6px below input

Focus:         border-color #7C6EFA, box-shadow 0 0 0 3px rgba(124,110,250,0.15)
Error:         border-color #F43F5E, box-shadow 0 0 0 3px rgba(244,63,94,0.12)
Success:       border-color #10B981, box-shadow 0 0 0 3px rgba(16,185,129,0.12)
Disabled:      opacity 0.5, cursor not-allowed, no focus ring
```

**Textarea**
```
Same as input, min-height 96px, resize vertical only
```

**Select / Dropdown**
```
Same as input + chevron icon right-aligned
Open: dropdown surface with surface-lg shadow, radius-lg, border Surface 3
Option hover: bg Surface 2
Option selected: bg violet/10, text violet
```

**Checkbox & Radio**
```
Size:          18×18px
Border:        1.5px solid Border Default
Radius:        radius-xs (checkbox), radius-full (radio)
Checked fill:  Gradient Primary
Check icon:    white, 1.5px stroke
Focus ring:    0 0 0 3px rgba(124,110,250,0.2)
```

**Toggle**
```
Track:         40×22px, radius-full
Off:           bg #243352
On:            bg Gradient Primary
Thumb:         18×18px white circle, shadow-sm
Animation:     150ms spring
```

**File Upload Zone**
```
Border:        1.5px dashed #243352
Bg:            transparent
Radius:        radius-xl (16px)
Hover:         border #7C6EFA, bg rgba(124,110,250,0.04)
Active drop:   border #7C6EFA solid, bg rgba(124,110,250,0.08)
```

---

## 11. CARD STYLE

### Base Card
```
Background:    Surface 1 (#0D1526)
Border:        1px solid Border Subtle (#243352)
Radius:        radius-lg (12px)
Padding:       24px
Shadow:        shadow-sm at rest, shadow-md on hover
Hover:         translateY -2px, border-color #2E4270
Transition:    150ms ease-out
Top highlight: inset 0 1px 0 rgba(255,255,255,0.04)
```

### Elevated Card (modal-like)
```
Background:    Surface 2 (#131E35)
Border:        1px solid #2E4270
Shadow:        shadow-lg
No hover interaction
```

### Glass Card (for hero / overlays)
```
Background:    rgba(13,21,38,0.7)
Backdrop:      blur(20px) saturate(180%)
Border:        1px solid rgba(46,66,112,0.5)
```

### Feature Card
```
Same as base card +
Icon container: 40×40px, Surface 3 bg, radius-md, violet icon
Header: heading-sm
Body: body-sm, Text Secondary
Footer: optional CTA link or badge row
```

### Service Card (Marketplace)
```
Same as base card +
Service icon: 48×48px colored icon container
Rating: star row (amber)
Price: display-sm with /session or /month label
Category badge: label-sm pill
Hover: border shifts to violet
```

---

## 12. PRICING CARD

### Layout Structure
```
┌─────────────────────────────────┐
│ PLAN NAME          [POPULAR]    │
│ One line description            │
│                                 │
│ Rp X.XXX.XXX / bulan            │
│ Billed annually                 │
│                                 │
│ ─────────────────────────────   │
│ ✓ Feature 1                     │
│ ✓ Feature 2                     │
│ ✓ Feature 3                     │
│ ✓ Feature 4                     │
│ ✗ Feature 5 (grayed)            │
│                                 │
│ [    CTA Button    ]            │
└─────────────────────────────────┘
```

**Tiers:**
- **Starter:** ghost button, standard card
- **Professional:** primary button, highlighted border (#7C6EFA)
- **Enterprise:** gold button, gold border (#F59E0B), `MOST POPULAR` badge

**Popular badge:** label-sm, Gradient Primary bg, top-right corner
**Price:** `display-md` for amount, `body-sm` for period in Text Secondary
**Feature list:** 14px, check (green) or x (red/muted), 8px gap

---

## 13. PACKAGE CARD

Used in the AI Service marketplace for individual service packages.

```
┌─────────────────────────────────┐
│ 🎯 [SERVICE ICON]               │
│                                 │
│ Package Name                   │
│ Short description               │
│                                 │
│ ┌──────┐ ┌──────┐ ┌──────┐     │
│ │ 3    │ │ 5    │ │ 7    │     │
│ │ hari │ │ hari │ │ hari │     │
│ └──────┘ └──────┘ └──────┘     │
│                                 │
│ Mulai dari                      │
│ Rp 5.000.000                   │
│                                 │
│ [ Lihat Detail →]              │
└─────────────────────────────────┘
```

- Delivery selector: segmented pill (3 options)
- Price updates dynamically on selection (animated number swap)
- "Terlaris" badge: amber pill, top-left
- Hover: entire card lifts + violet border glow

---

## 14. STEPPER

### Horizontal Stepper (for Brief → Production flow)

```
● Step 1    ──── ● Step 2    ──── ○ Step 3    ──── ○ Step 4
Brief           Analysis        Commercial       Production
  ↑ Completed     ↑ Active       ↑ Upcoming        ↑ Locked
```

**States:**
- **Completed:** violet fill circle, white check icon, solid violet connector line
- **Active:** violet fill circle (pulsing ring aura), label bold
- **Upcoming:** Surface 2 circle, Border Default outline, label Text Tertiary
- **Error:** Error red circle, x icon

**Specs:**
```
Circle size:   32px
Line:          1.5px, dashed (upcoming), solid (completed)
Label:         label-sm below circle, 6px gap
Padding:       16px between steps (responsive: collapses to vertical on mobile)
```

### Vertical Stepper (for detailed sub-steps)
```
● Step label                     ← icon + label
│ Sub-description or form
│
● Next step
│
○ Upcoming
```

---

## 15. NAVIGATION (Top Bar)

### Desktop Navigation
```
┌─────────────────────────────────────────────────────────────────┐
│ [◇ Creative Studio]  Layanan ▾  Harga  Blog  [Login] [Mulai →] │
└─────────────────────────────────────────────────────────────────┘
```

**Specs:**
- Height: 64px
- Background: `rgba(6,11,24,0.85)` with `backdrop-blur(20px)`
- Border bottom: 1px solid Border Subtle (on scroll)
- Logo: Plus Jakarta Sans, heading-md, 600 weight
- Nav links: body-sm, Text Secondary → Text Primary on hover
- Dropdown mega menu: 2–3 column grid, service icons, 400px wide panel
- Sticky: yes, slides in from top on scroll up
- Scroll behavior: border and bg darken after 80px scroll

### Auth State (logged in)
Replace [Login] [Mulai] with:
```
[🔔 3] [Avatar ▾]
```
Avatar dropdown: profile, orders, settings, billing, logout

---

## 16. SIDEBAR

Used in the Customer Dashboard and Order workspace.

**Desktop Sidebar:**
```
Width:         240px (expanded), 64px (collapsed)
Background:    Surface 1 (#0D1526)
Border right:  1px solid Border Subtle
Padding:       16px 12px

Logo area:     48px height, 16px padding
Nav section:   label-sm Text Tertiary for group labels (uppercase, 0.1em tracking)
Nav item:      36px height, 12px h-padding, body-sm
  - Icon:      18px, Text Secondary
  - Label:     Text Secondary → Text Primary on hover
  - Active:    Surface 3 bg, violet left border (2px), icon+text Violet
  - Hover:     Surface 2 bg, 150ms ease
Bottom area:   Upgrade CTA card, avatar/account info
```

**Collapsed Mode:**
- Only icons visible
- Tooltip on hover showing label
- Expand toggle: bottom of sidebar

**Mobile:** Full-screen drawer from left edge, backdrop blur overlay

---

## 17. HERO SECTION

### Landing Page Hero

**Layout:**
```
┌────────────────────────────────────────────────────────────────┐
│                         [HERO SECTION]                         │
│                                                                │
│              ← Radial violet glow from top-center →           │
│                                                                │
│         [NEW]  Sekarang tersedia: 15 layanan AI               │
│                                                                │
│    Transformasi Bisnis Anda                                    │
│    dengan AI Enterprise                                        │
│    yang Bekerja untuk Anda.                                    │
│                                                                │
│    From creative campaigns to tax filings —                   │
│    your AI workforce is ready.                                 │
│                                                                │
│    [ Mulai Sekarang → ]    [ Lihat Demo  ▷ ]                  │
│                                                                │
│    ★4.9  ·  500+ enterprise clients  ·  15 AI verticals       │
│                                                                │
│         ┌─────────────────────────────┐                       │
│         │  [Hero Dashboard Preview]   │                       │
│         │  Glassmorphism mockup card  │                       │
│         └─────────────────────────────┘                       │
└────────────────────────────────────────────────────────────────┘
```

**Specs:**
- Min-height: 100vh
- Background: Gradient Hero + AI Aura radial overlay
- Badge pill: label-sm, Surface 3, Border Default, Cyan dot pulse
- Heading: display-xl, Plus Jakarta Sans, -2px tracking, white
- Highlight word: Gradient Primary text-fill (CSS gradient clip)
- Body: body-lg, Text Secondary, max-width 560px
- Trust bar: logo grid of enterprise clients using the platform
- Dashboard preview: glass card, rotated 2–3deg, subtle shadow-xl
- Scroll indicator: animated chevron-down at 80vh

---

## 18. CTA SECTION

### Primary CTA Block (between sections)
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│          Siap memulai transformasi AI bisnis Anda?             │
│         Konsultasikan kebutuhan Anda secara gratis.            │
│                                                                 │
│              [ Mulai Sekarang → ]  [ Hubungi Sales ]           │
│                                                                 │
│         No credit card required · Setup dalam 24 jam           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- Background: Surface 2 + AI Aura radial glow centered
- Border: 1px solid #2E4270
- Radius: radius-2xl
- Top + bottom glow: `box-shadow: 0 0 80px rgba(124,110,250,0.1)`

### Inline CTA (within content)
- Smaller, 2-column layout: text left, button right
- Used in section transitions

### Banner CTA (top of page)
- Height: 48px, full width, Primary Gradient bg
- Body-sm white text + close button

---

## 19. EMPTY STATE

**Structure:**
```
         [Illustration — 120×120px]

         Belum ada proyek aktif
         
         Anda belum memulai layanan apapun.
         Temukan layanan AI yang tepat untuk bisnis Anda.
         
         [ Jelajahi Layanan → ]
```

**Specs:**
- Container: centered, max-width 360px
- Illustration: subtle, line-art style (see Illustration section)
- Title: heading-md, Text Primary
- Description: body-sm, Text Secondary, max-width 300px
- CTA: Primary or Secondary button depending on context
- Variants: Orders, Notifications, Search results, Billing

---

## 20. LOADING STATE

### Full Page Loader
- Black overlay with centered Creative Studio logo
- Logo has breathing violet glow: `scale 1 → 1.05 → 1`, `opacity 0.6 → 1 → 0.6`, 2s loop
- Progress bar: Gradient Primary, 2px height, top of page, animates from 0 → 60% → 100%

### Inline Loader (inside buttons)
- 16px spinner, white stroke, 1px remaining arc
- Spin 360deg in 600ms linear loop
- Button text replaced by spinner + "Memproses..."

### Section Loader
- 3 stacked skeleton cards with shimmer
- 300ms stagger between cards

### AI Processing Indicator (special)
```
● ● ●  AI sedang menganalisis brief Anda...
```
- 3 violet dots with wave animation (staggered 150ms delay)
- Below: rotating insight messages, fade in/out every 3s:
  - "Menganalisis industri target..."
  - "Menyesuaikan AI model..."
  - "Mempersiapkan tim kreatif..."

---

## 21. SKELETON

**Rules:**
- Match exact layout dimensions of the content it replaces
- Base: Surface 2 (`#131E35`)
- Shimmer: linear-gradient sweep, highlight color `rgba(46,66,112,0.5)`
- Animation: `shimmer` keyframe, 1.5s ease-in-out infinite
- Direction: left → right
- Border-radius: match actual component's radius

**Skeleton Types:**
- Text line: full width, 14px height, radius-xs
- Text block: 3 lines, last line 60% width
- Avatar: circle, 40px
- Card: full card dimensions with internal skeleton lines
- Image: rectangle, radius matches image container
- Table row: alternating skeleton lines

---

## 22. SUCCESS SCREEN

### Inline Success (toasts / banners)
```
✓  Brief berhasil dikirim! Tim kami akan menghubungi dalam 2 jam.    ✕
```
- Background: Success Surface, border Success color
- Green check icon, body-sm Text Primary, 4s auto-dismiss

### Full-Page Success (post-payment, post-submission)
```
         ╔══════════════════════════════╗
         ║  [Animated check — 80px]     ║
         ║                              ║
         ║  Pembayaran Berhasil! 🎉     ║
         ║                              ║
         ║  Order #CS-2024-0142         ║
         ║  Tim AI kami akan mulai      ║
         ║  bekerja dalam 30 menit.     ║
         ║                              ║
         ║  [Lihat Workspace →]         ║
         ║  [Kembali ke Dashboard]      ║
         ╚══════════════════════════════╝
```
- Centered card, max-width 440px
- Particle burst animation on entry (confetti, violet + gold)
- Check icon: animated stroke-dashoffset reveal
- Order number: mono-sm, Surface 3 pill

---

## 23. ERROR SCREEN

### Inline Error (field, toast)
- Toast: Error Surface bg, rose border, error icon
- Field: red border + `body-xs` error message below

### Page Error (404, 500)
```
         [Illustration — abstract broken node]
         
         404 — Halaman Tidak Ditemukan
         
         Sepertinya Anda mencari sesuatu yang tidak ada.
         
         [ Kembali ke Beranda ]    [ Hubungi Support ]
```
- Cool, not alarming — use the illustration to keep tone calm
- Error code: mono-lg, Text Tertiary
- Title: heading-xl

### API / System Error (inline panel)
- Error Surface card with border
- Retry button after 3s
- Collapse-able technical details (for admin)

---

## 24. AI WIDGET STYLE

### AI Chat Floating Widget
- **Position:** Fixed, bottom-right, 24px margin
- **Collapsed state:** 56×56px circle, Gradient Primary bg, AI icon, violet glow pulse ring
- **Expanded state:** 380×520px card, Surface 2 bg, radius-xl, shadow-xl
- **Header:** "Tanya AI Assistant" + minimize/close buttons
- **Message bubbles:**
  - AI: Surface 3 bg, left-aligned, radius-lg without top-left
  - User: Gradient Primary bg, right-aligned, radius-lg without top-right
  - AI typing: animated 3-dot loader
- **Input:** Surface 1 bg, no border top, radius-full
- **Voice input:** mic button, animated pulse ring when active

### AI Insight Card (inline, in dashboard)
```
┌──────────────────────────────────────┐
│ ✦ AI Insight                         │
│                                      │
│ Campaign Anda memiliki potensi 2.3x  │
│ lebih tinggi jika target ke segmen   │
│ B2B Manufacturing di Surabaya.       │
│                                      │
│ [Lihat Analisis Lengkap →]           │
└──────────────────────────────────────┘
```
- Subtle violet left border (2px)
- ✦ icon (custom AI sparkle)
- Background: `rgba(124,110,250,0.04)`
- Animated: fade-up on first appear

### AI Status Badge
```
⬤ AI Online    ← Pulsing green dot
```
```
◎ AI Processing  ← Pulsing violet ring
```
```
⊗ AI Unavailable ← Static gray
```

---

## 25. MOBILE DESIGN GUIDELINES

### Breakpoints
| Name | Min-width | Max-width | Target |
|---|---|---|---|
| xs | 0 | 479px | Small phones |
| sm | 480px | 767px | Large phones |
| md | 768px | 1023px | Tablets |
| lg | 1024px | 1279px | Small desktops |
| xl | 1280px | — | Full desktop |

### Mobile-First Rules

**Navigation:**
- Bottom navigation bar (5 tabs max) replaces sidebar
- Tab bar: 64px height, blur bg, Surface 1 base
- Hamburger/drawer for secondary navigation

**Touch Targets:**
- Minimum: 44×44px for all interactive elements
- Spacing: 8px minimum between adjacent targets

**Typography Adjustments:**
- `display-xl` → `display-md` on mobile
- `heading-xl` → `heading-lg`
- `body-lg` → `body-md`
- Line-length: max 38 characters per line (mobile)

**Card Layout:**
- Single column, edge-to-edge with 16px page margin
- Cards: full-width, no fixed height
- Horizontal scroll for tag/chip groups

**Forms:**
- Full-width inputs
- Sticky CTA button: fixed bottom, 16px from edge
- Avoid modals — use bottom sheets instead

**Bottom Sheet:**
- Handle: 32×4px pill, centered, 8px from top
- Background: Surface 1, radius-3xl top only
- Max height: 90vh, scrollable content

**Gestures:**
- Swipe left on cards: quick actions (delete, archive)
- Pull-to-refresh: custom violet spinner
- Long press: context menu (haptic feedback on native)

**Performance:**
- Skeleton on all list views
- Image lazy loading with blur placeholder
- Stagger animation only when < 6 items visible

---

# SITEMAP UI — Creative Studio

## Full Flow Map

```
PUBLIK (Unauthenticated)
│
├── [01] Landing Page
│     ├── Hero — Value proposition + CTA
│     ├── Layanan AI — Grid 15 service categories
│     ├── Bagaimana Cara Kerja — 4-step visual stepper
│     ├── Statistik / Social Proof
│     ├── Pricing Tiers
│     ├── Testimonial Enterprise Clients
│     ├── FAQ
│     └── Footer CTA
│
├── [02] Marketplace — Service Directory
│     ├── Filter / Sort sidebar (category, price, delivery)
│     ├── Service card grid
│     ├── Featured / Recommended row
│     └── Search results state
│
├── [03] Service Detail Page
│     ├── Service hero (icon, name, category, rating)
│     ├── Package selector (Starter / Pro / Enterprise)
│     ├── Delivery time picker
│     ├── Scope of work (expandable)
│     ├── AI capabilities section
│     ├── Sample output gallery
│     ├── FAQs about service
│     ├── Provider profile card
│     ├── Related services
│     └── Sticky CTA panel (Pesan Sekarang)
│
├── [04] Halaman Harga — Pricing Page
│     ├── Toggle: Monthly / Annual
│     ├── Plan comparison table
│     └── Enterprise contact form
│
├── [05] Blog / Resources (optional)
│
├── [06] Login / Register
│     ├── Email + password
│     ├── Google SSO
│     ├── OTP (phone number option)
│     └── Forgot password flow
│
└── [07] Company Profile / Tentang Kami

─────────────────────────────────────────────────────────────

ORDER FLOW (Authenticated)
│
├── [10] Brief Submission
│     ├── Step 1: Pilih Layanan
│     │     └── Service category + package confirmation
│     ├── Step 2: Informasi Proyek
│     │     ├── Project name, description
│     │     ├── Target audience
│     │     ├── Industry vertical
│     │     └── Reference files (drag-and-drop)
│     ├── Step 3: Deliverables
│     │     ├── Format output yang diinginkan
│     │     ├── Tone / style guide
│     │     └── Deadline preference
│     ├── Step 4: Review Brief
│     │     └── Summary + edit links
│     └── Step 5: Konfirmasi
│           └── Brief sent → goes to AI Analysis
│
├── [11] AI Analysis Phase
│     ├── AI Processing screen (animated)
│     ├── Analysis result card:
│     │     ├── Feasibility score
│     │     ├── Scope clarification questions
│     │     ├── Estimated timeline
│     │     └── Recommended AI team
│     └── Approve Analysis → go to Commercial
│
├── [12] Commercial / Quotation Phase
│     ├── Penawaran (quotation) detail view
│     │     ├── Line items breakdown
│     │     ├── Validity period countdown
│     │     └── Terms & conditions
│     ├── Approve quotation → Payment
│     ├── Request revision
│     └── Payment Gateway
│           ├── Bank transfer instructions
│           ├── Virtual account
│           ├── Payment proof upload
│           └── Confirmation waiting screen
│
├── [13] Production Phase
│     ├── Production workspace dashboard
│     │     ├── Progress tracker (% complete)
│     │     ├── Active AI workers panel
│     │     ├── Milestone timeline
│     │     ├── Live activity log
│     │     └── Chat with project manager
│     ├── Partial deliverable previews
│     └── Revision request form
│
├── [14] Review Phase
│     ├── Deliverable viewer (per file)
│     ├── Annotation / feedback tool
│     ├── Approve → mark Completed
│     └── Request revision → back to Production
│
└── [15] Completed / Delivery
      ├── All files unlocked for download
      ├── Certificate / report PDF
      ├── Rate & review prompt
      └── Upsell: "Lanjutkan dengan layanan lain?"

─────────────────────────────────────────────────────────────

CLIENT DASHBOARD (Authenticated)
│
├── [20] Dashboard Home
│     ├── Active projects summary
│     ├── Pending actions (approval needed, payment due)
│     ├── AI insights widget
│     ├── Quick stats (total projects, savings, hours saved)
│     └── Recent activity feed
│
├── [21] Order History
│     ├── All orders list with status filter
│     ├── Order detail → links to relevant phase page
│     └── Repeat order button
│
├── [22] Workspace (per project)
│     ├── Brief summary (read-only)
│     ├── Files & deliverables
│     ├── Communication thread
│     ├── Timeline view
│     └── Invoice download
│
├── [23] Profile
│     ├── Company information
│     ├── Brand guidelines upload
│     ├── Contact details
│     └── AI memory / preferences
│
├── [24] Billing & Invoices
│     ├── Invoice list + download PDF
│     ├── Payment method management
│     ├── Subscription plan
│     └── Usage report
│
└── [25] Settings
      ├── Notification preferences
      ├── Team member management (enterprise)
      ├── API access (enterprise)
      ├── Security (2FA, sessions)
      └── Delete account
```

---

## Page Priority for MVP

**Phase 1 (Core flow):**
01 Landing → 02 Marketplace → 03 Service Detail → 10 Brief → 12 Commercial → 13 Production → 15 Completed

**Phase 2 (Dashboard):**
20 Dashboard → 21 Order History → 22 Workspace → 24 Billing

**Phase 3 (Enrichment):**
04 Pricing → 11 AI Analysis → 23 Profile → 25 Settings → Blog

---

## Design Notes for Developer Handoff

1. All measurements are in `px` at 1x; implement with `rem` (base 16px)
2. Color tokens should be CSS custom properties (`:root {}` for dark, `[data-theme="light"] {}` for light)
3. Font loading: preconnect Google Fonts, preload Inter 400/500/600
4. All animations respect `prefers-reduced-motion: reduce`
5. Dark mode is default; Light mode toggled by `[data-theme="light"]` on `<html>`
6. Grid system: CSS Grid + Flexbox (no Bootstrap)
7. Component library: build on Tailwind CSS + Radix UI primitives
8. Icon set: Lucide React (tree-shakable)

---

*Design Master v1.0 — Creative Studio AI Enterprise Marketplace*
*Awaiting approval before implementation begins.*
