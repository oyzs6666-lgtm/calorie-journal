const ENTRY_KEY = 'calorie-journal.entries.v1';
const UI_KEY = 'calorie-journal.ui.v1';

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const LEVEL_COLORS = [
  '#234B3B', '#3F6655', '#66845D', '#8DA06A', '#AAB47A', '#C7BB72',
  '#D3A45F', '#DE8B55', '#CF744D', '#B95D47', '#98483F', '#8A1C1C'
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
let editingId = null;
let selectedBinIndex = null;
let chartBars = [];
let toastTimer;
let longPressTimer = null;
let longPressStart = null;
let longPressTriggered = false;
let calculatorExpression = '';
let calculatorHistory = '';
let calculatorResult = 0;
let calculatorJustEvaluated = false;

const elements = {
  todayLabel: document.querySelector('#today-label'),
  statsView: document.querySelector('#stats-view'),
  quickEntryForm: document.querySelector('#quick-entry-form'),
  quickFood: document.querySelector('#quick-food'),
  quickCalories: document.querySelector('#quick-calories'),
  quickSaveButton: document.querySelector('#quick-save-button'),
  calculatorOpenButton: document.querySelector('#calculator-open-button'),
  calculatorDialog: document.querySelector('#calculator-dialog'),
  calculatorGrid: document.querySelector('#calculator-grid'),
  calculatorExpression: document.querySelector('#calculator-expression'),
  calculatorResult: document.querySelector('#calculator-result'),
  kilojoulesPer100: document.querySelector('#kilojoules-per-100'),
  foodWeight: document.querySelector('#food-weight'),
  convertedKcal: document.querySelector('#converted-kcal'),
  addConvertedButton: document.querySelector('#add-converted-button'),
  editRecordDialog: document.querySelector('#edit-record-dialog'),
  editRecordForm: document.querySelector('#edit-record-form'),
  editFoodName: document.querySelector('#edit-food-name'),
  editFoodCalories: document.querySelector('#edit-food-calories'),
  editRecordTime: document.querySelector('#edit-record-time'),
  deleteEditRecord: document.querySelector('#delete-edit-record'),
  recordChoiceDialog: document.querySelector('#record-choice-dialog'),
  recordChoiceList: document.querySelector('#record-choice-list'),
  statsDateLabel: document.querySelector('#stats-date-label'),
  statsDateInput: document.querySelector('#stats-date-input'),
  nextDay: document.querySelector('#next-day'),
  chart: document.querySelector('#calorie-chart'),
  chartWrap: document.querySelector('#chart-wrap'),
  chartEmpty: document.querySelector('#chart-empty'),
  chartTooltip: document.querySelector('#chart-tooltip'),
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
  if (value >= 1100) return LEVEL_COLORS[11];
  const position = value / 100;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return LEVEL_COLORS[lowerIndex];
  return mixHexColors(LEVEL_COLORS[lowerIndex], LEVEL_COLORS[upperIndex], position - lowerIndex);
}

function mixHexColors(first, second, amount) {
  const channel = (hex, start) => parseInt(hex.slice(start, start + 2), 16);
  const blend = (start, end) => Math.round(start + (end - start) * amount).toString(16).padStart(2, '0');
  return `#${blend(channel(first, 1), channel(second, 1))}${blend(channel(first, 3), channel(second, 3))}${blend(channel(first, 5), channel(second, 5))}`;
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

function renderHeader() {
  elements.todayLabel.textContent = formatDate(dateKey(new Date()));
}

function updateQuickSaveButton() {
  const calories = Number(elements.quickCalories.value);
  const valid = Number.isFinite(calories) && calories > 0;
  elements.quickSaveButton.disabled = !valid;
  elements.quickSaveButton.textContent = '记录';
}

function formatCalculatorNumber(value, precision = 6) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round((value + Number.EPSILON) * 10 ** precision) / 10 ** precision;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function evaluateCalculatorExpression(expression = calculatorExpression) {
  const clean = String(expression || '').trim();
  if (!clean || clean.length > 120 || !/^[0-9+\-*/.()\s]+$/.test(clean) || /[+\-*/.(]$/.test(clean)) return null;
  try {
    const value = Function(`"use strict"; return (${clean})`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function calculatorDisplayExpression() {
  const source = calculatorJustEvaluated && calculatorHistory ? calculatorHistory : calculatorExpression;
  return source.replaceAll('*', '×').replaceAll('/', '÷').replaceAll('-', '−').replaceAll('+', '＋').replaceAll('(', '（').replaceAll(')', '）') || '\u00a0';
}

function commitCalculatorResult() {
  if (!Number.isFinite(calculatorResult) || calculatorResult <= 0) return;
  elements.quickCalories.value = String(Math.round(calculatorResult));
  updateQuickSaveButton();
}

function renderCalculator() {
  const evaluated = evaluateCalculatorExpression();
  if (evaluated !== null) calculatorResult = Math.round(evaluated);
  elements.calculatorExpression.textContent = calculatorDisplayExpression();
  elements.calculatorResult.textContent = Number(calculatorResult).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
  commitCalculatorResult();
}

function openCalculator() {
  const existing = Number(elements.quickCalories.value);
  const existingRounded = Number.isFinite(existing) && existing > 0 ? Math.round(existing) : 0;
  const draftValue = evaluateCalculatorExpression();
  const draftRounded = draftValue === null ? 0 : Math.round(draftValue);
  if (!calculatorExpression || existingRounded !== draftRounded) {
    calculatorExpression = existingRounded > 0 ? String(existingRounded) : '';
    calculatorResult = existingRounded;
    calculatorHistory = '';
    calculatorJustEvaluated = false;
  }
  renderCalculator();
  elements.calculatorDialog.showModal();
}

function appendCalculatorValue(value) {
  if (value === '(') {
    if (calculatorJustEvaluated) {
      calculatorExpression = '';
      calculatorHistory = '';
      calculatorJustEvaluated = false;
    }
    calculatorExpression += !calculatorExpression || /[+\-*/(]$/.test(calculatorExpression) ? '(' : '*(';
    renderCalculator();
    return;
  }
  if (value === ')') {
    const openCount = (calculatorExpression.match(/\(/g) || []).length;
    const closeCount = (calculatorExpression.match(/\)/g) || []).length;
    if (openCount > closeCount && calculatorExpression && !/[+\-*/.(]$/.test(calculatorExpression)) {
      calculatorExpression += ')';
      calculatorHistory = '';
      calculatorJustEvaluated = false;
      renderCalculator();
    }
    return;
  }
  const isOperator = ['+', '-', '*', '/'].includes(value);
  if (isOperator) {
    calculatorHistory = '';
    calculatorJustEvaluated = false;
    if (!calculatorExpression) {
      if (value === '-') calculatorExpression = '-';
      renderCalculator();
      return;
    }
    if (calculatorExpression.endsWith('(')) {
      if (value === '-') calculatorExpression += '-';
      renderCalculator();
      return;
    }
    calculatorExpression = /[+\-*/]$/.test(calculatorExpression)
      ? `${calculatorExpression.slice(0, -1)}${value}`
      : `${calculatorExpression}${value}`;
    renderCalculator();
    return;
  }
  if (calculatorJustEvaluated) {
    calculatorExpression = '';
    calculatorHistory = '';
    calculatorJustEvaluated = false;
  }
  if (calculatorExpression.endsWith(')')) calculatorExpression += '*';
  const currentPart = calculatorExpression.split(/[+\-*/()]/).pop() || '';
  if (value === '.' && currentPart.includes('.')) return;
  if (value === '.' && (!calculatorExpression || /[+\-*/]$/.test(calculatorExpression))) calculatorExpression += '0';
  calculatorExpression += value;
  renderCalculator();
}

function runCalculatorCommand(command) {
  if (command === 'clear') {
    calculatorExpression = '';
    calculatorHistory = '';
    calculatorResult = 0;
    calculatorJustEvaluated = false;
  } else if (command === 'backspace') {
    calculatorExpression = calculatorJustEvaluated ? '' : calculatorExpression.slice(0, -1);
    calculatorHistory = '';
    calculatorJustEvaluated = false;
    if (!calculatorExpression) calculatorResult = 0;
  } else if (command === 'equals') {
    const value = evaluateCalculatorExpression();
    if (value !== null) {
      calculatorHistory = calculatorExpression;
      calculatorExpression = String(Math.round(value));
      calculatorResult = Math.round(value);
      calculatorJustEvaluated = true;
    }
  }
  renderCalculator();
}

function updateKilojouleConversion() {
  const kilojoules = Number(elements.kilojoulesPer100.value);
  const weight = Number(elements.foodWeight.value);
  const converted = kilojoules > 0 && weight > 0 ? Math.round(kilojoules * weight / 418.4) : 0;
  elements.convertedKcal.textContent = converted > 0 ? converted.toLocaleString('zh-CN') : '0';
  elements.addConvertedButton.disabled = !(converted > 0 && Number.isFinite(converted));
  return converted;
}

function addConvertedCalories() {
  const converted = updateKilojouleConversion();
  if (!(converted > 0)) return;
  const value = String(converted);
  const current = evaluateCalculatorExpression();
  if (!calculatorExpression || current === 0) calculatorExpression = value;
  else if (/[+\-*/]$/.test(calculatorExpression)) calculatorExpression += value;
  else calculatorExpression += `+${value}`;
  calculatorHistory = '';
  calculatorJustEvaluated = false;
  renderCalculator();
}

function saveQuickRecord(event) {
  event.preventDefault();
  const calories = Number(elements.quickCalories.value);
  if (!Number.isFinite(calories) || calories <= 0 || calories > 99999) {
    showToast('请填写有效的热量数字');
    return;
  }
  const now = new Date();
  const selectedDate = dateFromKey(statsDate);
  selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
  const record = {
    id: makeId(),
    timestamp: selectedDate.toISOString(),
    food: elements.quickFood.value.trim(),
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
  elements.quickFood.value = '';
  elements.quickCalories.value = '';
  calculatorExpression = '';
  calculatorHistory = '';
  calculatorResult = 0;
  calculatorJustEvaluated = false;
  updateQuickSaveButton();
  selectedBinIndex = null;
  renderChart();
  showToast('热量记录已保存');
}

function deleteRecord(id) {
  const record = entries.find((entry) => entry.id === id);
  if (!record || !confirm(`删除 ${formatTime(record.timestamp)} 的 ${record.calories} kcal 记录？`)) return;
  entries = entries.filter((entry) => entry.id !== id);
  persistEntries();
  editingId = null;
  selectedBinIndex = null;
  if (elements.editRecordDialog.open) elements.editRecordDialog.close();
  if (elements.recordChoiceDialog.open) elements.recordChoiceDialog.close();
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
  renderChart();
  showToast('记录已更新');
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

function renderChart() {
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
  const dailyTotal = groups.reduce((sum, group) => sum + group.total, 0);
  const plotLeft = compact ? 27 : 30;
  const plotRight = bounds.width - 2;
  const binWidth = (plotRight - plotLeft) / TIME_BINS.length;
  const plot = {
    left: plotLeft,
    right: plotRight,
    top: compact ? 13 : 20,
    bottom: bounds.height - (compact ? 28 : 34)
  };
  const plotHeight = plot.bottom - plot.top;
  const calorieUnit = plotHeight / 11;
  const yFor = (calories) => {
    const value = Math.max(0, Number(calories) || 0);
    if (value > 1000) return plot.top;
    return plot.bottom - (value / 100) * calorieUnit;
  };

  ctx.font = `700 ${compact ? 8 : 11}px system-ui, sans-serif`;
  ctx.fillStyle = '#47443e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(dailyTotal.toLocaleString('zh-CN'), bounds.width / 2, compact ? 1 : 2);

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

  });

  const selected = chartBars.find((bar) => bar.binIndex === selectedBinIndex);
  if (selected) {
    const namedEntries = selected.entries.filter((entry) => String(entry.food || '').trim());
    const foodDetails = namedEntries
      .map((entry) => `${formatTime(entry.timestamp)}　${String(entry.food).trim()}　${Number(entry.calories).toLocaleString('zh-CN')} kcal`)
      .join('\n');
    elements.chartTooltip.style.whiteSpace = foodDetails ? 'pre-line' : 'normal';
    elements.chartTooltip.textContent = foodDetails
      ? `${selected.detailLabel}点 ｜ 合计 ${selected.total.toLocaleString('zh-CN')} kcal\n${foodDetails}`
      : `${selected.detailLabel}点 ｜ ${selected.total.toLocaleString('zh-CN')} kcal`;
    elements.chartTooltip.hidden = false;
  }
}

function chartBarAt(clientX, clientY) {
  const rect = elements.chart.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return chartBars.find((bar) => x >= bar.x - 5 && x <= bar.x + bar.width + 5 && y >= bar.y - 8 && y <= bar.y + bar.height + 4);
}

function selectChartBar(event) {
  const hit = chartBarAt(event.clientX, event.clientY);
  selectedBinIndex = hit ? hit.binIndex : null;
  renderChart();
}

function openBarEditor(bar) {
  if (!bar?.entries?.length) return;
  selectedBinIndex = bar.binIndex;
  renderChart();
  if (bar.entries.length === 1) {
    openRecordEditor(bar.entries[0].id);
    return;
  }
  elements.recordChoiceList.innerHTML = bar.entries.map((entry) => `<button class="record-choice-button" type="button" data-choice-record="${entry.id}"><time datetime="${entry.timestamp}">${formatTime(entry.timestamp)}</time><strong>${escapeHtml(entry.food || '未命名')} · ${Number(entry.calories).toLocaleString('zh-CN')} kcal</strong></button>`).join('');
  elements.recordChoiceDialog.showModal();
}

function startChartLongPress(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  clearTimeout(longPressTimer);
  longPressTriggered = false;
  longPressStart = { x:event.clientX, y:event.clientY };
  const bar = chartBarAt(event.clientX, event.clientY);
  if (!bar) return;
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    navigator.vibrate?.(35);
    openBarEditor(bar);
  }, 550);
}

function moveChartLongPress(event) {
  if (!longPressStart || !longPressTimer) return;
  if (Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 10) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function finishChartPress(event) {
  clearTimeout(longPressTimer);
  longPressTimer = null;
  longPressStart = null;
  if (longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  selectChartBar(event);
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 1900);
}

elements.quickCalories.addEventListener('input', updateQuickSaveButton);
elements.quickEntryForm.addEventListener('submit', saveQuickRecord);
elements.calculatorOpenButton.addEventListener('click', openCalculator);
elements.calculatorGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-calc-value],[data-calc-command]');
  if (!button) return;
  if (button.dataset.calcCommand) runCalculatorCommand(button.dataset.calcCommand);
  else appendCalculatorValue(button.dataset.calcValue);
});
elements.kilojoulesPer100.addEventListener('input', updateKilojouleConversion);
elements.foodWeight.addEventListener('input', updateKilojouleConversion);
elements.addConvertedButton.addEventListener('click', addConvertedCalories);
elements.calculatorDialog.addEventListener('click', (event) => {
  if (event.target !== elements.calculatorDialog) return;
  commitCalculatorResult();
  elements.calculatorDialog.close();
});
elements.calculatorDialog.addEventListener('close', commitCalculatorResult);
elements.editRecordForm.addEventListener('submit', saveEditedRecord);
elements.deleteEditRecord.addEventListener('click', () => { if (editingId) deleteRecord(editingId); });
document.querySelectorAll('[data-close-edit]').forEach((button) => button.addEventListener('click', () => {
  editingId = null;
  elements.editRecordDialog.close();
}));
elements.recordChoiceList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-choice-record]');
  if (!button) return;
  elements.recordChoiceDialog.close();
  openRecordEditor(button.dataset.choiceRecord);
});
document.querySelectorAll('[data-close-choice]').forEach((button) => button.addEventListener('click', () => elements.recordChoiceDialog.close()));
document.querySelector('#previous-day').addEventListener('click', () => moveStatsDay(-1));
elements.nextDay.addEventListener('click', () => moveStatsDay(1));
elements.statsDateInput.addEventListener('change', () => {
  if (!elements.statsDateInput.value) return;
  statsDate = elements.statsDateInput.value;
  selectedBinIndex = null;
  rememberUiState();
  renderChart();
});
elements.chart.addEventListener('pointerdown', startChartLongPress);
elements.chart.addEventListener('pointermove', moveChartLongPress);
elements.chart.addEventListener('pointerup', finishChartPress);
elements.chart.addEventListener('pointercancel', () => { clearTimeout(longPressTimer); longPressTimer=null; longPressStart=null; });
elements.chart.addEventListener('contextmenu', (event) => event.preventDefault());

if ('ResizeObserver' in window) {
  const resizeObserver = new ResizeObserver(() => {
    renderChart();
  });
  resizeObserver.observe(elements.chartWrap);
} else {
  window.addEventListener('resize', renderChart);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) rememberUiState();
  else {
    renderHeader();
    if (statsDate > dateKey(new Date())) statsDate = dateKey(new Date());
    renderChart();
  }
});
window.addEventListener('pagehide', rememberUiState);
window.addEventListener('pageshow', () => { renderHeader(); requestAnimationFrame(renderChart); });

renderHeader();
updateQuickSaveButton();
requestAnimationFrame(renderChart);
