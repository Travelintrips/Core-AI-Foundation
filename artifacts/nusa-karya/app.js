const categories = [
  ["🎨","Seni","Lukisan & visual"],
  ["🧵","Kriya","Handmade & crochet"],
  ["👘","Fesyen","Batik & pakaian"],
  ["🪑","Interior","Furnitur & dekorasi"],
  ["🎭","Pertunjukan","Teater & tiket"],
  ["♫","Musik","Lagu & karya audio"],
];
const works = [
  {title:"Senja di Ubud",creator:"Made Arta",city:"Bali",cat:"Seni",price:"Rp 4.800.000",likes:1248,img:"https://images.unsplash.com/photo-1541961017774-22349e4a1262?auto=format&fit=crop&w=900&q=82",h:"tall"},
  {title:"Kebaya Sagara",creator:"Raras Studio",city:"Yogyakarta",cat:"Fesyen",price:"Rp 1.250.000",likes:892,img:"https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=900&q=82"},
  {title:"Kursi Lengkung Jepara",creator:"Ruang Kayu",city:"Jepara",cat:"Interior",price:"Rp 3.900.000",likes:645,img:"https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=900&q=82"},
  {title:"Boneka Rajut Nusantara",creator:"Benang Cerita",city:"Bandung",cat:"Kriya",price:"Rp 385.000",likes:1533,img:"https://images.unsplash.com/photo-1615486364134-62a4c72c822d?auto=format&fit=crop&w=900&q=82"},
  {title:"Fragmen: Rumah",creator:"Kolektif Layar",city:"Jakarta",cat:"Pertunjukan",price:"Mulai Rp 175.000",likes:478,img:"https://images.unsplash.com/photo-1507924538820-ede94a04019d?auto=format&fit=crop&w=900&q=82"},
  {title:"Nada dari Timur",creator:"Aru Sounds",city:"Ambon",cat:"Musik",price:"Rp 79.000",likes:2104,img:"https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=900&q=82"},
  {title:"Topeng Kayu Kuno",creator:"Sanggar Tilik",city:"Solo",cat:"Kriya",price:"Rp 1.800.000",likes:730,img:"https://images.unsplash.com/photo-1564399579883-451a5d44ec08?auto=format&fit=crop&w=900&q=82"},
  {title:"Batik Pesisir 01",creator:"Laras Pesisir",city:"Pekalongan",cat:"Fesyen",price:"Rp 890.000",likes:1180,img:"https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=82"},
  {title:"Ruang Dalam #7",creator:"Ayunda Pramesti",city:"Surabaya",cat:"Seni",price:"Rp 6.200.000",likes:966,img:"https://images.unsplash.com/photo-1578301978018-3005759f48f7?auto=format&fit=crop&w=900&q=82"},
  {title:"Meja Kopi Akar",creator:"Kayu Pulih",city:"Semarang",cat:"Interior",price:"Rp 2.750.000",likes:523,img:"https://images.unsplash.com/photo-1532372320572-cda25653a694?auto=format&fit=crop&w=900&q=82"},
];
const state={query:"",category:"Semua",saved:new Set()};

const categoryList=document.querySelector("#categoryList");
const artGrid=document.querySelector("#artGrid");
const drawer=document.querySelector("#drawer");
const drawerContent=document.querySelector("#drawerContent");

function renderCategories(){
  categoryList.innerHTML=categories.map(([emoji,name,desc])=>`
    <button class="category" data-category="${name}">
      <span class="emoji">${emoji}</span><strong>${name}</strong><small>${desc}</small>
    </button>`).join("");
}
function visibleWorks(){
  return works.filter(w=>{
    const text=`${w.title} ${w.creator} ${w.city} ${w.cat}`.toLowerCase();
    return (state.category==="Semua"||w.cat===state.category) && text.includes(state.query.toLowerCase());
  });
}
function renderWorks(){
  const list=visibleWorks();
  artGrid.innerHTML=list.length?list.map((w,i)=>`
    <article class="card">
      <div class="card-image">
        <img src="${w.img}" alt="${w.title}" loading="lazy" />
        <span class="badge">${w.cat.toUpperCase()}</span>
        <button class="save ${state.saved.has(w.title)?"saved":""}" data-save="${w.title}" aria-label="Simpan ${w.title}">♡</button>
      </div>
      <div class="card-body">
        <div class="creator"><span class="avatar">${w.creator[0]}</span><span>${w.creator} · ${w.city}</span></div>
        <h3>${w.title}</h3>
        <div class="meta"><span>♡ ${w.likes.toLocaleString("id-ID")}</span><span>Tawaran via DM</span></div>
        <div class="price">${w.price}</div>
      </div>
    </article>`).join(""):`<div class="empty">Belum ada karya yang cocok dengan pencarian ini.</div>`;
}
function openDrawer(title,html){
  drawerContent.innerHTML=`<p class="eyebrow">NUSA KARYA</p><h2>${title}</h2>${html}`;
  drawer.classList.add("open"); drawer.setAttribute("aria-hidden","false");
}
function closeDrawer(){drawer.classList.remove("open");drawer.setAttribute("aria-hidden","true")}
document.addEventListener("click",e=>{
  const cat=e.target.closest("[data-category]");
  if(cat){state.category=cat.dataset.category;document.querySelector("#explore").scrollIntoView();renderWorks()}
  const save=e.target.closest("[data-save]");
  if(save){const id=save.dataset.save;state.saved.has(id)?state.saved.delete(id):state.saved.add(id);renderWorks()}
  const sc=e.target.closest("[data-scroll]");
  if(sc)document.querySelector(sc.dataset.scroll)?.scrollIntoView({behavior:"smooth"});
  if(e.target.closest("[data-close-drawer]"))closeDrawer();
});
document.querySelector("#searchInput").addEventListener("input",e=>{state.query=e.target.value;renderWorks()});
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));btn.classList.add("active");
  const mode=btn.dataset.filter;
  if(mode==="Terbaru") works.reverse(); else if(mode==="Populer") works.sort((a,b)=>b.likes-a.likes);
  renderWorks();
}));
document.querySelector("#allCategoryBtn").onclick=()=>{state.category="Semua";renderWorks();document.querySelector("#explore").scrollIntoView()};
const showSaved=()=>openDrawer("Karya tersimpan",state.saved.size?[...state.saved].map(x=>`<div class="drawer-item"><strong>${x}</strong><span>Tersimpan di koleksimu</span></div>`).join(""):"<p>Belum ada karya tersimpan. Tekan ikon ♡ pada karya yang kamu suka.</p>");
document.querySelector("#savedBtn").onclick=showSaved;
document.querySelector("#mobileSaved").onclick=showSaved;
const profile=()=>openDrawer("Profilmu","<p>Profil pembeli/kreator akan memuat karya, pengikut, likes, lokasi, bio, dan katalog SOLD.</p><button class='btn primary'>Masuk / Daftar</button>");
document.querySelector("#profileBtn").onclick=profile;document.querySelector("#mobileProfile").onclick=profile;
const sell=()=>openDrawer("Mulai menjual karya","<p>Alur MVP: buat profil kreator → unggah foto/video → tentukan harga atau buka penawaran → terima DM → tandai SOLD → checkout.</p><button class='btn primary'>Buat profil kreator</button>");
document.querySelector("#sellBtn").onclick=sell;document.querySelector("#creatorJoinBtn").onclick=sell;document.querySelector("#mobileAdd").onclick=sell;
document.querySelector("#messageBtn").onclick=()=>openDrawer("Pesan & penawaran","<div class='drawer-item'><strong>Raras Studio</strong><span>“Boleh ditawar untuk ukuran M?”</span></div><div class='drawer-item'><strong>Ruang Kayu</strong><span>“Pengiriman ke Jakarta tersedia.”</span></div>");
renderCategories();renderWorks();
