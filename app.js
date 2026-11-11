// --- 1. Utilidades de Fecha (ISO-8601) ---
function getISOWeekData(date = new Date()) {
    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    
    const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000);
    const year = target.getFullYear();
  
    // Rango Lunes - Domingo
    const current = new Date(date);
    const day = (current.getDay() + 6) % 7;
    const monday = new Date(current);
    monday.setDate(current.getDate() - day);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
  
    const opts = { day: 'numeric', month: 'short' };
    const rangeStr = `${monday.toLocaleDateString('es-MX', opts)} - ${sunday.toLocaleDateString('es-MX', opts)}`;
  
    return { weekNumber, year, rangeStr, weekKey: `${year}-W${weekNumber}` };
  }
  
  // --- 2. Persistencia con IndexedDB ---
  const DB_NAME = 'ControlGastosDB';
  const DB_VERSION = 1;
  let db = null;
  
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
  
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        // Almacén de gastos con índice por semana
        if (!database.objectStoreNames.contains('expenses')) {
          const store = database.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
          store.createIndex('weekKey', 'weekKey', { unique: false });
        }
      };
  
      request.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
  
      request.onerror = (e) => reject(e.target.error);
    });
  }
  
  function saveExpenseToDB(expense) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('expenses', 'readwrite');
      const store = tx.objectStore('expenses');
      const req = store.add(expense);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  
  function getExpensesByWeek(weekKey) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('expenses', 'readonly');
      const store = tx.objectStore('expenses');
      const index = store.index('weekKey');
      const req = index.getAll(IDBKeyRange.only(weekKey));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  
  function deleteExpenseFromDB(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('expenses', 'readwrite');
      const store = tx.objectStore('expenses');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  
  // --- 3. Lógica de Aplicación y Estado ---
  const currentWeek = getISOWeekData();
  let currentExpenses = [];
  
  // Elementos del DOM
  const weekDisplay = document.getElementById('weekDisplay');
  const dateRange = document.getElementById('dateRange');
  const weeklyBudgetInput = document.getElementById('weeklyBudget');
  const serviceFundsInput = document.getElementById('serviceFunds');
  const currentBalanceDisplay = document.getElementById('currentBalance');
  const totalSpentDisplay = document.getElementById('totalSpent');
  const expenseConceptInput = document.getElementById('expenseConcept');
  const expenseAmountInput = document.getElementById('expenseAmount');
  const addExpenseBtn = document.getElementById('addExpenseBtn');
  const expenseList = document.getElementById('expenseList');
  const errorMsg = document.getElementById('errorMsg');
  const expenseDayInput = document.getElementById('expenseDay');
  
  // Formateador de moneda MXN
  const currencyFormatter = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN'
  });
  
  // Carga de montos fijos guardados en LocalStorage (permanentes entre semanas)
  function loadFixedSettings() {
    const budget = localStorage.getItem('fixed_weekly_budget') || '';
    const services = localStorage.getItem('fixed_service_funds') || '';
    weeklyBudgetInput.value = budget;
    serviceFundsInput.value = services;
  }
  
  // Recalcular saldo y renderizar lista
  function updateUI() {
    const budget = parseFloat(weeklyBudgetInput.value) || 0;
    const services = parseFloat(serviceFundsInput.value) || 0;
    
    const totalSpent = currentExpenses.reduce((sum, item) => sum + item.amount, 0);
    const remainingToday = budget - services - totalSpent;
  
    currentBalanceDisplay.textContent = currencyFormatter.format(remainingToday);
    currentBalanceDisplay.style.color = remainingToday < 0 ? 'var(--accent-red)' : 'var(--accent-green)';
    totalSpentDisplay.textContent = `Total: ${currencyFormatter.format(totalSpent)}`;
  
    // Renderizado de lista
    expenseList.innerHTML = '';
    if (currentExpenses.length === 0) {
      expenseList.innerHTML = '<li style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem 0;">No hay gastos registrados en esta semana.</li>';
      return;
    }
  
    currentExpenses.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'expense-item';
        li.innerHTML = `
          <div style="display: flex; align-items: center;">
            <span class="day-tag">${item.dateFormatted || `Día ${item.day}`}</span>
            <span class="concept">${item.concept}</span>
          </div>
          <div style="display: flex; align-items: center;">
            <span class="amount">-${currencyFormatter.format(item.amount)}</span>
            <button class="btn-delete" onclick="handleDeleteExpense(${item.id})">&times;</button>
          </div>
        `;
        expenseList.appendChild(li);
      });
  }
  
  // Guardar cambios en inputs de presupuestos fijos
  weeklyBudgetInput.addEventListener('input', () => {
    localStorage.setItem('fixed_weekly_budget', weeklyBudgetInput.value);
    updateUI();
  });
  
  serviceFundsInput.addEventListener('input', () => {
    localStorage.setItem('fixed_service_funds', serviceFundsInput.value);
    updateUI();
  });
  
  // Agregar gasto con validación estricta de campos vacíos
  addExpenseBtn.addEventListener('click', async () => {
    const dayVal = expenseDayInput.value.trim();
    const concept = expenseConceptInput.value.trim();
    const amountVal = expenseAmountInput.value.trim();
    
    const day = parseInt(dayVal, 10);
    const amount = parseFloat(amountVal);
  
    // Obtener mes y año actuales de forma automática
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-11
    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  
    // Validación: ninguno de los tres campos puede estar vacío o fuera de rango
    if (!dayVal || isNaN(day) || day < 1 || day > daysInCurrentMonth) {
      errorMsg.textContent = `Ingresa un día válido entre 1 y ${daysInCurrentMonth}.`;
      return;
    }
  
    if (!concept || !amountVal || isNaN(amount) || amount <= 0) {
      errorMsg.textContent = 'Ingresa un concepto y un monto válido mayor a 0.';
      return;
    }
  
    errorMsg.textContent = '';
  
    // Formato legible DD/MM (ej. 05/11)
    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
  
    const newExpense = {
      day,
      dateFormatted: `${dayStr}/${monthStr}`,
      concept,
      amount,
      weekKey: currentWeek.weekKey,
      createdAt: new Date(year, month, day).toISOString()
    };
  
    await saveExpenseToDB(newExpense);
    currentExpenses = await getExpensesByWeek(currentWeek.weekKey);
  
    // Limpiar campos dejando el día vacío
    expenseDayInput.value = '';
    expenseConceptInput.value = '';
    expenseAmountInput.value = '';
    expenseDayInput.focus();
  
    updateUI();
  });
  
  // Eliminar un gasto
  window.handleDeleteExpense = async (id) => {
    await deleteExpenseFromDB(id);
    currentExpenses = await getExpensesByWeek(currentWeek.weekKey);
    updateUI();
  };

  async function requestStoragePersistence() {
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persist();
      console.log(`Persistencia de almacenamiento activa: ${isPersisted}`);
    }
  }
  
  // Inicialización de la aplicación
  async function initApp() {
    await requestStoragePersistence(); // <- Agregar aquí
    weekDisplay.textContent = `Semana ${currentWeek.weekNumber}`;
    weekDisplay.textContent = `Semana ${currentWeek.weekNumber}`;
    dateRange.textContent = currentWeek.rangeStr;
  
    loadFixedSettings();
    await initDB();
    currentExpenses = await getExpensesByWeek(currentWeek.weekKey);
    updateUI();

  }
  
  document.addEventListener('DOMContentLoaded', initApp);