/**
 * Team 17 — Interior Design Planning — Customer Brief Submission
 * Multi-step wizard: room type → dimensions → structural elements → style → needs → review
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { ArrowLeft, ArrowRight, Sofa, Loader2, CheckCircle, AlertTriangle, Home } from "lucide-react";

const ROOM_TYPES = [
  { value: "living_room", label: "Ruang Tamu", emoji: "🛋️" },
  { value: "bedroom", label: "Kamar Tidur", emoji: "🛏️" },
  { value: "kitchen", label: "Dapur", emoji: "🍳" },
  { value: "office", label: "Ruang Kerja", emoji: "💼" },
  { value: "cafe", label: "Kafe", emoji: "☕" },
  { value: "restaurant", label: "Restoran", emoji: "🍽️" },
  { value: "hotel", label: "Kamar Hotel", emoji: "🏨" },
  { value: "lobby", label: "Lobi / Resepsi", emoji: "🏢" },
  { value: "booth", label: "Booth / Pameran", emoji: "🏪" },
] as const;

const STYLES = [
  { value: "modern", label: "Modern" },
  { value: "minimalist", label: "Minimalis" },
  { value: "scandinavian", label: "Skandinavia" },
  { value: "industrial", label: "Industrial" },
  { value: "traditional", label: "Tradisional" },
  { value: "rustic", label: "Rustic" },
  { value: "art_deco", label: "Art Deco" },
  { value: "japandi", label: "Japandi" },
  { value: "tropical", label: "Tropis" },
  { value: "mediterranean", label: "Mediterania" },
] as const;

const COMMON_FURNITURE = [
  "Sofa", "Meja Kopi", "TV Cabinet", "Lemari Pakaian",
  "Meja Makan", "Kursi Makan", "Tempat Tidur", "Nakas",
  "Meja Kerja", "Kursi Kerja", "Rak Buku", "Lemari Pajangan",
  "Meja Bar", "Bangku Bar", "Sofa Corner", "Chaise Lounge",
];

interface BriefForm {
  title: string;
  clientName: string;
  clientEmail: string;
  roomType: string;
  roomLengthM: string;
  roomWidthM: string;
  ceilingHeightM: string;
  doorsCount: string;
  windowsCount: string;
  hasColumns: boolean;
  hasImmutableZones: boolean;
  immutableZoneNotes: string;
  style: string;
  primaryColors: string[];
  secondaryColors: string[];
  flooringPreference: string;
  wallsPreference: string;
  lightingAmbient: string;
  lightingTask: string;
  furnitureNeeds: string[];
  customFurniture: string;
  budgetNotes: string;
  photoUrls: string;
  floorPlanUrl: string;
  additionalNotes: string;
}

const INITIAL_FORM: BriefForm = {
  title: "",
  clientName: "",
  clientEmail: "",
  roomType: "",
  roomLengthM: "",
  roomWidthM: "",
  ceilingHeightM: "2.8",
  doorsCount: "1",
  windowsCount: "1",
  hasColumns: false,
  hasImmutableZones: false,
  immutableZoneNotes: "",
  style: "",
  primaryColors: [],
  secondaryColors: [],
  flooringPreference: "",
  wallsPreference: "",
  lightingAmbient: "",
  lightingTask: "",
  furnitureNeeds: [],
  customFurniture: "",
  budgetNotes: "",
  photoUrls: "",
  floorPlanUrl: "",
  additionalNotes: "",
};

const COLOR_SWATCHES = [
  { label: "Putih", hex: "#FFFFFF" },
  { label: "Krem", hex: "#F5F0E8" },
  { label: "Beige", hex: "#E8DCC8" },
  { label: "Abu Muda", hex: "#D0D0D0" },
  { label: "Abu Tua", hex: "#6B7280" },
  { label: "Hitam", hex: "#1A1A1A" },
  { label: "Navy", hex: "#1E3A5F" },
  { label: "Biru Teal", hex: "#2C7873" },
  { label: "Hijau Sage", hex: "#87A989" },
  { label: "Terrakota", hex: "#C07D59" },
  { label: "Coklat Hangat", hex: "#8B5E3C" },
  { label: "Kuning Mustard", hex: "#D4A017" },
];

function ColorPicker({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: string[];
  onChange: (colors: string[]) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        {COLOR_SWATCHES.map((sw) => (
          <button
            key={sw.hex}
            type="button"
            title={sw.label}
            onClick={() => {
              if (selected.includes(sw.hex)) {
                onChange(selected.filter((c) => c !== sw.hex));
              } else if (selected.length < 3) {
                onChange([...selected, sw.hex]);
              }
            }}
            className="relative w-8 h-8 rounded-full border-2 transition-all hover:scale-110"
            style={{
              backgroundColor: sw.hex,
              borderColor: selected.includes(sw.hex) ? "#7C6EFA" : "rgba(255,255,255,0.15)",
              boxShadow: selected.includes(sw.hex) ? "0 0 0 2px rgba(124,110,250,0.5)" : "none",
            }}
          />
        ))}
      </div>
      {selected.length > 0 && (
        <p className="text-xs mt-1" style={{ color: "#5A6B8C" }}>
          Dipilih: {selected.map((c) => COLOR_SWATCHES.find((s) => s.hex === c)?.label ?? c).join(", ")}
        </p>
      )}
    </div>
  );
}

const STEPS = [
  { id: 1, title: "Jenis Ruang" },
  { id: 2, title: "Dimensi" },
  { id: 3, title: "Elemen Struktural" },
  { id: 4, title: "Gaya & Warna" },
  { id: 5, title: "Kebutuhan" },
  { id: 6, title: "Review" },
];

export default function InteriorDesignBriefPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<BriefForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof BriefForm>(k: K, v: BriefForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function toggleFurniture(item: string) {
    set(
      "furnitureNeeds",
      form.furnitureNeeds.includes(item)
        ? form.furnitureNeeds.filter((i) => i !== item)
        : [...form.furnitureNeeds, item],
    );
  }

  function canProceed(): boolean {
    switch (step) {
      case 1: return !!form.roomType && !!form.title;
      case 2:
        return (
          !!form.roomLengthM &&
          !!form.roomWidthM &&
          !!form.ceilingHeightM &&
          parseFloat(form.roomLengthM) > 0 &&
          parseFloat(form.roomWidthM) > 0 &&
          parseFloat(form.ceilingHeightM) > 0
        );
      case 3: return true;
      case 4: return !!form.style;
      case 5: return true;
      default: return true;
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    const furniture = [...form.furnitureNeeds];
    if (form.customFurniture.trim()) {
      furniture.push(...form.customFurniture.split(",").map((s) => s.trim()).filter(Boolean));
    }

    const photoUrls = form.photoUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);

    // Build minimal door array
    const doorsCount = parseInt(form.doorsCount) || 1;
    const doors = Array.from({ length: doorsCount }, (_, i) => ({
      id: `d${i + 1}`,
      wall: "north" as const,
      positionM: 0.5 + i * 1.5,
      widthM: 0.9,
      swingInward: true,
    }));

    // Build minimal window array
    const windowsCount = parseInt(form.windowsCount) || 1;
    const windows = Array.from({ length: windowsCount }, (_, i) => ({
      id: `w${i + 1}`,
      wall: "south" as const,
      positionM: 0.5 + i * 1.5,
      widthM: 1.2,
      sillHeightM: 0.9,
      headHeightM: 2.1,
    }));

    try {
      const res = await fetch("/api/public/interior-design/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          roomType: form.roomType,
          clientName: form.clientName || undefined,
          clientEmail: form.clientEmail || undefined,
          notes: form.additionalNotes || undefined,
          brief: {
            roomLengthM: parseFloat(form.roomLengthM),
            roomWidthM: parseFloat(form.roomWidthM),
            ceilingHeightM: parseFloat(form.ceilingHeightM),
            doors,
            windows,
            style: form.style,
            primaryColors: form.primaryColors,
            secondaryColors: form.secondaryColors,
            materialsPreference: {
              flooring: form.flooringPreference || undefined,
              walls: form.wallsPreference || undefined,
            },
            lightingPreference: {
              ambient: form.lightingAmbient || undefined,
              task: form.lightingTask || undefined,
            },
            furnitureNeeds: furniture,
            budgetNotes: form.budgetNotes || undefined,
            photoUrls,
            floorPlanUrl: form.floorPlanUrl || undefined,
            additionalNotes: form.additionalNotes || undefined,
          },
        }),
      });

      const data = (await res.json()) as { project?: { id: number }; accessToken?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      // Project page is token-gated — use accessToken (UUID), never numeric id
      const token = data.accessToken;
      if (!token) throw new Error("No access token returned");

      navigate(`/interior-design/${token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setSubmitting(false);
    }
  }

  const roomLabel = ROOM_TYPES.find((r) => r.value === form.roomType)?.label ?? "";

  return (
    <Layout>
      <div className="min-h-screen" style={{ background: "#060B18" }}>
        <div className="container mx-auto px-4 py-12 max-w-3xl">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-1.5 text-sm mb-6 transition-colors hover:opacity-80"
              style={{ color: "#8B9BC4" }}
            >
              <ArrowLeft className="w-4 h-4" />
              Kembali
            </button>
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}
              >
                <Home className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-white">Interior Design Brief</h1>
            </div>
            <p style={{ color: "#8B9BC4" }}>
              Ceritakan kebutuhan desain interior Anda — kami akan menyiapkan konsep yang tepat.
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
            {STEPS.map((s, idx) => (
              <div key={s.id} className="flex items-center gap-1 flex-shrink-0">
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={{
                    background:
                      step === s.id
                        ? "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)"
                        : step > s.id
                          ? "rgba(124,110,250,0.15)"
                          : "rgba(255,255,255,0.05)",
                    color: step === s.id ? "#fff" : step > s.id ? "#7C6EFA" : "#5A6B8C",
                  }}
                >
                  {step > s.id ? <CheckCircle className="w-3 h-3" /> : <span>{s.id}</span>}
                  {s.title}
                </div>
                {idx < STEPS.length - 1 && (
                  <div className="w-4 h-px" style={{ background: "rgba(255,255,255,0.1)" }} />
                )}
              </div>
            ))}
          </div>

          {/* Card */}
          <div
            className="rounded-2xl p-8"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {/* Step 1: Room type + project name */}
            {step === 1 && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-white">Pilih Jenis Ruang</h2>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>
                    Nama Proyek *
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder="contoh: Renovasi Ruang Tamu Apartemen BSD"
                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {ROOM_TYPES.map((rt) => (
                    <button
                      key={rt.value}
                      type="button"
                      onClick={() => set("roomType", rt.value)}
                      className="p-4 rounded-xl text-center transition-all hover:scale-102"
                      style={{
                        background:
                          form.roomType === rt.value
                            ? "linear-gradient(135deg, rgba(124,110,250,0.2) 0%, rgba(95,82,208,0.2) 100%)"
                            : "rgba(255,255,255,0.04)",
                        border:
                          form.roomType === rt.value
                            ? "1px solid rgba(124,110,250,0.6)"
                            : "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <div className="text-2xl mb-1">{rt.emoji}</div>
                      <div
                        className="text-xs font-medium"
                        style={{ color: form.roomType === rt.value ? "#7C6EFA" : "#8B9BC4" }}
                      >
                        {rt.label}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>Nama Klien (opsional)</label>
                    <input
                      type="text"
                      value={form.clientName}
                      onChange={(e) => set("clientName", e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>Email Klien (opsional)</label>
                    <input
                      type="email"
                      value={form.clientEmail}
                      onChange={(e) => set("clientEmail", e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Dimensions */}
            {step === 2 && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-white">Dimensi Ruangan</h2>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { key: "roomLengthM", label: "Panjang (m)", placeholder: "mis. 6.0" },
                    { key: "roomWidthM", label: "Lebar (m)", placeholder: "mis. 4.5" },
                    { key: "ceilingHeightM", label: "Tinggi Plafon (m)", placeholder: "mis. 2.8" },
                  ].map(({ key, label, placeholder }) => (
                    <div key={key}>
                      <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>{label} *</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={form[key as keyof BriefForm] as string}
                        onChange={(e) => set(key as keyof BriefForm, e.target.value as never)}
                        placeholder={placeholder}
                        className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                      />
                    </div>
                  ))}
                </div>
                {form.roomLengthM && form.roomWidthM && (
                  <div className="p-4 rounded-xl" style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.15)" }}>
                    <p className="text-sm" style={{ color: "#7C6EFA" }}>
                      📐 Luas: <strong>{(parseFloat(form.roomLengthM) * parseFloat(form.roomWidthM)).toFixed(1)} m²</strong>
                      {" "} — {form.roomLengthM}m × {form.roomWidthM}m × {form.ceilingHeightM}m tinggi
                    </p>
                  </div>
                )}
                <div className="p-4 rounded-xl" style={{ background: "rgba(255,200,0,0.06)", border: "1px solid rgba(255,200,0,0.1)" }}>
                  <p className="text-sm" style={{ color: "#C9A227" }}>
                    ⚠️ Dimensi adalah perkiraan desain. Pengukuran lapangan oleh profesional tetap diperlukan sebelum produksi.
                  </p>
                </div>
              </div>
            )}

            {/* Step 3: Structural elements */}
            {step === 3 && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-white">Elemen Struktural</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>Jumlah Pintu</label>
                    <select
                      value={form.doorsCount}
                      onChange={(e) => set("doorsCount", e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n} style={{ background: "#111827" }}>{n} pintu</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>Jumlah Jendela</label>
                    <select
                      value={form.windowsCount}
                      onChange={(e) => set("windowsCount", e.target.value)}
                      className="w-full px-4 py-3 rounded-xl text-white outline-none focus:ring-2 focus:ring-purple-500"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      {[0, 1, 2, 3, 4, 6].map((n) => (
                        <option key={n} value={n} style={{ background: "#111827" }}>{n} jendela</option>
                      ))}
                    </select>
                  </div>
                </div>
                {[
                  { key: "hasColumns", label: "Ada kolom struktural di dalam ruangan?" },
                  { key: "hasImmutableZones", label: "Ada zona yang tidak bisa diubah (mis. saluran AC, shaft, tangga)?" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <span className="text-sm text-white">{label}</span>
                    <button
                      type="button"
                      onClick={() => set(key as keyof BriefForm, !form[key as keyof BriefForm] as never)}
                      className="w-12 h-6 rounded-full transition-all relative"
                      style={{
                        background: form[key as keyof BriefForm] ? "#7C6EFA" : "rgba(255,255,255,0.1)",
                      }}
                    >
                      <div
                        className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all"
                        style={{ left: form[key as keyof BriefForm] ? "28px" : "4px" }}
                      />
                    </button>
                  </div>
                ))}
                {form.hasImmutableZones && (
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>Deskripsi zona tidak berubah</label>
                    <textarea
                      value={form.immutableZoneNotes}
                      onChange={(e) => set("immutableZoneNotes", e.target.value)}
                      rows={3}
                      placeholder="mis. Kolom 0.4×0.4m di sudut kiri depan, saluran AC di plafon"
                      className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Step 4: Style + Colors */}
            {step === 4 && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-white">Gaya & Warna</h2>
                <div>
                  <label className="block text-sm font-medium mb-3" style={{ color: "#8B9BC4" }}>Gaya Desain *</label>
                  <div className="grid grid-cols-2 gap-2">
                    {STYLES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => set("style", s.value)}
                        className="px-4 py-2.5 rounded-xl text-sm font-medium text-left transition-all"
                        style={{
                          background:
                            form.style === s.value
                              ? "linear-gradient(135deg, rgba(124,110,250,0.25) 0%, rgba(95,82,208,0.25) 100%)"
                              : "rgba(255,255,255,0.04)",
                          border: form.style === s.value ? "1px solid rgba(124,110,250,0.6)" : "1px solid rgba(255,255,255,0.08)",
                          color: form.style === s.value ? "#7C6EFA" : "#8B9BC4",
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <ColorPicker
                  label="Warna Utama (maks. 3)"
                  selected={form.primaryColors}
                  onChange={(c) => set("primaryColors", c)}
                />
                <ColorPicker
                  label="Warna Aksen (opsional, maks. 3)"
                  selected={form.secondaryColors}
                  onChange={(c) => set("secondaryColors", c)}
                />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>Preferensi Lantai</label>
                    <input
                      type="text"
                      value={form.flooringPreference}
                      onChange={(e) => set("flooringPreference", e.target.value)}
                      placeholder="mis. Parket kayu, keramik 60×60"
                      className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>Preferensi Dinding</label>
                    <input
                      type="text"
                      value={form.wallsPreference}
                      onChange={(e) => set("wallsPreference", e.target.value)}
                      placeholder="mis. Cat, wallpaper, bata ekspos"
                      className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 5: Furniture + needs */}
            {step === 5 && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-white">Kebutuhan Furnitur & Pencahayaan</h2>
                <div>
                  <label className="block text-sm font-medium mb-3" style={{ color: "#8B9BC4" }}>
                    Furnitur yang Dibutuhkan
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {COMMON_FURNITURE.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleFurniture(item)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                        style={{
                          background: form.furnitureNeeds.includes(item)
                            ? "rgba(124,110,250,0.2)"
                            : "rgba(255,255,255,0.05)",
                          border: form.furnitureNeeds.includes(item)
                            ? "1px solid rgba(124,110,250,0.5)"
                            : "1px solid rgba(255,255,255,0.08)",
                          color: form.furnitureNeeds.includes(item) ? "#7C6EFA" : "#8B9BC4",
                        }}
                      >
                        {form.furnitureNeeds.includes(item) ? "✓ " : ""}
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>
                    Furnitur lain (pisahkan dengan koma)
                  </label>
                  <input
                    type="text"
                    value={form.customFurniture}
                    onChange={(e) => set("customFurniture", e.target.value)}
                    placeholder="mis. Hammock, piano, aquarium"
                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>Pencahayaan Utama</label>
                    <input
                      type="text"
                      value={form.lightingAmbient}
                      onChange={(e) => set("lightingAmbient", e.target.value)}
                      placeholder="mis. Hangat 2700K, terang natural"
                      className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>Pencahayaan Kerja</label>
                    <input
                      type="text"
                      value={form.lightingTask}
                      onChange={(e) => set("lightingTask", e.target.value)}
                      placeholder="mis. LED strip dapur, lampu meja"
                      className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>
                    Catatan Anggaran (opsional — tidak ada perhitungan harga)
                  </label>
                  <input
                    type="text"
                    value={form.budgetNotes}
                    onChange={(e) => set("budgetNotes", e.target.value)}
                    placeholder="mis. Mid-range, prioritaskan sofa berkualitas"
                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>
                    URL Foto Ruangan (satu per baris, opsional)
                  </label>
                  <textarea
                    value={form.photoUrls}
                    onChange={(e) => set("photoUrls", e.target.value)}
                    rows={2}
                    placeholder="https://storage.example.com/photo1.jpg"
                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>URL Denah Lantai (opsional)</label>
                  <input
                    type="text"
                    value={form.floorPlanUrl}
                    onChange={(e) => set("floorPlanUrl", e.target.value)}
                    placeholder="https://storage.example.com/floor-plan.jpg"
                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: "#8B9BC4" }}>Catatan Tambahan</label>
                  <textarea
                    value={form.additionalNotes}
                    onChange={(e) => set("additionalNotes", e.target.value)}
                    rows={3}
                    placeholder="Informasi lain yang perlu kami ketahui..."
                    className="w-full px-4 py-3 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  />
                </div>
              </div>
            )}

            {/* Step 6: Review */}
            {step === 6 && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-white">Review Brief Anda</h2>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Proyek", value: form.title },
                    { label: "Jenis Ruang", value: roomLabel },
                    { label: "Dimensi", value: `${form.roomLengthM}m × ${form.roomWidthM}m × ${form.ceilingHeightM}m` },
                    { label: "Gaya", value: STYLES.find((s) => s.value === form.style)?.label ?? form.style },
                    { label: "Pintu / Jendela", value: `${form.doorsCount} pintu, ${form.windowsCount} jendela` },
                    { label: "Furnitur", value: form.furnitureNeeds.length > 0 ? `${form.furnitureNeeds.length} item` : "Tidak dipilih" },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="p-3 rounded-xl"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <p className="text-xs mb-0.5" style={{ color: "#5A6B8C" }}>{label}</p>
                      <p className="text-sm font-medium text-white">{value || "—"}</p>
                    </div>
                  ))}
                </div>
                {error && (
                  <div className="p-4 rounded-xl flex items-center gap-2" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <p className="text-sm text-red-400">{error}</p>
                  </div>
                )}
                <div className="p-4 rounded-xl" style={{ background: "rgba(255,200,0,0.06)", border: "1px solid rgba(255,200,0,0.1)" }}>
                  <p className="text-xs font-medium mb-1" style={{ color: "#C9A227" }}>⚠️ Catatan Penting</p>
                  <p className="text-xs" style={{ color: "#9A7B2A" }}>
                    Output yang dihasilkan adalah <strong>konsep desain interior</strong> — bukan gambar konstruksi dan tidak termasuk perhitungan RAB/harga.
                    Survey lapangan oleh profesional tetap diperlukan sebelum pelaksanaan.
                  </p>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={step === 1}
                className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-30 flex items-center gap-2"
                style={{ background: "rgba(255,255,255,0.06)", color: "#8B9BC4", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <ArrowLeft className="w-4 h-4" />
                Sebelumnya
              </button>

              {step < STEPS.length ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => s + 1)}
                  disabled={!canProceed()}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 flex items-center gap-2 text-white"
                  style={{ background: canProceed() ? "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" : "rgba(124,110,250,0.3)" }}
                >
                  Selanjutnya
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 flex items-center gap-2 text-white"
                  style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Mengirim...
                    </>
                  ) : (
                    <>
                      <Sofa className="w-4 h-4" />
                      Kirim Brief
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
