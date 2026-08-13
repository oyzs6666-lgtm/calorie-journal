const ENTRY_KEY = 'calorie-journal.entries.v1';
const UI_KEY = 'calorie-journal.ui.v1';

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const LEVEL_COLORS = [
  '#3F6655', '#66845D', '#8DA06A', '#AAB47A', '#C7BB72',
  '#D3A45F', '#DE8B55', '#CF744D', '#B95D47', '#98483F'
];
const TIME_BINS = [
  { start: 0, end: 8, label: '0–8', detailLabel: '0–8' },
  ...Array.from({ length: 13 }, (_, index) => ({
    start: index + 8,
    end: index + 9,
    label: String(index + 8),
    detailLabel: `${index + 8}–${index + 9}`
  })),
  { start: 21, end: 24, label: '21–24', detailLabel: '21–24' }
];

let entries = loadArray(ENTRY_KEY);
let uiState = loadObject(UI_KEY);
let statsDate = /^\d{4}-\d{2}-\d{2}$/.test(uiState.statsDate || '') ? uiState.statsDate : dateKey(new Date());
if (statsDate > dateKey(new Date())) statsDate = dateKey(new Date());
let currentView = uiState.view === 'stats' ? 'stats' : 'record';
let editingId = null;
let selectedBinIndex = null;
let chartBars = [];
let toastTimer;
let scrollSaveTimer;

const elements = {
  todayLabel: document.querySelector('#today-label'),
  todayCalories: document.querySelector('#today-calories'),
  foodName: document.querySelector('#food-name'),
  foodCalories: document.querySelector('#food-calories'),
  saveButton: document.querySelector('#save-button'),
  todayRecords: document.querySelector('#today-records'),
  entryCount: document.querySelector('#entry-count'),
  recordView: document.querySelector('#record-view'),
  statsView: document.querySelector('#stats-view'),
  navButtons: [...document.querySelectorAll('.nav-button')],
  editRecordDialog: document.querySelector('#edit-record-dialog'),
  editRecordForm: document.querySelector('#edit-record-form'),
  editFoodName: document.querySelector('#edit-food-name'),
  editFoodCalories: document.querySelector('#edit-food-calories'),
  editRecordTime: document.querySelector('#edit-record-time'),
  statsDateLabel: document.querySelector('#stats-date-label'),
  statsDateInput: document.querySelector('#stats-date-input'),
  nextDay: document.querySelector('#next-day'),
  chartTotalTitle: document.querySelector('#chart-total-title'),
  chartTotalValue: document.querySelector('#chart-total-value'),
  chart: document.querySelector('#calorie-chart'),
  chartWrap: document.querySelector('#chart-wrap'),
  chartEmpty: document.querySelector('#chart-empty'),
  chartTooltip: document.querySelector('#chart-tooltip'),
  statsFoodRecords: document.querySelector('#stats-food-records'),
  toast: document.querySelector('#toast')
};

function loadArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function loadObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function persistEntries() {
  localStorage.setItem(ENTRY_KEY, JSON.stringify(entries));
}

function persistUiState() {
  try { localStorage.setItem(UI_KEY, JSON.stringify(uiState)); } catch {}
}

function rememberUiState() {
  if (currentView === 'record') uiState.recordScroll = Math.max(0, window.scrollY || 0);
  uiState.view = currentView;
  uiState.statsDate = statsDate;
  persistUiState();
}

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(key, includeYear = true) {
  return new Intl.DateTimeFormat('zh-CN', {
    ...(includeYear ? { year: 'numeric' } : {}), month: 'long', day: 'numeric', weekday: 'long'
  }).format(dateFromKey(key));
}

function formatTime(value) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function makeId() {
  return crypto.randomUUID?.() || `calorie-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function colorForCalories(calories) {
  const value = Math.max(0, Number(calories) || 0);
  const level = Math.max(1, Math.min(10, Math.ceil(value / 100)));
  return LEVEL_COLORS[level - 1];
}

function roundedBarPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.closePath();
}

function entriesForDate(key) {
  return entries
    .filter((entry) => dateKey(entry.timestamp) === key)
    .sort((first, second) => new Date(first.timestamp) - new Date(second.timestamp));
}

function renderHome() {
  const today = dateKey(new Date());
  const records = entriesForDate(today).slice().reverse();
  const total = records.reduce((sum, entry) => sum + (Number(entry.calories) || 0), 0);
  elements.todayLabel.textContent = formatDate(today);
  elements.todayCalories.textContent = total.toLocaleString('zh-CN');
  elements.entryCount.textContent = `${records.length} 条`;
  elements.todayRecords.innerHTML = records.length ? records.map((entry) => {
    const calories = Number(entry.calories) || 0;
    const food = String(entry.food || '').trim() || '未填写食物名称';
    return `<article class="record-row">
      <button class="record-edit-button" type="button" data-edit="${entry.id}" aria-label="编辑${formatTime(entry.timestamp)}的记录">
        <span class="record-calorie-badge" style="--calorie-color:${colorForCalories(calories)}"><strong>${calories}</strong><small>kcal</small></span>
        <span class="record-main"><strong>${escapeHtml(food)}</strong><span>${calories} kcal</span></span>
        <time class="record-time" datetime="${entry.timestamp}">${formatTime(entry.timestamp)}</time>
      </button>
      <button class="delete-record" type="button" data-delete="${entry.id}" aria-label="删除${formatTime(entry.timestamp)}的记录">×</button>
    </article>`;
  }).join('') : '<p class="empty-records">今天还没有热量记录。</p>';
}

function updateSaveButton() {
  const calories = Number(elements.foodCalories.value);
  const valid = Number.isFinite(calories) && calories > 0;
  elements.saveButton.disabled = !valid;
  elements.saveButton.textContent = valid ? `记录 ${calories} kcal` : '填写热量后记录';
}

function saveRecord() {
  const calories = Number(elements.foodCalories.value);
  if (!Number.isFinite(calories) || calories <= 0 || calories > 99999) {
    showToast('请填写有效的热量数字');
    return;
  }
  const record = {
    id: makeId(),
    timestamp: new Date().toISOString(),
    food: elements.foodName.value.trim(),
    calories
  };
  entries.push(record);
  try {
    persistEntries();
  } catch {
    entries.pop();
    showToast('保存失败，浏览器存储空间可能已满');
    return;
  }
  elements.foodName.value = '';
  elements.foodCalories.value = '';
  updateSaveButton();
  renderHome();
  if (dateKey(record.timestamp) === statsDate) renderChart();
  showToast('热量记录已保存');
}

function deleteRecord(id) {
  const record = entries.find((entry) => entry.id === id);
  if (!record || !confirm(`删除 ${formatTime(record.timestamp)} 的 ${record.calories} kcal 记录？`)) return;
  entries = entries.filter((entry) => entry.id !== id);
  persistEntries();
  selectedBinIndex = null;
  renderHome();
  renderChart();
  showToast('记录已删除');
}

function openRecordEditor(id) {
  const record = entries.find((entry) => entry.id === id);
  if (!record) return;
  editingId = id;
  elements.editFoodName.value = record.food || '';
  elements.editFoodCalories.value = record.calories;
  const time = new Date(record.timestamp);
  elements.editRecordTime.value = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  elements.editRecordDialog.showModal();
}

function saveEditedRecord(event) {
  event.preventDefault();
  const index = entries.findIndex((entry) => entry.id === editingId);
  const calories = Number(elements.editFoodCalories.value);
  const timeParts = elements.editRecordTime.value.split(':').map(Number);
  if (index < 0 || !Number.isFinite(calories) || calories <= 0 || calories > 99999) {
    showToast('请填写有效的热量数字');
    return;
  }
  if (timeParts.length !== 2 || timeParts.some((value) => !Number.isFinite(value))) {
    showToast('请选择有效的记录时间');
    return;
  }
  const original = entries[index];
  const originalTime = new Date(original.timestamp);
  const updatedTime = new Date(
    originalTime.getFullYear(), originalTime.getMonth(), originalTime.getDate(),
    timeParts[0], timeParts[1], 0, 0
  );
  entries[index] = {
    ...original,
    food: elements.editFoodName.value.trim(),
    calories,
    timestamp: updatedTime.toISOString()
  };
  try {
    persistEntries();
  } catch {
    entries[index] = original;
    showToast('保存失败，请稍后重试');
    return;
  }
  editingId = null;
  selectedBinIndex = null;
  elements.editRecordDialog.close();
  renderHome();
  renderChart();
  showToast('记录已更新');
}

function restoreRecordScroll() {
  const target = Math.max(0, Number(uiState.recordScroll) || 0);
  const restore = () => window.scrollTo(0, target);
  restore();
  requestAnimationFrame(() => requestAnimationFrame(restore));
  setTimeout(restore, 120);
}

function showView(name) {
  if (currentView === 'record' && name !== 'record') uiState.recordScroll = Math.max(0, window.scrollY || 0);
  currentView = name === 'stats' ? 'stats' : 'record';
  uiState.view = currentView;
  uiState.statsDate = statsDate;
  persistUiState();
  const showStats = currentView === 'stats';
  document.documentElement.classList.toggle('stats-active', showStats);
  document.body.classList.toggle('stats-active', showStats);
  elements.recordView.hidden = showStats;
  elements.statsView.hidden = !showStats;
  elements.navButtons.forEach((button) => {
    const active = button.dataset.view === currentView;
    button.classList.toggle('is-active', active);
    active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current');
  });
  if (showStats) requestAnimationFrame(renderChart);
  else restoreRecordScroll();
}

function moveStatsDay(offset) {
  const date = dateFromKey(statsDate);
  date.setDate(date.getDate() + offset);
  const next = dateKey(date);
  if (next > dateKey(new Date())) return;
  statsDate = next;
  selectedBinIndex = null;
  rememberUiState();
  renderChart();
}

function binIndexForEntry(entry) {
  const time = new Date(entry.timestamp);
  const hour = time.getHours() + time.getMinutes() / 60 + time.getSeconds() / 3600;
  return TIME_BINS.findIndex((bin) => hour >= bin.start && hour < bin.end);
}

function calorieEntriesForStats() {
  return entriesForDate(statsDate).filter((entry) => Number(entry.calories) > 0);
}

function groupedCalories() {
  const groups = TIME_BINS.map((bin, binIndex) => ({ ...bin, binIndex, entries: [], total: 0 }));
  calorieEntriesForStats().forEach((entry) => {
    const binIndex = binIndexForEntry(entry);
    if (binIndex < 0) return;
    groups[binIndex].entries.push(entry);
    groups[binIndex].total += Number(entry.calories) || 0;
  });
  return groups.filter((group) => group.total > 0);
}

function renderStatsFoodRecords() {
  const foodRecords = calorieEntriesForStats().filter((entry) => String(entry.food || '').trim());
  elements.statsFoodRecords.innerHTML = foodRecords.map((entry) => `<article class="stats-food-row">
    <time class="stats-food-time" datetime="${entry.timestamp}">${formatTime(entry.timestamp)}</time>
    <div class="stats-food-name">${escapeHtml(entry.food)}</div>
    <div class="stats-food-calories">${entry.calories} kcal</div>
  </article>`).join('');
}

function foodLabelForGroup(group) {
  return group.entries
    .map((entry) => String(entry.food || '').trim())
    .filter(Boolean)
    .join('、');
}

function wrapChartLabel(ctx, text, maxWidth, maxLines = 5) {
  if (!text) return [];
  const characters = Array.from(text);
  const lines = [];
  let current = '';
  characters.forEach((character) => {
    const candidate = current + character;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  let last = visible[maxLines - 1];
  while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
  visible[maxLines - 1] = `${last}…`;
  return visible;
}

function renderChart() {
  renderStatsFoodRecords();
  const dailyTotal = calorieEntriesForStats().reduce((sum, entry) => sum + (Number(entry.calories) || 0), 0);
  elements.chartTotalTitle.textContent = statsDate === dateKey(new Date()) ? '今日总热量' : '当日总热量';
  elements.chartTotalValue.textContent = dailyTotal.toLocaleString('zh-CN');
  const bounds = elements.chartWrap.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const canvas = elements.chart;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(bounds.width * dpr);
  canvas.height = Math.round(bounds.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, bounds.width, bounds.height);

  elements.statsDateLabel.textContent = statsDate === dateKey(new Date()) ? '今天' : formatDate(statsDate, false);
  elements.statsDateInput.value = statsDate;
  elements.statsDateInput.max = dateKey(new Date());
  elements.nextDay.disabled = statsDate >= dateKey(new Date());
  elements.chartTooltip.hidden = true;

  const compact = bounds.height < 310;
  const groups = groupedCalories();
  const plotLeft = compact ? 27 : 30;
  const plotRight = bounds.width - 2;
  const binWidth = (plotRight - plotLeft) / TIME_BINS.length;
  const foodFontSize = 7;
  const foodLineHeight = 8;
  ctx.font = `${foodFontSize}px system-ui, sans-serif`;
  const over1000LabelLines = groups
    .filter((group) => group.total > 1000)
    .map((group) => wrapChartLabel(ctx, foodLabelForGroup(group), Math.max(7, binWidth - 2)).length);
  const over1000TopSpace = over1000LabelLines.length
    ? Math.max(20, Math.max(...over1000LabelLines) * foodLineHeight + 13)
    : 0;
  const plot = {
    left: plotLeft,
    right: plotRight,
    top: (compact ? 13 : 20) + over1000TopSpace,
    bottom: bounds.height - (compact ? 28 : 34)
  };
  const plotHeight = plot.bottom - plot.top;
  const calorieUnit = plotHeight / 11;
  const yFor = (calories) => {
    const value = Math.max(0, Number(calories) || 0);
    if (value > 1000) return plot.top;
    return plot.bottom - (value / 100) * calorieUnit;
  };

  ctx.font = `${compact ? 7 : 8}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let step = 0; step <= 10; step += 1) {
    const y = plot.bottom - step * calorieUnit;
    const is400Reference = step === 4;
    ctx.strokeStyle = is400Reference ? '#68786f' : (step === 0 || step === 10 ? '#d3cec5' : '#e9e5de');
    ctx.lineWidth = is400Reference ? 1.7 : 1;
    ctx.setLineDash(is400Reference ? [5, 3] : []);
    ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `${is400Reference ? '700' : '400'} ${compact ? 7 : 8}px system-ui, sans-serif`;
    ctx.fillStyle = is400Reference ? '#4f6258' : '#88847c';
    ctx.fillText(String(step * 100), plot.left - 4, y);
  }
  ctx.strokeStyle = '#d3cec5';
  ctx.beginPath(); ctx.moveTo(plot.left, plot.top); ctx.lineTo(plot.right, plot.top); ctx.stroke();
  ctx.font = `${compact ? 6 : 7}px system-ui, sans-serif`;
  ctx.fillStyle = '#8f3340';
  ctx.fillText('>1000', plot.left - 4, plot.top);

  ctx.font = `${compact ? 8 : 9}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  TIME_BINS.forEach((bin, index) => {
    const x = plot.left + index * binWidth;
    ctx.strokeStyle = '#ece8e1';
    ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke();
    ctx.fillStyle = '#88847c';
    ctx.fillText(bin.label, x + binWidth / 2, plot.bottom + 7);
  });
  ctx.beginPath(); ctx.moveTo(plot.right, plot.top); ctx.lineTo(plot.right, plot.bottom); ctx.stroke();

  elements.chartEmpty.hidden = groups.length > 0;
  const barWidth = Math.max(5, binWidth * 0.62);
  chartBars = groups.map((group) => {
    const centerX = plot.left + (group.binIndex + .5) * binWidth;
    const topY = yFor(group.total);
    return { ...group, x: centerX - barWidth / 2, y: topY, width: barWidth, height: plot.bottom - topY };
  });

  chartBars.forEach((bar) => {
    const radius = Math.min(4, bar.width * .28);
    ctx.fillStyle = colorForCalories(bar.total);
    roundedBarPath(ctx, bar.x, bar.y, bar.width, bar.height, radius);
    ctx.fill();
    if (bar.binIndex === selectedBinIndex) {
      ctx.strokeStyle = '#fffdf9';
      ctx.lineWidth = 4;
      roundedBarPath(ctx, bar.x - 2, bar.y - 2, bar.width + 4, bar.height + 4, radius + 2);
      ctx.stroke();
      ctx.strokeStyle = '#24231f';
      ctx.lineWidth = 2;
      roundedBarPath(ctx, bar.x - 2, bar.y - 2, bar.width + 4, bar.height + 4, radius + 2);
      ctx.stroke();
    }
  });

  const calorieFontSize = compact ? 7 : 8;
  ctx.font = `600 ${calorieFontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  chartBars.forEach((bar) => {
    const label = Number(bar.total).toLocaleString('zh-CN');
    const centerX = bar.x + bar.width / 2;
    const labelY = Math.max(compact ? 8 : 10, bar.y - 4);
    ctx.lineWidth = compact ? 2.5 : 3;
    ctx.strokeStyle = 'rgba(255,253,249,.96)';
    ctx.strokeText(label, centerX, labelY);
    ctx.fillStyle = '#47443e';
    ctx.fillText(label, centerX, labelY);

    const foodLabel = foodLabelForGroup(bar);
    if (!foodLabel) return;
    ctx.font = `${foodFontSize}px system-ui, sans-serif`;
    const lines = wrapChartLabel(ctx, foodLabel, Math.max(7, binWidth - 2));
    const foodBottom = labelY - calorieFontSize - 2;
    const startY = Math.max(1, foodBottom - lines.length * foodLineHeight);
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#88847c';
    lines.forEach((line, index) => ctx.fillText(line, centerX, startY + index * foodLineHeight));
    ctx.font = `600 ${calorieFontSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'bottom';
  });

  const selected = chartBars.find((bar) => bar.binIndex === selectedBinIndex);
  if (selected) {
    const foods = selected.entries.map((entry) => String(entry.food || '').trim()).filter(Boolean);
    const foodText = foods.length ? foods.join('、') : '未填写食物名称';
    elements.chartTooltip.textContent = `${selected.detailLabel}点 ｜ ${foodText} ｜ ${selected.total} kcal`;
    elements.chartTooltip.hidden = false;
  }
}

function selectChartBar(event) {
  const rect = elements.chart.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const hit = chartBars.find((bar) => x >= bar.x - 5 && x <= bar.x + bar.width + 5 && y >= bar.y - 8 && y <= bar.y + bar.height + 4);
  selectedBinIndex = hit ? hit.binIndex : null;
  renderChart();
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 1900);
}

elements.foodCalories.addEventListener('input', updateSaveButton);
elements.saveButton.addEventListener('click', saveRecord);
elements.todayRecords.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) { deleteRecord(deleteButton.dataset.delete); return; }
  const editButton = event.target.closest('[data-edit]');
  if (editButton) openRecordEditor(editButton.dataset.edit);
});
elements.editRecordForm.addEventListener('submit', saveEditedRecord);
document.querySelectorAll('[data-close-edit]').forEach((button) => button.addEventListener('click', () => {
  editingId = null;
  elements.editRecordDialog.close();
}));
elements.navButtons.forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelector('#previous-day').addEventListener('click', () => moveStatsDay(-1));
elements.nextDay.addEventListener('click', () => moveStatsDay(1));
elements.statsDateInput.addEventListener('change', () => {
  if (!elements.statsDateInput.value) return;
  statsDate = elements.statsDateInput.value;
  selectedBinIndex = null;
  rememberUiState();
  renderChart();
});
elements.chart.addEventListener('pointerdown', selectChartBar);

if ('ResizeObserver' in window) {
  const resizeObserver = new ResizeObserver(() => {
    if (!elements.statsView.hidden) renderChart();
  });
  resizeObserver.observe(elements.chartWrap);
} else {
  window.addEventListener('resize', () => { if (!elements.statsView.hidden) renderChart(); });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) rememberUiState();
  else {
    renderHome();
    if (statsDate > dateKey(new Date())) statsDate = dateKey(new Date());
    if (currentView === 'stats') renderChart();
    else restoreRecordScroll();
  }
});
window.addEventListener('scroll', () => {
  if (currentView !== 'record') return;
  uiState.recordScroll = Math.max(0, window.scrollY || 0);
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(persistUiState, 180);
}, { passive: true });
window.addEventListener('pagehide', rememberUiState);
window.addEventListener('pageshow', () => showView(currentView));

renderHome();
updateSaveButton();
showView(currentView);
