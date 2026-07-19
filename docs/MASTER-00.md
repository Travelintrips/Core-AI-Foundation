# MASTER-00.md

# CREATIVE AI PLATFORM
## V4.2 MULTI-TEAM IMPLEMENTATION MASTER RULE

Version:
1.0

Status:
ACTIVE

Applies To:

- Team 1
- Team 2
- Team 3
- Team 4
- Team 5
- Team 6

---

# PROJECT OVERVIEW

Platform ini sedang memasuki Phase V4.2 Goal-Based Service Discovery.

Target utama proyek adalah mengubah pengalaman customer dari:

❌ Memilih 123 layanan

menjadi

✅ Memilih tujuan bisnis (Goal-Based Experience)

Seluruh implementasi wajib mempertahankan seluruh kemampuan sistem yang sudah ada.

Tidak boleh ada regression.

Tidak boleh ada duplicate source of truth.

Tidak boleh ada rewrite besar tanpa alasan yang jelas.

---

# PROJECT OBJECTIVES

Seluruh perubahan harus mengarah pada tujuan berikut:

1.
Customer tidak lagi dipaksa memahami struktur internal platform.

2.
Customer cukup menjelaskan tujuan bisnis.

3.
Sistem menentukan layanan yang paling sesuai.

4.
Semua layanan tetap memakai workflow canonical yang ada.

5.
Tidak boleh membuat service baru bila sebenarnya hanya presentation layer.

6.
Public experience harus sederhana.

7.
Internal architecture tetap scalable.

---

# ARCHITECTURE PRINCIPLE

Seluruh team wajib mengikuti prinsip berikut.

## 1. Single Source of Truth

Tidak boleh membuat source of truth kedua.

Jika data sudah ada di database:

Gunakan database.

Jika data sudah ada di service registry:

Gunakan service registry.

Jika data sudah ada di workflow:

Gunakan workflow.

Dilarang melakukan copy data.

---

## 2. Backward Compatibility

Semua endpoint lama harus tetap berjalan.

Semua order lama harus tetap valid.

Semua project lama harus tetap dapat dibuka.

Semua invoice lama tetap berlaku.

Semua slug lama tetap valid.

Semua service_code tetap sama.

---

## 3. Additive Only

Perubahan bersifat additive.

Tidak boleh:

- rename service
- rename workflow
- rename endpoint
- rename service_code

kecuali mendapat approval owner.

---

## 4. Deterministic

Business logic wajib deterministic.

Tidak boleh:

"AI memutuskan"

untuk:

- pricing
- eligibility
- recommendation ranking utama
- visibility

AI hanya boleh membantu penjelasan.

Bukan menentukan aturan bisnis.

---

# TEAM ISOLATION

Setiap team hanya boleh bekerja pada scope masing-masing.

Tidak boleh mengubah pekerjaan team lain.

Jika membutuhkan perubahan lintas team:

buat interface

bukan implementasi.

---

# GIT STRATEGY

main

↓

integration/v4.2

↓

feature/team-01

feature/team-02

feature/team-03

feature/team-04

feature/team-05

feature/team-06

Tidak boleh merge langsung ke main.

Tidak boleh force push.

---

# CODING STANDARD

Semua file baru wajib:

- small
- readable
- typed
- documented
- tested
- single responsibility

Tidak boleh membuat file 3000+ baris.

---

# DATABASE RULES

Tidak boleh:

DROP TABLE

DROP COLUMN

DELETE DATA

TRUNCATE

Mass UPDATE

Tanpa approval.

Migration harus additive.

---

# API RULES

Tidak boleh:

breaking API

rename endpoint

rename payload

rename response

Jika perlu perubahan:

buat version

atau

buat optional field.

---

# FRONTEND RULES

Frontend tidak boleh:

hardcode service

hardcode pricing

hardcode recommendation

hardcode visibility

Frontend hanya menampilkan data.

Business logic berada di backend.

---

# SECURITY RULES

Seluruh endpoint public wajib:

validate input

authorize

sanitize

rate limit bila diperlukan

Tidak boleh expose:

internal metadata

secret

commercial policy internal

admin note

tenant data
---

# DEVELOPMENT RULES

Seluruh implementasi harus mengikuti prinsip berikut.

## Read Before Write

Sebelum mengubah file:

- baca file terlebih dahulu;
- pahami dependency;
- pahami interface;
- pahami caller;
- pahami test.

Jangan mengubah file yang belum dipahami.

---

## No Blind Refactor

Dilarang melakukan refactor besar hanya karena menemukan kode yang kurang rapi.

Jika refactor tidak termasuk scope:

Catat.

Jangan dikerjakan.

---

## Respect Existing Architecture

Jika project sudah memiliki:

- Repository Layer
- Service Layer
- Validation Layer
- Worker Layer
- Dispatcher
- Runtime
- Shared Types

Gunakan layer tersebut.

Jangan membuat layer baru tanpa alasan.

---

## Reuse Existing Components

Frontend wajib menggunakan komponen yang sudah ada apabila memungkinkan.

Contoh:

✓ Button

✓ Card

✓ Dialog

✓ Sheet

✓ Table

✓ Form

✓ Badge

✓ Tabs

✓ Toast

Jangan membuat komponen baru bila hanya berbeda sedikit.

---

## Avoid Business Logic in UI

UI hanya:

- menampilkan data;
- mengirim input;
- mengatur state.

Business rule berada di backend.

---

# AI AGENT RULES

Seluruh AI Agent wajib bekerja seperti engineer profesional.

Bukan code generator.

Sebelum coding wajib:

1.
Audit.

2.
Pahami struktur.

3.
Cari source of truth.

4.
Cari dependency.

5.
Cari test.

6.
Baru implementasi.

---

## Jangan Berasumsi

Jika belum menemukan fakta di source code:

Jangan mengarang.

Jangan membuat dummy implementation.

Jangan membuat fake integration.

---

## Jangan Hardcode

Dilarang hardcode:

- category id
- service id
- workflow id
- tenant id
- role id
- pricing
- visibility
- status
- AI provider
- model

Gunakan registry atau konfigurasi.

---

## Dependency Injection

Jika project sudah menggunakan DI:

Ikuti pola tersebut.

Jangan instantiate dependency langsung.

---

# FILE ORGANIZATION

Semua file baru wajib memiliki satu tanggung jawab.

Contoh:

serviceDiscovery/

goalService.ts

collectionService.ts

recommendationService.ts

visibilityPolicy.ts

goalSchemas.ts

goalTypes.ts

goalMapper.ts

index.ts

Bukan:

goalEverything.ts

5000 baris.

---

# TYPESCRIPT RULES

Tidak boleh menggunakan:

any

Sebisa mungkin gunakan:

- interface
- type
- union
- generic
- readonly
- branded type bila sudah ada.

---

# VALIDATION

Seluruh input wajib divalidasi.

Gunakan validator project yang sudah ada.

Jangan membuat validator baru bila project sudah memiliki validator.

---

# ERROR HANDLING

Semua error harus:

predictable

typed

consistent

customer safe

Jangan expose:

stack trace

database

internal status

query

secret

---

# LOGGING

Gunakan logger project.

Jangan menggunakan console.log.

Log wajib memiliki level:

debug

info

warn

error

Jangan log data sensitif.

---

# CONFIGURATION

Semua konfigurasi:

- environment
- feature flag
- timeout
- retry
- threshold

harus berasal dari configuration.

Bukan hardcode.

---

# TEST STRATEGY

Semua perubahan wajib memiliki test.

Minimal:

Unit Test.

Jika menyentuh API:

Integration Test.

Jika menyentuh UI:

Component Test bila project sudah memilikinya.

---

# TEST QUALITY

Test harus:

deterministic

isolated

repeatable

fast

Tidak boleh:

bergantung production

bergantung internet

bergantung waktu sistem

bergantung random

tanpa mocking yang tepat.

---

# BUILD QUALITY

Seluruh perubahan wajib lolos:

Backend Test

Frontend Test

Backend Typecheck

Frontend Typecheck

Production Build

Tidak boleh merge bila salah satu gagal.

---

# PERFORMANCE

Jangan membuat:

N+1 query

Loop database

Repeated fetch

Repeated render

Heavy rerender

Gunakan:

memoization

caching

pagination

lazy loading

bila diperlukan.

---

# ACCESSIBILITY

Seluruh UI baru wajib memenuhi:

Keyboard navigation

ARIA label

Focus state

Color contrast

Reduced motion

Touch target

Responsive

Screen reader compatibility

---

# RESPONSIVE DESIGN

Desktop

Laptop

Tablet

Mobile

harus diverifikasi.

Jangan membuat desktop-only.

---

# FEATURE FLAGS

Jika perubahan berisiko:

Gunakan feature flag.

Jangan langsung mengganti perilaku lama tanpa rollback strategy.

---

# DOCUMENTATION

Setiap feature baru wajib memiliki:

Purpose

Architecture

Flow

Dependency

Known Limitation

Future Extension
---

# GIT WORKFLOW

Seluruh team wajib mengikuti strategi Git yang sama.

Tidak boleh membuat workflow sendiri.

Semua perubahan harus dapat ditelusuri.

---

# BRANCH STRATEGY

Branch utama:

main

↓

integration/v4.2

↓

feature/v4.2b-commercial-policy

feature/v4.2c-goal-taxonomy

feature/v4.2d-discovery-ui

feature/v4.2e-service-normalization

feature/v4.2f-analytics-qa

integration/review

Tidak boleh commit langsung ke:

main

integration/v4.2

kecuali Team 6 setelah approval.

---

# COMMIT STRATEGY

Commit kecil.

Commit sering.

Commit jelas.

Contoh:

feat(commercial): add canonical eligibility service

fix(search): apply commercial policy

test(goal): recommendation mapping

docs(v4.2): update architecture notes

Hindari:

update

fix

done

final

---

# PULL REQUEST RULE

Setiap Pull Request wajib memiliki:

## Summary

Apa yang dikerjakan.

## Scope

Apa yang disentuh.

## Out of Scope

Apa yang sengaja tidak disentuh.

## Risk

Risiko merge.

## Test Result

Backend test.

Frontend test.

Typecheck.

Build.

## Screenshot

Jika ada perubahan UI.

---

# FILE OWNERSHIP

Setiap team mempunyai area kepemilikan.

Jika file dimiliki team lain:

Jangan mengubah tanpa alasan.

Gunakan interface.

Jika benar-benar perlu:

Laporkan dalam PR.

---

# CROSS TEAM DEPENDENCY

Jika Team membutuhkan pekerjaan team lain:

Jangan implementasi sendiri.

Gunakan:

interface

contract

mock

sementara.

Contoh:

interface RecommendationProvider {

recommend(...)

}

Implementasi asli nanti di Team 2.

---

# API CONTRACT

Sebelum frontend dibuat:

API contract harus stabil.

Jika backend belum selesai:

gunakan:

mock adapter

bukan fake business logic.

---

# DATABASE OWNERSHIP

Migration hanya boleh dibuat oleh team yang memang memiliki scope database.

Team lain tidak boleh membuat migration sendiri.

Jika membutuhkan field baru:

buat proposal.

---

# MERGE CONFLICT STRATEGY

Jika terjadi conflict:

1.

Jangan resolve sendiri.

2.

Laporkan.

3.

Bandingkan source of truth.

4.

Pilih implementasi yang paling sesuai arsitektur.

5.

Update test.

---

# DUPLICATE LOGIC

Dilarang membuat duplicate logic.

Jika menemukan logic yang sama:

Extract.

Reuse.

Jangan copy paste.

---

# DUPLICATE SOURCE OF TRUTH

Contoh yang dilarang:

Service visibility di backend

+

Service visibility di frontend

Frontend harus membaca backend.

---

# DEPENDENCY MANAGEMENT

Jangan menambah dependency baru kecuali benar-benar diperlukan.

Jika harus:

jelaskan:

Mengapa?

Alternatif?

Ukuran package?

Maintenance?

License?

---

# FEATURE FLAG STRATEGY

Perubahan besar wajib mendukung rollback.

Gunakan feature flag bila memungkinkan.

Jangan menghapus implementasi lama sebelum feature baru stabil.

---

# RELEASE STRATEGY

Development

↓

Integration

↓

Regression

↓

UAT

↓

Production

Tidak boleh melewati tahapan.

---

# CODE REVIEW CHECKLIST

Reviewer wajib memeriksa:

Architecture

Naming

Typing

Security

Validation

Performance

Accessibility

Testing

Backward compatibility

Error handling

---

# REVIEW QUESTIONS

Sebelum approve PR, jawab:

Apakah ada duplicate logic?

Apakah ada hardcode?

Apakah ada regression?

Apakah ada breaking API?

Apakah source of truth tetap satu?

Apakah business rule deterministic?

Apakah test cukup?

Apakah build lolos?

Jika ada satu jawaban "Tidak",

PR tidak boleh di-merge.

---

# SECURITY REVIEW

Pastikan:

Tidak ada secret.

Tidak ada token.

Tidak ada password.

Tidak ada API key.

Tidak ada stack trace.

Tidak ada internal metadata.

Tidak ada tenant leak.

Tidak ada SQL injection.

Tidak ada XSS.

Tidak ada privilege escalation.

---

# BACKWARD COMPATIBILITY REVIEW

Pastikan:

Order lama tetap bisa dibuka.

Invoice lama tetap valid.

Workflow lama tetap berjalan.

Slug lama tetap aktif.

API lama tetap dapat dipanggil.

Service_code tidak berubah.

---

# PERFORMANCE REVIEW

Pastikan:

Tidak ada query berulang.

Tidak ada fetch berulang.

Tidak ada render berulang.

Tidak ada loading yang tidak perlu.

Tidak ada memory leak.

---

# DOCUMENTATION REVIEW

Semua feature baru wajib memiliki:

Architecture

Flow

Known Limitation

Extension Plan

Configuration

Testing Notes

---

# STOP CONDITION

Jika scope selesai:

STOP.

Jangan mulai fase berikutnya.

Jangan menambahkan fitur baru.

Jangan memperbaiki bug di luar scope.

Catat saja.

Tunggu approval owner.
---

# QUALITY ASSURANCE (QA)

Tidak ada fitur yang dianggap selesai hanya karena sudah bisa berjalan.

Sebuah fitur dianggap selesai apabila:

✓ Scope selesai

✓ Unit Test selesai

✓ Integration Test selesai (jika diperlukan)

✓ Typecheck lolos

✓ Production Build lolos

✓ Manual Verification selesai

✓ Review Team 6 selesai

✓ Approval Owner diberikan

---

# DEFINITION OF DONE (DoD)

Sebuah task dinyatakan DONE apabila seluruh poin berikut terpenuhi.

## Functional

- Semua requirement pada scope telah selesai.
- Tidak ada fitur utama yang tertinggal.
- Tidak ada TODO yang mempengaruhi fungsi utama.

---

## Technical

- Tidak ada TypeScript error baru.
- Tidak ada lint error baru (jika lint digunakan).
- Tidak ada dependency yang tidak terpakai.
- Tidak ada console.log.
- Tidak ada any tanpa alasan.

---

## Testing

Minimal:

✓ Unit Test

Jika menyentuh API:

✓ Integration Test

Jika menyentuh UI:

✓ Component/UI Verification

---

## Build

Seluruh project wajib berhasil:

- Backend Build
- Frontend Build
- Shared Library Build
- Customer Portal Build
- Admin Portal Build

---

# MANUAL VERIFICATION

Setiap team wajib melakukan verifikasi manual.

Checklist minimal:

□ Happy Path

□ Error Path

□ Empty State

□ Loading State

□ Mobile

□ Desktop

□ Accessibility

□ Authorization

□ Backward Compatibility

Jangan hanya mengandalkan unit test.

---

# REGRESSION POLICY

Jika menemukan regression:

STOP.

Jangan lanjut implementasi.

Perbaiki regression terlebih dahulu.

Jika regression berada di luar scope:

Catat.

Laporkan.

Jangan memperbaiki tanpa persetujuan.

---

# OWNER APPROVAL

Perubahan berikut WAJIB mendapat approval owner:

- Rename service_code
- Menghapus endpoint
- Mengubah database existing
- Mengubah workflow production
- Mengubah pricing production
- Mengubah runtime V4.0 / V4.1
- Mengubah public contract API
- Menghapus fitur customer

---

# CHANGELOG

Setiap team wajib membuat changelog.

Format:

## Added

## Changed

## Fixed

## Removed (hanya jika disetujui)

## Known Limitation

## Future Improvement

---

# FINAL REPORT FORMAT

Setelah scope selesai, WAJIB membuat laporan dengan format berikut.

# FINAL REPORT

## Executive Summary

Jelaskan secara singkat apa yang dikerjakan.

---

## Scope Completed

Daftar requirement yang selesai.

---

## Files Changed

Tampilkan seluruh file yang berubah.

Kelompokkan:

Backend

Frontend

Shared

Tests

Documentation

---

## API Changes

Endpoint baru

Endpoint berubah

Payload baru

Response baru

Backward compatibility

---

## Database

Migration

Schema

Seed

Configuration

Jika tidak ada:

Tulis:

No database changes.

---

## Tests

Backend Test

Frontend Test

Integration Test

Manual Verification

---

## Typecheck

Backend

Frontend

Shared

---

## Production Build

Backend

Frontend

Shared

---

## Security Review

Input Validation

Authorization

Sanitization

Sensitive Data

Rate Limiting

Tenant Isolation

---

## Accessibility Review

Keyboard

ARIA

Contrast

Responsive

Reduced Motion

Screen Reader

---

## Performance Review

Database

Rendering

Caching

Network

Lazy Loading

---

## Backward Compatibility

API

Orders

Workflow

Service Code

Slug

Projects

---

## Known Limitation

Tuliskan secara jujur.

Jangan menyembunyikan keterbatasan.

---

## Remaining Risks

Tuliskan risiko yang masih ada.

---

## Recommendations

Rekomendasi fase berikutnya.

---

# NO GOLD PLATING

Dilarang menambahkan fitur yang tidak diminta.

Contoh:

User meminta:

Goal Taxonomy

Jangan sekaligus membuat:

CRM

Chat

Analytics

AI Agent baru

Dashboard baru

Karena:

Out of scope.

---

# HONESTY POLICY

Jika sesuatu belum selesai:

Tulis:

BELUM SELESAI.

Jika tidak sempat:

Tulis:

NOT IMPLEMENTED.

Jika hanya prototype:

Tulis:

PROTOTYPE.

Jangan pernah menulis:

"Complete"

apabila sebenarnya belum selesai.

---

# AI ETHICS

AI Agent wajib:

- Jujur.
- Tidak mengarang implementasi.
- Tidak membuat fake report.
- Tidak mengklaim test yang tidak dijalankan.
- Tidak mengklaim build yang tidak dijalankan.
- Tidak mengklaim manual verification yang tidak dilakukan.

Semua laporan harus dapat diverifikasi.

---

# STOP CONDITION

MASTER RULE selesai.

Setelah membaca dokumen ini:

Setiap Team hanya boleh mengerjakan prompt miliknya.

Tidak boleh mengerjakan prompt team lain.

Tidak boleh memulai fase berikutnya.

Tidak boleh merge ke main.

Tunggu review Team 6.

Setelah Team 6 menyatakan seluruh requirement terpenuhi dan owner memberikan persetujuan, barulah merge ke branch integration/v4.2.

Hanya setelah integration/v4.2 lolos regression dan UAT, perubahan boleh di-merge ke main.

---

# END OF MASTER-00

Version: 1.0

Status: ACTIVE

Document Owner:
Project Architecture

Applies To:
Team 1
Team 2
Team 3
Team 4
Team 5
Team 6