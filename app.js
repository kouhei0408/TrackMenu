const days = ["月", "火", "水", "木", "金", "土", "日"];
const blockLabels = {
  short: "短距離ブロック",
  long: "長距離ブロック",
};

function defaultExportTitle(date = new Date()) {
  const month = date.getMonth() + 1;
  const week = Math.ceil(date.getDate() / 7);
  return `メニュー_${month}月${week}週`;
}

const fallbackMenusCsv = `メニュー名,カテゴリ,負荷,セット指定
流し + WS,スピード,中,1
120m加速走,スピード,高,1
400mインターバル,持久,超高,1
テンポ走,持久,中,0
スタート練習,技術,中,1
ハードルドリル,技術,低,0
ウエイト 下半身,筋トレ,高,0
体幹補強,筋トレ,中,0
回復ジョグ,回復,低,0`;

const defaultMenus = menusFromCsv(fallbackMenusCsv);

let state = {
  menus: defaultMenus,
  menuSettings: {},
  blockType: "short",
  exportTitle: defaultExportTitle(),
  dayStart: 6,
  dayEnd: 19,
  workouts: [],
  activeDay: 0, // スマホ用: 選択中の曜日
};

const menuGrid = document.querySelector("#menuGrid");
const menuCountLabel = document.querySelector("#menuCountLabel");
const weekGrid = document.querySelector("#weekGrid");
const timeRail = document.querySelector("#timeRail");
const dayStartInput = document.querySelector("#dayStartInput");
const dayEndInput = document.querySelector("#dayEndInput");
const blockSelect = document.querySelector("#blockSelect");
const plannerTitle = document.querySelector("#plannerTitle");
const exportTitleInput = document.querySelector("#exportTitleInput");
const exportCanvas = document.querySelector("#exportCanvas");
const editModal = document.querySelector("#editModal");
const editName = document.querySelector("#editName");
const editDay = document.querySelector("#editDay");
const editStart = document.querySelector("#editStart");
const editDuration = document.querySelector("#editDuration");
const editMemo = document.querySelector("#editMemo");
const dayTabsEl = document.querySelector("#dayTabs");
let editingWorkoutId = null;

function minutesPerDay() {
  return (state.dayEnd - state.dayStart) * 60;
}

function hourHeight() {
  return 108;
}

function timelineHeight() {
  return (minutesPerDay() / 60) * hourHeight();
}

function saveState() {
  const { menus, ...savedState } = state;
  localStorage.setItem("trackWeekPlanner", JSON.stringify(savedState));
}

function loadState() {
  const saved = localStorage.getItem("trackWeekPlanner");
  if (!saved) return;
  try {
    state = { ...state, ...JSON.parse(saved), menus: defaultMenus };
    normalizeTimeline();
  } catch {
    localStorage.removeItem("trackWeekPlanner");
  }
}

function normalizeTimeline() {
  state.dayEnd = clamp(Number(state.dayEnd) || 19, 13, 19);
  state.dayStart = clamp(Number(state.dayStart) || 6, 4, Math.min(12, state.dayEnd - 1));
  state.blockType = blockLabels[state.blockType] ? state.blockType : "short";
  state.exportTitle = String(state.exportTitle || defaultExportTitle()).trim() || defaultExportTitle();
  state.activeDay = clamp(Number(state.activeDay) || 0, 0, days.length - 1);
  state.workouts = state.workouts
    .filter((workout) => workout.start < state.dayEnd * 60)
    .map((workout) => ({
      ...workout,
      duration: Math.min(workout.duration, state.dayEnd * 60 - workout.start),
    }))
    .filter((workout) => workout.duration > 0);
}

function defaultSetting(menu) {
  if (menu.setEnabled) {
    return { repDuration: 2, reps: 5, repRest: 3, sets: 2, setRest: 8, focus: "" };
  }
  return { duration: 60, focus: "" };
}

function settingFor(menu) {
  if (!state.menuSettings[menu.id]) {
    state.menuSettings[menu.id] = defaultSetting(menu);
  }
  return state.menuSettings[menu.id];
}

function menuColor(menu) {
  return colorFromText(menu.category || "その他");
}

function colorFromText(text) {
  let hash = 0;
  [...text].forEach((char) => {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  });
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 42%)`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function snapMinutes(value) {
  return Math.round(value / 15) * 15;
}

function formatTime(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

function timeInputValue(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function timeValueToMinutes(value) {
  const [hour = "0", minute = "0"] = String(value).split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatMinutes(minutes) {
  return `${Math.round(minutes)}分`;
}

function calculateDuration(menu) {
  const setting = settingFor(menu);
  if (!menu.setEnabled) {
    return clamp(Number(setting.duration) || 15, 5, 360);
  }

  const repDuration = clamp(Number(setting.repDuration) || 1, 1, 60);
  const reps = clamp(Number(setting.reps) || 1, 1, 99);
  const repRest = clamp(Number(setting.repRest) || 0, 0, 60);
  const sets = clamp(Number(setting.sets) || 1, 1, 20);
  const setRest = clamp(Number(setting.setRest) || 0, 0, 120);
  return sets * reps * repDuration + sets * Math.max(0, reps - 1) * repRest + Math.max(0, sets - 1) * setRest;
}

function workoutMemo(menu) {
  const setting = settingFor(menu);
  const base = menu.setEnabled
    ? `${setting.reps}本 x ${setting.sets}set / 本間${setting.repRest}分 / set間${setting.setRest}分`
    : `${menu.category} / 負荷:${menu.load}`;
  return setting.focus ? `${base} / 意識:${setting.focus}` : base;
}

function dragPayload(menu) {
  return JSON.stringify({
    action: "add",
    title: menu.title,
    category: menu.category,
    load: menu.load,
    color: menuColor(menu),
    duration: calculateDuration(menu),
    memo: workoutMemo(menu),
    focus: settingFor(menu).focus || "",
  });
}

// ===== 日別タブ（スマホ用）=====
function renderDayTabs() {
  dayTabsEl.innerHTML = "";
  days.forEach((day, index) => {
    const hasWorkouts = state.workouts.some((w) => w.day === index);
    const tab = document.createElement("button");
    tab.className = `day-tab${index === state.activeDay ? " active" : ""}${hasWorkouts ? " has-workouts" : ""}`;
    tab.type = "button";
    tab.dataset.day = index;
    tab.innerHTML = `${escapeHtml(day)}<span class="tab-dot"></span>`;
    tab.addEventListener("click", () => {
      state.activeDay = index;
      saveState();
      renderDayTabs();
      updateActiveDayColumn();
      renderMenu(); // クイック追加ボタンの曜日表示を更新
    });
    dayTabsEl.appendChild(tab);
  });
}

function updateActiveDayColumn() {
  document.querySelectorAll(".day-column").forEach((col, index) => {
    col.classList.toggle("active-day", index === state.activeDay);
  });
}

// ===== メニューカード =====
function renderMenu() {
  menuCountLabel.textContent = `${state.menus.length}件`;
  menuGrid.innerHTML = "";

  state.menus.forEach((menu) => {
    const setting = settingFor(menu);
    const card = document.createElement("article");
    card.className = "menu-card";
    card.draggable = true;
    card.style.setProperty("--card-color", menuColor(menu));
    const activeLabel = `${days[state.activeDay]}・${state.dayStart + 1}:00`;
    card.innerHTML = `
      <div class="menu-title-row">
        <strong>${escapeHtml(menu.title)}</strong>
        <span>${escapeHtml(menu.load)}</span>
      </div>
      <small>${escapeHtml(menu.category)} / ${menu.setEnabled ? "セット指定可" : "時間指定"}</small>
      ${menu.setEnabled ? setControls(menu, setting) : durationControl(menu, setting)}
      ${focusControl(setting)}
      <div class="menu-card-footer">
        <div class="menu-duration">${formatMinutes(calculateDuration(menu))}</div>
        <button class="quick-add-button" type="button">${activeLabel}に追加</button>
      </div>
    `;
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/json", dragPayload(menu));
      event.dataTransfer.effectAllowed = "copy";
    });
    setupMenuPointerDrag(card, menu);
    card.querySelectorAll("input, textarea").forEach((input) => {
      input.addEventListener("input", () => {
        setting[input.name] = input.type === "number" ? Number(input.value) : input.value;
        card.querySelector(".menu-duration").textContent = formatMinutes(calculateDuration(menu));
        saveState();
      });
      input.addEventListener("pointerdown", (event) => event.stopPropagation());
      input.addEventListener("dragstart", (event) => event.preventDefault());
    });
    card.querySelector(".quick-add-button").addEventListener("click", (event) => {
      event.stopPropagation();
      // 選択中の曜日の開始時刻+1時間に追加
      addMenuToDay(menu, state.activeDay, (state.dayStart + 1) * 60);
    });
    menuGrid.appendChild(card);
  });
}

function setupMenuPointerDrag(card, menu) {
  let drag = null;

  card.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("input, textarea, button, select")) return;
    drag = {
      menu,
      startX: event.clientX,
      startY: event.clientY,
      ghost: null,
      active: false,
      pointerId: event.pointerId,
    };
    card.setPointerCapture(event.pointerId);
  });

  card.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.active && distance < 10) return;
    if (!drag.active) {
      drag.active = true;
      drag.ghost = createDragGhost(card, menu);
      document.body.appendChild(drag.ghost);
    }
    event.preventDefault();
    moveDragGhost(drag.ghost, event.clientX, event.clientY);
    highlightDropZone(event.clientX, event.clientY);
  });

  card.addEventListener("pointerup", (event) => {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (card.hasPointerCapture(current.pointerId)) card.releasePointerCapture(current.pointerId);
    clearDropHighlights();
    if (current.ghost) current.ghost.remove();
    if (!current.active) return;
    const zone = dropZoneFromPoint(event.clientX, event.clientY);
    if (!zone) return;
    // スマホ: ドロップ先の曜日をactiveDayにも反映
    const dayIndex = Number(zone.dataset.day);
    if (!isNaN(dayIndex)) {
      state.activeDay = dayIndex;
    }
    addMenuToDropPoint(current.menu, dayIndex, zone, event.clientY);
  });

  card.addEventListener("pointercancel", () => {
    if (drag && card.hasPointerCapture(drag.pointerId)) card.releasePointerCapture(drag.pointerId);
    if (drag?.ghost) drag.ghost.remove();
    drag = null;
    clearDropHighlights();
  });
}

function createDragGhost(card, menu) {
  const ghost = document.createElement("div");
  ghost.classList.add("drag-ghost");
  ghost.style.setProperty("--card-color", menuColor(menu));
  ghost.innerHTML = `
    <strong>${escapeHtml(menu.title)}</strong>
    <span>${formatMinutes(calculateDuration(menu))}</span>
  `;
  ghost.style.width = `${Math.min(card.offsetWidth, 320)}px`;
  return ghost;
}

function moveDragGhost(ghost, x, y) {
  const zone = dropZoneFromPoint(x, y);
  if (zone) {
    ghost.style.width = `${Math.max(96, zone.getBoundingClientRect().width - 16)}px`;
  }
  ghost.style.transform = `translate(${x + 10}px, ${y + 10}px)`;
}

function highlightDropZone(x, y) {
  clearDropHighlights();
  dropZoneFromPoint(x, y)?.classList.add("drag-over");
}

function clearDropHighlights() {
  document.querySelectorAll(".drop-zone.drag-over").forEach((zone) => zone.classList.remove("drag-over"));
}

function dropZoneFromPoint(x, y) {
  const elements = document.elementsFromPoint(x, y);
  return elements
    .map((element) => element.closest?.(".drop-zone") || element.closest?.(".day-column")?.querySelector(".drop-zone"))
    .find(Boolean);
}

function addMenuToDropPoint(menu, day, zone, clientY) {
  const duration = calculateDuration(menu);
  const rect = zone.getBoundingClientRect();
  const y = clamp(clientY - rect.top, 0, rect.height);
  const startOffset = snapMinutes((y / hourHeight()) * 60);
  const maxStart = minutesPerDay() - duration;
  const start = state.dayStart * 60 + clamp(startOffset, 0, Math.max(0, maxStart));
  addMenuToDay(menu, day, start);
}

function addMenuToDay(menu, day, start) {
  const duration = calculateDuration(menu);
  const workout = {
    id: crypto.randomUUID(),
    day,
    start: clamp(start, state.dayStart * 60, Math.max(state.dayStart * 60, state.dayEnd * 60 - duration)),
    duration,
    title: menu.title,
    category: menu.category,
    load: menu.load,
    color: menuColor(menu),
    memo: workoutMemo(menu),
    focus: settingFor(menu).focus || "",
  };
  state.workouts.push(workout);
  warnIfOverlapping(workout);
  saveState();
  render();
}

function focusControl(setting) {
  return `
    <label class="focus-field">
      <span>意識すること</span>
      <textarea name="focus" rows="2" placeholder="例: 接地を真下、腕振りを大きく">${escapeHtml(setting.focus || "")}</textarea>
    </label>
  `;
}

function durationControl(menu, setting) {
  return `
    <label class="mini-field">
      <span>時間</span>
      <input name="duration" type="number" min="5" max="360" step="5" value="${setting.duration}">
      <small>分</small>
    </label>
  `;
}

function setControls(menu, setting) {
  return `
    <div class="set-controls">
      <label class="mini-field">
        <span>1本</span>
        <input name="repDuration" type="number" min="1" max="60" step="1" value="${setting.repDuration}">
        <small>分</small>
      </label>
      <label class="mini-field">
        <span>本数</span>
        <input name="reps" type="number" min="1" max="99" step="1" value="${setting.reps}">
        <small>本</small>
      </label>
      <label class="mini-field">
        <span>本間</span>
        <input name="repRest" type="number" min="0" max="60" step="1" value="${setting.repRest}">
        <small>分</small>
      </label>
      <label class="mini-field">
        <span>set</span>
        <input name="sets" type="number" min="1" max="20" step="1" value="${setting.sets}">
        <small>組</small>
      </label>
      <label class="mini-field">
        <span>set間</span>
        <input name="setRest" type="number" min="0" max="120" step="1" value="${setting.setRest}">
        <small>分</small>
      </label>
    </div>
  `;
}

function renderTimeRail() {
  timeRail.style.height = `${timelineHeight() + 48}px`;
  timeRail.innerHTML = "";
  for (let hour = state.dayStart; hour <= state.dayEnd; hour += 1) {
    const mark = document.createElement("div");
    mark.className = "time-mark";
    mark.style.top = `${48 + (hour - state.dayStart) * hourHeight()}px`;
    mark.textContent = `${hour}:00`;
    timeRail.appendChild(mark);
  }
}

function renderWeek() {
  weekGrid.style.setProperty("--hour-height", `${hourHeight()}px`);
  weekGrid.style.setProperty("--timeline-height", `${timelineHeight()}px`);
  weekGrid.innerHTML = "";

  days.forEach((day, dayIndex) => {
    const dayWorkouts = state.workouts
      .filter((item) => item.day === dayIndex)
      .sort((a, b) => a.start - b.start);
    const total = dayWorkouts.reduce((sum, item) => sum + item.duration, 0);

    const column = document.createElement("article");
    column.className = `day-column${dayIndex === state.activeDay ? " active-day" : ""}`;
    column.innerHTML = `
      <header class="day-head">
        <strong>${day}</strong>
        <span class="day-total">${total}分</span>
      </header>
      <div class="drop-zone" data-day="${dayIndex}"></div>
    `;

    const zone = column.querySelector(".drop-zone");
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (event) => {
      // ドロップ先の曜日をactiveDayに反映（スマホ用）
      state.activeDay = dayIndex;
      handleDrop(event, dayIndex, zone);
    });

    dayWorkouts.forEach((workout) => {
      zone.appendChild(createWorkoutElement(workout));
    });

    weekGrid.appendChild(column);
  });
}

function workoutBlockHeight(workout) {
  const durationHeight = (workout.duration / 60) * hourHeight() - 6;
  const memoLines = Math.max(1, Math.ceil(String(workout.memo || "").length / 18));
  const contentHeight = 58 + memoLines * 16;
  return Math.max(112, durationHeight, contentHeight);
}

function createWorkoutElement(workout) {
  const item = document.createElement("div");
  item.className = "workout";
  item.draggable = true;
  item.style.setProperty("--card-color", workout.color);
  item.style.top = `${((workout.start - state.dayStart * 60) / 60) * hourHeight()}px`;
  item.style.height = `${workoutBlockHeight(workout)}px`;
  item.innerHTML = `
    <strong>${escapeHtml(workout.title)}</strong>
    <span class="workout-time">${formatTime(workout.start)}-${formatTime(workout.start + workout.duration)} / ${workout.duration}分</span>
    <span class="workout-memo">${escapeHtml(workout.memo || "")}</span>
    <button class="delete-workout" type="button" title="削除">×</button>
  `;
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("application/json", JSON.stringify({ action: "move", id: workout.id }));
    event.dataTransfer.effectAllowed = "move";
  });
  item.querySelector(".delete-workout").addEventListener("click", () => {
    state.workouts = state.workouts.filter((entry) => entry.id !== workout.id);
    saveState();
    render();
  });
  item.addEventListener("click", (event) => {
    if (event.target.closest(".delete-workout")) return;
    openEditDialog(workout.id);
  });

  // スマホ用: 配置済みワークアウトをpointerドラッグで移動
  setupWorkoutPointerDrag(item, workout);

  return item;
}

// ===== 配置済みワークアウトのpointerドラッグ（スマホ対応）=====
function setupWorkoutPointerDrag(item, workout) {
  let drag = null;

  item.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".delete-workout")) return;
    drag = {
      workout,
      startX: event.clientX,
      startY: event.clientY,
      ghost: null,
      active: false,
      pointerId: event.pointerId,
    };
    item.setPointerCapture(event.pointerId);
  });

  item.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.active && distance < 12) return;
    if (!drag.active) {
      drag.active = true;
      drag.ghost = createWorkoutDragGhost(workout);
      document.body.appendChild(drag.ghost);
    }
    event.preventDefault();
    event.stopPropagation();
    drag.ghost.style.transform = `translate(${event.clientX + 10}px, ${event.clientY + 10}px)`;
    highlightDropZone(event.clientX, event.clientY);
  });

  item.addEventListener("pointerup", (event) => {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (item.hasPointerCapture(current.pointerId)) item.releasePointerCapture(current.pointerId);
    clearDropHighlights();
    if (current.ghost) current.ghost.remove();
    if (!current.active) return;

    const zone = dropZoneFromPoint(event.clientX, event.clientY);
    if (!zone) return;

    const dayIndex = Number(zone.dataset.day);
    const rect = zone.getBoundingClientRect();
    const y = clamp(event.clientY - rect.top, 0, rect.height);
    const startOffset = snapMinutes((y / hourHeight()) * 60);
    const maxStart = minutesPerDay() - current.workout.duration;
    const newStart = state.dayStart * 60 + clamp(startOffset, 0, Math.max(0, maxStart));

    const w = state.workouts.find((x) => x.id === current.workout.id);
    if (w) {
      w.day = dayIndex;
      w.start = newStart;
      state.activeDay = dayIndex;
      warnIfOverlapping(w);
      saveState();
      render();
    }
  });

  item.addEventListener("pointercancel", () => {
    if (drag && item.hasPointerCapture(drag.pointerId)) item.releasePointerCapture(drag.pointerId);
    if (drag?.ghost) drag.ghost.remove();
    drag = null;
    clearDropHighlights();
  });
}

function createWorkoutDragGhost(workout) {
  const ghost = document.createElement("div");
  ghost.classList.add("drag-ghost");
  ghost.style.setProperty("--card-color", workout.color);
  ghost.innerHTML = `
    <strong>${escapeHtml(workout.title)}</strong>
    <span>${formatMinutes(workout.duration)}</span>
  `;
  ghost.style.width = "160px";
  return ghost;
}

function handleDrop(event, dayIndex, zone) {
  event.preventDefault();
  zone.classList.remove("drag-over");

  const raw = event.dataTransfer.getData("application/json");
  if (!raw) return;

  const payload = JSON.parse(raw);
  const rect = zone.getBoundingClientRect();
  const y = clamp(event.clientY - rect.top, 0, rect.height);
  const startOffset = snapMinutes((y / hourHeight()) * 60);
  const maxStart = minutesPerDay() - Number(payload.duration || 60);
  const start = state.dayStart * 60 + clamp(startOffset, 0, Math.max(0, maxStart));

  if (payload.action === "move") {
    const workout = state.workouts.find((item) => item.id === payload.id);
    if (workout) {
      workout.day = dayIndex;
      workout.start = start;
      warnIfOverlapping(workout);
    }
  } else {
    const workout = {
      id: crypto.randomUUID(),
      day: dayIndex,
      start,
      duration: Number(payload.duration),
      title: payload.title,
      category: payload.category,
      load: payload.load,
      color: payload.color,
      memo: payload.memo,
      focus: payload.focus,
    };
    state.workouts.push(workout);
    warnIfOverlapping(workout);
  }

  saveState();
  render();
}

function openEditDialog(workoutId) {
  const workout = state.workouts.find((item) => item.id === workoutId);
  if (!workout) return;
  editingWorkoutId = workoutId;
  editName.value = workout.title;
  editDay.innerHTML = days.map((day, index) => `<option value="${index}">${day}</option>`).join("");
  editDay.value = String(workout.day);
  editStart.value = timeInputValue(workout.start);
  editDuration.value = workout.duration;
  editMemo.value = workout.memo || "";
  editModal.hidden = false;
  editName.focus();
}

function closeEditDialog() {
  editingWorkoutId = null;
  editModal.hidden = true;
}

function saveEditedWorkout() {
  const workout = state.workouts.find((item) => item.id === editingWorkoutId);
  if (!workout) return;
  const duration = clamp(Number(editDuration.value) || 5, 5, 360);
  const day = clamp(Number(editDay.value) || 0, 0, days.length - 1);
  const latestStart = state.dayEnd * 60 - duration;
  workout.title = editName.value.trim() || workout.title;
  workout.day = day;
  workout.duration = duration;
  workout.start = clamp(snapMinutes(timeValueToMinutes(editStart.value)), state.dayStart * 60, Math.max(state.dayStart * 60, latestStart));
  workout.memo = editMemo.value.trim();
  workout.focus = workout.memo;
  state.activeDay = day; // 編集後は対象曜日をアクティブに
  saveState();
  render();
  closeEditDialog();
  warnIfOverlapping(workout);
}

function deleteEditedWorkout() {
  state.workouts = state.workouts.filter((item) => item.id !== editingWorkoutId);
  saveState();
  render();
  closeEditDialog();
}

function findOverlap(workout) {
  return state.workouts.find((item) => {
    if (item.id === workout.id || item.day !== workout.day) return false;
    return workout.start < item.start + item.duration && item.start < workout.start + workout.duration;
  });
}

function warnIfOverlapping(workout) {
  const overlap = findOverlap(workout);
  if (overlap) {
    showToast(`「${workout.title}」と「${overlap.title}」が重複しています！`, "warning");
  }
}

function fillSample() {
  state.workouts = [
    sampleWorkout(0, 9, "スタート練習"),
    sampleWorkout(0, 10, "流し + WS"),
    sampleWorkout(1, 16, "ウエイト 下半身"),
    sampleWorkout(2, 9, "400mインターバル"),
    sampleWorkout(3, 17, "回復ジョグ"),
    sampleWorkout(4, 9, "120m加速走"),
    sampleWorkout(4, 10, "体幹補強"),
    sampleWorkout(5, 8, "テンポ走"),
    sampleWorkout(6, 10, "回復ジョグ"),
  ];
  saveState();
  render();
}

function sampleWorkout(day, hour, menuName) {
  const menu = state.menus.find((item) => item.title === menuName || item.id === menuName) || state.menus[0];
  return {
    id: crypto.randomUUID(),
    day,
    start: hour * 60,
    duration: calculateDuration(menu),
    title: menu.title,
    category: menu.category,
    load: menu.load,
    color: menuColor(menu),
    memo: workoutMemo(menu),
    focus: settingFor(menu).focus || "",
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function menusFromCsv(text) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const dataRows = rows[0]?.[0] === "メニュー名" ? rows.slice(1) : rows;
  return dataRows
    .map((row, index) => ({
      id: `menu-${index}-${slugify(row[0] || "")}`,
      title: row[0] || "",
      category: row[1] || "その他",
      load: row[2] || "中",
      setEnabled: String(row[3] || "0").trim() === "1",
    }))
    .filter((menu) => menu.title);
}

async function loadMenusFromRepo() {
  try {
    const response = await fetch("menus.csv", { cache: "no-store" });
    if (!response.ok) return;
    const menus = menusFromCsv(await decodeCsvResponse(response));
    if (!menus.length) return;
    state.menus = menus;
    render();
  } catch {
    render();
  }
}

async function decodeCsvResponse(response) {
  const buffer = await response.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("shift_jis").decode(buffer);
  }
}

function slugify(value) {
  return encodeURIComponent(String(value).trim()).replaceAll("%", "").slice(0, 36) || "menu";
}

function exportPng() {
  const title = state.exportTitle || defaultExportTitle();
  const width = 1680;
  const height = 1080;
  const ctx = exportCanvas.getContext("2d");
  exportCanvas.width = width;
  exportCanvas.height = height;

  ctx.fillStyle = "#fffdfa";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#202124";
  ctx.font = "700 38px Meiryo, sans-serif";
  ctx.fillText(title, 48, 64);
  ctx.font = "18px Meiryo, sans-serif";
  ctx.fillStyle = "#6c6f75";
  ctx.fillText(`${blockLabels[state.blockType]} / ${state.dayStart}:00-${state.dayEnd}:00`, 48, 94);

  const left = 92;
  const top = 132;
  const colWidth = (width - left - 44) / 7;
  const rowHeight = (height - top - 50) / Math.max(1, minutesPerDay() / 60);

  ctx.strokeStyle = "#ded8ce";
  ctx.lineWidth = 1;
  for (let hour = state.dayStart; hour <= state.dayEnd; hour += 1) {
    const y = top + (hour - state.dayStart) * rowHeight;
    ctx.fillStyle = "#6c6f75";
    ctx.font = "14px Meiryo, sans-serif";
    ctx.fillText(`${hour}:00`, 28, y + 5);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - 44, y);
    ctx.stroke();
  }

  days.forEach((day, index) => {
    const x = left + colWidth * index;
    ctx.fillStyle = "#f7f2ea";
    ctx.fillRect(x, top - 36, colWidth, 36);
    ctx.strokeStyle = "#ded8ce";
    ctx.strokeRect(x, top - 36, colWidth, height - top - 14);
    ctx.fillStyle = "#202124";
    ctx.font = "700 20px Meiryo, sans-serif";
    ctx.fillText(day, x + 16, top - 12);
  });

  state.workouts.forEach((item) => {
    const x = left + colWidth * item.day + 10;
    const y = top + ((item.start - state.dayStart * 60) / 60) * rowHeight + 4;
    const h = Math.max(42, (item.duration / 60) * rowHeight - 8);
    ctx.fillStyle = "#ffffff";
    roundedRect(ctx, x, y, colWidth - 20, h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(32,33,36,0.18)";
    ctx.stroke();
    ctx.fillStyle = item.color || "#202124";
    roundedRect(ctx, x, y, 8, h, 4);
    ctx.fill();
    ctx.fillStyle = "#202124";
    ctx.font = "700 16px Meiryo, sans-serif";
    ctx.fillText(item.title, x + 18, y + 24, colWidth - 48);
    ctx.fillStyle = "#6c6f75";
    ctx.font = "13px Meiryo, sans-serif";
    ctx.fillText(`${formatTime(item.start)}-${formatTime(item.start + item.duration)} / ${item.duration}分`, x + 18, y + 44, colWidth - 48);
    if (item.memo) ctx.fillText(item.memo, x + 18, y + 63, colWidth - 48);
  });

  const link = document.createElement("a");
  link.download = `${safeFileName(title)}.png`;
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
  showToast("PNGを書き出しました");
}

function safeFileName(value) {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || defaultExportTitle();
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function showToast(message, tone = "default") {
  const current = document.querySelector(".toast");
  if (current) current.remove();
  const toast = document.createElement("div");
  toast.className = `toast ${tone === "warning" ? "warning" : ""}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function syncInputs() {
  dayStartInput.value = state.dayStart;
  dayEndInput.value = state.dayEnd;
  blockSelect.value = state.blockType;
  plannerTitle.textContent = blockLabels[state.blockType];
  exportTitleInput.value = state.exportTitle;
}

function render() {
  normalizeTimeline();
  syncInputs();
  renderMenu();
  renderTimeRail();
  renderWeek();
  renderDayTabs();
}

dayStartInput.addEventListener("change", () => {
  state.dayStart = clamp(Number(dayStartInput.value) || 6, 4, Math.min(12, state.dayEnd - 1));
  if (state.dayEnd <= state.dayStart) state.dayEnd = state.dayStart + 1;
  saveState();
  render();
});

dayEndInput.addEventListener("change", () => {
  state.dayEnd = clamp(Number(dayEndInput.value) || 19, 13, 19);
  if (state.dayEnd <= state.dayStart) state.dayStart = state.dayEnd - 1;
  saveState();
  render();
});

blockSelect.addEventListener("change", () => {
  state.blockType = blockSelect.value;
  saveState();
  render();
});

exportTitleInput.addEventListener("input", () => {
  state.exportTitle = exportTitleInput.value;
  saveState();
});

document.querySelector("#sampleButton").addEventListener("click", fillSample);
document.querySelector("#exportButton").addEventListener("click", exportPng);
document.querySelector("#resetButton").addEventListener("click", () => {
  state.workouts = [];
  saveState();
  render();
});
document.querySelector("#closeEditButton").addEventListener("click", closeEditDialog);
document.querySelector("#saveEditButton").addEventListener("click", saveEditedWorkout);
document.querySelector("#deleteEditButton").addEventListener("click", deleteEditedWorkout);
editModal.addEventListener("click", (event) => {
  if (event.target === editModal) closeEditDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !editModal.hidden) closeEditDialog();
});

loadState();
render();
loadMenusFromRepo();
