// ── Categories ──────────────────────────────────────────────
const EXPENSE_CATEGORIES = [
  'Food & Dining', 'Transportation', 'Housing', 'Utilities',
  'Entertainment', 'Shopping', 'Healthcare', 'Education',
  'Personal Care', 'Travel', 'Subscriptions', 'Other'
];

const INCOME_CATEGORIES = [
  'Salary', 'Freelance', 'Investments', 'Gifts', 'Refunds', 'Other'
];

const CATEGORY_ICONS = {
  'Food & Dining': '🍽️', 'Transportation': '🚗', 'Housing': '🏠',
  'Utilities': '💡', 'Entertainment': '🎬', 'Shopping': '🛒',
  'Healthcare': '🏥', 'Education': '📚', 'Personal Care': '💇',
  'Travel': '✈️', 'Subscriptions': '📱', 'Other': '📌',
  'Salary': '💰', 'Freelance': '💻', 'Investments': '📈',
  'Gifts': '🎁', 'Refunds': '↩️'
};

const CHART_COLORS = [
  '#818cf8', '#f87171', '#34d399', '#fbbf24', '#f472b6',
  '#22d3ee', '#a78bfa', '#fb923c', '#4ade80', '#e879f9',
  '#38bdf8', '#facc15'
];

// ── State ───────────────────────────────────────────────────
let transactions = [];
let budgets = JSON.parse(localStorage.getItem('ft_budgets') || '{}');
let currentMonth = new Date();
currentMonth.setDate(1);

let categoryChart = null;
let monthlyChart = null;

// ── Persistence ─────────────────────────────────────────────
function saveBudgets() {
  localStorage.setItem('ft_budgets', JSON.stringify(budgets));
}

async function fetchTransactions() {
  try {
    const resp = await fetch('/api/transactions');
    if (resp.ok) transactions = await resp.json();
  } catch (e) {
    console.error('Failed to fetch transactions:', e);
  }
}

// ── Helpers ─────────────────────────────────────────────────
function fmt(n) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthKey(date) {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Tab Navigation ──────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'dashboard') refreshDashboard();
    if (btn.dataset.tab === 'uber') refreshUber();
  });
});

// ── Month Navigation ────────────────────────────────────────
document.getElementById('prev-month').addEventListener('click', () => {
  currentMonth.setMonth(currentMonth.getMonth() - 1);
  refreshDashboard();
});

document.getElementById('next-month').addEventListener('click', () => {
  currentMonth.setMonth(currentMonth.getMonth() + 1);
  refreshDashboard();
});

// ── Category Dropdown Population ────────────────────────────
function populateCategoryDropdowns() {
  const txType = document.getElementById('tx-type');
  const txCat = document.getElementById('tx-category');
  const filterCat = document.getElementById('filter-category');
  const budgetCat = document.getElementById('budget-category');

  function updateTxCategories() {
    const cats = txType.value === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    txCat.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  txType.addEventListener('change', updateTxCategories);
  updateTxCategories();

  // Filter dropdown: all categories
  const allCats = [...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])];
  filterCat.innerHTML = '<option value="all">All Categories</option>' +
    allCats.map(c => `<option value="${c}">${c}</option>`).join('');

  // Budget dropdown: only expense categories
  budgetCat.innerHTML = EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
}

// ── Receipt Extraction ──────────────────────────────────────
const txReceiptInput = document.getElementById('tx-receipt-image');
const txExtractBtn = document.getElementById('tx-extract-btn');
const txExtractStatus = document.getElementById('tx-extract-status');

txReceiptInput.addEventListener('change', () => {
  txExtractBtn.style.display = txReceiptInput.files.length ? 'block' : 'none';
  txExtractStatus.style.display = 'none';
});

txExtractBtn.addEventListener('click', async () => {
  if (!txReceiptInput.files.length) return;

  txExtractBtn.disabled = true;
  txExtractBtn.textContent = 'Extracting with AI...';
  txExtractStatus.style.display = 'block';
  txExtractStatus.textContent = 'Analyzing receipt...';

  const formData = new FormData();
  formData.append('receiptImage', txReceiptInput.files[0]);

  try {
    const resp = await fetch('/api/extract-receipt', { method: 'POST', body: formData });
    const data = await resp.json();

    if (data.success) {
      // Pre-fill form
      document.getElementById('tx-type').value = 'expense';
      document.getElementById('tx-type').dispatchEvent(new Event('change'));

      // Wait a tick for category dropdown to repopulate
      setTimeout(() => {
        if (data.amount) document.getElementById('tx-amount').value = data.amount;
        if (data.date) document.getElementById('tx-date').value = data.date;
        if (data.storeName) document.getElementById('tx-description').value = data.storeName;
        if (data.category) {
          const catSelect = document.getElementById('tx-category');
          const match = Array.from(catSelect.options).find(o => o.value === data.category);
          if (match) catSelect.value = data.category;
        }
        txExtractStatus.textContent = 'Extracted! Review and submit below.';
        txExtractStatus.style.color = 'var(--income)';
      }, 50);
    } else {
      txExtractStatus.textContent = data.error || 'Could not extract receipt data.';
      txExtractStatus.style.color = 'var(--expense)';
    }
  } catch (err) {
    txExtractStatus.textContent = 'Error: ' + err.message;
    txExtractStatus.style.color = 'var(--expense)';
  } finally {
    txExtractBtn.disabled = false;
    txExtractBtn.textContent = 'Extract from Receipt';
  }
});

// ── Transactions ────────────────────────────────────────────
document.getElementById('transaction-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tx = {
    id: uid(),
    type: document.getElementById('tx-type').value,
    amount: parseFloat(document.getElementById('tx-amount').value),
    category: document.getElementById('tx-category').value,
    date: document.getElementById('tx-date').value,
    description: document.getElementById('tx-description').value.trim()
  };

  try {
    await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tx)
    });
    await fetchTransactions();
  } catch (err) {
    alert('Failed to save transaction: ' + err.message);
  }

  e.target.reset();
  document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('tx-type').dispatchEvent(new Event('change'));
  // Reset receipt upload
  txReceiptInput.value = '';
  document.getElementById('tx-receipt-preview').style.display = 'none';
  document.getElementById('tx-receipt-placeholder').style.display = 'flex';
  txExtractBtn.style.display = 'none';
  txExtractStatus.style.display = 'none';
  txExtractStatus.style.color = 'var(--accent)';
  renderTransactions();
  refreshDashboard();
});

async function deleteTransaction(id) {
  try {
    await fetch('/api/transactions/' + id, { method: 'DELETE' });
    await fetchTransactions();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
  renderTransactions();
  refreshDashboard();
}

function renderTransactions() {
  const list = document.getElementById('transaction-list');
  const filterType = document.getElementById('filter-type').value;
  const filterCat = document.getElementById('filter-category').value;

  let filtered = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  if (filterType !== 'all') filtered = filtered.filter(t => t.type === filterType);
  if (filterCat !== 'all') filtered = filtered.filter(t => t.category === filterCat);

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">No transactions yet. Add one above!</div>';
    return;
  }

  list.innerHTML = filtered.map(tx => `
    <div class="tx-item">
      <div class="tx-icon ${tx.type}">${CATEGORY_ICONS[tx.category] || '📌'}</div>
      <div class="tx-details">
        <div class="tx-cat">${tx.category}</div>
        <div class="tx-desc">${tx.description || '—'}</div>
      </div>
      <div class="tx-meta">
        <div class="tx-amount ${tx.type}">${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount)}</div>
        <div class="tx-date">${new Date(tx.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
      </div>
      <button class="tx-delete" onclick="deleteTransaction('${tx.id}')" title="Delete">&times;</button>
    </div>
  `).join('');
}

document.getElementById('filter-type').addEventListener('change', renderTransactions);
document.getElementById('filter-category').addEventListener('change', renderTransactions);

// ── Budgets ─────────────────────────────────────────────────
document.getElementById('budget-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const category = document.getElementById('budget-category').value;
  const amount = parseFloat(document.getElementById('budget-amount').value);
  budgets[category] = amount;
  saveBudgets();
  e.target.reset();
  renderBudgets();
});

function deleteBudget(category) {
  delete budgets[category];
  saveBudgets();
  renderBudgets();
}

function renderBudgets() {
  const list = document.getElementById('budget-list');
  const entries = Object.entries(budgets);

  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state">No budgets set. Create one above!</div>';
    return;
  }

  const mk = monthKey(currentMonth);
  list.innerHTML = entries.map(([cat, limit]) => {
    const spent = transactions
      .filter(t => t.type === 'expense' && t.category === cat && monthKey(t.date) === mk)
      .reduce((s, t) => s + t.amount, 0);
    const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
    const status = pct >= 100 ? 'over' : pct >= 75 ? 'warning' : 'ok';

    return `
      <div class="budget-item">
        <span class="budget-cat">${CATEGORY_ICONS[cat] || '📌'} ${cat}</span>
        <span class="budget-amt">${fmt(spent)} / ${fmt(limit)}</span>
        <button class="budget-delete" onclick="deleteBudget('${cat}')" title="Delete">&times;</button>
      </div>`;
  }).join('');
}

// ── Dashboard ───────────────────────────────────────────────
function refreshDashboard() {
  const mk = monthKey(currentMonth);
  document.getElementById('current-month-label').textContent = monthLabel(currentMonth);

  const monthTx = transactions.filter(t => monthKey(t.date) === mk);
  const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  document.getElementById('total-income').textContent = '+' + fmt(income);
  document.getElementById('total-expenses').textContent = '-' + fmt(expenses);
  const balance = income - expenses;
  document.getElementById('total-balance').textContent = (balance >= 0 ? '+' : '-') + fmt(balance);

  renderCategoryChart(monthTx);
  renderMonthlyChart();
  renderBudgetProgress(mk);
}

function renderCategoryChart(monthTx) {
  const expensesByCategory = {};
  monthTx.filter(t => t.type === 'expense').forEach(t => {
    expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + t.amount;
  });

  const labels = Object.keys(expensesByCategory);
  const data = Object.values(expensesByCategory);

  if (categoryChart) categoryChart.destroy();

  const ctx = document.getElementById('category-chart').getContext('2d');
  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: CHART_COLORS.slice(0, labels.length),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#8b8fa3', padding: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: $${ctx.parsed.toFixed(2)}`
          }
        }
      }
    }
  });
}

function renderMonthlyChart() {
  const months = [];
  const incomeData = [];
  const expenseData = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(currentMonth);
    d.setMonth(d.getMonth() - i);
    const mk = monthKey(d);
    months.push(d.toLocaleDateString('en-US', { month: 'short' }));

    const monthTx = transactions.filter(t => monthKey(t.date) === mk);
    incomeData.push(monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0));
    expenseData.push(monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  }

  if (monthlyChart) monthlyChart.destroy();

  const ctx = document.getElementById('monthly-chart').getContext('2d');
  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Income',
          data: incomeData,
          backgroundColor: 'rgba(52, 211, 153, 0.7)',
          borderRadius: 4
        },
        {
          label: 'Expenses',
          data: expenseData,
          backgroundColor: 'rgba(248, 113, 113, 0.7)',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        x: {
          grid: { color: 'rgba(46,51,69,0.5)' },
          ticks: { color: '#8b8fa3' }
        },
        y: {
          grid: { color: 'rgba(46,51,69,0.5)' },
          ticks: {
            color: '#8b8fa3',
            callback: (v) => '$' + v.toLocaleString()
          }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#8b8fa3', padding: 12 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}`
          }
        }
      }
    }
  });
}

function renderBudgetProgress(mk) {
  const container = document.getElementById('budget-progress-bars');
  const entries = Object.entries(budgets);

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:1rem">No budgets set yet.</div>';
    return;
  }

  container.innerHTML = entries.map(([cat, limit]) => {
    const spent = transactions
      .filter(t => t.type === 'expense' && t.category === cat && monthKey(t.date) === mk)
      .reduce((s, t) => s + t.amount, 0);
    const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
    const status = pct >= 100 ? 'over' : pct >= 75 ? 'warning' : 'ok';

    return `
      <div class="progress-item">
        <div class="progress-header">
          <span class="category-name">${CATEGORY_ICONS[cat] || '📌'} ${cat}</span>
          <span class="progress-amount">${fmt(spent)} / ${fmt(limit)}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${status}" style="width: ${pct}%"></div>
        </div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// ── UBER DRIVER TRACKER (API-backed) ────────────────────────
// ══════════════════════════════════════════════════════════════

let uberRecords = [];
let uberMonth = new Date();
uberMonth.setDate(1);

async function fetchUberRecords() {
  try {
    const resp = await fetch('/api/records');
    if (resp.ok) uberRecords = await resp.json();
  } catch (e) {
    console.error('Failed to fetch records:', e);
  }
}

// ── Image Preview ───────────────────────────────────────────
function setupImagePreview(inputId, previewId, placeholderId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const placeholder = document.getElementById(placeholderId);
  if (!input) return;
  input.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        preview.src = reader.result;
        preview.style.display = 'block';
        placeholder.style.display = 'none';
      };
      reader.readAsDataURL(file);
    } else {
      preview.style.display = 'none';
      placeholder.style.display = 'flex';
    }
  });
}

// ── Uber Month Navigation ───────────────────────────────────
document.getElementById('uber-prev-month').addEventListener('click', () => {
  uberMonth.setMonth(uberMonth.getMonth() - 1);
  renderUber();
});

document.getElementById('uber-next-month').addEventListener('click', () => {
  uberMonth.setMonth(uberMonth.getMonth() + 1);
  renderUber();
});

// ── Uber Form Submit ────────────────────────────────────────
document.getElementById('uber-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('uber-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Processing with AI...';

  const formData = new FormData(e.target);

  try {
    const resp = await fetch('/api/records', { method: 'POST', body: formData });
    if (resp.ok) {
      const data = await resp.json();
      if (data.syncError) alert('Record saved, but Notion sync failed: ' + data.syncError);
      if (data.extractionError) alert('Warning: ' + data.extractionError);
      e.target.reset();
      document.getElementById('uber-date').value = new Date().toISOString().split('T')[0];
      // Reset image previews
      document.getElementById('start-preview').style.display = 'none';
      document.getElementById('start-placeholder').style.display = 'flex';
      document.getElementById('odometer-preview').style.display = 'none';
      document.getElementById('odometer-placeholder').style.display = 'flex';
      document.getElementById('receipt-preview').style.display = 'none';
      document.getElementById('receipt-placeholder').style.display = 'flex';
      await fetchUberRecords();
      renderUber();
    } else {
      alert('Failed to save record.');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Record';
  }
});

// ── Uber Delete ─────────────────────────────────────────────
async function deleteUberRecord(id) {
  try {
    const resp = await fetch('/api/records/' + id, { method: 'DELETE' });
    if (resp.ok) {
      await fetchUberRecords();
      renderUber();
    } else {
      alert('Failed to delete.');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ── Uber Edit ───────────────────────────────────────────────
function openUberEdit(id) {
  const record = uberRecords.find(r => r.id === id);
  if (!record) return;
  document.getElementById('uber-edit-id').value = record.id;
  document.getElementById('uber-edit-date').value = record.date;
  document.getElementById('uber-edit-earnings').value = record.earnings || '';
  document.getElementById('uber-edit-start').value = record.start_miles || '';
  document.getElementById('uber-edit-odometer').value = record.odometer_reading || '';
  document.getElementById('uber-edit-personal').value = record.personal_miles || '';
  document.getElementById('uber-edit-gas').value = record.gas_cost || '';
  document.getElementById('uber-edit-notes').value = record.notes || '';
  document.getElementById('uber-edit-modal').style.display = 'flex';
}

function closeUberEdit() {
  document.getElementById('uber-edit-modal').style.display = 'none';
}

document.getElementById('uber-edit-close').addEventListener('click', closeUberEdit);
document.getElementById('uber-edit-cancel').addEventListener('click', closeUberEdit);

document.getElementById('uber-edit-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeUberEdit();
});

document.getElementById('uber-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData();
  formData.append('id', document.getElementById('uber-edit-id').value);
  formData.append('date', document.getElementById('uber-edit-date').value);
  formData.append('earnings', document.getElementById('uber-edit-earnings').value);
  formData.append('startMiles', document.getElementById('uber-edit-start').value);
  formData.append('odometerReading', document.getElementById('uber-edit-odometer').value);
  formData.append('personalMiles', document.getElementById('uber-edit-personal').value);
  formData.append('gasCost', document.getElementById('uber-edit-gas').value);
  formData.append('notes', document.getElementById('uber-edit-notes').value);

  try {
    const resp = await fetch('/api/records', { method: 'POST', body: formData });
    if (resp.ok) {
      closeUberEdit();
      await fetchUberRecords();
      renderUber();
    } else {
      alert('Failed to update.');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

// ── Uber Render ─────────────────────────────────────────────
function renderUber() {
  const mk = monthKey(uberMonth);
  document.getElementById('uber-month-label').textContent = monthLabel(uberMonth);

  const monthRecords = uberRecords.filter(r => monthKey(r.date) === mk);

  // Stats
  const totalEarnings = monthRecords.reduce((s, r) => s + (r.earnings || 0), 0);
  const totalGas = monthRecords.reduce((s, r) => s + (r.gas_cost || 0), 0);
  const totalPersonal = monthRecords.reduce((s, r) => s + (r.personal_miles || 0), 0);
  const net = totalEarnings - totalGas;

  // Calculate total driven miles from start/end per day
  let totalMiles = 0;
  monthRecords.forEach(r => {
    if (r.start_miles && r.odometer_reading) {
      totalMiles += r.odometer_reading - r.start_miles;
    }
  });

  document.getElementById('uber-total-earnings').textContent = '$' + totalEarnings.toFixed(2);
  document.getElementById('uber-total-gas').textContent = '$' + totalGas.toFixed(2);
  document.getElementById('uber-total-miles').textContent = totalMiles.toFixed(1);
  document.getElementById('uber-personal-miles').textContent = 'Personal: ' + totalPersonal.toFixed(1);
  document.getElementById('uber-net-profit').textContent = '$' + net.toFixed(2);

  // Record list
  const list = document.getElementById('uber-record-list');
  const sorted = [...uberRecords].sort((a, b) => b.date.localeCompare(a.date));

  if (sorted.length === 0) {
    list.innerHTML = '<div class="empty-state">No records yet. Add your first trip above!</div>';
    return;
  }

  list.innerHTML = sorted.map(r => {
    const earnings = r.earnings || 0;
    const gas = r.gas_cost || 0;
    const profit = earnings - gas;
    const profitClass = profit >= 0 ? '' : 'red';
    const dateStr = new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });

    // Mileage display: show start → end (driven)
    let mileageHtml = '';
    if (r.start_miles && r.odometer_reading) {
      const driven = (r.odometer_reading - r.start_miles).toFixed(1);
      mileageHtml = `<span class="value">${driven} mi driven</span>
        <br><span style="font-size:0.65rem;color:var(--text-muted)">${r.start_miles.toLocaleString()} → ${r.odometer_reading.toLocaleString()}</span>`;
    } else if (r.odometer_reading) {
      mileageHtml = `<span class="value">${r.odometer_reading.toLocaleString()} mi</span>`;
    } else if (r.start_miles) {
      mileageHtml = `<span class="value">Start: ${r.start_miles.toLocaleString()} mi</span>`;
    } else {
      mileageHtml = `<span class="value">N/A</span>`;
    }
    if (r.personal_miles) {
      mileageHtml += `<br><span style="font-size:0.65rem;color:var(--text-muted)">(Personal: ${r.personal_miles} mi)</span>`;
    }

    let imagesHtml = '';
    if (r.start_image_path || r.odometer_image_path || r.gas_receipt_image_path) {
      imagesHtml = '<div class="uber-record-images">';
      if (r.start_image_path) imagesHtml += `<a href="${r.start_image_path}" target="_blank"><img src="${r.start_image_path}" alt="Start odometer"></a>`;
      if (r.odometer_image_path) imagesHtml += `<a href="${r.odometer_image_path}" target="_blank"><img src="${r.odometer_image_path}" alt="End odometer"></a>`;
      if (r.gas_receipt_image_path) imagesHtml += `<a href="${r.gas_receipt_image_path}" target="_blank"><img src="${r.gas_receipt_image_path}" alt="Receipt"></a>`;
      imagesHtml += '</div>';
    }

    return `
      <div class="uber-record">
        <div class="uber-record-header">
          <span class="uber-record-date">${dateStr}</span>
          <div class="uber-record-actions">
            <button class="edit-btn" onclick="openUberEdit('${r.id}')" title="Edit">&#9998;</button>
            <button class="delete-btn" onclick="deleteUberRecord('${r.id}')" title="Delete">&times;</button>
          </div>
        </div>
        <div class="uber-record-grid">
          <div class="uber-record-field">
            <label>Mileage</label>
            ${mileageHtml}
          </div>
          <div class="uber-record-field">
            <label>Earnings</label>
            <span class="value green">$${earnings.toFixed(2)}</span>
          </div>
          <div class="uber-record-field">
            <label>Gas Cost</label>
            <span class="value red">-$${gas.toFixed(2)}</span>
          </div>
          <div class="uber-record-field">
            <label>Net Profit</label>
            <span class="value bold ${profitClass}">$${profit.toFixed(2)}</span>
          </div>
        </div>
        ${imagesHtml}
        ${r.notes ? `<div class="uber-record-notes">${r.notes}</div>` : ''}
      </div>`;
  }).join('');
}

// Alias for tab navigation compatibility
function refreshUber() { renderUber(); }

// ── Init ────────────────────────────────────────────────────
async function init() {
  document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('uber-date').value = new Date().toISOString().split('T')[0];
  populateCategoryDropdowns();
  await fetchTransactions();
  renderTransactions();
  renderBudgets();
  refreshDashboard();
  setupImagePreview('tx-receipt-image', 'tx-receipt-preview', 'tx-receipt-placeholder');
  setupImagePreview('uber-start-image', 'start-preview', 'start-placeholder');
  setupImagePreview('uber-odometer-image', 'odometer-preview', 'odometer-placeholder');
  setupImagePreview('uber-receipt-image', 'receipt-preview', 'receipt-placeholder');
  await fetchUberRecords();
  renderUber();
}

init();
