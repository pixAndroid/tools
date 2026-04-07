/**
 * gst-calculator.js
 * Pure GST calculation logic — no DOM access.
 * All functions are stateless and exported for use by ui-handler.js.
 */

/**
 * Extracts the 2-digit state code from a GSTIN string.
 * @param {string} gstin - The GSTIN string (e.g. "27AABCU9603R1ZX")
 * @returns {string|null} Two-digit state code, or null if invalid/empty.
 */
export function extractStateCode(gstin) {
  if (!gstin || typeof gstin !== 'string') return null;
  const trimmed = gstin.trim();
  if (trimmed.length < 2) return null;
  const code = trimmed.substring(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

/**
 * Determines whether a transaction is intra-state or inter-state.
 * @param {string} businessGstin - Seller's GSTIN
 * @param {string} customerGstin - Buyer's GSTIN (may be empty)
 * @returns {'intra'|'inter'} Transaction type
 */
export function getTransactionType(businessGstin, customerGstin) {
  const sellerCode = extractStateCode(businessGstin);
  const buyerCode = extractStateCode(customerGstin);

  // If either GSTIN is missing or buyer code unavailable → intra-state default
  if (!sellerCode || !buyerCode) return 'intra';
  return sellerCode === buyerCode ? 'intra' : 'inter';
}

/**
 * Parses a value as a non-negative float, defaulting to 0 for invalid input.
 * @param {*} val
 * @returns {number}
 */
function safePositiveFloat(val) {
  const n = parseFloat(val);
  if (isNaN(n) || n < 0) return 0;
  return n;
}

/**
 * Calculates the tax breakdown for a single line item.
 * @param {Object} item - Line item data
 * @param {number|string} item.qty
 * @param {number|string} item.rate
 * @param {number|string} item.gstPercent
 * @param {'intra'|'inter'} transactionType
 * @returns {{taxableAmount: number, cgst: number, sgst: number, igst: number, total: number}}
 */
export function calculateLineItem(item, transactionType) {
  const qty = safePositiveFloat(item.qty);
  const rate = safePositiveFloat(item.rate);
  const gstPct = safePositiveFloat(item.gstPercent);

  const taxableAmount = round2(qty * rate);
  const taxAmount = round2(taxableAmount * gstPct / 100);

  let cgst = 0, sgst = 0, igst = 0;

  if (transactionType === 'inter') {
    igst = taxAmount;
  } else {
    cgst = round2(taxableAmount * (gstPct / 2) / 100);
    sgst = cgst;
  }

  const total = round2(taxableAmount + cgst + sgst + igst);
  return { taxableAmount, cgst, sgst, igst, total };
}

/**
 * Calculates the invoice summary from an array of line items.
 * @param {Array<Object>} items - Array of line item objects
 * @param {'intra'|'inter'} transactionType
 * @returns {{
 *   lineItems: Array,
 *   subtotal: number,
 *   totalCgst: number,
 *   totalSgst: number,
 *   totalIgst: number,
 *   grandTotal: number
 * }}
 */
export function calculateInvoice(items, transactionType) {
  let subtotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  const lineItems = items.map((item) => {
    const calc = calculateLineItem(item, transactionType);
    subtotal += calc.taxableAmount;
    totalCgst += calc.cgst;
    totalSgst += calc.sgst;
    totalIgst += calc.igst;
    return { ...item, ...calc };
  });

  subtotal = round2(subtotal);
  totalCgst = round2(totalCgst);
  totalSgst = round2(totalSgst);
  totalIgst = round2(totalIgst);
  const grandTotal = round2(subtotal + totalCgst + totalSgst + totalIgst);

  return { lineItems, subtotal, totalCgst, totalSgst, totalIgst, grandTotal };
}

/**
 * Rounds a number to 2 decimal places.
 * @param {number} num
 * @returns {number}
 */
export function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Formats a number as Indian currency string (e.g. ₹1,23,456.00).
 * @param {number} amount
 * @returns {string}
 */
export function formatIndianCurrency(amount) {
  const num = round2(amount);
  const [intPart, decPart] = num.toFixed(2).split('.');

  // Indian number grouping: last 3 digits, then groups of 2
  const lastThree = intPart.slice(-3);
  const remaining = intPart.slice(0, -3);
  const grouped = remaining
    ? remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree
    : lastThree;

  return `₹${grouped}.${decPart}`;
}

// ─── Amount in Words ───────────────────────────────────────────────────────────

const ones = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const tens = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

/**
 * Converts a number below 1000 to words.
 * @param {number} n
 * @returns {string}
 */
function belowThousand(n) {
  if (n === 0) return '';
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + belowThousand(n % 100) : '');
}

/**
 * Converts a non-negative integer to Indian number words.
 * @param {number} n
 * @returns {string}
 */
function integerToWords(n) {
  if (n === 0) return 'Zero';

  let result = '';

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;

  if (crore) result += belowThousand(crore) + ' Crore ';
  if (lakh) result += belowThousand(lakh) + ' Lakh ';
  if (thousand) result += belowThousand(thousand) + ' Thousand ';
  if (n) result += belowThousand(n);

  return result.trim();
}

/**
 * Converts a monetary amount to Indian rupees in words.
 * @param {number} amount
 * @returns {string} e.g. "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only"
 */
export function amountToWords(amount) {
  const rounded = round2(Math.abs(amount));
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  let words = 'Rupees ' + integerToWords(rupees);
  if (paise > 0) {
    words += ' and ' + integerToWords(paise) + ' Paise';
  }
  words += ' Only';
  return words;
}

/**
 * Generates an invoice number using a localStorage counter.
 * Format: INV-YYYYMMDD-NNN (NNN resets each day).
 * @returns {string}
 */
export function generateInvoiceNumber() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  let counter = 1;
  try {
    const stored = JSON.parse(localStorage.getItem('gst_inv_counter') || '{}');
    if (stored.date === dateStr) {
      counter = (stored.count || 0) + 1;
    }
    localStorage.setItem('gst_inv_counter', JSON.stringify({ date: dateStr, count: counter }));
  } catch (_) {
    // localStorage unavailable — use default counter
  }

  return `INV-${dateStr}-${String(counter).padStart(3, '0')}`;
}
