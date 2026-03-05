// ── Helpers ─────────────────────────────────────────────────
function isImageFile(file) {
  if (file.type && isImageFile(file)) return true;
  const ext = (file.name || '').toLowerCase();
  return ext.endsWith('.heic') || ext.endsWith('.heif');
}

// ── Categories ──────────────────────────────────────────────
const EXPENSE_CATEGORIES = [
  'Food & Dining', 'Transportation', 'Housing', 'Utilities',
  'Entertainment', 'Shopping', 'Healthcare', 'Education',
  'Personal Care', 'Travel', 'Subscriptions', 'Interest & Fees', 'Other'
];

const INCOME_CATEGORIES = [
  'Salary', 'Freelance', 'Investments', 'Gifts', 'Refunds', 'Other'
];

const CATEGORY_ICONS = {
  'Food & Dining': '🍽️', 'Transportation': '🚗', 'Housing': '🏠',
  'Utilities': '💡', 'Entertainment': '🎬', 'Shopping': '🛒',
  'Healthcare': '🏥', 'Education': '📚', 'Personal Care': '💇',
  'Travel': '✈️', 'Subscriptions': '📱', 'Interest & Fees': '🏦', 'Other': '📌',
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

let bills = [];
let billPayments = [];
let billsMonth = new Date();
billsMonth.setDate(1);

// ── Persistence ─────────────────────────────────────────────
function saveBudgets() {
  localStorage.setItem('ft_budgets', JSON.stringify(budgets));
}

async function fetchTransactions() {
  try {
    const resp = await fetch('/api/transactions');
    if (resp.ok) {
      transactions = await resp.json();
      populateYearFilter();
    }
  } catch (e) {
    console.error('Failed to fetch transactions:', e);
  }
}

async function fetchBills() {
  try {
    const resp = await fetch('/api/bills');
    if (resp.ok) bills = await resp.json();
  } catch (e) { console.error('Failed to fetch bills:', e); }
}

async function fetchBillPayments() {
  try {
    const resp = await fetch('/api/bill-payments?month=' + monthKey(billsMonth));
    if (resp.ok) billPayments = await resp.json();
  } catch (e) { console.error('Failed to fetch bill payments:', e); }
}

// ── Helpers ─────────────────────────────────────────────────
function fmt(n) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
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
    if (btn.dataset.tab === 'dashboard') { fetchTransactions().then(() => { fetchUberRecords().then(refreshDashboard); }); }
    if (btn.dataset.tab === 'transactions') { fetchTransactions().then(renderTransactions); }
    if (btn.dataset.tab === 'uber') { fetchUberRecords().then(refreshUber); }
    if (btn.dataset.tab === 'yb') { fetchTransactions().then(refreshYB); }
    if (btn.dataset.tab === 'tax') refreshTax();
    if (btn.dataset.tab === 'receipts') refreshReceipts();
    if (btn.dataset.tab === 'bills') refreshBills();
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
let pendingReceiptImagePath = null;

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

    // Save receipt image path (kept on server now)
    if (data.receiptImagePath) pendingReceiptImagePath = data.receiptImagePath;

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

// ── Batch Receipt Extraction ────────────────────────────────
const batchReceiptInput = document.getElementById('batch-receipt-input');
const batchReceiptBtn = document.getElementById('batch-receipt-btn');
const batchReceiptStatus = document.getElementById('batch-receipt-status');

batchReceiptInput.addEventListener('change', () => {
  batchReceiptBtn.style.display = batchReceiptInput.files.length ? 'block' : 'none';
  batchReceiptStatus.style.display = 'none';
  const placeholder = document.getElementById('batch-receipt-placeholder');
  if (batchReceiptInput.files.length) {
    placeholder.innerHTML = `<span class="upload-icon">&#128206;</span><span>${batchReceiptInput.files.length} receipt(s) selected</span>`;
  }
});

batchReceiptBtn.addEventListener('click', async () => {
  const files = batchReceiptInput.files;
  if (!files.length) return;

  batchReceiptBtn.disabled = true;
  batchReceiptBtn.textContent = 'Extracting...';
  batchReceiptStatus.style.display = 'block';

  const results = [];
  for (let i = 0; i < files.length; i++) {
    batchReceiptStatus.textContent = `Processing receipt ${i + 1} of ${files.length}...`;
    const formData = new FormData();
    formData.append('receiptImage', files[i]);
    try {
      const resp = await fetch('/api/extract-receipt', { method: 'POST', body: formData });
      const data = await resp.json();
      if (data.success) {
        results.push({
          description: data.storeName || 'Unknown',
          amount: data.amount || 0,
          date: data.date || new Date().toISOString().split('T')[0],
          category: data.category || 'Other',
          type: 'expense',
          receiptImagePath: data.receiptImagePath || null
        });
      }
    } catch (err) {
      console.error('Batch receipt error:', err);
    }
  }

  if (results.length > 0) {
    pendingStatementTx = results;
    document.getElementById('statement-business').value = document.getElementById('batch-receipt-business').value;
    showStatementReview();
    batchReceiptStatus.textContent = `Extracted ${results.length} of ${files.length} receipts.`;
    batchReceiptStatus.style.color = 'var(--income)';
  } else {
    batchReceiptStatus.textContent = 'Could not extract any receipts.';
    batchReceiptStatus.style.color = 'var(--expense)';
  }

  batchReceiptBtn.disabled = false;
  batchReceiptBtn.textContent = 'Extract All Receipts';
  batchReceiptInput.value = '';
  document.getElementById('batch-receipt-placeholder').innerHTML = '<span class="upload-icon">&#128206;</span><span>Drag & drop or tap to upload multiple receipts</span><span class="upload-hint">(AI extracts each receipt — review before saving)</span>';
  batchReceiptBtn.style.display = 'none';
});

// ── Statement Extraction ────────────────────────────────────
const stmtFile = document.getElementById('statement-file');
const stmtExtractBtn = document.getElementById('statement-extract-btn');
const stmtStatus = document.getElementById('statement-status');
let pendingStatementTx = [];

stmtFile.addEventListener('change', () => {
  stmtExtractBtn.style.display = stmtFile.files.length ? 'block' : 'none';
  stmtStatus.style.display = 'none';
  // Show preview for images (not PDFs)
  const file = stmtFile.files[0];
  const preview = document.getElementById('statement-preview');
  const placeholder = document.getElementById('statement-placeholder');
  if (file && isImageFile(file)) {
    const reader = new FileReader();
    reader.onloadend = () => { preview.src = reader.result; preview.style.display = 'block'; placeholder.style.display = 'none'; };
    reader.readAsDataURL(file);
  } else if (file) {
    preview.style.display = 'none';
    placeholder.innerHTML = '<span class="upload-icon">&#128196;</span><span>' + file.name + '</span><span class="upload-hint">(PDF ready)</span>';
  }
});

stmtExtractBtn.addEventListener('click', async () => {
  if (!stmtFile.files.length) return;
  stmtExtractBtn.disabled = true;
  stmtExtractBtn.textContent = 'Extracting with AI...';
  stmtStatus.style.display = 'block';
  stmtStatus.textContent = 'Analyzing statement... this may take a moment.';

  const formData = new FormData();
  formData.append('statementFile', stmtFile.files[0]);

  try {
    const resp = await fetch('/api/extract-statement', { method: 'POST', body: formData });
    const data = await resp.json();
    if (data.success && data.transactions?.length) {
      pendingStatementTx = data.transactions;
      showStatementReview();
      stmtStatus.textContent = `Found ${data.transactions.length} transactions.`;
      stmtStatus.style.color = 'var(--income)';
    } else {
      stmtStatus.textContent = data.error || 'No transactions found.';
      stmtStatus.style.color = 'var(--expense)';
    }
  } catch (err) {
    stmtStatus.textContent = 'Error: ' + err.message;
    stmtStatus.style.color = 'var(--expense)';
  } finally {
    stmtExtractBtn.disabled = false;
    stmtExtractBtn.textContent = 'Extract Transactions';
  }
});

function showStatementReview() {
  const business = document.getElementById('statement-business').value;
  const container = document.getElementById('statement-items');
  container.innerHTML = pendingStatementTx.map((tx, i) => `
    <div class="tx-item" style="flex-wrap:wrap;gap:0.3rem;padding:0.6rem" data-idx="${i}">
      <div style="display:flex;align-items:center;gap:0.5rem;width:100%">
        <input type="checkbox" checked data-stmt-check="${i}" style="width:1rem;height:1rem">
        <span style="flex:1;font-size:0.85rem">${tx.description || 'Unknown'}</span>
        <span style="font-weight:600;font-size:0.85rem;color:${tx.type === 'income' ? 'var(--income)' : 'var(--expense)'}">
          ${tx.type === 'income' ? '+' : '-'}$${parseFloat(tx.amount).toFixed(2)}
        </span>
      </div>
      <div style="display:flex;gap:0.4rem;width:100%;padding-left:1.5rem;font-size:0.75rem;color:var(--text-muted)">
        <span>${tx.date}</span>
        <select data-stmt-cat="${i}" style="font-size:0.75rem;padding:1px 4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px">
          ${EXPENSE_CATEGORIES.map(c => `<option value="${c}" ${c === tx.category ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');

  document.getElementById('statement-count').textContent = `${pendingStatementTx.length} items`;
  document.getElementById('statement-modal').style.display = 'flex';
}

document.getElementById('statement-modal-close').addEventListener('click', () => {
  document.getElementById('statement-modal').style.display = 'none';
});
document.getElementById('statement-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

document.getElementById('statement-save-btn').addEventListener('click', async () => {
  const business = document.getElementById('statement-business').value;
  const toSave = [];
  pendingStatementTx.forEach((tx, i) => {
    const checked = document.querySelector(`[data-stmt-check="${i}"]`)?.checked;
    if (!checked) return;
    const category = document.querySelector(`[data-stmt-cat="${i}"]`)?.value || tx.category;
    toSave.push({
      id: uid(),
      type: tx.type || 'expense',
      amount: parseFloat(tx.amount),
      category,
      date: tx.date,
      description: tx.description || '',
      business
    });
  });

  if (toSave.length === 0) return alert('No transactions selected.');

  const btn = document.getElementById('statement-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await fetch('/api/transactions/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: toSave })
    });
    await fetchTransactions();
    renderTransactions();
    refreshDashboard();
    document.getElementById('statement-modal').style.display = 'none';
    // Reset
    stmtFile.value = '';
    document.getElementById('statement-preview').style.display = 'none';
    document.getElementById('statement-placeholder').innerHTML = '<span class="upload-icon">&#128196;</span><span>Upload PDF or photo of statement</span><span class="upload-hint">(AI extracts all line items)</span>';
    stmtExtractBtn.style.display = 'none';
    stmtStatus.textContent = `Saved ${toSave.length} transactions!`;
    stmtStatus.style.color = 'var(--income)';
  } catch (err) {
    alert('Failed to save: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save All';
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
    description: document.getElementById('tx-description').value.trim(),
    business: document.getElementById('tx-business').value,
    receipt_image_path: pendingReceiptImagePath || null
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
  pendingReceiptImagePath = null;
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

function populateYearFilter() {
  const years = new Set();
  transactions.forEach(t => years.add(new Date(t.date + 'T00:00:00').getFullYear()));
  uberRecords.forEach(r => years.add(new Date(r.date + 'T00:00:00').getFullYear()));
  const sorted = [...years].sort((a, b) => b - a);
  const select = document.getElementById('filter-year');
  const current = select.value;
  select.innerHTML = '<option value="all">All Years</option>' +
    sorted.map(y => `<option value="${y}">${y}</option>`).join('');
  if (current !== 'all') select.value = current;
}

function renderTransactions() {
  const list = document.getElementById('transaction-list');
  const filterYear = document.getElementById('filter-year').value;
  const filterType = document.getElementById('filter-type').value;
  const filterCat = document.getElementById('filter-category').value;
  const filterBiz = document.getElementById('filter-business').value;

  let filtered = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  if (filterYear !== 'all') filtered = filtered.filter(t => new Date(t.date + 'T00:00:00').getFullYear() === parseInt(filterYear));
  if (filterType !== 'all') filtered = filtered.filter(t => t.type === filterType);
  if (filterCat !== 'all') filtered = filtered.filter(t => t.category === filterCat);
  if (filterBiz !== 'all') filtered = filtered.filter(t => (t.business || '') === filterBiz);

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">No transactions yet. Add one above!</div>';
    return;
  }

  list.innerHTML = filtered.map(tx => {
    const bizTag = tx.business ? `<span style="font-size:0.6rem;background:var(--accent);color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">${tx.business}</span>` : '';
    return `
    <div class="tx-item">
      <div class="tx-icon ${tx.type}">${CATEGORY_ICONS[tx.category] || '📌'}</div>
      <div class="tx-details">
        <div class="tx-cat">${tx.category}${bizTag}</div>
        <div class="tx-desc">${tx.description || '—'}</div>
      </div>
      <div class="tx-meta">
        <div class="tx-amount ${tx.type}">${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount)}</div>
        <div class="tx-date">${new Date(tx.date + 'T00:00:00').toLocaleDateString('en-US', filterYear === 'all' ? { year: 'numeric', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })}</div>
      </div>
      <button class="tx-delete" onclick="deleteTransaction('${tx.id}')" title="Delete">&times;</button>
    </div>`;
  }).join('');
}

document.getElementById('filter-year').addEventListener('change', renderTransactions);
document.getElementById('filter-type').addEventListener('change', renderTransactions);
document.getElementById('filter-category').addEventListener('change', renderTransactions);
document.getElementById('filter-business').addEventListener('change', renderTransactions);

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
  let income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  let expenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  // Include Uber records (earnings + gas)
  const monthUber = uberRecords.filter(r => monthKey(r.date) === mk);
  income += monthUber.reduce((s, r) => s + (r.earnings || 0), 0);
  expenses += monthUber.reduce((s, r) => s + (r.gas_cost || 0), 0);

  const interest = monthTx.filter(t => t.type === 'expense' && t.category === 'Interest & Fees').reduce((s, t) => s + t.amount, 0);

  document.getElementById('total-income').textContent = '+' + fmt(income);
  document.getElementById('total-expenses').textContent = '-' + fmt(expenses);
  const balance = income - expenses;
  document.getElementById('total-balance').textContent = (balance >= 0 ? '+' : '-') + fmt(balance);
  document.getElementById('total-interest').textContent = '-' + fmt(interest);

  renderCategoryChart(monthTx, monthUber);
  renderMonthlyChart();
  renderBudgetProgress(mk);
}

function renderCategoryChart(monthTx, monthUber) {
  const expensesByCategory = {};
  monthTx.filter(t => t.type === 'expense').forEach(t => {
    expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + t.amount;
  });
  // Include Uber gas in chart
  if (monthUber) {
    const uberGas = monthUber.reduce((s, r) => s + (r.gas_cost || 0), 0);
    if (uberGas > 0) expensesByCategory['Gas (Uber)'] = (expensesByCategory['Gas (Uber)'] || 0) + uberGas;
  }

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
    const mUber = uberRecords.filter(r => monthKey(r.date) === mk);
    incomeData.push(monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0) + mUber.reduce((s, r) => s + (r.earnings || 0), 0));
    expenseData.push(monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) + mUber.reduce((s, r) => s + (r.gas_cost || 0), 0));
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

  function showPreview(file) {
    const reader = new FileReader();
    reader.onloadend = () => {
      preview.src = reader.result;
      preview.style.display = 'block';
      placeholder.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  input.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) { showPreview(file); }
    else { preview.style.display = 'none'; placeholder.style.display = 'flex'; }
  });

  // Drag & drop
  const zone = input.closest('.form-group')?.querySelector('.upload-zone');
  if (!zone) return;
  let dc = 0;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); dc++; zone.classList.add('drag-over'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; });
  zone.addEventListener('dragleave', (e) => { e.stopPropagation(); dc--; if (dc <= 0) { dc = 0; zone.classList.remove('drag-over'); } });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dc = 0;
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files?.[0];
    if (file && (isImageFile(file) || file.type === 'application/pdf')) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

function setupDropZone(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  // Search up from input to find the nearest .upload-zone sibling
  const container = input.closest('.form-container') || input.parentElement;
  const zone = container.querySelector('.upload-zone');
  if (!zone) { console.warn('No .upload-zone found for', inputId); return; }

  let dragCounter = 0; // Track enter/leave on child elements
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); dragCounter++; zone.classList.add('drag-over'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; });
  zone.addEventListener('dragleave', (e) => { e.stopPropagation(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; zone.classList.remove('drag-over'); } });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    zone.classList.remove('drag-over');
    const dt = new DataTransfer();
    const droppedFiles = e.dataTransfer.files;
    if (input.multiple) {
      for (const f of droppedFiles) {
        if (isImageFile(f) || f.type === 'application/pdf') dt.items.add(f);
      }
    } else {
      const f = droppedFiles[0];
      if (f && (isImageFile(f) || f.type === 'application/pdf')) dt.items.add(f);
    }
    if (dt.files.length) {
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

// Prevent browser from opening files dropped outside a drop zone
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
setupDropZone('statement-file');
setupDropZone('yb-statement-file');
setupDropZone('batch-receipt-input');
setupDropZone('batch-odometer-input');

// ── Batch Odometer Upload ───────────────────────────────────
const batchOdoInput = document.getElementById('batch-odometer-input');
const batchOdoBtn = document.getElementById('batch-odometer-btn');
const batchOdoStatus = document.getElementById('batch-odometer-status');

batchOdoInput.addEventListener('change', () => {
  batchOdoBtn.style.display = batchOdoInput.files.length ? 'block' : 'none';
  batchOdoStatus.style.display = 'none';
  const placeholder = document.getElementById('batch-odometer-placeholder');
  if (batchOdoInput.files.length) {
    placeholder.innerHTML = `<span class="upload-icon">&#128247;</span><span>${batchOdoInput.files.length} photo(s) selected</span>`;
  }
});

batchOdoBtn.addEventListener('click', async () => {
  const files = batchOdoInput.files;
  if (!files.length) return;

  batchOdoBtn.disabled = true;
  batchOdoBtn.textContent = 'Processing...';
  batchOdoStatus.style.display = 'block';

  // Phase 1: Extract reading + date from each photo
  const extractions = [];
  for (let i = 0; i < files.length; i++) {
    batchOdoStatus.textContent = `Extracting photo ${i + 1} of ${files.length}...`;
    const fd = new FormData();
    fd.append('image', files[i]);
    try {
      const resp = await fetch('/api/extract-odometer', { method: 'POST', body: fd });
      if (resp.ok) {
        const data = await resp.json();
        extractions.push({
          reading: data.reading,
          date: data.date || new Date().toISOString().split('T')[0],
          filename: data.filename,
          error: data.error
        });
      } else {
        extractions.push({ reading: null, date: null, filename: null, error: 'Upload failed' });
      }
    } catch (err) {
      extractions.push({ reading: null, date: null, filename: null, error: err.message });
    }
  }

  // Phase 2: Group by date
  const byDate = {};
  for (const ex of extractions) {
    if (!ex.date || ex.reading === null) continue;
    if (!byDate[ex.date]) byDate[ex.date] = [];
    byDate[ex.date].push(ex);
  }

  // Phase 3: Classify and create records (chronological order for gap calc)
  //
  // Classification:
  //   Reading < 1000  → trip meter (personal miles indicator)
  //   Reading >= 1000 → actual odometer reading
  //
  // Personal miles logic (handled server-side):
  //   When startMiles is set, the server finds the previous day's end miles
  //   and calculates: gap = today's start - previous day's end
  //   This gap is saved as the PREVIOUS day's personal_miles.
  //   We do NOT send personalMiles explicitly — the server auto-calculates.
  //
  // Patterns:
  //   trip meter + 1 odometer → start-of-day (odometer = startMiles)
  //   2 odometers            → start + end (lower = start, higher = end)
  //   1 odometer alone       → end-of-day (odometer = odometerReading)
  let saved = 0;
  let errors = 0;
  let autoPaired = 0;
  let tripMeterDays = 0;
  const dates = Object.keys(byDate).sort(); // chronological for gap calc chain
  for (let di = 0; di < dates.length; di++) {
    const dt = dates[di];
    const group = byDate[dt];
    batchOdoStatus.textContent = `Creating record ${di + 1} of ${dates.length} (${dt})...`;

    const tripMeter = group.filter(e => e.reading < 1000);
    const odometer = group.filter(e => e.reading >= 1000).sort((a, b) => a.reading - b.reading);
    const hasTripMeter = tripMeter.length > 0;

    const formData = new FormData();
    formData.append('date', dt);
    formData.append('earnings', '0');

    if (odometer.length >= 2) {
      // Two+ odometer photos: lowest = start, highest = end
      formData.append('startMiles', odometer[0].reading);
      formData.append('startImageFilename', odometer[0].filename);
      formData.append('odometerReading', odometer[odometer.length - 1].reading);
      formData.append('odometerImageFilename', odometer[odometer.length - 1].filename);
      autoPaired++;
    } else if (odometer.length === 1 && hasTripMeter) {
      // Trip meter + one odometer = start-of-day pattern
      // Server will auto-calc personal miles from gap to previous day's end
      formData.append('startMiles', odometer[0].reading);
      formData.append('startImageFilename', odometer[0].filename);
      tripMeterDays++;
    } else if (odometer.length === 1) {
      // Single odometer, no trip meter = end of day
      formData.append('odometerReading', odometer[0].reading);
      formData.append('odometerImageFilename', odometer[0].filename);
    } else {
      // Only trip meter photos, no actual odometer — skip
      continue;
    }

    try {
      const resp = await fetch('/api/records', { method: 'POST', body: formData });
      if (resp.ok) {
        saved++;
      } else { errors++; }
    } catch (err) {
      console.error('Batch record error:', err);
      errors++;
    }
  }

  const failedExtractions = extractions.filter(e => e.reading === null).length;

  await fetchUberRecords();
  renderUber();

  let msg = `Done: ${saved} record(s) from ${extractions.length} photos.`;
  if (failedExtractions) msg += ` ${failedExtractions} unreadable.`;
  if (autoPaired) msg += ` ${autoPaired} day(s) auto-paired start/end.`;
  if (tripMeterDays) msg += ` ${tripMeterDays} day(s) with trip meter (start miles set, personal miles auto-calculated from gap).`;
  batchOdoStatus.textContent = msg;
  batchOdoStatus.style.color = errors ? 'var(--expense)' : 'var(--income)';
  batchOdoBtn.disabled = false;
  batchOdoBtn.textContent = 'Process All Photos';
  batchOdoInput.value = '';
  document.getElementById('batch-odometer-placeholder').innerHTML = '<span class="upload-icon">&#128247;</span><span>Drag & drop or tap to upload multiple photos</span><span class="upload-hint">(Odometer photos — AI reads values, EXIF dates, auto-pairs start/end)</span>';
  batchOdoBtn.style.display = 'none';
});

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

  // Record list (filtered by selected month)
  const list = document.getElementById('uber-record-list');
  const sorted = monthRecords.sort((a, b) => b.date.localeCompare(a.date));

  if (sorted.length === 0) {
    list.innerHTML = '<div class="empty-state">No records for this month. Use the arrows to navigate.</div>';
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

// ══════════════════════════════════════════════════════════════
// ── 易北教育 TAB ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

const CAPITAL_CATEGORIES = ['Owner Contribution', 'Owner Draw', 'Other'];

let ybMonth = new Date();
ybMonth.setDate(1);

function updateYbCategories() {
  const type = document.getElementById('yb-type').value;
  const catSelect = document.getElementById('yb-category');
  let cats;
  if (type === 'income') cats = INCOME_CATEGORIES;
  else if (type === 'capital') cats = CAPITAL_CATEGORIES;
  else cats = EXPENSE_CATEGORIES;
  catSelect.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

document.getElementById('yb-prev-month').addEventListener('click', () => {
  ybMonth.setMonth(ybMonth.getMonth() - 1);
  renderYB();
});

document.getElementById('yb-next-month').addEventListener('click', () => {
  ybMonth.setMonth(ybMonth.getMonth() + 1);
  renderYB();
});

document.getElementById('yb-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tx = {
    id: uid(),
    type: document.getElementById('yb-type').value,
    amount: parseFloat(document.getElementById('yb-amount').value),
    category: document.getElementById('yb-category').value,
    date: document.getElementById('yb-date').value,
    description: document.getElementById('yb-description').value.trim(),
    business: '易北教育'
  };

  try {
    await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tx)
    });
    await fetchTransactions();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }

  e.target.reset();
  document.getElementById('yb-date').value = new Date().toISOString().split('T')[0];
  updateYbCategories();
  renderYB();
  renderTransactions();
  refreshDashboard();
});

// YB Statement extraction (reuses server endpoint + review modal)
const ybStmtFile = document.getElementById('yb-statement-file');
const ybStmtBtn = document.getElementById('yb-statement-extract-btn');
const ybStmtStatus = document.getElementById('yb-statement-status');

ybStmtFile.addEventListener('change', () => {
  ybStmtBtn.style.display = ybStmtFile.files.length ? 'block' : 'none';
  ybStmtStatus.style.display = 'none';
  const file = ybStmtFile.files[0];
  const preview = document.getElementById('yb-statement-preview');
  const placeholder = document.getElementById('yb-statement-placeholder');
  if (file && isImageFile(file)) {
    const reader = new FileReader();
    reader.onloadend = () => { preview.src = reader.result; preview.style.display = 'block'; placeholder.style.display = 'none'; };
    reader.readAsDataURL(file);
  } else if (file) {
    preview.style.display = 'none';
    placeholder.innerHTML = '<span class="upload-icon">&#128196;</span><span>' + file.name + '</span><span class="upload-hint">(PDF ready)</span>';
  }
});

ybStmtBtn.addEventListener('click', async () => {
  if (!ybStmtFile.files.length) return;
  ybStmtBtn.disabled = true;
  ybStmtBtn.textContent = 'Extracting with AI...';
  ybStmtStatus.style.display = 'block';
  ybStmtStatus.textContent = 'Analyzing statement...';

  const formData = new FormData();
  formData.append('statementFile', ybStmtFile.files[0]);

  try {
    const resp = await fetch('/api/extract-statement', { method: 'POST', body: formData });
    const data = await resp.json();
    if (data.success && data.transactions?.length) {
      pendingStatementTx = data.transactions;
      document.getElementById('statement-business').value = '易北教育';
      showStatementReview();
      ybStmtStatus.textContent = `Found ${data.transactions.length} transactions.`;
      ybStmtStatus.style.color = 'var(--income)';
    } else {
      ybStmtStatus.textContent = data.error || 'No transactions found.';
      ybStmtStatus.style.color = 'var(--expense)';
    }
  } catch (err) {
    ybStmtStatus.textContent = 'Error: ' + err.message;
    ybStmtStatus.style.color = 'var(--expense)';
  } finally {
    ybStmtBtn.disabled = false;
    ybStmtBtn.textContent = 'Extract Transactions';
  }
});

function renderYB() {
  const mk = monthKey(ybMonth);
  document.getElementById('yb-month-label').textContent = monthLabel(ybMonth);

  const ybTx = transactions.filter(t => t.business === '易北教育' && monthKey(t.date) === mk);
  const revenue = ybTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = ybTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const capital = ybTx.filter(t => t.type === 'capital').reduce((s, t) => s + t.amount, 0);
  const net = revenue - expenses;

  document.getElementById('yb-revenue').textContent = fmt(revenue);
  document.getElementById('yb-expenses').textContent = fmt(expenses);
  document.getElementById('yb-capital').textContent = fmt(capital);
  const netEl = document.getElementById('yb-net');
  netEl.textContent = (net >= 0 ? '' : '-') + fmt(net);
  netEl.style.color = net >= 0 ? 'var(--income)' : 'var(--expense)';

  // Transaction list
  const list = document.getElementById('yb-transaction-list');
  const allYb = transactions.filter(t => t.business === '易北教育').sort((a, b) => b.date.localeCompare(a.date));

  if (allYb.length === 0) {
    list.innerHTML = '<div class="empty-state">No transactions yet for 易北教育.</div>';
    return;
  }

  list.innerHTML = allYb.map(tx => {
    const icon = tx.type === 'capital' ? '💰' : (CATEGORY_ICONS[tx.category] || '📌');
    const colorClass = tx.type === 'expense' ? 'expense' : 'income';
    const sign = tx.type === 'expense' ? '-' : '+';
    const badgeColor = tx.type === 'capital' ? '#fbbf24' : (tx.type === 'income' ? 'var(--income)' : 'var(--expense)');
    return `
    <div class="tx-item">
      <div class="tx-icon ${colorClass}">${icon}</div>
      <div class="tx-details">
        <div class="tx-cat">${tx.category} <span style="font-size:0.6rem;background:${badgeColor};color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">${tx.type}</span></div>
        <div class="tx-desc">${tx.description || '—'}</div>
      </div>
      <div class="tx-meta">
        <div class="tx-amount ${colorClass}">${sign}${fmt(tx.amount)}</div>
        <div class="tx-date">${new Date(tx.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
      </div>
      <button class="tx-delete" onclick="deleteYbTransaction('${tx.id}')" title="Delete">&times;</button>
    </div>`;
  }).join('');
}

async function deleteYbTransaction(id) {
  try {
    await fetch('/api/transactions/' + id, { method: 'DELETE' });
    await fetchTransactions();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
  renderYB();
  renderTransactions();
  refreshDashboard();
}

function refreshYB() { renderYB(); }

// ══════════════════════════════════════════════════════════════
// ── TAX SUMMARY ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

// ── Year-Specific Tax Tables ─────────────────────────────────
// IRS standard mileage rates
// Note: 2022 had a mid-year increase (58.5¢ Jan-Jun, 62.5¢ Jul-Dec)
const IRS_MILEAGE_RATES = { 2022: { h1: 0.585, h2: 0.625 }, 2023: 0.655, 2024: 0.67, 2025: 0.70, 2026: 0.70 };

function getMileageDeduction(year, records) {
  const rate = IRS_MILEAGE_RATES[year];
  if (!rate) return { deduction: 0, miles: 0, rateLabel: '$0.70/mi' };
  let miles = 0, deduction = 0;
  records.forEach(r => {
    if (r.start_miles && r.odometer_reading) {
      const driven = r.odometer_reading - r.start_miles;
      miles += driven;
      if (typeof rate === 'object') {
        // Split-year rate (2022): Jan-Jun vs Jul-Dec
        const m = new Date(r.date + 'T00:00:00').getMonth();
        deduction += driven * (m < 6 ? rate.h1 : rate.h2);
      } else {
        deduction += driven * rate;
      }
    }
  });
  const rateLabel = typeof rate === 'object' ? `$${rate.h1}/$${rate.h2}/mi` : `$${rate.toFixed(2)}/mi`;
  return { deduction, miles, rateLabel };
}

// Standard deductions (single filer)
const STANDARD_DEDUCTIONS = { 2022: 12950, 2023: 13850, 2024: 14600, 2025: 15000, 2026: 15000 };

// Federal tax brackets by year (single filer) — bracket widths
const FED_TAX_BRACKETS = {
  2022: [
    [10275, 0.10], [31500, 0.12], [47300, 0.22], [80975, 0.24],
    [45900, 0.32], [323950, 0.35], [Infinity, 0.37]
  ],
  2023: [
    [11000, 0.10], [33725, 0.12], [50650, 0.22], [86725, 0.24],
    [49150, 0.32], [346875, 0.35], [Infinity, 0.37]
  ],
  2024: [
    [11600, 0.10], [35550, 0.12], [53375, 0.22], [91425, 0.24],
    [51775, 0.32], [365625, 0.35], [Infinity, 0.37]
  ],
  2025: [
    [11925, 0.10], [36550, 0.12], [54875, 0.22], [93950, 0.24],
    [53225, 0.32], [375825, 0.35], [Infinity, 0.37]
  ]
};

// Social Security wage base (for SE tax cap)
const SS_WAGE_BASE = { 2022: 147000, 2023: 160200, 2024: 168600, 2025: 176100, 2026: 176100 };

// QBI deduction (20% of qualified business income, phases out above threshold)
const QBI_THRESHOLDS = { 2022: 170050, 2023: 182100, 2024: 191950, 2025: 197300, 2026: 197300 };
const QBI_PHASE_RANGE = 50000; // single filer phase-out range

// CA state tax brackets (single filer, 2025)
const CA_TAX_BRACKETS = [
  [10412, 0.01], [14272, 0.02], [14275, 0.04], [15122, 0.06],
  [14269, 0.08], [280787, 0.093], [69824, 0.103], [279310, 0.113],
  [Infinity, 0.123]
];
const CA_STD_DEDUCTION = 5540;

// State residency: NV until March 2025, CA from April 2025
const CA_RESIDENT_FROM = '2025-04';

function calcBracketTax(income, brackets) {
  let tax = 0, remaining = income;
  for (const [width, rate] of brackets) {
    if (remaining <= 0) break;
    const amt = Math.min(remaining, width);
    tax += amt * rate;
    remaining -= amt;
  }
  return tax;
}

function calcFederalTax(taxableIncome, year) {
  const brackets = FED_TAX_BRACKETS[year] || FED_TAX_BRACKETS[2025];
  return calcBracketTax(taxableIncome, brackets);
}

function calcSETax(seIncome, year) {
  const base = seIncome * 0.9235;
  const ssBase = SS_WAGE_BASE[year] || 176100;
  // Social Security: 12.4% up to wage base cap
  const ssTax = Math.min(base, ssBase) * 0.124;
  // Medicare: 2.9% on all, plus 0.9% additional over $200k
  const medicareTax = base * 0.029 + Math.max(0, base - 200000) * 0.009;
  return { seTax: ssTax + medicareTax, seDeduction: (ssTax + medicareTax) / 2 };
}

function calcQBI(seIncome, taxableIncomeBeforeQBI, year) {
  const threshold = QBI_THRESHOLDS[year] || 197300;
  if (seIncome <= 0) return 0;
  const qbi20 = seIncome * 0.20;
  if (taxableIncomeBeforeQBI <= threshold) return qbi20;
  // Phase-out for single filer
  const over = taxableIncomeBeforeQBI - threshold;
  if (over >= QBI_PHASE_RANGE) return 0;
  return qbi20 * (1 - over / QBI_PHASE_RANGE);
}

function populateTaxYears() {
  const years = new Set([new Date().getFullYear()]);
  transactions.forEach(t => years.add(new Date(t.date + 'T00:00:00').getFullYear()));
  uberRecords.forEach(r => years.add(new Date(r.date + 'T00:00:00').getFullYear()));
  const sorted = [...years].sort((a, b) => b - a);
  const select = document.getElementById('tax-year');
  select.innerHTML = sorted.map(y => `<option value="${y}">${y}</option>`).join('');
}

function refreshTax() {
  const year = parseInt(document.getElementById('tax-year').value);
  const stdDeduction = STANDARD_DEDUCTIONS[year] || 15000;

  // === UBER (Schedule C) ===
  const yearRecords = uberRecords.filter(r => new Date(r.date + 'T00:00:00').getFullYear() === year);
  const uberEarnings = yearRecords.reduce((s, r) => s + (r.earnings || 0), 0);
  const uberGas = yearRecords.reduce((s, r) => s + (r.gas_cost || 0), 0);
  const uberTx = transactions.filter(t => t.business === 'Uber' && new Date(t.date + 'T00:00:00').getFullYear() === year);
  const uberTxExpenses = uberTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  // Mileage deduction with year-specific rate (handles 2022 split)
  const { deduction: mileageDed, miles: businessMiles, rateLabel } = getMileageDeduction(year, yearRecords);
  const uberNetTaxable = Math.max(0, uberEarnings - mileageDed);

  document.getElementById('tax-mileage-rate').textContent = rateLabel;
  document.getElementById('tax-uber-earnings').textContent = fmt(uberEarnings);
  document.getElementById('tax-uber-biz-miles').textContent = businessMiles.toFixed(1) + ' mi';
  document.getElementById('tax-uber-mileage-ded').textContent = '-' + fmt(mileageDed);
  document.getElementById('tax-uber-gas').textContent = fmt(uberGas + uberTxExpenses);
  document.getElementById('tax-uber-net').textContent = fmt(uberNetTaxable);

  // === 易北教育 (Schedule C) ===
  const ybTx = transactions.filter(t => t.business === '易北教育' && new Date(t.date + 'T00:00:00').getFullYear() === year);
  const ybRevenue = ybTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const ybExpenses = ybTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const ybNet = ybRevenue - ybExpenses;

  document.getElementById('tax-yb-revenue').textContent = fmt(ybRevenue);
  document.getElementById('tax-yb-expenses').textContent = '-' + fmt(ybExpenses);
  document.getElementById('tax-yb-net').textContent = fmt(ybNet);

  const ybByCategory = {};
  ybTx.filter(t => t.type === 'expense').forEach(t => {
    ybByCategory[t.category] = (ybByCategory[t.category] || 0) + t.amount;
  });
  document.getElementById('tax-yb-breakdown').innerHTML = Object.entries(ybByCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `<div class="tax-row sub"><span>${cat}</span><span>${fmt(amt)}</span></div>`)
    .join('');

  // === Personal ===
  const personalTx = transactions.filter(t => !t.business && new Date(t.date + 'T00:00:00').getFullYear() === year);
  const personalIncome = personalTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const personalExpenses = personalTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  document.getElementById('tax-personal-income').textContent = fmt(personalIncome);
  document.getElementById('tax-personal-expenses').textContent = '-' + fmt(personalExpenses);
  document.getElementById('tax-personal-net').textContent = fmt(personalIncome - personalExpenses);

  // === Self-Employment Tax (with SS wage base cap) ===
  const seIncome = Math.max(0, uberNetTaxable) + Math.max(0, ybNet);
  const { seTax, seDeduction } = calcSETax(seIncome, year);

  // === QBI Deduction (20% of qualified business income) ===
  const agiBeforeQBI = personalIncome + seIncome - seDeduction;
  const taxableBeforeQBI = Math.max(0, agiBeforeQBI - stdDeduction);
  const qbiDeduction = calcQBI(seIncome, taxableBeforeQBI, year);

  // === Federal Tax ===
  const agi = agiBeforeQBI;
  const taxableIncome = Math.max(0, agi - stdDeduction - qbiDeduction);
  const fedTax = calcFederalTax(taxableIncome, year);

  // === State Tax ===
  // NV resident 2022-2024 (no state tax). CA resident from April 2025.
  const yearStr = String(year);
  const isCAResident = yearStr > CA_RESIDENT_FROM.slice(0, 4) ||
    (yearStr === CA_RESIDENT_FROM.slice(0, 4));

  let caTax = 0;
  let stateLabel = 'NV — No State Income Tax';
  if (isCAResident) {
    // From April 2025: CA tax on all income earned while CA resident
    // For 2025: only income from April onward is CA-sourced
    // Simplified: prorate by months of CA residency (9 months in 2025)
    const caMonths = year === 2025 ? 9 : 12;
    const caFraction = caMonths / 12;
    const caTaxable = Math.max(0, (agi * caFraction) - CA_STD_DEDUCTION);
    caTax = calcBracketTax(caTaxable, CA_TAX_BRACKETS);
    stateLabel = year === 2025
      ? `CA State Tax (Apr-Dec, ${caMonths} mo prorated)`
      : 'CA State Tax';
  }

  // === Totals ===
  const totalTax = seTax + fedTax + caTax;
  const totalGrossIncome = personalIncome + uberEarnings + ybRevenue;
  const effectiveRate = totalGrossIncome > 0 ? (totalTax / totalGrossIncome * 100).toFixed(1) : '0.0';

  document.getElementById('tax-se-income').textContent = fmt(seIncome);
  document.getElementById('tax-se-tax').textContent = fmt(seTax);
  document.getElementById('tax-se-ded').textContent = '-' + fmt(seDeduction);
  document.getElementById('tax-qbi-ded').textContent = '-' + fmt(qbiDeduction);
  document.getElementById('tax-agi').textContent = fmt(agi);
  document.getElementById('tax-std-ded').textContent = '-' + fmt(stdDeduction);
  document.getElementById('tax-taxable').textContent = fmt(taxableIncome);
  document.getElementById('tax-fed').textContent = fmt(fedTax);
  document.getElementById('tax-state-label').textContent = stateLabel;
  document.getElementById('tax-state').textContent = fmt(caTax);
  document.getElementById('tax-total').textContent = fmt(totalTax);
  document.getElementById('tax-rate').textContent = effectiveRate + '%';
  document.getElementById('tax-std-ded-label').textContent = fmt(stdDeduction);

  // Show SS wage base info
  const ssBase = SS_WAGE_BASE[year] || 176100;
  document.getElementById('tax-ss-base').textContent = '$' + ssBase.toLocaleString();
}

function exportTaxSummary() {
  const year = document.getElementById('tax-year').value;
  const get = id => document.getElementById(id).textContent;

  const lines = [
    `TAX SUMMARY - ${year}`,
    '='.repeat(50),
    '',
    'UBER / RIDESHARE (Schedule C)',
    `  Gross Earnings:         ${get('tax-uber-earnings')}`,
    `  Business Miles:         ${get('tax-uber-biz-miles')}`,
    `  Mileage Rate:           ${get('tax-mileage-rate')}`,
    `  Mileage Deduction:      ${get('tax-uber-mileage-ded')}`,
    `  Actual Gas Costs:       ${get('tax-uber-gas')}`,
    `  Net Taxable:            ${get('tax-uber-net')}`,
    '',
    '易北教育 (Schedule C)',
    `  Revenue:                ${get('tax-yb-revenue')}`,
    `  Expenses:               ${get('tax-yb-expenses')}`,
    `  Net Profit:             ${get('tax-yb-net')}`,
    '',
    'PERSONAL',
    `  Income:                 ${get('tax-personal-income')}`,
    `  Expenses:               ${get('tax-personal-expenses')}`,
    `  Net:                    ${get('tax-personal-net')}`,
    '',
    'ESTIMATED TAX LIABILITY',
    `  Self-Employment Income: ${get('tax-se-income')}`,
    `  SE Tax (SS base ${get('tax-ss-base')}): ${get('tax-se-tax')}`,
    `  1/2 SE Tax Deduction:   ${get('tax-se-ded')}`,
    `  QBI Deduction (20%):    ${get('tax-qbi-ded')}`,
    `  AGI:                    ${get('tax-agi')}`,
    `  Standard Deduction:     ${get('tax-std-ded')}`,
    `  Taxable Income:         ${get('tax-taxable')}`,
    `  Federal Income Tax:     ${get('tax-fed')}`,
    `  ${get('tax-state-label')}: ${get('tax-state')}`,
    `  Total Estimated Tax:    ${get('tax-total')}`,
    `  Effective Rate:         ${get('tax-rate')}`,
    '',
    `State Residency: NV (2022-Mar 2025), CA (Apr 2025+)`,
    'Note: These are estimates. Consult a tax professional.',
    `Generated: ${new Date().toLocaleDateString()}`
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tax-summary-${year}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════
// ── RECEIPTS GALLERY ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let allReceipts = [];

async function fetchReceipts() {
  try {
    const resp = await fetch('/api/receipts');
    if (resp.ok) allReceipts = await resp.json();
  } catch (e) {
    console.error('Failed to fetch receipts:', e);
  }
}

function renderReceipts() {
  const from = document.getElementById('receipt-from').value;
  const to = document.getElementById('receipt-to').value;

  let filtered = [...allReceipts];
  if (from) filtered = filtered.filter(r => r.date >= from);
  if (to) filtered = filtered.filter(r => r.date <= to);

  // Group by date
  const grouped = {};
  filtered.forEach(r => {
    if (!grouped[r.date]) grouped[r.date] = [];
    grouped[r.date].push(r);
  });

  const sortedDates = Object.keys(grouped).sort().reverse();
  const gallery = document.getElementById('receipt-gallery');

  if (sortedDates.length === 0) {
    gallery.innerHTML = '<div class="empty-state">No receipts found.</div>';
    return;
  }

  gallery.innerHTML = sortedDates.map(date => {
    const dateStr = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
    return `
      <div class="receipt-date-group">
        <h4 class="receipt-date-header">${dateStr}</h4>
        <div class="receipt-grid">
          ${grouped[date].map(r => `
            <div class="receipt-card">
              <a href="${r.path}" target="_blank">
                <img src="${r.path}" alt="${r.description}" loading="lazy">
              </a>
              <div class="receipt-card-info">
                <span class="receipt-source">${r.source}</span>
                <span class="receipt-desc">${r.description}</span>
              </div>
              <a href="${r.path}" download class="receipt-dl-btn" title="Download">&#8681;</a>
            </div>
          `).join('')}
        </div>
      </div>`;
  }).join('');
}

async function downloadReceiptsInRange() {
  const from = document.getElementById('receipt-from').value;
  const to = document.getElementById('receipt-to').value;

  let filtered = [...allReceipts];
  if (from) filtered = filtered.filter(r => r.date >= from);
  if (to) filtered = filtered.filter(r => r.date <= to);

  if (filtered.length === 0) return alert('No receipts in this range.');

  const btn = document.getElementById('receipt-download-btn');
  btn.disabled = true;
  btn.textContent = `Downloading ${filtered.length} files...`;

  try {
    const zip = new JSZip();
    for (let i = 0; i < filtered.length; i++) {
      const r = filtered[i];
      btn.textContent = `Fetching ${i + 1}/${filtered.length}...`;
      const resp = await fetch(r.path);
      const blob = await resp.blob();
      const ext = r.path.split('.').pop();
      const safeName = r.description.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
      zip.file(`${r.date}_${r.source}_${safeName}.${ext}`, blob);
    }

    btn.textContent = 'Creating zip...';
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipts_${from || 'all'}_to_${to || 'all'}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Download failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download All in Range';
  }
}

function refreshReceipts() {
  fetchReceipts().then(renderReceipts);
}

// ══════════════════════════════════════════════════════════════
// ── BILLS ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

document.getElementById('bills-prev-month').addEventListener('click', () => {
  billsMonth.setMonth(billsMonth.getMonth() - 1);
  refreshBills();
});

document.getElementById('bills-next-month').addEventListener('click', () => {
  billsMonth.setMonth(billsMonth.getMonth() + 1);
  refreshBills();
});

document.getElementById('bill-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const bill = {
    id: uid(),
    name: document.getElementById('bill-name').value.trim(),
    is_recurring: document.getElementById('bill-recurring').checked ? 1 : 0,
    default_amount: parseFloat(document.getElementById('bill-default-amount').value) || 0,
    due_day: parseInt(document.getElementById('bill-due-day').value) || 1
  };
  try {
    await fetch('/api/bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bill)
    });
    await fetchBills();
    renderBillDefinitions();
    await fetchBillPayments();
    renderBillPayments();
  } catch (err) {
    alert('Failed to save bill: ' + err.message);
  }
  e.target.reset();
  document.getElementById('bill-recurring').checked = true;
});

async function deleteBill(id) {
  if (!confirm('Delete this bill and all its payment history?')) return;
  try {
    await fetch('/api/bills/' + id, { method: 'DELETE' });
    await fetchBills();
    renderBillDefinitions();
    await fetchBillPayments();
    renderBillPayments();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

function renderBillDefinitions() {
  const list = document.getElementById('bill-definitions-list');
  if (bills.length === 0) {
    list.innerHTML = '<div class="empty-state">No bills registered yet. Add one above!</div>';
    return;
  }
  list.innerHTML = bills.map(b => `
    <div class="tx-item">
      <div class="tx-icon expense" style="font-size:1.2rem">&#128176;</div>
      <div class="tx-details">
        <div class="tx-cat">${b.name}</div>
        <div class="tx-desc">${b.is_recurring ? 'Recurring' : 'One-time'}${b.due_day ? ' &middot; Due: ' + ordinal(b.due_day) : ''}${b.default_amount ? ' &middot; ' + fmt(b.default_amount) : ''}</div>
      </div>
      <button class="tx-delete" onclick="deleteBill('${b.id}')" title="Delete">&times;</button>
    </div>
  `).join('');
}

function renderBillPayments() {
  const mk = monthKey(billsMonth);
  document.getElementById('bills-month-label').textContent = monthLabel(billsMonth);

  const totalDue = billPayments.reduce((s, bp) => s + (bp.amount_due || 0), 0);
  const totalPaid = billPayments.reduce((s, bp) => s + (bp.amount_paid || 0), 0);
  const remaining = totalDue - totalPaid;

  document.getElementById('bills-total-due').textContent = fmt(totalDue);
  document.getElementById('bills-total-paid').textContent = fmt(totalPaid);
  document.getElementById('bills-remaining').textContent = fmt(Math.max(0, remaining));

  const list = document.getElementById('bill-payments-list');
  if (billPayments.length === 0) {
    list.innerHTML = '<div class="empty-state">No bills for this month.</div>';
    return;
  }

  // Sort by due date
  const sorted = [...billPayments].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));

  list.innerHTML = sorted.map(bp => {
    const statusClass = bp.status || 'pending';
    const statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
    const dueDate = bp.due_date
      ? new Date(bp.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    const paidDate = bp.date_paid
      ? new Date(bp.date_paid + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';

    return `
      <div class="bill-payment-row" onclick="openBillPaymentEdit('${bp.id}', '${bp.bill_id}', '${bp.month}')">
        <div class="bill-payment-info">
          <div class="bill-vendor">${bp.bill_name || 'Unknown'}</div>
          <div class="bill-amounts">
            ${dueDate ? 'Due: ' + dueDate + ' &middot; ' : ''}${fmt(bp.amount_due || 0)}${bp.total_balance ? ' &middot; Bal: ' + fmt(bp.total_balance) : ''}${paidDate ? ' &middot; Paid: ' + paidDate : ''}
          </div>
        </div>
        <div class="bill-payment-meta">
          <div class="bill-paid-amount" style="color:${bp.amount_paid > 0 ? 'var(--income)' : 'var(--text-secondary)'}">
            ${bp.amount_paid > 0 ? fmt(bp.amount_paid) : '$0.00'}
          </div>
          <span class="bill-status ${statusClass}">${statusLabel}</span>
        </div>
      </div>`;
  }).join('');
}

function openBillPaymentEdit(id, billId, month) {
  const bp = billPayments.find(p => p.id === id);
  document.getElementById('bp-id').value = id;
  document.getElementById('bp-bill-id').value = billId;
  document.getElementById('bp-month').value = month;
  document.getElementById('bp-due-date').value = bp?.due_date || '';
  document.getElementById('bp-amount-due').value = bp?.amount_due || '';
  document.getElementById('bp-total-balance').value = bp?.total_balance || '';
  document.getElementById('bp-amount-paid').value = bp?.amount_paid || '';
  document.getElementById('bp-date-paid').value = bp?.date_paid || '';
  document.getElementById('bp-notes').value = bp?.notes || '';
  document.getElementById('bill-payment-modal-title').textContent = 'Edit Payment: ' + (bp?.bill_name || 'Bill');
  document.getElementById('bill-payment-modal').style.display = 'flex';
}

function closeBillPaymentModal() {
  document.getElementById('bill-payment-modal').style.display = 'none';
}

document.getElementById('bill-payment-modal-close').addEventListener('click', closeBillPaymentModal);
document.getElementById('bill-payment-cancel').addEventListener('click', closeBillPaymentModal);
document.getElementById('bill-payment-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeBillPaymentModal();
});

document.getElementById('bill-payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    id: document.getElementById('bp-id').value,
    bill_id: document.getElementById('bp-bill-id').value,
    month: document.getElementById('bp-month').value,
    due_date: document.getElementById('bp-due-date').value || null,
    amount_due: parseFloat(document.getElementById('bp-amount-due').value) || 0,
    total_balance: parseFloat(document.getElementById('bp-total-balance').value) || 0,
    amount_paid: parseFloat(document.getElementById('bp-amount-paid').value) || 0,
    date_paid: document.getElementById('bp-date-paid').value || null,
    notes: document.getElementById('bp-notes').value.trim()
  };
  try {
    await fetch('/api/bill-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeBillPaymentModal();
    await fetchBillPayments();
    renderBillPayments();
  } catch (err) {
    alert('Failed to save payment: ' + err.message);
  }
});

async function refreshBills() {
  await fetchBillPayments();
  renderBillPayments();
}

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
  document.getElementById('yb-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('yb-type').addEventListener('change', updateYbCategories);
  updateYbCategories();
  populateTaxYears();
  document.getElementById('tax-year').addEventListener('change', refreshTax);
  document.getElementById('tax-export-btn').addEventListener('click', exportTaxSummary);
  document.getElementById('receipt-from').addEventListener('change', renderReceipts);
  document.getElementById('receipt-to').addEventListener('change', renderReceipts);
  document.getElementById('receipt-download-btn').addEventListener('click', downloadReceiptsInRange);
  await fetchBills();
  renderBillDefinitions();
  await fetchBillPayments();
  renderBillPayments();
}

init();
