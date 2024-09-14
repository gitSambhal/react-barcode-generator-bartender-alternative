import React, { useState, useRef, useEffect, useCallback } from 'react';
import JsBarcode from 'jsbarcode';
import Papa from 'papaparse';
import { useReactToPrint } from 'react-to-print';
import { FaPrint } from 'react-icons/fa';
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
  const [previewScale, setPreviewScale] = useState(1);
  const previewContainerRef = useRef(null);

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

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    let labelWidth, labelHeight;
    if (useCustomSize) {
      labelWidth = parseFloat(customWidth);
      labelHeight = parseFloat(customHeight);
    } else {
      labelWidth = labelSizes[labelSize].width;
      labelHeight = labelSizes[labelSize].height;
    }

    // Set canvas size based on label size
    canvas.width = labelWidth;
    canvas.height = labelHeight;

    // Set fixed barcode height
    const barcodeHeight = 100; // 100mm height

    console.log(`Barcode height: ${barcodeHeight}mm`); // Log the barcode height

    const newBarcodes = barcodeEntries.map(entry => {
      // Clear canvas for each new barcode
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      JsBarcode(canvas, entry.data, {
        format: "CODE128",
        width: 2,
        height: barcodeHeight,
        displayValue: true,
        margin: 5,
        fontSize: 12,
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

  const getLabelDimensions = useCallback(() => {
    if (useCustomSize) {
      return {
        width: parseFloat(customWidth),
        height: parseFloat(customHeight),
        columns: parseInt(customColumns, 10) || 1
      };
    }
    return {
      width: labelSizes[labelSize].width,
      height: labelSizes[labelSize].height,
      columns: labelSizes[labelSize].columns
    };
  }, [useCustomSize, customWidth, customHeight, customColumns, labelSize]);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    pageStyle: `
      @page {
        size: ${getLabelDimensions().width * getLabelDimensions().columns}mm ${getLabelDimensions().height}mm;
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
      setLabelSize('2x1-2col');
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

  // Function to group barcodes into rows based on the number of columns
  const groupBarcodesIntoRows = useCallback(() => {
    const { columns } = getLabelDimensions();
    return barcodes.reduce((rows, barcode, index) => {
      if (index % columns === 0) rows.push([]);
      rows[rows.length - 1].push(barcode);
      return rows;
    }, []);
  }, [barcodes, getLabelDimensions]);

  const updatePreviewScale = useCallback(() => {
    if (previewContainerRef.current && barcodes.length > 0) {
      const containerWidth = previewContainerRef.current.offsetWidth;
      const { width, columns } = getLabelDimensions();
      const rowWidth = width * columns;
      const scale = (containerWidth - 20) / rowWidth; // 20px for padding
      setPreviewScale(Math.min(scale, 1)); // Don't scale up, only down
    }
  }, [barcodes.length, getLabelDimensions]);

  useEffect(() => {
    updatePreviewScale();
    window.addEventListener('resize', updatePreviewScale);
    return () => window.removeEventListener('resize', updatePreviewScale);
  }, [updatePreviewScale]);

  return (
    <div className="App">
      <h1>Barcode Generator</h1>
      <div className="app-layout">
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
            <h2>File Upload</h2>
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
          <div className="preview-section">
            <h2>Preview</h2>
            <div className="preview-container" ref={previewContainerRef}>
              <div 
                className="print-area" 
                ref={printRef}
                style={{
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top left',
                }}
              >
                {groupBarcodesIntoRows().map((row, rowIndex) => (
                  <div 
                    key={rowIndex} 
                    className="barcode-row"
                    style={{
                      width: `${getLabelDimensions().width * getLabelDimensions().columns}mm`,
                      height: `${getLabelDimensions().height}mm`,
                    }}
                  >
                    {row.map((barcode, index) => (
                      <div 
                        key={index} 
                        className="barcode-item"
                        style={{
                          width: `${getLabelDimensions().width}mm`,
                          height: `${getLabelDimensions().height}mm`,
                        }}
                      >
                        <img 
                          src={barcode.image} 
                          alt={`Barcode ${rowIndex * getLabelDimensions().columns + index + 1}`} 
                          style={{
                            width: '100%',
                            objectFit: 'contain'
                          }}
                        />
                        {showExtraInfo && barcode.text && (
                          <div className="additional-text">{barcode.text}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

export default App;
