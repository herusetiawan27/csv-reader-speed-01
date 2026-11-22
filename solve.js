// csv-reader 1.0.0, faster drop-in v6: byte-identical to vendor/csv-reader/index.js readCsv.
// Bulk scanning, no per-char loop. Unquoted fields: indexOf(',') + a slice that is the field
// value itself (checked for line break / stray CR); the last field of a record (line break
// in the segment) is handled inline, no regex. Quoted fields: indexOf('"') for the closing
// quote; the regex scan is kept only for the rare segment holding a CR. No eval, no
// cross-case state.

const DELIM = /[,\r\n]/g;
const QDELIM = /["\r]/g;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  const len = text.length;
  if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Quoted-field result slots.
  let fval = '';
  let fended = 0; // 0 comma, 1 line break, 2 end
  let fadded = 0;

  // Reads unquoted characters onto `init` up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Sets fval/fended/fadded. Only used for rare
  // paths (no comma left, stray CR, quote_junk / unterminated_quote continuations).
  function readUnquoted(init) {
    let value = init;
    let added = 0;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        if (pos < len) {
          value += text.slice(pos);
          added += len - pos;
          pos = len;
        }
        fval = value; fended = 2; fadded = added;
        return;
      }
      const j = m.index;
      if (j > pos) {
        value += text.slice(pos, j);
        added += j - pos;
      }
      const dc = text.charCodeAt(j);
      if (dc === 44) { pos = j + 1; fval = value; fended = 0; fadded = added; return; }
      if (dc === 10) { pos = j + 1; line++; fval = value; fended = 1; fadded = added; return; }
      if (text.charCodeAt(j + 1) === 10) { pos = j + 2; line++; fval = value; fended = 1; fadded = added; return; }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = j + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fval/fended/fadded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos++;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: literal character, text after it read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      const seg = text.slice(pos, q);
      if (seg.indexOf('\r') !== -1) {
        // CR inside the quotes: fall back to the regex scan (rare).
        for (;;) {
          QDELIM.lastIndex = pos;
          const m = QDELIM.exec(text);
          if (m === null) {
            pos = open + 1;
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            readUnquoted('"');
            return;
          }
          const j = m.index;
          if (j > pos) {
            value += text.slice(pos, j);
            let k = pos;
            for (;;) {
              k = text.indexOf('\n', k);
              if (k === -1 || k >= j) break;
              line++;
              k++;
            }
          }
          if (text.charCodeAt(j) === 34) {
            if (text.charCodeAt(j + 1) === 34) { value += '"'; pos = j + 2; break; }
            pos = j + 1;
            if (pos >= len) { fval = value; fended = 2; fadded = 0; return; }
            const c = text.charCodeAt(pos);
            if (c === 44) { pos++; fval = value; fended = 0; fadded = 0; return; }
            if (c === 10) { pos++; line++; fval = value; fended = 1; fadded = 0; return; }
            if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; fval = value; fended = 1; fadded = 0; return; }
            readUnquoted(value);
            if (fadded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            return;
          }
          value += '\n';
          line++;
          pos = text.charCodeAt(j + 1) === 10 ? j + 2 : j + 1;
        }
        // A doubled quote was consumed by the regex fallback; resume the indexOf scan.
        continue;
      }
      // No CR in [pos, q): the segment is literal; count its line breaks.
      value += seg;
      const ni = seg.indexOf('\n');
      if (ni !== -1) {
        let k = 0;
        for (;;) {
          k = seg.indexOf('\n', k);
          if (k === -1) break;
          line++;
          k++;
        }
      }
      if (text.charCodeAt(q + 1) === 34) { value += '"'; pos = q + 2; continue; }
      pos = q + 1;
      if (pos >= len) { fval = value; fended = 2; fadded = 0; return; }
      const c = text.charCodeAt(pos);
      if (c === 44) { pos++; fval = value; fended = 0; fadded = 0; return; }
      if (c === 10) { pos++; line++; fval = value; fended = 1; fadded = 0; return; }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; fval = value; fended = 1; fadded = 0; return; }
      // What follows the closing quote is appended as it stands (quote_junk, when it adds).
      readUnquoted(value);
      if (fadded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos++; line++; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; }
      else break;
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = (header && columns === null) ? null : rows.length;

    // Line fast path: the whole record is one clean line (no quote, no stray CR).
    // indexOf bounds avoid a slice for the 76% of records that take the slow path.
    const nl = text.indexOf('\n', pos);
    const le = nl === -1 ? len : nl;
    // A CR only belongs to a CRLF line ending when a LF actually follows it;
    // a trailing CR at end of file is a stray CR, not a line ending.
    const ce = (nl !== -1 && le > pos && text.charCodeAt(le - 1) === 13) ? le - 1 : le;
    const q = text.indexOf('"', pos);
    const r = text.indexOf('\r', pos);
    // fastCtx: no line break or stray CR can hide inside an unquoted field of this
    // record's current line — nl is the first LF at or after the record start and no
    // CR sits in the line's content before ce. A quoted field that spans lines clears
    // it (its line accounting moves past nl).
    let fastCtx = (r === -1 || r >= ce);
    if (q === -1 || q >= le) {
      if (r === -1 || r >= ce) {
        const fields = text.slice(pos, ce).split(',');
        if (nl !== -1) line++;
        pos = nl === -1 ? len : nl + 1;
        if (width < 0) width = fields.length;
        if (header && columns === null) { columns = fields; continue; }
        if (fields.length < width) {
          errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
          while (fields.length < width) fields.push('');
        } else if (fields.length > width) {
          errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
        }
        rows.push(fields);
        continue;
      }
    }

    // Field by field.
    const fields = [];
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const lb = line;
        readQuoted();
        if (line !== lb) fastCtx = false;
        fields.push(fval);
      } else {
        quoted = false;
        // Inline unquoted field (common case): next comma; the field ends there
        // unless a line break or stray CR comes first.
        const c = text.indexOf(',', pos);
        if (fastCtx) {
          // The comma (if any) comes before the line's LF, so the segment holds no
          // LF; and the line holds no stray CR, so it holds no CR either. The field
          // ends at the comma, at the line break, or at the end of the text.
          const end = nl === -1 ? len : nl;
          if (c !== -1 && c < end) {
            fields.push(text.slice(pos, c));
            pos = c + 1;
            fended = 0;
          } else if (nl === -1) {
            fields.push(text.slice(pos, len));
            pos = len;
            fended = 2;
          } else {
            fields.push(text.slice(pos, ce));
            pos = nl + 1;
            line++;
            fended = 1;
          }
        } else if (c === -1) {
          readUnquoted('');
          fields.push(fval);
        } else {
          const seg = text.slice(pos, c);
          const ni = seg.indexOf('\n');
          if (ni === -1) {
            if (seg.indexOf('\r') === -1) {
              fields.push(seg);
              pos = c + 1;
              fended = 0;
            } else {
              readUnquoted(''); // stray CR
              fields.push(fval);
            }
          } else {
            // Field ends at the line break in the segment.
            const ri = seg.indexOf('\r');
            if (ri !== -1 && ri < ni - 1) {
              readUnquoted(''); // stray CR before the line break
              fields.push(fval);
            } else {
              const end = ri === ni - 1 ? ni - 1 : ni; // CRLF: drop the CR
              fields.push(text.slice(pos, pos + end));
              pos += ni + 1;
              line++;
              fended = 1;
            }
          }
        }
      }
    } while (fended === 0);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
