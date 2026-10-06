-- Customer-facing discovery seed.
-- Idempotent and deterministic: familiar goals/solution packages mapped to existing service codes.

SET search_path TO ai_platform, public;

INSERT INTO ai_goals (slug,name,description,icon,display_order,status,metadata_json) VALUES
('buat-brand-baru','Buat Brand Baru','Logo, identitas merek, dan strategi brand untuk memulai atau merapikan brand.','sparkles',1,'active','{"keywords":["brand","logo","merek"]}'::jsonb),
('buat-konten-promosi','Buat Konten & Promosi','Konten media sosial, copy, visual promosi, poster, dan banner.','megaphone',2,'active','{"keywords":["konten","promosi","sosial media"]}'::jsonb),
('buat-presentasi-bisnis','Buat Presentasi & Dokumen Bisnis','Pitch deck, company profile, proposal, dan dokumen bisnis yang siap dipakai.','file-text',3,'active','{"keywords":["presentasi","proposal","company profile"]}'::jsonb),
('buat-katalog-produk','Buat Katalog / Materi Produk','Katalog produk, product sheet, kemasan, dan materi komersial untuk penjualan.','package',4,'active','{"keywords":["katalog produk","kemasan","produk"]}'::jsonb),
('desain-interior','Desain Interior','Konsep desain ruangan, gaya, material, dan visual interior.','home',5,'active','{"keywords":["interior","ruangan","rumah"]}'::jsonb),
('desain-fashion','Desain Fashion','Konsep koleksi, arah gaya, dan materi visual untuk fashion.','shirt',6,'active','{"keywords":["fashion","baju","pakaian"]}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
name=excluded.name,description=excluded.description,icon=excluded.icon,display_order=excluded.display_order,
status='active',metadata_json=excluded.metadata_json,updated_at=now();

WITH m(goal_slug,service_code,relevance_score,display_order,is_primary) AS (VALUES
('buat-brand-baru','brand-identity',100,1,true),('buat-brand-baru','logo-design',95,2,false),('buat-brand-baru','brand-strategy',90,3,false),
('buat-konten-promosi','social-media-design',100,1,true),('buat-konten-promosi','copywriting',95,2,false),('buat-konten-promosi','image-generation',90,3,false),('buat-konten-promosi','poster-banner',85,4,false),
('buat-presentasi-bisnis','pitch-deck',100,1,true),('buat-presentasi-bisnis','company-profile',95,2,false),('buat-presentasi-bisnis','proposal',90,3,false),
('buat-katalog-produk','product-catalog',100,1,true),('buat-katalog-produk','packaging-design',90,2,false),('buat-katalog-produk','social-media-design',75,3,false),
('desain-interior','interior-concept-design',100,1,true),('desain-fashion','fashion-brand-brief',100,1,true))
INSERT INTO ai_goal_service_mappings(goal_id,service_id,relevance_score,display_order,is_primary,status)
SELECT g.id,s.id,m.relevance_score,m.display_order,m.is_primary,'active'
FROM m JOIN ai_goals g ON g.slug=m.goal_slug JOIN ai_services s ON s.service_code=m.service_code AND s.status='active'
ON CONFLICT (goal_id,service_id) DO UPDATE SET
relevance_score=excluded.relevance_score,display_order=excluded.display_order,is_primary=excluded.is_primary,status='active',updated_at=now();

INSERT INTO solution_collections(code,slug,name,short_description,status,visibility,display_order) VALUES
('sc_brand_launch','paket-launching-brand','Paket Launching Brand','Logo, identitas merek, dan strategi brand dalam satu rangkaian.','active','public',1),
('sc_product_promo','paket-promosi-produk','Paket Promosi Produk','Katalog produk, kemasan, konten media sosial, dan copy promosi.','active','public',2),
('sc_business_docs','paket-presentasi-bisnis','Paket Presentasi Bisnis','Pitch deck, company profile, dan proposal bisnis.','active','public',3)
ON CONFLICT (slug) DO UPDATE SET name=excluded.name,short_description=excluded.short_description,status='active',
visibility='public',display_order=excluded.display_order,updated_at=now();

WITH m(collection_slug,service_code,display_order,role,is_optional) AS (VALUES
('paket-launching-brand','brand-identity',1,'anchor',false),('paket-launching-brand','logo-design',2,'complementary',false),('paket-launching-brand','brand-strategy',3,'complementary',true),
('paket-promosi-produk','product-catalog',1,'anchor',false),('paket-promosi-produk','packaging-design',2,'complementary',true),('paket-promosi-produk','social-media-design',3,'complementary',true),('paket-promosi-produk','copywriting',4,'optional',true),
('paket-presentasi-bisnis','pitch-deck',1,'anchor',false),('paket-presentasi-bisnis','company-profile',2,'complementary',true),('paket-presentasi-bisnis','proposal',3,'optional',true))
INSERT INTO solution_collection_services(collection_id,service_id,display_order,role,is_optional)
SELECT c.id,s.id,m.display_order,m.role,m.is_optional
FROM m JOIN solution_collections c ON c.slug=m.collection_slug JOIN ai_services s ON s.service_code=m.service_code AND s.status='active'
ON CONFLICT (collection_id,service_id) DO UPDATE SET
display_order=excluded.display_order,role=excluded.role,is_optional=excluded.is_optional;
