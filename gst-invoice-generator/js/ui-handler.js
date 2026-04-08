/**
 * ui-handler.js
 * Main orchestrator: DOM manipulation, event listeners, live preview, localStorage persistence.
 */

import {
  calculateInvoice,
  getTransactionType,
  formatIndianCurrency,
  amountToWords,
  generateInvoiceNumber,
  round2,
} from './gst-calculator.js';

import { downloadPdf, printInvoice } from './pdf-generator.js';

// ─── State ─────────────────────────────────────────────────────────────────────

/** @type {Array<{id: string, name: string, hsn: string, qty: string, rate: string, gstPercent: string}>} */
let items = [];
let debounceTimer = null;
const DEBOUNCE_MS = 175;
const STORAGE_KEY = 'gst_invoice_data';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns today's date formatted as YYYY-MM-DD (for date input value).
 * @returns {string}
 */
function todayIso() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

/**
 * Formats a date string (YYYY-MM-DD) to a display format (DD/MM/YYYY).
 * @param {string} dateStr
 * @returns {string}
 */
function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Generates a unique ID for a row.
 * @returns {string}
 */
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * Creates a blank item row object.
 * @returns {Object}
 */
function blankItem() {
  return { id: uid(), name: '', hsn: '', qty: '1', rate: '', gstPercent: '18' };
}

// ─── LocalStorage ──────────────────────────────────────────────────────────────

/**
 * Reads current form values and saves to localStorage.
 */
function saveToStorage() {
  try {
    const data = {
      businessName: q('#business-name').value,
      businessGstin: q('#business-gstin').value,
      businessAddress: q('#business-address').value,
      customerName: q('#customer-name').value,
      customerGstin: q('#customer-gstin').value,
      customerAddress: q('#customer-address').value,
      invoiceNumber: q('#invoice-number').value,
      invoiceDate: q('#invoice-date').value,
      dueDate: q('#due-date').value,
      paymentMethod: q('#payment-method').value,
      invoiceNotes: q('#invoice-notes').value,
      items,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) { /* ignore */ }
}

/**
 * Restores form values from localStorage.
 * @returns {boolean} true if data was restored
 */
function restoreFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);

    q('#business-name').value = data.businessName || '';
    q('#business-gstin').value = data.businessGstin || '';
    q('#business-address').value = data.businessAddress || '';
    q('#customer-name').value = data.customerName || '';
    q('#customer-gstin').value = data.customerGstin || '';
    q('#customer-address').value = data.customerAddress || '';
    q('#invoice-number').value = data.invoiceNumber || generateInvoiceNumber();
    q('#invoice-date').value = data.invoiceDate || todayIso();
    q('#due-date').value = data.dueDate || '';
    q('#payment-method').value = data.paymentMethod || '';
    q('#invoice-notes').value = data.invoiceNotes || '';

    if (Array.isArray(data.items) && data.items.length > 0) {
      items = data.items;
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Clears localStorage and resets the form to defaults.
 */
function clearInvoice() {
  if (!confirm('Start a new invoice? All current data will be cleared.')) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }

  q('#business-name').value = '';
  q('#business-gstin').value = '';
  q('#business-address').value = '';
  q('#customer-name').value = '';
  q('#customer-gstin').value = '';
  q('#customer-address').value = '';
  q('#invoice-number').value = generateInvoiceNumber();
  q('#invoice-date').value = todayIso();

  items = [blankItem()];
  renderItemTable();
  scheduleUpdate();
}

// ─── DOM Queries ───────────────────────────────────────────────────────────────

/** Shorthand querySelector */
function q(selector) {
  return document.querySelector(selector);
}

// ─── Item Table Rendering ──────────────────────────────────────────────────────

/**
 * Renders the entire items table body from the `items` array.
 */
function renderItemTable() {
  const tbody = q('#items-tbody');
  tbody.innerHTML = '';
  items.forEach((item, idx) => {
    tbody.appendChild(createItemRow(item, idx));
  });
}

/**
 * Creates a table row DOM element for an item.
 * @param {Object} item
 * @param {number} idx
 * @returns {HTMLTableRowElement}
 */
function createItemRow(item, idx) {
  const tr = document.createElement('tr');
  tr.dataset.id = item.id;

  const gstOptions = [0, 5, 12, 18, 28]
    .map(v => `<option value="${v}" ${String(item.gstPercent) === String(v) ? 'selected' : ''}>${v}%</option>`)
    .join('');

  tr.innerHTML = `
    <td class="col-sno">${idx + 1}</td>
    <td class="col-name">
      <input type="text" class="item-input item-name" placeholder="Item name" value="${escHtml(item.name)}" aria-label="Item name">
    </td>
    <td class="col-hsn">
      <input type="text" class="item-input item-hsn" placeholder="HSN/SAC" value="${escHtml(item.hsn)}" aria-label="HSN/SAC code">
    </td>
    <td class="col-qty">
      <input type="number" class="item-input item-qty" min="0" step="1" placeholder="0" value="${escHtml(item.qty)}" aria-label="Quantity">
    </td>
    <td class="col-rate">
      <input type="number" class="item-input item-rate" min="0" step="0.01" placeholder="0.00" value="${escHtml(item.rate)}" aria-label="Rate">
    </td>
    <td class="col-gst">
      <select class="item-input item-gst" aria-label="GST percentage">
        ${gstOptions}
      </select>
    </td>
    <td class="col-taxable computed" data-field="taxable">—</td>
    <td class="col-tax computed" data-field="tax">—</td>
    <td class="col-total computed" data-field="total">—</td>
    <td class="col-action">
      <button class="btn-remove-row" title="Remove item" aria-label="Remove item">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
      </button>
    </td>
  `;

  // ── Bind events ──────────────────────────────────────────────────────────────
  tr.querySelector('.item-name').addEventListener('input', (e) => {
    updateItemField(item.id, 'name', e.target.value);
  });
  tr.querySelector('.item-hsn').addEventListener('input', (e) => {
    updateItemField(item.id, 'hsn', e.target.value);
  });
  tr.querySelector('.item-qty').addEventListener('input', (e) => {
    updateItemField(item.id, 'qty', e.target.value);
  });
  tr.querySelector('.item-rate').addEventListener('input', (e) => {
    updateItemField(item.id, 'rate', e.target.value);
  });
  tr.querySelector('.item-gst').addEventListener('change', (e) => {
    updateItemField(item.id, 'gstPercent', e.target.value);
  });
  tr.querySelector('.btn-remove-row').addEventListener('click', () => {
    removeItem(item.id);
  });

  return tr;
}

/**
 * Escapes HTML special characters to prevent XSS in innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Updates a single field in an item and schedules a recalculation.
 * @param {string} id - Item unique ID
 * @param {string} field - Field name
 * @param {string} value - New value
 */
function updateItemField(id, field, value) {
  const item = items.find(i => i.id === id);
  if (item) {
    item[field] = value;
    scheduleUpdate();
  }
}

/**
 * Adds a new blank item row.
 */
function addItem() {
  items.push(blankItem());
  renderItemTable();
  scheduleUpdate();

  // Focus the name field of the new row
  const rows = q('#items-tbody').querySelectorAll('tr');
  const lastRow = rows[rows.length - 1];
  if (lastRow) {
    const nameInput = lastRow.querySelector('.item-name');
    if (nameInput) nameInput.focus();
  }
}

/**
 * Removes an item from the list, keeping at least one row.
 * @param {string} id
 */
function removeItem(id) {
  if (items.length === 1) {
    // Reset the only row instead of removing
    items[0] = { ...blankItem(), id: items[0].id };
    renderItemTable();
  } else {
    items = items.filter(i => i.id !== id);
    renderItemTable();
  }
  scheduleUpdate();
}

// ─── Calculation & Preview ─────────────────────────────────────────────────────

/**
 * Schedules a debounced update of calculations and preview.
 */
function scheduleUpdate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    updateCalculations();
    updatePreview();
    saveToStorage();
  }, DEBOUNCE_MS);
}

/**
 * Runs GST calculations and updates computed cells in the table.
 */
function updateCalculations() {
  const businessGstin = q('#business-gstin').value;
  const customerGstin = q('#customer-gstin').value;
  const txType = getTransactionType(businessGstin, customerGstin);

  const result = calculateInvoice(items, txType);

  // Update computed cells in each row
  const rows = q('#items-tbody').querySelectorAll('tr');
  rows.forEach((tr, idx) => {
    const li = result.lineItems[idx];
    if (!li) return;
    tr.querySelector('[data-field="taxable"]').textContent = formatIndianCurrency(li.taxableAmount);
    tr.querySelector('[data-field="tax"]').textContent = formatIndianCurrency(
      txType === 'inter' ? li.igst : li.cgst + li.sgst
    );
    tr.querySelector('[data-field="total"]').textContent = formatIndianCurrency(li.total);
  });

  // Update summary section
  q('#summary-subtotal').textContent = formatIndianCurrency(result.subtotal);

  const cgstRow = q('#summary-cgst-row');
  const sgstRow = q('#summary-sgst-row');
  const igstRow = q('#summary-igst-row');

  if (txType === 'inter') {
    cgstRow.style.display = 'none';
    sgstRow.style.display = 'none';
    igstRow.style.display = '';
    q('#summary-igst').textContent = formatIndianCurrency(result.totalIgst);
  } else {
    cgstRow.style.display = '';
    sgstRow.style.display = '';
    igstRow.style.display = 'none';
    q('#summary-cgst').textContent = formatIndianCurrency(result.totalCgst);
    q('#summary-sgst').textContent = formatIndianCurrency(result.totalSgst);
  }

  q('#summary-grand-total').textContent = formatIndianCurrency(result.grandTotal);
  q('#amount-in-words').textContent = amountToWords(result.grandTotal);

  // Badge: intra / inter
  const badge = q('#transaction-type-badge');
  badge.textContent = txType === 'inter' ? 'Inter-State (IGST)' : 'Intra-State (CGST+SGST)';
  badge.className = `tx-badge tx-badge--${txType}`;

  // Store result for PDF / preview use
  q('#items-tbody').dataset.txType = txType;
  return result;
}

// ─── Live Preview ──────────────────────────────────────────────────────────────

/**
 * Rebuilds the invoice preview panel.
 */
function updatePreview() {
  const businessGstin = q('#business-gstin').value.trim();
  const customerGstin = q('#customer-gstin').value.trim();
  const txType = getTransactionType(businessGstin, customerGstin);
  const result = calculateInvoice(items, txType);

  const invoiceNumber = q('#invoice-number').value.trim() || '—';
  const invoiceDate = formatDisplayDate(q('#invoice-date').value) || '—';
  const dueDate = formatDisplayDate(q('#due-date').value);
  const paymentMethod = q('#payment-method').value.trim();
  const invoiceNotes = q('#invoice-notes').value.trim();

  const businessName = q('#business-name').value.trim() || 'Your Business Name';
  const businessAddress = q('#business-address').value.trim() || '';
  const customerName = q('#customer-name').value.trim() || 'Customer Name';
  const customerAddress = q('#customer-address').value.trim() || '';

  // Build items rows HTML
  const itemRowsHtml = result.lineItems.map((li, idx) => {
    if (!li.name && !parseFloat(li.rate) && !parseFloat(li.qty)) return '';
    const halfGst = round2(parseFloat(li.gstPercent) / 2);
    const gstPctSafe = escHtml(String(li.gstPercent));
    const taxDisplay = txType === 'inter'
      ? `IGST ${gstPctSafe}%: ${formatIndianCurrency(li.igst)}`
      : `CGST ${halfGst}%: ${formatIndianCurrency(li.cgst)}<br>SGST ${halfGst}%: ${formatIndianCurrency(li.sgst)}`;

    return `
      <tr>
        <td class="pv-center">${idx + 1}</td>
        <td>
          <strong>${escHtml(li.name) || '—'}</strong>
          ${li.hsn ? `<br><span class="pv-hsn-tag">HSN: ${escHtml(li.hsn)}</span>` : ''}
        </td>
        <td class="pv-center">${escHtml(String(li.qty))}</td>
        <td class="pv-right">${formatIndianCurrency(parseFloat(li.rate) || 0)}</td>
        <td class="pv-right">${formatIndianCurrency(li.taxableAmount)}</td>
        <td class="pv-right pv-small">${taxDisplay}</td>
        <td class="pv-right"><strong>${formatIndianCurrency(li.total)}</strong></td>
      </tr>`;
  }).join('');

  // Per-rate tax breakdown rows
  const breakdownRows = result.taxBreakdown
    .filter(b => b.rate > 0 && (b.igst > 0 || b.cgst > 0))
    .map(b => {
      if (txType === 'inter') {
        return `<tr><td class="pv-totals-label">IGST ${b.rate}%</td><td>${formatIndianCurrency(b.igst)}</td></tr>`;
      } else {
        const half = round2(b.rate / 2);
        return `
          <tr><td class="pv-totals-label">CGST ${half}%</td><td>${formatIndianCurrency(b.cgst)}</td></tr>
          <tr><td class="pv-totals-label">SGST ${half}%</td><td>${formatIndianCurrency(b.sgst)}</td></tr>`;
      }
    }).join('');

  // Total tax row
  const totalTaxRow = txType === 'inter'
    ? `<tr class="pv-total-tax-row"><td class="pv-totals-label"><strong>Total IGST</strong></td><td><strong>${formatIndianCurrency(result.totalIgst)}</strong></td></tr>`
    : `<tr class="pv-total-tax-row"><td class="pv-totals-label"><strong>Total Tax</strong></td><td><strong>${formatIndianCurrency(round2(result.totalCgst + result.totalSgst))}</strong></td></tr>`;

  // Optional meta rows
  const dueDateRow = dueDate ? `<tr><th>Due Date</th><td>${escHtml(dueDate)}</td></tr>` : '';
  const paymentRow = paymentMethod ? `<tr><th>Payment</th><td>${escHtml(paymentMethod)}</td></tr>` : '';

  // Notes section
  const notesHtml = invoiceNotes
    ? `<div class="pv-notes">
        <p class="pv-notes-label">Notes</p>
        <p class="pv-notes-text">${escHtml(invoiceNotes).replace(/\n/g, '<br>')}</p>
       </div>`
    : '';

  const preview = q('#invoice-preview');
  preview.innerHTML = `
    <div class="pv-header">
      <div class="pv-header-left">
        <h2 class="pv-business-name">${escHtml(businessName)}</h2>
        ${businessGstin ? `<p class="pv-sub">GSTIN: ${escHtml(businessGstin)}</p>` : ''}
        ${businessAddress ? `<p class="pv-address">${escHtml(businessAddress).replace(/\n/g, '<br>')}</p>` : ''}
      </div>
      <div class="pv-header-right">
        <h1 class="pv-invoice-title">TAX INVOICE</h1>
        <table class="pv-meta-table">
          <tr><th>Invoice No.</th><td>${escHtml(invoiceNumber)}</td></tr>
          <tr><th>Date</th><td>${escHtml(invoiceDate)}</td></tr>
          ${dueDateRow}
          ${paymentRow}
        </table>
      </div>
    </div>

    <div class="pv-parties">
      <div class="pv-bill-to">
        <p class="pv-section-label">BILL TO</p>
        <p class="pv-customer-name">${escHtml(customerName)}</p>
        ${customerGstin ? `<p class="pv-sub">GSTIN: ${escHtml(customerGstin)}</p>` : ''}
        ${customerAddress ? `<p class="pv-address">${escHtml(customerAddress).replace(/\n/g, '<br>')}</p>` : ''}
      </div>
      <div class="pv-tx-info">
        <span class="tx-badge tx-badge--${txType}">${txType === 'inter' ? 'Inter-State (IGST)' : 'Intra-State (CGST+SGST)'}</span>
      </div>
    </div>

    <div class="pv-table-wrapper">
      <table class="pv-items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item / Description</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Taxable Amt</th>
            <th>Tax</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRowsHtml || '<tr><td colspan="7" class="pv-center pv-empty">No items added yet</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="pv-summary">
      <div class="pv-words">
        <p class="pv-words-label">Amount in Words</p>
        <p class="pv-words-text">${escHtml(amountToWords(result.grandTotal))}</p>
      </div>
      <div class="pv-totals">
        <table class="pv-totals-table">
          <tr><td class="pv-totals-label">Subtotal</td><td>${formatIndianCurrency(result.subtotal)}</td></tr>
          ${breakdownRows}
          ${totalTaxRow}
          <tr class="pv-grand-total-row">
            <td><strong>Grand Total</strong></td>
            <td><strong>${formatIndianCurrency(result.grandTotal)}</strong></td>
          </tr>
        </table>
      </div>
    </div>

    ${notesHtml}

    <div class="pv-footer">
      <div class="pv-signature-block">
        <div class="pv-signature-box">
          <div class="pv-signature-line"></div>
          <p class="pv-signature-label">Authorized Signatory</p>
          <p class="pv-signature-name">${escHtml(businessName)}</p>
        </div>
        <div class="pv-seal-box">
          <div class="pv-seal-circle"></div>
          <p class="pv-signature-label">Company Seal</p>
        </div>
      </div>
      <p class="pv-footer-note">Computer Generated Invoice</p>
    </div>
  `;
}

// ─── Event Setup ───────────────────────────────────────────────────────────────

/**
 * Wires up all form event listeners.
 */
function bindFormEvents() {
  const formFields = [
    '#business-name', '#business-gstin', '#business-address',
    '#customer-name', '#customer-gstin', '#customer-address',
    '#invoice-number', '#invoice-date', '#due-date', '#payment-method', '#invoice-notes',
  ];

  formFields.forEach(selector => {
    const el = q(selector);
    if (el) {
      el.addEventListener('input', scheduleUpdate);
      el.addEventListener('change', scheduleUpdate);
    }
  });

  q('#btn-add-row').addEventListener('click', addItem);

  q('#btn-download-pdf').addEventListener('click', () => {
    const invoiceNumber = q('#invoice-number').value.trim() || 'draft';
    downloadPdf(q('#invoice-preview'), invoiceNumber);
  });

  q('#btn-print').addEventListener('click', printInvoice);

  q('#btn-new-invoice').addEventListener('click', clearInvoice);
}

// ─── Init ──────────────────────────────────────────────────────────────────────

/**
 * Initialises the application on DOMContentLoaded.
 */
export function init() {
  // Set defaults
  q('#invoice-date').value = todayIso();
  q('#invoice-number').value = generateInvoiceNumber();

  // Try to restore from storage, otherwise start with one blank row
  const restored = restoreFromStorage();
  if (!restored || items.length === 0) {
    items = [blankItem()];
  }

  renderItemTable();
  bindFormEvents();
  updateCalculations();
  updatePreview();
}
