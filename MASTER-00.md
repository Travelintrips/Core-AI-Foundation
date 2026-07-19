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
