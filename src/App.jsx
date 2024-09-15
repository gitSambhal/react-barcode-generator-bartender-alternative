import React, { useState, useRef, useEffect, useCallback } from 'react';
import JsBarcode from 'jsbarcode';
import Papa from 'papaparse';
import { useReactToPrint } from 'react-to-print';
import { FaPrint } from 'react-icons/fa';
import Darkmode from 'darkmode-js';
import { Helmet } from 'react-helmet';
import './App.css';

const labelSizes = {
  '2x1-1col': { width: 50, height: 25, columns: 1 },
  '2x1-2col': { width: 50, height: 25, columns: 2 },
  '2x1-3col': { width: 50, height: 25, columns: 3 },
  '2x1-4col': { width: 50, height: 25, columns: 4 },
  '3x2-1col': { width: 75, height: 50, columns: 1 },
  '3x2-2col': { width: 75, height: 50, columns: 2 },
  '3x2-3col': { width: 75, height: 50, columns: 3 },
  '4x3-1col': { width: 100, height: 75, columns: 1 },
  '4x3-2col': { width: 100, height: 75, columns: 2 },
  '4x1-2col': { width: 100, height: 25, columns: 2 }, // New option
};

function App() {
  const [data, setData] = useState('');
  const [text, setText] = useState('');
  const [barcodeEntries, setBarcodeEntries] = useState([]);
  const [barcodes, setBarcodes] = useState([]);
  const [showExtraInfo, setShowExtraInfo] = useState(true);
  const [labelSize, setLabelSize] = useState('2x1-2col');
  const [prefix, setPrefix] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const canvasRef = useRef(null);
  const printRef = useRef(null);
  const fileInputRef = useRef(null);
  const entriesSectionRef = useRef(null);
  const [lastAddedIndex, setLastAddedIndex] = useState(null);
  const [useCustomSize, setUseCustomSize] = useState(false);
  const [customWidth, setCustomWidth] = useState('');
  const [customHeight, setCustomHeight] = useState('');
  const [customColumns, setCustomColumns] = useState('');
  const previewContainerRef = useRef(null);
  const [debugMode, setDebugMode] = useState(false);

  const addBarcodeEntry = () => {
    if (data.trim() !== '') {
      const newEntries = [...(barcodeEntries || []), { data, text }];
      setBarcodeEntries(newEntries);
      setLastAddedIndex(newEntries.length - 1);
      setData('');
      setText('');
      setTimeout(scrollToBottom, 0);
    }
  };

  const generateBarcode = useCallback(() => {
    if (barcodeEntries.length === 0) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let labelWidth, labelHeight;
    if (useCustomSize) {
      labelWidth = parseFloat(customWidth);
      labelHeight = parseFloat(customHeight);
    } else {
      labelWidth = labelSizes[labelSize].width;
      labelHeight = labelSizes[labelSize].height;
    }

    // Increase resolution (multiply dimensions by 4 for better quality)
    canvas.width = labelWidth * 4;
    canvas.height = labelHeight * 4;

    // Set barcode height to 70% of label height
    const barcodeHeight = labelHeight * 0.7 * 4; // 70% of label height, scaled up

    console.log(`Label size: ${labelWidth}mm x ${labelHeight}mm`);
    console.log(`Barcode height: ${barcodeHeight / 4}mm`);

    const newBarcodes = barcodeEntries.map(entry => {
      // Clear canvas for each new barcode
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      JsBarcode(canvas, entry.data, {
        format: "CODE128",
        width: 2,
        height: barcodeHeight,
        displayValue: true,
        margin: 10,
        fontSize: Math.max(20, labelHeight * 0.1 * 4), // Adjust font size based on label height
        textMargin: 8,
        background: "transparent"
      });

      const barcodeImage = canvas.toDataURL('image/png');
      
      return { 
        image: barcodeImage, 
        data: entry.data,
        text: entry.text 
      };
    });

    setBarcodes(newBarcodes);
  }, [barcodeEntries, labelSize, useCustomSize, customWidth, customHeight]);

  useEffect(() => {
    generateBarcode();
  }, [labelSize, useCustomSize, customWidth, customHeight, generateBarcode]);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      Papa.parse(file, {
        complete: (results) => {
          const newEntries = results.data
            .filter(row => row.length >= 1 && row[0].trim() !== '')
            .map(row => ({
              data: row[0],
              text: row.length > 1 ? row[1] : ''
            }));
          
          if (newEntries.length > 0) {
            setBarcodeEntries(prevEntries => {
              const updatedEntries = [...(prevEntries || []), ...newEntries];
              setLastAddedIndex(updatedEntries.length - 1);
              return updatedEntries;
            });
            setTimeout(scrollToBottom, 0);
          } else {
            alert('No valid entries found in the CSV file.');
          }
        },
        header: false,
        skipEmptyLines: true
      });
    }
  };

  const getPageAndLabelDimensions = useCallback(() => {
    let pageWidth, pageHeight, columns;
    if (useCustomSize) {
      pageWidth = parseFloat(customWidth);
      pageHeight = parseFloat(customHeight);
      columns = parseInt(customColumns, 10) || 1;
    } else {
      ({ width: pageWidth, height: pageHeight, columns } = labelSizes[labelSize]);
    }

    const labelWidth = pageWidth / columns;
    const labelHeight = pageHeight;

    return {
      pageWidth,
      pageHeight: pageHeight - 1,
      labelWidth,
      labelHeight,
      columns
    };
  }, [useCustomSize, customWidth, customHeight, customColumns, labelSize]);

  const renderPrintItems = useCallback(() => {
    const { pageWidth, pageHeight, labelWidth, labelHeight, columns } = getPageAndLabelDimensions();
    const labelsPerPage = columns;
    const pages = Math.ceil(barcodes.length / labelsPerPage);

    console.log(`Page size: ${pageWidth}mm x ${pageHeight}mm`);
    console.log(`Label size: ${labelWidth}mm x ${labelHeight}mm`);
    console.log(`Total barcodes: ${barcodes.length}`);
    console.log(`Labels per page: ${labelsPerPage}`);
    console.log(`Total pages: ${pages}`);

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
            backgroundColor: debugMode ? (pageIndex % 2 === 0 ? '#f0f0f0' : '#ffffff') : 'transparent',
            pageBreakAfter: 'always',
            overflow: 'hidden',
            boxSizing: 'border-box',
            padding: debugMode ? '0.5mm' : '0',
          }}
        >
          {pageLabels.map((barcode, index) => (
            <div 
              key={index} 
              className="print-item"
              style={{
                width: `${labelWidth}mm`,
                height: `${labelHeight}mm`,
                outline: debugMode ? '1px dashed red' : 'none',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'hidden',
                margin: debugMode ? '0.25mm' : '0',
              }}
            >
              <img 
                src={barcode.image} 
                alt={`Barcode ${pageIndex * labelsPerPage + index + 1}`} 
                style={{
                  maxWidth: '95%',
                  maxHeight: '90%',
                  objectFit: 'contain'
                }}
              />
              {showExtraInfo && barcode.text && (
                <div className="additional-text">{barcode.text}</div>
              )}
              {debugMode && (
                <div style={{ position: 'absolute', top: 0, left: 0, fontSize: '8px', color: 'red' }}>
                  {pageIndex * labelsPerPage + index + 1}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    });
  }, [barcodes, getPageAndLabelDimensions, showExtraInfo, debugMode]);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    pageStyle: `
      @page {
        size: ${getPageAndLabelDimensions().pageWidth}mm ${getPageAndLabelDimensions().pageHeight}mm;
        margin: 0;
      }
    `,
  });

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all fields and remove the preview?')) {
      setData('');
      setText('');
      setPrefix('');
      setRangeStart('');
      setRangeEnd('');
      setBarcodeEntries([]);
      setBarcodes([]);
      setShowExtraInfo(true);
      setLabelSize('4x1-2col');
      setUseCustomSize(false);
      setCustomWidth('');
      setCustomHeight('');
      setCustomColumns('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const deleteBarcodeEntry = (index) => {
    const newEntries = barcodeEntries.filter((_, i) => i !== index);
    setBarcodeEntries(newEntries);
  };

  const generateBarcodeRange = () => {
    const start = parseInt(rangeStart, 10);
    const end = parseInt(rangeEnd, 10);

    if (isNaN(start) || isNaN(end) || start > end) {
      alert('Please enter a valid range');
      return;
    }

    const newEntries = [];
    for (let i = start; i <= end; i++) {
      const paddedNumber = i.toString().padStart(rangeEnd.length, '0');
      const barcodeData = `${prefix}${paddedNumber}`;
      newEntries.push({ data: barcodeData, text: '' });
    }

    const newBarcodeEntries = [...(barcodeEntries || []), ...newEntries];
    setBarcodeEntries(newBarcodeEntries);
    setLastAddedIndex(newBarcodeEntries.length - 1);
    setRangeStart('');
    setRangeEnd('');
    setTimeout(scrollToBottom, 0);
  };

  const scrollToBottom = () => {
    if (entriesSectionRef.current) {
      entriesSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  };

  useEffect(() => {
    if (barcodeEntries.length > 0) {
      scrollToBottom();
    }
  }, [barcodeEntries]);

  useEffect(() => {
    if (lastAddedIndex !== null) {
      const timer = setTimeout(() => {
        setLastAddedIndex(null);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [lastAddedIndex]);

  const updatePreviewScale = useCallback(() => {
    if (previewContainerRef.current && barcodes.length > 0) {
      const containerWidth = previewContainerRef.current.offsetWidth;
      const { width, columns } = getPageAndLabelDimensions(); // Get the width and columns of the selected size
      const rowWidth = width * columns;
      const scale = Math.min((containerWidth - 20) / rowWidth, 1);
      previewContainerRef.current.style.transform = `scale(${scale})`;
      previewContainerRef.current.style.transformOrigin = 'top left';
    }
  }, [barcodes.length, getPageAndLabelDimensions]);

  useEffect(() => {
    updatePreviewScale();
    window.addEventListener('resize', updatePreviewScale);
    return () => window.removeEventListener('resize', updatePreviewScale);
  }, [updatePreviewScale]);

  const renderPreviewItems = useCallback(() => {
    const { pageWidth, pageHeight, labelWidth, labelHeight, columns } = getPageAndLabelDimensions();
    const rows = Math.ceil(barcodes.length / columns);

    return Array.from({ length: rows }).map((_, rowIndex) => (
      <div key={rowIndex} style={{ display: 'flex', width: '100%' }}>
        {barcodes.slice(rowIndex * columns, (rowIndex + 1) * columns).map((barcode, index) => (
          <div 
            key={index}
            className="preview-item"
            style={{
              width: `${labelWidth}mm`,
              height: `${labelHeight}mm`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              border: '1px solid #ccc',
              boxSizing: 'border-box',
              margin: '1px',
              backgroundColor: '#fff',
            }}
          >
            {barcode.image && (
              <img 
                src={barcode.image} 
                alt={`Barcode ${rowIndex * columns + index + 1}`} 
                style={{
                  maxWidth: '100%',
                  maxHeight: '85%',
                  objectFit: 'contain'
                }}
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

  const pageSizeInfo = useCallback(() => {
    const { pageWidth, pageHeight, columns } = getPageAndLabelDimensions();
    return `Page Size: ${pageWidth}mm x ${pageHeight}mm (${columns} column${columns > 1 ? 's' : ''})`;
  }, [getPageAndLabelDimensions]);

  useEffect(() => {
    if (barcodes.length > 0) {
      console.log('Total barcodes:', barcodes.length);
      console.log('First barcode:', barcodes[0]);
      console.log('First barcode image:', barcodes[0].image);
    }
  }, [barcodes]);

  useEffect(() => {
    const options = {
      bottom: '64px',
      right: 'unset',
      left: '32px',
      time: '0.5s',
      mixColor: '#fff',
      backgroundColor: '#fff',
      buttonColorDark: '#100f2c',
      buttonColorLight: '#fff',
      saveInCookies: false,
      label: '🌓',
      autoMatchOsTheme: true
    };
    
    const darkmode = new Darkmode(options);
    darkmode.showWidget();

    return () => {
      const darkmodeActivator = document.querySelector('.darkmode-toggle');
      if (darkmodeActivator) {
        darkmodeActivator.remove();
      }
    };
  }, []);

  const previewScale = useCallback(() => {
    const { pageWidth, pageHeight, columns } = getPageAndLabelDimensions();
    const totalWidth = pageWidth * columns;
    const containerWidth = 800; // max-width of preview container
    return Math.min(1, containerWidth / totalWidth);
  }, [getPageAndLabelDimensions]);

  return (
    <div className="App">
      <Helmet>
        <title>Free Online Barcode Generator | BarTender Alternative</title>
        <meta name="description" content="Generate barcodes online for free with our easy-to-use Barcode Generator. A powerful, web-based alternative to BarTender. Create individual barcodes, ranges, or bulk generate from CSV." />
        <meta name="keywords" content="barcode generator, BarTender alternative, free barcode creator, online label maker, QR code generator" />
        <meta name="author" content="Suhail Akhtar" />
        <meta property="og:title" content="Free Online Barcode Generator | BarTender Alternative" />
        <meta property="og:description" content="Generate barcodes online for free with our easy-to-use Barcode Generator. A powerful, web-based alternative to BarTender. Create individual barcodes, ranges, or bulk generate from CSV." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://your-app-url.com" />
        <meta property="og:image" content="https://your-app-url.com/path-to-your-logo.png" />
        <link rel="canonical" href="https://your-app-url.com" />
      </Helmet>

      <header className="App-header">
        <h1 className="app-title">
          Barcode Generator 𝄃𝄃𝄂𝄂𝄀𝄁𝄃𝄂𝄂𝄃
        </h1>
      </header>

      <main className="app-layout">
        <div className="controls-section">
          <section className="input-section">
            <h2>Individual Barcode</h2>
            <input
              type="text"
              placeholder="Barcode data"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
            <input
              type="text"
              placeholder="Additional text"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button onClick={addBarcodeEntry}>Add Barcode Entry</button>
          </section>

          <section className="input-section">
            <h2>Barcode Range</h2>
            <input
              type="text"
              placeholder="Prefix (optional)"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
            <div className="range-inputs">
              <input
                type="number"
                placeholder="Range start"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
              />
              <input
                type="number"
                placeholder="Range end"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
              />
            </div>
            <button onClick={generateBarcodeRange}>Generate Barcode Range</button>
          </section>

          <section className="input-section">
            <h2>CSV File Upload</h2>
            <input type="file" accept=".csv" onChange={handleFileUpload} ref={fileInputRef} />
          </section>

          <section className="options-section">
            <h2>Options</h2>
            <div className="checkbox-container">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showExtraInfo}
                  onChange={(e) => setShowExtraInfo(e.target.checked)}
                />
                <span>Show additional text</span>
              </label>
            </div>
            <div className="checkbox-container">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useCustomSize}
                  onChange={(e) => setUseCustomSize(e.target.checked)}
                />
                <span>Use custom label size</span>
              </label>
            </div>
            {useCustomSize ? (
              <div className="custom-size-inputs">
                <input
                  type="number"
                  placeholder="Width (mm)"
                  value={customWidth}
                  onChange={(e) => {
                    setCustomWidth(e.target.value);
                    generateBarcode();
                  }}
                />
                <input
                  type="number"
                  placeholder="Height (mm)"
                  value={customHeight}
                  onChange={(e) => {
                    setCustomHeight(e.target.value);
                    generateBarcode();
                  }}
                />
                <input
                  type="number"
                  placeholder="Columns"
                  value={customColumns}
                  onChange={(e) => {
                    setCustomColumns(e.target.value);
                    generateBarcode();
                  }}
                />
              </div>
            ) : (
              <select value={labelSize} onChange={(e) => setLabelSize(e.target.value)}>
                <option value="2x1-1col">2x1 inches (50mm x 25mm) - 1 column</option>
                <option value="2x1-2col">2x1 inches (50mm x 25mm) - 2 columns</option>
                <option value="2x1-3col">2x1 inches (50mm x 25mm) - 3 columns</option>
                <option value="2x1-4col">2x1 inches (50mm x 25mm) - 4 columns</option>
                <option value="3x2-1col">3x2 inches (75mm x 50mm) - 1 column</option>
                <option value="3x2-2col">3x2 inches (75mm x 50mm) - 2 columns</option>
                <option value="3x2-3col">3x2 inches (75mm x 50mm) - 3 columns</option>
                <option value="4x3-1col">4x3 inches (100mm x 75mm) - 1 column</option>
                <option value="4x3-2col">4x3 inches (100mm x 75mm) - 2 columns</option>
                <option value="4x1-2col">4x1 inches (100mm x 25mm) - 2 columns</option>
              </select>
            )}
          </section>

          <section className="action-buttons">
            <button onClick={generateBarcode}>Generate Barcodes</button>
            <button onClick={handlePrint} className="print-button">
              <FaPrint /> Print Barcodes
            </button>
            <button onClick={handleClearAll} className="clear-button">Clear All</button>
          </section>

          {(barcodeEntries && barcodeEntries.length > 0) && (
            <section className="barcode-entries" ref={entriesSectionRef}>
              <h2>Current Barcode Entries: (Total: {barcodeEntries?.length || 0})</h2>
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Data</th>
                    {barcodeEntries.some(entry => entry.text) && <th>Text</th>}
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {barcodeEntries.map((entry, index) => (
                    <tr key={index} className={index === lastAddedIndex ? 'new-entry' : ''}>
                      <td>{index + 1}</td>
                      <td>{entry.data}</td>
                      {barcodeEntries.some(entry => entry.text) && <td>{entry.text}</td>}
                      <td>
                        <button 
                          onClick={() => deleteBarcodeEntry(index)}
                          className="delete-entry"
                          aria-label="Delete entry"
                        >
                          &times;
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>

        {barcodes.length > 0 && (
          <div className="preview-section" style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
            <h2 style={{ color: '#fff' }}>Preview</h2>
            <div className="page-size-info" style={{ color: '#fff' }}>{pageSizeInfo()}</div>
            <div 
              className="preview-container" 
              ref={previewContainerRef} 
              style={{ 
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                overflow: 'hidden',
                border: '1px solid #ccc',
                backgroundColor: '#f9f9f9',
              }}
            >
              {renderPreviewItems()}
            </div>
          </div>
        )}
      </main>

      <footer style={{
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        color: '#fff',
        padding: '10px',
        textAlign: 'center'
      }}>
        Created by <a 
          href="https://www.linkedin.com/in/im-suhail-akhtar/" 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ color: '#4CAF50', textDecoration: 'none' }}
        >
          Suhail Akhtar
        </a> 👨‍💻
      </footer>

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Print preview area */}
      <div className="print-preview">
        <h3>Print Preview</h3>
        <div className="preview-outer-container">
          <div className="preview-container">
            <div ref={printRef} className="print-wrapper">
              {renderPrintItems()}
            </div>
          </div>
        </div>
      </div>

      <button onClick={handlePrint} className="print-button">
        <FaPrint /> Print Labels
      </button>

      <div>
        <label>
          <input
            type="checkbox"
            checked={debugMode}
            onChange={(e) => setDebugMode(e.target.checked)}
          />
          Debug Mode
        </label>
      </div>
    </div>
  );
}

export default App;
