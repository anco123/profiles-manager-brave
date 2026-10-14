/**
 * public/xlsx-worker.js
 * -----------------------------------------------------------------------
 * Parses an uploaded .xlsx file OFF the main thread. XLSX.read() and
 * XLSX.utils.sheet_to_json() are synchronous and CPU-heavy for a large
 * spreadsheet -- running them on the main thread (as editor.js used to)
 * blocks EVERYTHING for however long parsing takes, including the
 * browser's own repaint/input handling, which is exactly what triggers
 * a "Page Unresponsive -- Wait or Kill this page?" dialog on a big file.
 * A Web Worker has its own separate thread, so no matter how long
 * parsing takes, the main page (and the "Importing..." button state
 * editor.js shows while this runs) stays fully responsive throughout.
 * -----------------------------------------------------------------------
 */

importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

self.onmessage = (e) => {
  try {
    const { buffer } = e.data;
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // Column letters from the sheet's actual used range (not from row 1's
    // text) -- robust even when a header cell is blank but the column
    // below it has data.
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const columnLetters = [];
    for (let c = range.s.c; c <= range.e.c; c++) columnLetters.push(XLSX.utils.encode_col(c));

    // header:'A' keys every row by column letter instead of by row-1 text,
    // and includes row 1 itself as a normal data entry -- pull it out
    // separately as display-only labels, then drop it from the real rows.
    const allRows = XLSX.utils.sheet_to_json(sheet, { header: 'A', defval: '' });
    const headerLabels = allRows[0] || {};
    const rows = allRows.slice(1);

    self.postMessage({ ok: true, columnLetters, headerLabels, rows });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
