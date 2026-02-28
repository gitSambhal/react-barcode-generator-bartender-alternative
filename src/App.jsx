import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import Papa from 'papaparse';
import { useReactToPrint } from 'react-to-print';
import { FaPrint, FaPlus, FaTrashAlt, FaUpload, FaBarcode, FaCog, FaRuler, FaEye, FaInfoCircle, FaList, FaDatabase, FaTimes, FaChevronDown, FaChevronRight, FaSlidersH, FaMoon, FaSun, FaQrcode } from 'react-icons/fa';
import { Helmet } from 'react-helmet-async';
import './App.css';

// ============================================
// CONSTANTS
// ============================================

const STORAGE_KEY = 'suhails-barcode-gen-settings';

const LABEL_SIZES = {
  '2x1-1col': { width: 50, height: 25, columns: 1, label: 'Small · 1 across' },
  '2x1-2col': { width: 50, height: 25, columns: 2, label: 'Small · 2 across' },
  '2x1-3col': { width: 50, height: 25, columns: 3, label: 'Small · 3 across' },
  '2x1-4col': { width: 50, height: 25, columns: 4, label: 'Small · 4 across' },
  '3x2-1col': { width: 75, height: 50, columns: 1, label: 'Medium · 1 across' },
  '3x2-2col': { width: 75, height: 50, columns: 2, label: 'Medium · 2 across' },
  '3x2-3col': { width: 75, height: 50, columns: 3, label: 'Medium · 3 across' },
  '4x3-1col': { width: 100, height: 75, columns: 1, label: 'Large · 1 across' },
  '4x3-2col': { width: 100, height: 75, columns: 2, label: 'Large · 2 across' },
  '4x1-2col': { width: 100, height: 25, columns: 2, label: 'Wide · 2 across' },
};

const BARCODE_TYPES = [
  { id: 'CODE128', name: 'Code 128', desc: 'Versatile, any character', icon: '▐▌▐▌▌▐' },
  { id: 'CODE39', name: 'Code 39', desc: 'Alphanumeric, industrial', icon: '▐▌ ▌▐▌' },
  { id: 'EAN13', name: 'EAN-13', desc: 'Retail products (13 digits)', icon: '▌▐▌▐▌▐' },
  { id: 'UPC', name: 'UPC-A', desc: 'US retail (12 digits)', icon: '▌▐▐▌▐▌' },
  { id: 'QR', name: 'QR Code', desc: 'URLs, text, 2D matrix', icon: null, isQR: true },
];

// mm to px conversion at 96 DPI (screen standard)
const MM_TO_PX = 96 / 25.4; // ~3.78 px per mm

// ============================================
// HELPERS
// ============================================

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

// Generate a single barcode / QR code image via offscreen canvas
async function generateBarcodeImage(entryData, labelWidth, labelHeight, barcodeType = 'CODE128') {
  if (barcodeType === 'QR') {
    try {
      const size = Math.min(labelWidth, labelHeight) * 6;
      const dataUrl = await QRCode.toDataURL(entryData || ' ', {
        width: size,
        margin: 1,
        color: { dark: '#000000', light: '#00000000' },
        errorCorrectionLevel: 'M',
      });
      return dataUrl;
    } catch {
      return null;
    }
  }

  const canvas = document.createElement('canvas');
  const scale = 6;
  canvas.width = labelWidth * scale;
  canvas.height = labelHeight * scale;
  const barcodeHeight = labelHeight * 0.7 * scale;

  const renderBarcode = (format) => {
    try {
      JsBarcode(canvas, entryData, {
        format,
        width: 3,
        height: barcodeHeight,
        displayValue: true,
        margin: 12,
        fontSize: Math.max(24, labelHeight * 0.12 * scale),
        textMargin: 8,
        font: 'monospace',
        fontOptions: 'bold',
        background: 'transparent',
      });
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  // Try the requested format first; if it fails (e.g. EAN-13 needs 12-13 digits),
  // fall back to Code 128 which accepts any input
  let result = renderBarcode(barcodeType);
  if (!result && barcodeType !== 'CODE128') {
    result = renderBarcode('CODE128');
  }
  return result;
}

// Yield to allow UI updates between batches
function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ============================================
// BARCODE IMAGE CACHE
// ============================================

const barcodeCache = new Map();
const MAX_CACHE_SIZE = 5000;

function getCacheKey(data, labelWidth, labelHeight, barcodeType) {
  return `${data}|${labelWidth}|${labelHeight}|${barcodeType}`;
}

async function getCachedBarcodeImage(entryData, labelWidth, labelHeight, barcodeType) {
  const key = getCacheKey(entryData, labelWidth, labelHeight, barcodeType);
  if (barcodeCache.has(key)) {
    return barcodeCache.get(key);
  }
  const image = await generateBarcodeImage(entryData, labelWidth, labelHeight, barcodeType);
  // LRU-like eviction: if cache is full, remove oldest entries
  if (barcodeCache.size >= MAX_CACHE_SIZE) {
    const firstKey = barcodeCache.keys().next().value;
    barcodeCache.delete(firstKey);
  }
  barcodeCache.set(key, image);
  return image;
}

// ============================================
// VIRTUALIZED ENTRIES LIST — renders only visible cards
// ============================================

const ENTRY_CARD_HEIGHT = 76; // estimated card height + gap in px
const ENTRY_OVERSCAN = 5;

function VirtualizedEntryCardList({ entries, lastAddedIndex, onUpdate, onDelete }) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setContainerHeight(e.contentRect.height));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  const totalHeight = entries.length * ENTRY_CARD_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ENTRY_CARD_HEIGHT) - ENTRY_OVERSCAN);
  const visibleCount = Math.ceil(containerHeight / ENTRY_CARD_HEIGHT) + 2 * ENTRY_OVERSCAN;
  const endIndex = Math.min(entries.length, startIndex + visibleCount);

  return (
    <div
      ref={containerRef}
      className="entries-card-list entries-card-list-virtual"
      onScroll={handleScroll}
      style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 340px)' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: startIndex * ENTRY_CARD_HEIGHT, left: 0, right: 0 }}>
          {entries.slice(startIndex, endIndex).map((entry, i) => {
            const realIndex = startIndex + i;
            return (
              <div key={realIndex} className={`entry-card ${realIndex === lastAddedIndex ? 'entry-card-new' : ''}`} style={{ marginBottom: 8 }}>
                <div className="entry-card-index">{realIndex + 1}</div>
                <div className="entry-card-body">
                  <input
                    className="entry-card-input"
                    type="text"
                    value={entry.data}
                    onChange={e => onUpdate(realIndex, 'data', e.target.value)}
                    aria-label={`Barcode data for entry ${realIndex + 1}`}
                  />
                  <input
                    className="entry-card-input-label"
                    type="text"
                    value={entry.text || ''}
                    placeholder="Label text…"
                    onChange={e => onUpdate(realIndex, 'text', e.target.value)}
                    aria-label={`Label text for entry ${realIndex + 1}`}
                  />
                </div>
                <button className="entry-card-delete" onClick={() => onDelete(realIndex)} aria-label="Delete entry">
                  <FaTimes />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LabelMiniPreview({ columns }) {
  return (
    <div className="label-mini-preview-wrap">
      <div className="label-size-mini-preview">
        {Array.from({ length: Math.min(columns, 4) }).map((_, i) => (
          <div key={i} className="label-size-mini-cell" />
        ))}
      </div>
    </div>
  );
}

// ============================================
// LABEL SIZE PREVIEW COMPONENT
// ============================================

function LabelSizePreview({ pageWidth, pageHeight, columns }) {
  const maxDiagramWidth = 300;
  const scaleFactor = Math.min(maxDiagramWidth / pageWidth, 150 / pageHeight, 3);
  const diagramW = pageWidth * scaleFactor;
  const diagramH = pageHeight * scaleFactor;
  const cellW = diagramW / columns;

  return (
    <div className="label-diagram-container">
      <div
        className="label-diagram"
        style={{ width: diagramW, height: diagramH }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <div
            key={i}
            className="label-diagram-cell"
            style={{ width: cellW, height: diagramH }}
          >
            <div className="label-diagram-cell-inner">
              {(pageWidth / columns).toFixed(0)}×{pageHeight.toFixed(0)}
            </div>
          </div>
        ))}
      </div>
      <div className="label-diagram-dimensions">
        <div className="label-dim">
          <span className="label-dim-label">Page</span>
          <span className="label-dim-value">{pageWidth}×{pageHeight}mm</span>
        </div>
        <div className="label-dim">
          <span className="label-dim-label">Label</span>
          <span className="label-dim-value">{(pageWidth / columns).toFixed(1)}×{pageHeight}mm</span>
        </div>
        <div className="label-dim">
          <span className="label-dim-label">Cols</span>
          <span className="label-dim-value">{columns}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN APP
// ============================================

function App() {
  // Try to restore settings
  const savedSettings = useMemo(() => loadSettings(), []);
  const restoredFromStorage = !!savedSettings;

  const [data, setData] = useState('');
  const [text, setText] = useState('');
  const [barcodeEntries, setBarcodeEntries] = useState([]);
  const [barcodes, setBarcodes] = useState([]);
  const [generationProgress, setGenerationProgress] = useState(null); // null = complete, 0-100 = in progress
  const [showExtraInfo, setShowExtraInfo] = useState(savedSettings?.showExtraInfo ?? true);
  const [labelSize, setLabelSize] = useState(savedSettings?.labelSize ?? '2x1-2col');
  const [barcodeType, setBarcodeType] = useState(savedSettings?.barcodeType ?? 'CODE128');
  const [prefix, setPrefix] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [lastAddedIndex, setLastAddedIndex] = useState(null);
  const [useCustomSize, setUseCustomSize] = useState(savedSettings?.useCustomSize ?? false);
  const [customWidth, setCustomWidth] = useState(savedSettings?.customWidth ?? '');
  const [customHeight, setCustomHeight] = useState(savedSettings?.customHeight ?? '');
  const [customColumns, setCustomColumns] = useState(savedSettings?.customColumns ?? '');
  const [showLabelPreview, setShowLabelPreview] = useState(savedSettings?.showLabelPreview ?? true);
  const [showSettingsRestored, setShowSettingsRestored] = useState(restoredFromStorage);
  const [activeTab, setActiveTab] = useState('data');
  const [dataSubSection, setDataSubSection] = useState('single');
  const [isPrepPrint, setIsPrepPrint] = useState(false);

  // CSV column mapping state
  const [csvParsedData, setCsvParsedData] = useState(null);
  const [csvColumns, setCsvColumns] = useState([]);
  const [csvBarcodeCol, setCsvBarcodeCol] = useState(0);
  const [csvTextCol, setCsvTextCol] = useState(-1);
  const [showCsvMapping, setShowCsvMapping] = useState(false);

  // Dark mode
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('barcode-theme');
    return saved ? saved === 'dark' : true; // default dark
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('barcode-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const dataInputRef = useRef(null);
  const printRef = useRef(null);
  const fileInputRef = useRef(null);
  const entriesSectionRef = useRef(null);
  const previewContainerRef = useRef(null);
  const generationAbortRef = useRef(null);

  // Hide "settings restored" after 3s
  useEffect(() => {
    if (showSettingsRestored) {
      const t = setTimeout(() => setShowSettingsRestored(false), 3000);
      return () => clearTimeout(t);
    }
  }, [showSettingsRestored]);

  // Persist settings on change
  useEffect(() => {
    saveSettings({
      showExtraInfo,
      labelSize,
      barcodeType,
      useCustomSize,
      customWidth,
      customHeight,
      customColumns,
      showLabelPreview,
      activeTab,
    });
  }, [showExtraInfo, labelSize, barcodeType, useCustomSize, customWidth, customHeight, customColumns, showLabelPreview, activeTab]);

  // ============================================
  // DIMENSIONS
  // ============================================

  const getPageAndLabelDimensions = useCallback(() => {
    let pageWidth, pageHeight, columns;
    if (useCustomSize) {
      pageWidth = parseFloat(customWidth) || 50;
      pageHeight = parseFloat(customHeight) || 25;
      columns = parseInt(customColumns, 10) || 1;
    } else {
      ({ width: pageWidth, height: pageHeight, columns } = LABEL_SIZES[labelSize]);
    }
    const labelWidth = pageWidth / columns;
    const labelHeight = pageHeight;
    return { pageWidth, pageHeight: pageHeight - 0.3, labelWidth, labelHeight, columns };
  }, [useCustomSize, customWidth, customHeight, customColumns, labelSize]);

  // ============================================
  // BARCODE GENERATION (progressive + cached)
  // ============================================

  const generateBarcode = useCallback(() => {
    // Abort any in-progress generation
    if (generationAbortRef.current) {
      generationAbortRef.current.aborted = true;
    }

    if (barcodeEntries.length === 0) {
      setBarcodes([]);
      setGenerationProgress(null);
      return;
    }

    let labelWidth, labelHeight;
    if (useCustomSize) {
      labelWidth = parseFloat(customWidth) || 50;
      labelHeight = parseFloat(customHeight) || 25;
    } else {
      labelWidth = LABEL_SIZES[labelSize].width;
      labelHeight = LABEL_SIZES[labelSize].height;
    }

    const abortToken = { aborted: false };
    generationAbortRef.current = abortToken;

    // Progressive generation — yield to UI every batch
    const generateProgressively = async () => {
      const BATCH_SIZE = 100;
      const total = barcodeEntries.length;
      const results = new Array(total);

      setGenerationProgress(0);

      for (let i = 0; i < total; i += BATCH_SIZE) {
        if (abortToken.aborted) return;

        const end = Math.min(i + BATCH_SIZE, total);
        const batchPromises = [];
        for (let j = i; j < end; j++) {
          batchPromises.push(
            getCachedBarcodeImage(barcodeEntries[j].data, labelWidth, labelHeight, barcodeType)
              .then(image => {
                results[j] = { image, data: barcodeEntries[j].data, text: barcodeEntries[j].text };
              })
          );
        }
        await Promise.all(batchPromises);

        if (abortToken.aborted) return;

        // Progressive update — show what we have so far
        const partial = results.slice(0, end).filter(Boolean);
        setBarcodes([...partial]);
        setGenerationProgress(Math.round((end / total) * 100));

        // Yield to UI thread
        if (i + BATCH_SIZE < total) {
          await yieldToUI();
        }
      }

      if (!abortToken.aborted) {
        setBarcodes(results.filter(Boolean));
        setGenerationProgress(null);
      }
    };

    generateProgressively();
  }, [barcodeEntries, labelSize, useCustomSize, customWidth, customHeight, barcodeType]);

  useEffect(() => {
    generateBarcode();
  }, [generateBarcode]);

  // ============================================
  // ENTRY MANAGEMENT
  // ============================================

  const addBarcodeEntry = useCallback(() => {
    if (data.trim() === '') return;
    setBarcodeEntries(prev => {
      const next = [...prev, { data: data.trim(), text }];
      setLastAddedIndex(next.length - 1);
      return next;
    });
    setData('');
    setText('');
    dataInputRef.current?.focus();
    setTimeout(() => entriesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  }, [data, text]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') addBarcodeEntry();
  }, [addBarcodeEntry]);

  const deleteBarcodeEntry = useCallback((index) => {
    setBarcodeEntries(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateBarcodeEntry = useCallback((index, field, value) => {
    setBarcodeEntries(prev => prev.map((entry, i) =>
      i === index ? { ...entry, [field]: value } : entry
    ));
  }, []);

  // ============================================
  // FILE UPLOAD
  // ============================================

  const handleFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      complete: (results) => {
        const rows = results.data.filter(row => row.some(cell => cell.trim() !== ''));
        if (rows.length === 0) {
          alert('No valid data found in the CSV file.');
          return;
        }
        // Build column headers — use first row if it looks like a header, else generate
        const firstRow = rows[0];
        const hasHeader = firstRow.some(cell => isNaN(cell) && cell.trim() !== '');
        const colNames = firstRow.map((cell, i) => hasHeader ? cell.trim() || `Column ${i + 1}` : `Column ${i + 1}`);
        const dataRows = hasHeader ? rows.slice(1) : rows;

        setCsvColumns(colNames);
        setCsvParsedData(dataRows);
        setCsvBarcodeCol(0);
        setCsvTextCol(colNames.length > 1 ? 1 : -1);
        setShowCsvMapping(true);
      },
      header: false,
      skipEmptyLines: true,
    });
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const processCsvMapping = useCallback(() => {
    if (!csvParsedData) return;
    const newEntries = csvParsedData
      .filter(row => row[csvBarcodeCol]?.trim())
      .map(row => ({
        data: row[csvBarcodeCol].trim(),
        text: csvTextCol >= 0 && row[csvTextCol] ? row[csvTextCol].trim() : '',
      }));

    if (newEntries.length > 0) {
      setBarcodeEntries(prev => {
        const updated = [...prev, ...newEntries];
        setLastAddedIndex(updated.length - 1);
        return updated;
      });
      setActiveTab('entries');
    } else {
      alert('No valid entries found with the selected column mapping.');
    }
    setShowCsvMapping(false);
    setCsvParsedData(null);
  }, [csvParsedData, csvBarcodeCol, csvTextCol]);

  // ============================================
  // RANGE GENERATION
  // ============================================

  const generateBarcodeRange = useCallback(() => {
    const start = parseInt(rangeStart, 10);
    const end = parseInt(rangeEnd, 10);
    if (isNaN(start) || isNaN(end) || start > end) {
      alert('Please enter a valid range (start ≤ end)');
      return;
    }
    if (end - start > 10000) {
      if (!window.confirm(`This will generate ${end - start + 1} barcodes. Continue?`)) return;
    }
    const newEntries = [];
    for (let i = start; i <= end; i++) {
      const padded = i.toString().padStart(rangeEnd.length, '0');
      newEntries.push({ data: `${prefix}${padded}`, text: '' });
    }
    setBarcodeEntries(prev => {
      const updated = [...prev, ...newEntries];
      setLastAddedIndex(updated.length - 1);
      return updated;
    });
    setRangeStart('');
    setRangeEnd('');
  }, [prefix, rangeStart, rangeEnd]);

  // ============================================
  // CLEAR ALL
  // ============================================

  const handleClearAll = useCallback(() => {
    if (!window.confirm('Clear all barcode entries?')) return;
    setData('');
    setText('');
    setPrefix('');
    setRangeStart('');
    setRangeEnd('');
    setBarcodeEntries([]);
    setBarcodes([]);
    barcodeCache.clear();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ============================================
  // PRINT
  // ============================================

  const renderPrintItems = useCallback(() => {
    const { pageWidth, pageHeight, labelWidth, labelHeight, columns } = getPageAndLabelDimensions();
    const labelsPerPage = columns;
    const pages = Math.ceil(barcodes.length / labelsPerPage);

    return Array.from({ length: pages }).map((_, pageIndex) => {
      const pageLabels = barcodes.slice(pageIndex * labelsPerPage, (pageIndex + 1) * labelsPerPage);
      return (
        <div
          key={pageIndex}
          className="print-page"
          style={{
            width: `${pageWidth}mm`,
            height: `${pageHeight}mm`,
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            pageBreakAfter: 'always',
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          {pageLabels.map((barcode, index) => (
            <div
              key={index}
              className="print-item"
              style={{
                width: `${labelWidth}mm`,
                height: `${labelHeight}mm`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.5mm',
                boxSizing: 'border-box',
              }}
            >
              <img
                src={barcode.image}
                alt={`Barcode ${pageIndex * labelsPerPage + index + 1}`}
                style={{ width: '100%', height: '60%', objectFit: 'contain' }}
              />
              {showExtraInfo && barcode.text && (
                <div className="additional-text" style={{
                  fontSize: `${Math.max(12, labelHeight * 0.18)}px`,
                  lineHeight: '1.2',
                  textAlign: 'center',
                  wordBreak: 'break-word',
                  width: '100%',
                  height: '35%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
                  fontWeight: '700',
                  color: '#000',
                }}>
                  {barcode.text}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    });
  }, [barcodes, getPageAndLabelDimensions, showExtraInfo]);

  const dims = getPageAndLabelDimensions();

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    onBeforeprint: () => setIsPrepPrint(true),
    onAfterPrint: () => setIsPrepPrint(false),
    pageStyle: `
      @page {
        size: ${dims.pageWidth}mm ${dims.pageHeight}mm;
        margin: 0;
      }
      @media print {
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .additional-text {
          font-size: ${Math.max(12, dims.labelHeight * 0.18)}px !important;
          display: flex !important;
          visibility: visible !important;
          font-family: "Helvetica Neue", Helvetica, Arial, sans-serif !important;
          font-weight: 700 !important;
          color: #000 !important;
        }
      }
    `,
  });

  // ============================================
  // PREVIEW (stable rendering with content-visibility)
  // ============================================

  const previewScale = useMemo(() => {
    const { labelWidth, columns } = getPageAndLabelDimensions();
    const totalPx = labelWidth * columns * MM_TO_PX;
    const container = 700; // approx max container width in px
    return Math.min(1, container / totalPx);
  }, [getPageAndLabelDimensions]);

  const renderPreviewItems = useCallback(() => {
    const { labelWidth, labelHeight, columns } = getPageAndLabelDimensions();
    const rows = Math.ceil(barcodes.length / columns);

    // Convert mm to screen pixels for real-world size
    const pxW = labelWidth * MM_TO_PX;
    const pxH = labelHeight * MM_TO_PX;

    return Array.from({ length: rows }).map((_, rowIndex) => (
      <div
        key={rowIndex}
        className="preview-row"
        style={{
          display: 'flex',
          contentVisibility: 'auto',
          containIntrinsicHeight: `${pxH}px`,
        }}
      >
        {barcodes.slice(rowIndex * columns, (rowIndex + 1) * columns).map((barcode, index) => (
          <div
            key={index}
            className="preview-item"
            style={{
              width: pxW,
              height: pxH,
              minWidth: pxW,
              minHeight: pxH,
            }}
          >
            {barcode.image && (
              <img
                src={barcode.image}
                alt={`Barcode ${rowIndex * columns + index + 1}`}
                loading="lazy"
                style={{ maxWidth: '100%', maxHeight: '85%', objectFit: 'contain' }}
              />
            )}
            {showExtraInfo && barcode.text && (
              <div className="additional-text">{barcode.text}</div>
            )}
          </div>
        ))}
      </div>
    ));
  }, [barcodes, getPageAndLabelDimensions, showExtraInfo]);

  // ============================================
  // DERIVED DATA
  // ============================================

  const hasTextColumn = useMemo(() => barcodeEntries.some(e => e.text), [barcodeEntries]);

  // Flash effect timeout
  useEffect(() => {
    if (lastAddedIndex !== null) {
      const t = setTimeout(() => setLastAddedIndex(null), 2000);
      return () => clearTimeout(t);
    }
  }, [lastAddedIndex]);

  const pageSizeText = `${dims.pageWidth}mm × ${dims.pageHeight.toFixed(1)}mm · ${dims.columns} col${dims.columns > 1 ? 's' : ''}`;

  return (
    <div className="App">
      <Helmet>
        <title>Suhail's Barcode Generator — Free Online Label Maker</title>
        <meta name="description" content="Generate barcodes online for free with Suhail's Barcode Generator. A powerful, web-based alternative to BarTender. Create individual barcodes, ranges, or bulk generate from CSV." />
        <meta name="keywords" content="barcode generator, BarTender alternative, free barcode creator, online label maker, Suhail Akhtar" />
        <meta name="author" content="Suhail Akhtar" />
        <meta property="og:title" content="Suhail's Barcode Generator — Free Online Label Maker" />
        <meta property="og:description" content="Generate barcodes online for free. A powerful, web-based alternative to BarTender." />
        <meta property="og:type" content="website" />
      </Helmet>

      {/* HEADER */}
      <header className="App-header">
        <h1 className="app-title">Suhail's Barcode Generator</h1>
        <p className="app-subtitle">A powerful, free alternative to BarTender — create labels in seconds</p>
        <button
          className="theme-toggle"
          onClick={() => setDarkMode(prev => !prev)}
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          id="theme-toggle-btn"
        >
          {darkMode ? <FaSun /> : <FaMoon />}
        </button>
      </header>

      {/* MAIN */}
      <main className="app-layout">
        {/* ============ LEFT COLUMN: SIDEBAR ============ */}
        <div className="controls-section">

          {/* Primary sidebar tabs: Data / Layout / Entries */}
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${activeTab === 'data' ? 'sidebar-tab-active' : ''}`}
              onClick={() => setActiveTab('data')}
              id="sidebar-tab-data"
            >
              <FaDatabase /> Data
            </button>
            <button
              className={`sidebar-tab ${activeTab === 'layout' ? 'sidebar-tab-active' : ''}`}
              onClick={() => setActiveTab('layout')}
              id="sidebar-tab-layout"
            >
              <FaSlidersH /> Layout
            </button>
            <button
              className={`sidebar-tab ${activeTab === 'entries' ? 'sidebar-tab-active' : ''}`}
              onClick={() => setActiveTab('entries')}
              id="sidebar-tab-entries"
            >
              <FaList /> Entries
              {barcodeEntries.length > 0 && (
                <span className="sidebar-tab-badge">{barcodeEntries.length}</span>
              )}
            </button>
          </div>

          {/* Scrollable tab content */}
          <div className="sidebar-scroll">

            {/* ===== DATA TAB ===== */}
            {activeTab === 'data' && (
              <div className="tab-panel">
                {/* Sub-section: Single */}
                <section className="card sub-card" id="input-single">
                  <button
                    className="sub-section-toggle"
                    onClick={() => setDataSubSection(dataSubSection === 'single' ? '' : 'single')}
                  >
                    <span className="sub-section-toggle-label"><FaBarcode /> Single Entry</span>
                    {dataSubSection === 'single' ? <FaChevronDown className="chevron" /> : <FaChevronRight className="chevron" />}
                  </button>
                  {dataSubSection === 'single' && (
                    <div className="sub-section-body">
                      <div className="form-group">
                        <input
                          ref={dataInputRef}
                          className="form-input"
                          type="text"
                          placeholder="Enter barcode data…"
                          value={data}
                          onChange={e => setData(e.target.value)}
                          onKeyDown={handleKeyDown}
                          id="barcode-data-input"
                        />
                      </div>
                      <div className="form-group">
                        <input
                          className="form-input"
                          type="text"
                          placeholder="Label text (optional)"
                          value={text}
                          onChange={e => setText(e.target.value)}
                          onKeyDown={handleKeyDown}
                          id="barcode-text-input"
                        />
                      </div>
                      <button className="btn btn-primary btn-block" onClick={addBarcodeEntry} id="add-barcode-btn">
                        <FaPlus /> Add Entry
                      </button>
                    </div>
                  )}
                </section>

                {/* Sub-section: Batch / Range */}
                <section className="card sub-card" id="input-range">
                  <button
                    className="sub-section-toggle"
                    onClick={() => setDataSubSection(dataSubSection === 'batch' ? '' : 'batch')}
                  >
                    <span className="sub-section-toggle-label"><FaRuler /> Batch Range</span>
                    {dataSubSection === 'batch' ? <FaChevronDown className="chevron" /> : <FaChevronRight className="chevron" />}
                  </button>
                  {dataSubSection === 'batch' && (
                    <div className="sub-section-body">
                      <div className="form-group">
                        <input
                          className="form-input"
                          type="text"
                          placeholder="Prefix (optional, e.g. ITEM)"
                          value={prefix}
                          onChange={e => setPrefix(e.target.value)}
                          id="range-prefix-input"
                        />
                      </div>
                      <div className="form-row">
                        <input
                          className="form-input"
                          type="number"
                          placeholder="Start"
                          value={rangeStart}
                          onChange={e => setRangeStart(e.target.value)}
                          id="range-start-input"
                        />
                        <input
                          className="form-input"
                          type="number"
                          placeholder="End"
                          value={rangeEnd}
                          onChange={e => setRangeEnd(e.target.value)}
                          id="range-end-input"
                        />
                      </div>
                      <button className="btn btn-primary btn-block" onClick={generateBarcodeRange} id="generate-range-btn">
                        <FaPlus /> Generate Range
                      </button>
                    </div>
                  )}
                </section>

                {/* Sub-section: CSV Import */}
                <section className="card sub-card" id="input-csv">
                  <button
                    className="sub-section-toggle"
                    onClick={() => setDataSubSection(dataSubSection === 'csv' ? '' : 'csv')}
                  >
                    <span className="sub-section-toggle-label"><FaUpload /> CSV Import</span>
                    {dataSubSection === 'csv' ? <FaChevronDown className="chevron" /> : <FaChevronRight className="chevron" />}
                  </button>
                  {dataSubSection === 'csv' && (
                    <div className="sub-section-body">
                      <label className="csv-upload-area" htmlFor="csv-file-input">
                        <FaUpload className="csv-upload-icon" />
                        <span>Click to upload CSV</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv,.txt"
                          onChange={handleFileUpload}
                          id="csv-file-input"
                          className="csv-file-hidden"
                        />
                      </label>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* ===== LAYOUT TAB ===== */}
            {activeTab === 'layout' && (
              <div className="tab-panel">
                {/* Barcode Type */}
                <section className="card" id="barcode-type-card">
                  <h3 className="card-title"><span className="icon"><FaBarcode /></span> Barcode Type</h3>
                  <div className="barcode-type-grid">
                    {BARCODE_TYPES.map(bt => (
                      <button
                        key={bt.id}
                        className={`barcode-type-card ${barcodeType === bt.id ? 'barcode-type-card-active' : ''}`}
                        onClick={() => setBarcodeType(bt.id)}
                        id={`barcode-type-${bt.id}`}
                      >
                        {bt.isQR ? (
                          <FaQrcode className="barcode-type-icon-qr" />
                        ) : (
                          <span className="barcode-type-icon">{bt.icon}</span>
                        )}
                        <span className="barcode-type-name">{bt.name}</span>
                        <span className="barcode-type-desc">{bt.desc}</span>
                        {barcodeType === bt.id && <span className="barcode-type-check">✓</span>}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Label Size */}
                <section className="card" id="label-size-card">
                  <h3 className="card-title"><span className="icon"><FaRuler /></span> Label Size</h3>

                  <div className="toggle-row" style={{ marginBottom: 10 }}>
                    <label className="toggle-label" htmlFor="custom-size-toggle">Custom label size</label>
                    <input type="checkbox" className="toggle-switch" checked={useCustomSize} onChange={e => setUseCustomSize(e.target.checked)} id="custom-size-toggle" />
                  </div>

                  {useCustomSize ? (
                    <div className="custom-size-form">
                      <div className="form-group">
                        <label className="form-label">Page width (mm)</label>
                        <input className="form-input" type="number" value={customWidth} onChange={e => setCustomWidth(e.target.value)} id="custom-width" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Page height (mm)</label>
                        <input className="form-input" type="number" value={customHeight} onChange={e => setCustomHeight(e.target.value)} id="custom-height" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Columns</label>
                        <input className="form-input" type="number" min={1} value={customColumns} onChange={e => setCustomColumns(e.target.value)} id="custom-columns" />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="label-preset-heading">Label Size Preset</div>
                      <div className="label-preset-grid">
                        {Object.entries(LABEL_SIZES).map(([key, sizeInfo]) => (
                          <button
                            key={key}
                            className={`label-size-card ${labelSize === key && !useCustomSize ? 'label-size-card-active' : ''}`}
                            onClick={() => { setLabelSize(key); setUseCustomSize(false); }}
                            id={`label-size-${key}`}
                          >
                            <LabelMiniPreview columns={sizeInfo.columns} />
                            <span className="label-size-name">{sizeInfo.width}×{sizeInfo.height}mm</span>
                            <span className="label-size-desc">{sizeInfo.label}</span>
                            {labelSize === key && !useCustomSize && <span className="barcode-type-check">✓</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </section>

                <section className="card" id="settings-card">
                  <h3 className="card-title"><span className="icon"><FaCog /></span> Display</h3>
                  <div className="toggle-row">
                    <label className="toggle-label" htmlFor="toggle-extra-info">Show label text</label>
                    <input type="checkbox" className="toggle-switch" checked={showExtraInfo} onChange={e => setShowExtraInfo(e.target.checked)} id="toggle-extra-info" />
                  </div>
                </section>
              </div>
            )}

            {/* ===== ENTRIES TAB ===== */}
            {activeTab === 'entries' && (
              <div className="tab-panel entries-tab-panel" ref={entriesSectionRef}>
                {barcodeEntries.length === 0 ? (
                  <div className="entries-empty">
                    <FaBarcode className="entries-empty-icon" />
                    <div className="entries-empty-title">No entries yet</div>
                    <div className="entries-empty-text">Switch to the <strong>Data</strong> tab to add barcodes</div>
                  </div>
                ) : (
                  <>
                    <div className="entries-list-header">
                      <span className="entries-count-label">{barcodeEntries.length} barcode{barcodeEntries.length !== 1 ? 's' : ''}</span>
                      <button className="btn-clear-all" onClick={handleClearAll}>
                        <FaTrashAlt /> Delete All
                      </button>
                    </div>
                    <VirtualizedEntryCardList
                      entries={barcodeEntries}
                      lastAddedIndex={lastAddedIndex}
                      onUpdate={updateBarcodeEntry}
                      onDelete={deleteBarcodeEntry}
                    />
                  </>
                )}
              </div>
            )}

          </div>

          {/* Action Buttons — fixed at bottom */}
          <div className="action-buttons">
            <button className="btn btn-success btn-block" onClick={handlePrint} disabled={barcodes.length === 0} id="print-btn">
              <FaPrint /> Print
            </button>
            <button className="btn btn-danger btn-block" onClick={handleClearAll} disabled={barcodeEntries.length === 0} id="clear-btn">
              <FaTrashAlt /> Clear All
            </button>
          </div>
        </div>

        {/* ============ RIGHT COLUMN: PREVIEW (centered, no bg) ============ */}
        <div className="preview-section">
          {barcodes.length > 0 ? (
            <>
              <div className="preview-header">
                <h2 className="preview-title">
                  <FaEye /> Preview
                  <span className="preview-badge">
                    {generationProgress !== null
                      ? `Generating… ${generationProgress}%`
                      : `${barcodes.length} barcode${barcodes.length !== 1 ? 's' : ''}`
                    }
                  </span>
                </h2>
                <div className="page-size-info">{pageSizeText}</div>
              </div>

              {/* Progress bar during generation */}
              {generationProgress !== null && (
                <div className="generation-progress-bar">
                  <div className="generation-progress-fill" style={{ width: `${generationProgress}%` }} />
                </div>
              )}

              <div className="preview-center-wrap">
                <div
                  className="preview-container"
                  ref={previewContainerRef}
                  style={{
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top center',
                  }}
                >
                  {renderPreviewItems()}
                </div>
              </div>
              <div className="real-size-note">
                Preview is shown at {(previewScale * 100).toFixed(0)}% of real-world size ({dims.labelWidth.toFixed(1)}mm × {dims.labelHeight.toFixed(1)}mm per label)
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">𝄃𝄃𝄂𝄂𝄀𝄁𝄃𝄂𝄂𝄃</div>
              <div className="empty-state-title">No barcodes yet</div>
              <div className="empty-state-text">Add barcode entries using the sidebar, then they'll appear here in real-world size.</div>
            </div>
          )}
        </div>
      </main>

      {/* CSV COLUMN MAPPING MODAL */}
      {showCsvMapping && (
        <div className="modal-overlay" onClick={() => setShowCsvMapping(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Map CSV Columns</h3>
              <button className="modal-close" onClick={() => setShowCsvMapping(false)}><FaTimes /></button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">Choose which columns to use for barcode data and label text.</p>

              <div className="mapping-row">
                <label className="form-label">Barcode Data Column <span className="required">*</span></label>
                <select className="form-select" value={csvBarcodeCol} onChange={e => setCsvBarcodeCol(Number(e.target.value))}>
                  {csvColumns.map((col, i) => <option key={i} value={i}>{col}</option>)}
                </select>
              </div>

              <div className="mapping-row">
                <label className="form-label">Label Text Column <span className="optional">(optional)</span></label>
                <select className="form-select" value={csvTextCol} onChange={e => setCsvTextCol(Number(e.target.value))}>
                  <option value={-1}>— None —</option>
                  {csvColumns.map((col, i) => <option key={i} value={i}>{col}</option>)}
                </select>
              </div>

              {/* Preview first 5 rows */}
              {csvParsedData && csvParsedData.length > 0 && (
                <div className="csv-preview">
                  <div className="csv-preview-title">Preview ({Math.min(5, csvParsedData.length)} of {csvParsedData.length} rows)</div>
                  <div className="csv-preview-table">
                    <div className="csv-preview-row csv-preview-header">
                      <div className="csv-preview-cell">Barcode Data</div>
                      {csvTextCol >= 0 && <div className="csv-preview-cell">Label Text</div>}
                    </div>
                    {csvParsedData.slice(0, 5).map((row, i) => (
                      <div key={i} className="csv-preview-row">
                        <div className="csv-preview-cell csv-preview-mono">{row[csvBarcodeCol] || '—'}</div>
                        {csvTextCol >= 0 && <div className="csv-preview-cell">{row[csvTextCol] || '—'}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowCsvMapping(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={processCsvMapping}>Import {csvParsedData?.length || 0} Rows</button>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="app-footer">
        <p className="app-footer-text">
          Built with ❤️ by{' '}
          <a href="https://www.linkedin.com/in/im-suhail-akhtar/" target="_blank" rel="noopener noreferrer">
            Suhail Akhtar
          </a>
        </p>
      </footer>

      {/* Hidden print content */}
      <div className="print-only-container">
        <div ref={printRef} className="print-wrapper">
          {renderPrintItems()}
        </div>
      </div>
    </div>
  );
}

export default App;
