/* =========================
   Agenda PWA (Offline-first)
   Grafite + Azul petróleo
   ========================= */

const $ = (id) => document.getElementById(id);

const VIEWS = {
  calendar: $("viewCalendar"),
  day: $("viewDay"),
  search: $("viewSearch"),
  insights: $("viewInsights"),
  backup: $("viewBackup"),
};

const state = {
  currentMonth: new Date(),
  selectedDate: toISODate(new Date()),
  autosaveTimer: null,
  db: null,
};

const WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/* =========================
   Boot
   ========================= */
document.addEventListener("DOMContentLoaded", async () => {
  renderWeekdays();
  bindNav();
  bindCalendarControls();
  bindDayControls();
  bindSearchControls();
  bindInsightsControls();
  bindBackupControls();

  await openDB();
  await ensureDayExists(state.selectedDate);

  // Render inicial
  showView("calendar");
  await renderCalendar();
  await openDay(state.selectedDate, { quiet: true });
  setFooter("Pronto. Offline-first.");

  // Service Worker
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      console.warn("SW falhou:", e);
    }
  }
});

/* =========================
   Navegação
   ========================= */
function showView(name) {
  Object.values(VIEWS).forEach(v => v.classList.add("hidden"));
  VIEWS[name].classList.remove("hidden");
}

function bindNav() {
  $("btnGoCalendar").onclick = async () => { showView("calendar"); await renderCalendar(); };
  $("btnGoToday").onclick = async () => { await openDay(toISODate(new Date())); };
  $("btnGoSearch").onclick = async () => { showView("search"); await primeSearchDefaults(); };
  $("btnGoInsights").onclick = async () => { showView("insights"); await renderInsights("week"); };
  $("btnGoBackup").onclick = async () => { showView("backup"); await refreshBackupStatus(); };
}

/* =========================
   Calendário
   ========================= */
function renderWeekdays() {
  const el = $("weekdays");
  el.innerHTML = "";
  WEEKDAYS_PT.forEach(w => {
    const d = document.createElement("div");
    d.textContent = w;
    el.appendChild(d);
  });
}

function bindCalendarControls() {
  $("btnPrevMonth").onclick = async () => {
    state.currentMonth = addMonths(state.currentMonth, -1);
    await renderCalendar();
  };
  $("btnNextMonth").onclick = async () => {
    state.currentMonth = addMonths(state.currentMonth, +1);
    await renderCalendar();
  };
}

async function renderCalendar() {
  const m = state.currentMonth;
  $("monthLabel").textContent = formatMonthLabel(m);

  const grid = $("calendarGrid");
  grid.innerHTML = "";

  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();

  // Dias do mês anterior preenchendo início
  const prevMonthDays = new Date(m.getFullYear(), m.getMonth(), 0).getDate();
  for (let i = 0; i < startDow; i++) {
    const dayNum = prevMonthDays - startDow + 1 + i;
    const date = new Date(m.getFullYear(), m.getMonth() - 1, dayNum);
    grid.appendChild(makeDayCell(date, { muted: true }));
  }

  // Dias do mês atual
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(m.getFullYear(), m.getMonth(), d);
    grid.appendChild(makeDayCell(date));
  }

  // Completa final para múltiplos de 7
  const totalCells = grid.children.length;
  const remainder = totalCells % 7;
  if (remainder !== 0) {
    const need = 7 - remainder;
    for (let i = 1; i <= need; i++) {
      const date = new Date(m.getFullYear(), m.getMonth() + 1, i);
      grid.appendChild(makeDayCell(date, { muted: true }));
    }
  }
}

function makeDayCell(dateObj, opts = {}) {
  const iso = toISODate(dateObj);

  const cell = document.createElement("div");
  cell.className = "daycell";
  if (opts.muted) cell.classList.add("muted");
  if (iso === toISODate(new Date())) cell.classList.add("today");
  if (iso === state.selectedDate) cell.classList.add("selected");

  const num = document.createElement("div");
  num.className = "daynum";
  num.textContent = String(dateObj.getDate());
  cell.appendChild(num);

  const markers = document.createElement("div");
  markers.className = "markers";
  markers.textContent = " ";
  cell.appendChild(markers);

  // Marcadores async (anota/foto)
  (async () => {
    const day = await getDay(iso);
    if (!day) return;
    const hasText = hasAnyText(day);
    const photosCount = day.photos?.length || 0;
    const pieces = [];
    if (hasText) pieces.push("📝");
    if (photosCount > 0) pieces.push("📷");
    markers.textContent = pieces.join(" ") || "";
  })();

  cell.onclick = async () => {
    await openDay(iso);
  };

  return cell;
}

/* =========================
   Dia
   ========================= */
function bindDayControls() {
  $("btnBackToCalendar").onclick = async () => {
    showView("calendar");
    await renderCalendar();
  };

  $("btnDayPrev").onclick = async () => {
    const d = fromISODate(state.selectedDate);
    d.setDate(d.getDate() - 1);
    await openDay(toISODate(d));
  };

  $("btnDayNext").onclick = async () => {
    const d = fromISODate(state.selectedDate);
    d.setDate(d.getDate() + 1);
    await openDay(toISODate(d));
  };

  $("btnAddPhoto").onclick = () => $("photoInput").click();
  $("photoInput").addEventListener("change", async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    await addPhotosToDay(state.selectedDate, files);
    $("photoInput").value = "";
    await refreshDayUI(state.selectedDate);
    setFooter("Fotos anexadas.");
  });

  // Autosave nos campos
  const autosave = () => scheduleAutosave();
  ["txtNotes","txtGoals","txtLearn","txtHard","txtNext"].forEach(id => {
    $(id).addEventListener("input", autosave);
  });

  $("btnPdfDay").onclick = async () => {
    await exportPdfDay(state.selectedDate);
  };
}

async function openDay(iso, { quiet = false } = {}) {
  state.selectedDate = iso;
  await ensureDayExists(iso);
  showView("day");

  $("dayTitle").textContent = formatFullDate(iso);
  $("daySub").textContent = `Data: ${iso}`;

  await refreshDayUI(iso);
  if (!quiet) setFooter("Dia aberto.");
}

async function refreshDayUI(iso) {
  const day = await getDay(iso);
  if (!day) return;

  $("txtNotes").value = day.notes || "";
  $("txtGoals").value = day.goals || "";
  $("txtLearn").value = day.learn || "";
  $("txtHard").value = day.hard || "";
  $("txtNext").value = day.next || "";

  const photosCount = day.photos?.length || 0;
  $("countsStatus").textContent = `${photosCount} fotos`;

  await renderPhotoGrid(day);
  markSaved(true);
}

function scheduleAutosave() {
  markSaved(false);
  if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(async () => {
    await saveCurrentDay();
  }, 450);
}

async function saveCurrentDay() {
  const iso = state.selectedDate;
  const day = await getDay(iso);
  if (!day) return;

  day.notes = $("txtNotes").value || "";
  day.goals = $("txtGoals").value || "";
  day.learn = $("txtLearn").value || "";
  day.hard = $("txtHard").value || "";
  day.next = $("txtNext").value || "";
  day.updatedAt = Date.now();

  await putDay(day);
  markSaved(true);
  setFooter("Salvo.");
}

function markSaved(saved) {
  $("saveStatus").textContent = saved ? "Salvo" : "Salvando…";
  $("saveStatus").style.opacity = saved ? "1" : ".75";
}

/* =========================
   Fotos
   ========================= */
async function addPhotosToDay(iso, files) {
  const day = await getDay(iso);
  if (!day) return;

  day.photos = day.photos || [];

  for (const file of files) {
    const blob = await compressImage(file, 1400, 0.82);
    const id = crypto.randomUUID();
    day.photos.push({
      id,
      name: file.name || `foto-${id}.jpg`,
      type: blob.type || "image/jpeg",
      blob,
      createdAt: Date.now(),
    });
  }

  day.updatedAt = Date.now();
  await putDay(day);
}

async function renderPhotoGrid(day) {
  const grid = $("photoGrid");
  grid.innerHTML = "";

  const photos = day.photos || [];
  if (!photos.length) {
    const div = document.createElement("div");
    div.className = "hint";
    div.textContent = "Sem fotos neste dia.";
    grid.appendChild(div);
    return;
  }

  for (const p of photos) {
    const wrap = document.createElement("div");
    wrap.className = "photo";

    const img = document.createElement("img");
    img.src = URL.createObjectURL(p.blob);
    img.onload = () => URL.revokeObjectURL(img.src);
    wrap.appendChild(img);

    const actions = document.createElement("div");
    actions.className = "ph-actions";

    const btnView = document.createElement("button");
    btnView.textContent = "Abrir";
    btnView.onclick = () => {
      const url = URL.createObjectURL(p.blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    };

    const btnDel = document.createElement("button");
    btnDel.textContent = "Remover";
    btnDel.className = "danger";
    btnDel.onclick = async () => {
      await removePhoto(state.selectedDate, p.id);
      await refreshDayUI(state.selectedDate);
      setFooter("Foto removida.");
    };

    actions.appendChild(btnView);
    actions.appendChild(btnDel);
    wrap.appendChild(actions);

    grid.appendChild(wrap);
  }
}

async function removePhoto(iso, photoId) {
  const day = await getDay(iso);
  if (!day?.photos) return;
  day.photos = day.photos.filter(p => p.id !== photoId);
  day.updatedAt = Date.now();
  await putDay(day);
}

/* =========================
   Busca e PDF de período
   ========================= */
function bindSearchControls() {
  $("btnSearch").onclick = async () => runSearch();
  $("searchInput").addEventListener("keydown", async (e) => {
    if (e.key === "Enter") await runSearch();
  });

  $("btnThisWeek").onclick = () => setRangeThisWeek();
  $("btnThisMonth").onclick = () => setRangeThisMonth();
  $("btnThisSemester").onclick = () => setRangeThisSemester();

  $("btnPdfRange").onclick = async () => {
    const from = $("dateFrom").value;
    const to = $("dateTo").value;
    await exportPdfRange(from, to);
  };
}

async function primeSearchDefaults() {
  const today = new Date();
  $("dateFrom").value = toISODate(new Date(today.getFullYear(), today.getMonth(), 1));
  $("dateTo").value = toISODate(today);
  $("searchInput").value = "";
  $("searchResults").innerHTML = "";
}

async function runSearch() {
  const q = ($("searchInput").value || "").trim().toLowerCase();
  const from = $("dateFrom").value || "1900-01-01";
  const to = $("dateTo").value || "2999-12-31";

  const days = await getDaysInRange(from, to);
  const results = [];

  for (const d of days) {
    const text = buildFullText(d).toLowerCase();
    if (!q || text.includes(q)) results.push(d);
  }

  renderSearchResults(results, q, from, to);
}

function renderSearchResults(days, q, from, to) {
  const box = $("searchResults");
  box.innerHTML = "";

  const head = document.createElement("div");
  head.className = "hint";
  head.textContent = `Resultados: ${days.length} | Período: ${from} → ${to}${q ? ` | Busca: "${q}"` : ""}`;
  box.appendChild(head);

  if (!days.length) return;

  // mais recentes primeiro
  days.sort((a,b) => (b.date.localeCompare(a.date)));

  for (const d of days.slice(0, 300)) {
    const it = document.createElement("div");
    it.className = "item";
    it.onclick = async () => await openDay(d.date);

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = formatFullDate(d.date);

    const sub = document.createElement("div");
    sub.className = "item-sub";
    const pc = d.photos?.length || 0;
    sub.textContent = `${hasAnyText(d) ? "📝 Com anotação" : "Sem anotação"} • 📷 ${pc} foto(s)`;

    const snip = document.createElement("div");
    snip.className = "item-snippet";
    snip.textContent = (d.notes || "").slice(0, 240);

    it.appendChild(title);
    it.appendChild(sub);
    it.appendChild(snip);
    box.appendChild(it);
  }
}

function setRangeThisWeek() {
  const now = new Date();
  const day = now.getDay(); // 0 domingo
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  $("dateFrom").value = toISODate(monday);
  $("dateTo").value = toISODate(sunday);
}

function setRangeThisMonth() {
  const now = new Date();
  $("dateFrom").value = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  $("dateTo").value = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

function setRangeThisSemester() {
  const now = new Date();
  const month = now.getMonth(); // 0..11
  const firstHalf = month <= 5;
  const startMonth = firstHalf ? 0 : 6;
  const endMonth = firstHalf ? 5 : 11;
  $("dateFrom").value = toISODate(new Date(now.getFullYear(), startMonth, 1));
  $("dateTo").value = toISODate(new Date(now.getFullYear(), endMonth + 1, 0));
}

/* =========================
   Insights (análises)
   ========================= */
function bindInsightsControls() {
  $("btnInsightsWeek").onclick = async () => renderInsights("week");
  $("btnInsightsMonth").onclick = async () => renderInsights("month");
  $("btnPdfMonth").onclick = async () => {
    const now = new Date();
    const from = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    await exportPdfRange(from, to, { title: `Resumo do mês (${formatMonthLabel(now)})` });
  };
}

async function renderInsights(mode) {
  const now = new Date();
  let from, to, title;

  if (mode === "week") {
    setRangeThisWeek();
    from = $("dateFrom").value;
    to = $("dateTo").value;
    title = `Resumo da semana (${from} → ${to})`;
  } else {
    setRangeThisMonth();
    from = $("dateFrom").value;
    to = $("dateTo").value;
    title = `Resumo do mês (${formatMonthLabel(now)})`;
  }

  $("insTitle").textContent = title;

  const days = await getDaysInRange(from, to);

  const total = days.length;
  const withNotes = days.filter(hasAnyText).length;
  const photos = days.reduce((acc,d)=>acc+(d.photos?.length||0),0);

  // palavras-chave simples (frequência)
  const words = {};
  for (const d of days) {
    const text = buildFullText(d)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !STOPWORDS.has(w));
    for (const w of text) words[w] = (words[w] || 0) + 1;
  }
  const topWords = Object.entries(words).sort((a,b)=>b[1]-a[1]).slice(0, 10);

  const body =
`Dias no período: ${total}
Dias com anotação: ${withNotes}
Total de fotos: ${photos}

Temas mais frequentes:
${topWords.length ? topWords.map(([w,c]) => `• ${w} (${c})`).join("\n") : "—"}

Perguntas rápidas (pra planejar o próximo):
• O que te deu mais resultado?
• O que drenou energia e vale cortar?
• Qual 1 ajuste deixa a próxima semana/mês melhor?`;

  $("insBody").textContent = body;

  // recentes
  const rec = $("insRecent");
  rec.innerHTML = "";
  const recent = [...days].sort((a,b)=>b.date.localeCompare(a.date)).slice(0, 14);
  for (const d of recent) {
    const it = document.createElement("div");
    it.className = "item";
    it.onclick = async () => await openDay(d.date);

    const t = document.createElement("div");
    t.className = "item-title";
    t.textContent = formatFullDate(d.date);

    const s = document.createElement("div");
    s.className = "item-sub";
    s.textContent = `${hasAnyText(d) ? "📝" : "—"} • 📷 ${d.photos?.length||0}`;

    it.appendChild(t);
    it.appendChild(s);
    rec.appendChild(it);
  }
}

/* =========================
   PDF
   ========================= */
async function exportPdfDay(iso) {
  await saveCurrentDay(); // garante persistência

  const day = await getDay(iso);
  if (!day) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const title = formatFullDate(iso);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, 40, 48);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Data: ${iso}`, 40, 68);

  const blocks = [
    ["Anotações", day.notes || ""],
    ["Objetivos", day.goals || ""],
    ["Aprendizados", day.learn || ""],
    ["Dificuldades", day.hard || ""],
    ["Próximo passo", day.next || ""],
  ].filter(([,v]) => (v||"").trim().length > 0);

  let y = 92;
  for (const [k,v] of blocks) {
    doc.setFont("helvetica","bold"); doc.setFontSize(12);
    doc.text(k, 40, y);
    y += 12;

    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    const lines = doc.splitTextToSize(v, 515);
    doc.text(lines, 40, y);
    y += lines.length * 12 + 12;

    if (y > 740) { doc.addPage(); y = 50; }
  }

  // Fotos (mini na página)
  const photos = day.photos || [];
  if (photos.length) {
    if (y > 680) { doc.addPage(); y = 50; }
    doc.setFont("helvetica","bold"); doc.setFontSize(12);
    doc.text("Fotos", 40, y); y += 14;

    const maxPerRow = 3;
    const thumbW = 160;
    const thumbH = 110;
    let col = 0;
    let x = 40;

    for (const p of photos.slice(0, 12)) {
      const dataUrl = await blobToDataURL(p.blob);
      doc.addImage(dataUrl, "JPEG", x, y, thumbW, thumbH, undefined, "FAST");

      col++;
      x += thumbW + 10;
      if (col >= maxPerRow) {
        col = 0;
        x = 40;
        y += thumbH + 12;
        if (y > 720) { doc.addPage(); y = 50; }
      }
    }
  }

  doc.save(`agenda-${iso}.pdf`);
  setFooter("PDF do dia gerado.");
}

async function exportPdfRange(from, to, opts = {}) {
  if (!from || !to) {
    alert("Selecione data inicial e final.");
    return;
  }
  await saveCurrentDay();

  const days = await getDaysInRange(from, to);
  days.sort((a,b)=>a.date.localeCompare(b.date));

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });

  const title = opts.title || `Registros (${from} → ${to})`;

  doc.setFont("helvetica","bold");
  doc.setFontSize(16);
  doc.text(title, 40, 48);

  doc.setFont("helvetica","normal");
  doc.setFontSize(10);
  doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, 40, 68);

  const rows = days.map(d => ([
    d.date,
    trimOneLine(d.notes || ""),
    (d.photos?.length || 0)
  ]));

  doc.autoTable({
    startY: 88,
    head: [["Data", "Resumo", "Fotos"]],
    body: rows,
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [13,59,63] },
    columnStyles: { 0:{cellWidth:90}, 1:{cellWidth:390}, 2:{cellWidth:50, halign:"center"} },
    didDrawPage: (data) => {
      doc.setFontSize(9);
      doc.text(`Período: ${from} → ${to}`, 40, doc.internal.pageSize.height - 28);
    }
  });

  // Apêndice detalhado (texto)
  let y = doc.lastAutoTable.finalY + 16;
  doc.addPage();
  y = 50;

  for (const d of days) {
    const full = buildFullText(d).trim();
    if (!full) continue;

    doc.setFont("helvetica","bold"); doc.setFontSize(12);
    doc.text(formatFullDate(d.date), 40, y);
    y += 14;

    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    const lines = doc.splitTextToSize(full, 515);
    doc.text(lines, 40, y);
    y += lines.length * 12 + 14;

    if (y > 740) { doc.addPage(); y = 50; }
  }

  doc.save(`agenda-${from}_a_${to}.pdf`);
  setFooter("PDF do período gerado.");
}

/* =========================
   Backup (ZIP) / Restore
   ========================= */
function bindBackupControls() {
  $("btnMakeBackup").onclick = async () => makeBackupZip();
  $("btnRestorePick").onclick = () => $("restoreInput").click();

  $("restoreInput").addEventListener("change", async (e) => {
    const f = (e.target.files || [])[0];
    if (!f) return;
    await restoreBackupZip(f);
    $("restoreInput").value = "";
    await refreshBackupStatus();
    showView("calendar");
    await renderCalendar();
    setFooter("Backup restaurado.");
  });
}

async function refreshBackupStatus() {
  const count = await countDays();
  $("backupStatus").textContent = `Registros salvos localmente: ${count} dia(s).`;
}

async function makeBackupZip() {
  await saveCurrentDay();

  const zip = new JSZip();
  const days = await getAllDays();

  // JSON sem blobs
  const meta = days.map(d => ({
    date: d.date,
    notes: d.notes || "",
    goals: d.goals || "",
    learn: d.learn || "",
    hard: d.hard || "",
    next: d.next || "",
    updatedAt: d.updatedAt || null,
    photos: (d.photos || []).map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      createdAt: p.createdAt
    }))
  }));

  zip.file("data.json", JSON.stringify({ version: 1, exportedAt: Date.now(), days: meta }, null, 2));

  // Fotos em pasta /photos/YYYY-MM-DD/
  for (const d of days) {
    for (const p of (d.photos || [])) {
      const path = `photos/${d.date}/${p.id}.jpg`;
      zip.file(path, p.blob);
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const name = `agenda-backup-${toISODate(new Date())}.zip`;
  downloadBlob(blob, name);

  $("backupStatus").textContent = `Backup gerado: ${name} (salve no Google Drive).`;
  setFooter("Backup gerado.");
}

async function restoreBackupZip(file) {
  const zip = await JSZip.loadAsync(file);
  const dataText = await zip.file("data.json").async("text");
  const data = JSON.parse(dataText);

  if (!data?.days) throw new Error("Backup inválido.");

  // Limpa base e restaura
  await clearDays();

  for (const d of data.days) {
    const day = {
      date: d.date,
      notes: d.notes || "",
      goals: d.goals || "",
      learn: d.learn || "",
      hard: d.hard || "",
      next: d.next || "",
      updatedAt: d.updatedAt || Date.now(),
      photos: []
    };

    const photosMeta = d.photos || [];
    for (const pm of photosMeta) {
      const path = `photos/${d.date}/${pm.id}.jpg`;
      const entry = zip.file(path);
      if (!entry) continue;
      const blob = await entry.async("blob");
      day.photos.push({
        id: pm.id,
        name: pm.name || `${pm.id}.jpg`,
        type: pm.type || "image/jpeg",
        createdAt: pm.createdAt || Date.now(),
        blob
      });
    }

    await putDay(day);
  }
}

/* =========================
   IndexedDB
   ========================= */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("agenda_pwa_db", 1);

    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      const store = db.createObjectStore("days", { keyPath: "date" });
      store.createIndex("updatedAt", "updatedAt", { unique: false });
    };

    req.onsuccess = () => {
      state.db = req.result;
      resolve();
    };

    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode = "readonly") {
  return state.db.transaction(storeName, mode).objectStore(storeName);
}

function getDay(date) {
  return new Promise((resolve, reject) => {
    const req = tx("days").get(date);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function putDay(day) {
  return new Promise((resolve, reject) => {
    const req = tx("days", "readwrite").put(day);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function ensureDayExists(date) {
  return getDay(date).then(async (d) => {
    if (d) return;
    await putDay({
      date,
      notes: "",
      goals: "",
      learn: "",
      hard: "",
      next: "",
      photos: [],
      updatedAt: Date.now(),
    });
  });
}

function getAllDays() {
  return new Promise((resolve, reject) => {
    const req = tx("days").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getDaysInRange(from, to) {
  const all = await getAllDays();
  return all.filter(d => d.date >= from && d.date <= to);
}

function countDays() {
  return new Promise((resolve, reject) => {
    const req = tx("days").count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

function clearDays() {
  return new Promise((resolve, reject) => {
    const req = tx("days", "readwrite").clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* =========================
   Utilidades
   ========================= */
function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function fromISODate(iso) {
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, m-1, d);
}
function addMonths(d, delta) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + delta);
  return x;
}
function formatMonthLabel(d) {
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^\w/, c => c.toUpperCase());
}
function formatFullDate(iso) {
  const d = fromISODate(iso);
  return d.toLocaleDateString("pt-BR", { weekday:"long", year:"numeric", month:"long", day:"numeric" })
    .replace(/^\w/, c => c.toUpperCase());
}
function setFooter(msg) {
  $("footerStatus").textContent = msg;
}
function hasAnyText(day) {
  return !!((day.notes||"").trim() || (day.goals||"").trim() || (day.learn||"").trim() || (day.hard||"").trim() || (day.next||"").trim());
}
function buildFullText(day) {
  const parts = [];
  if ((day.notes||"").trim()) parts.push(`Anotações:\n${day.notes.trim()}`);
  if ((day.goals||"").trim()) parts.push(`Objetivos:\n${day.goals.trim()}`);
  if ((day.learn||"").trim()) parts.push(`Aprendizados:\n${day.learn.trim()}`);
  if ((day.hard||"").trim()) parts.push(`Dificuldades:\n${day.hard.trim()}`);
  if ((day.next||"").trim()) parts.push(`Próximo passo:\n${day.next.trim()}`);
  return parts.join("\n\n");
}
function trimOneLine(s) {
  return (s||"").replace(/\s+/g, " ").trim().slice(0, 180);
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const STOPWORDS = new Set([
  "para","com","mais","menos","onde","quando","porque","sobre","pela","pelo","este","esta","isso","aquele","aquela",
  "hoje","ontem","amanha","amanhã","muito","pouco","cada","todo","toda","tudo","fazer","feito","ficar","ainda",
  "uma","umas","uns","dos","das","que","não","nao","por","tem","tive","teve","ser","são","sao","vou","vai","era"
]);

/* =========================
   Imagem: compressão básica
   ========================= */
function compressImage(file, maxSide = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(url);

      const { width, height } = img;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");

      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Falha ao processar imagem."));
        resolve(blob);
      }, "image/jpeg", quality);
    };

    img.onerror = () => reject(new Error("Imagem inválida."));
    img.src = url;
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
