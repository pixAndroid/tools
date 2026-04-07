/**
 * pdf-generator.js
 * Handles PDF export (via html2pdf.js) and browser print functionality.
 */

/**
 * Triggers the browser's native print dialog.
 */
export function printInvoice() {
  window.print();
}

/**
 * Generates and downloads a PDF of the invoice preview element.
 * @param {HTMLElement} previewEl - The invoice preview DOM element
 * @param {string} invoiceNumber - Used to name the downloaded file
 * @returns {Promise<void>}
 */
export async function downloadPdf(previewEl, invoiceNumber) {
  if (typeof html2pdf === 'undefined') {
    alert('PDF library is not loaded. Please check your internet connection and try again.');
    return;
  }

  const filename = `invoice-${invoiceNumber || 'draft'}.pdf`;

  const options = {
    margin: [10, 10, 10, 10], // top, left, bottom, right (mm)
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      letterRendering: true,
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
    },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  };

  try {
    // Clone the element so we can apply print-specific styles without affecting live UI
    const clone = previewEl.cloneNode(true);
    clone.style.width = '190mm';
    clone.style.padding = '0';
    clone.style.background = '#fff';
    clone.style.boxShadow = 'none';

    await html2pdf().set(options).from(clone).save();
  } catch (err) {
    console.error('PDF generation failed:', err);
    alert('PDF generation failed. Please try again.');
  }
}
