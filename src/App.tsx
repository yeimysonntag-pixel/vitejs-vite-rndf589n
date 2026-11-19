import React, { useState, useMemo, ChangeEvent } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Legend, BarChart, Bar, PieChart, Pie, Cell 
} from 'recharts';

const TIVIT_RED = '#CC0000';

// 6 COLUMNAS PRINCIPALES FIJAS (SIEMPRE PRESENTES AL INICIO EN TABLA Y EXPORTACIÓN)
const FIXED_PRIMARY_COLS = [
  'line_item_usage_account_id',
  'line_item_usage_account_name',
  'bill_payer_account_id',
  'Product_Name',
  'bill_billing_entity',
  'Costo_Final_Ajustado'
] as const;

const COL_DISPLAY_LABELS: Record<string, string> = {
  'Unblended_Cost': '💵 Unblended Cost',
  'Unblended_Rate': '🏷️ Unblended Rate',
  'Marketplace_Cost': '🛒 Marketplace Cost',
  'SPP_Discount': '➕ SPP Discount',
  'EDP_Discount': '➕ EDP Discount',
  'Costo_Final_Ajustado': 'Total',
  'Cuenta_Mapeada': '🏷️ Cuenta / Cliente Mapeado',
};

// NOMBRES DE ENCABEZADOS AL EXPORTAR (EXCEL .XLSM Y CSV)
const EXPORT_HEADER_LABELS: Record<string, string> = {
  'line_item_usage_account_id': 'Account ID',
  'line_item_usage_account_name': 'Account Name',
  'bill_payer_account_id': 'Payer Account Id',
  'Costo_Final_Ajustado': 'Total',
};

// COLUMNAS DE ID QUE DEBEN EXPORTARSE COMO NÚMERO ENTERO EN EXCEL
const NUMERIC_ID_COLS = new Set<string>([
  'line_item_usage_account_id',
  'bill_payer_account_id',
]);

// ============================================================================
// GENERADOR BINARIO ZIP NATIVO PARA LIBRO DE EXCEL HABILITADO PARA MACROS (.XLSM)
// ============================================================================
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipArchive(files: { path: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const fileEntries = files.map(f => {
    const nameBytes = encoder.encode(f.path);
    const dataBytes = encoder.encode(f.content);
    return {
      nameBytes,
      dataBytes,
      crc: crc32(dataBytes),
      offset: 0,
    };
  });

  const chunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of fileEntries) {
    entry.offset = offset;
    const localHeader = new Uint8Array(30 + entry.nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0x0021, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.dataBytes.length, true);
    view.setUint32(22, entry.dataBytes.length, true);
    view.setUint16(26, entry.nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(entry.nameBytes, 30);

    chunks.push(localHeader, entry.dataBytes);
    offset += localHeader.length + entry.dataBytes.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;

  for (const entry of fileEntries) {
    const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(centralHeader.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0x0021, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.dataBytes.length, true);
    view.setUint32(24, entry.dataBytes.length, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true);
    centralHeader.set(entry.nameBytes, 46);

    chunks.push(centralHeader);
    centralDirSize += centralHeader.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, fileEntries.length, true);
  eocdView.setUint16(10, fileEntries.length, true);
  eocdView.setUint32(12, centralDirSize, true);
  eocdView.setUint32(16, centralDirOffset, true);
  eocdView.setUint16(20, 0, true);
  chunks.push(eocd);

  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const output = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    output.set(chunk, pos);
    pos += chunk.length;
  }
  return output;
}

function colIndexToLetter(colIdx1Based: number): string {
  let temp = colIdx1Based;
  let letter = '';
  while (temp > 0) {
    const rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

interface RowData {
  id: number;
  _sourceFile?: string;
  [key: string]: any;
}

interface LoadedCurInfo {
  name: string;
  records: number;
  edp: number;
  marketplace: number;
}

interface AccountCatalogItem {
  accountKey: string;
  accountId: string;
  accountName: string;
  payerAccountId: string;
  records: number;
  totalCost: number;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'proyeccion' | 'finops' | 'reporte_completo'>('dashboard');

  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<RowData[]>([]);
  const [loadedFiles, setLoadedFiles] = useState<LoadedCurInfo[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string>('Sube uno o más archivos CUR descomprimidos (.csv o .tsv) para comenzar.');
  const [pageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [onlyDataWithValues] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);

  // ESTADOS PARA SELECCIÓN Y MAPEO DE CUENTAS DENTRO DE LOS CURS
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({});
  const [accountSearch, setAccountSearch] = useState<string>('');
  const [showAccountMapper, setShowAccountMapper] = useState<boolean>(true);

  // Permite alternar la visibilidad de los resúmenes tabulares en el reporte completo
  const [showResumenesReporte, setShowResumenesReporte] = useState<boolean>(true);

  // CAMPOS DE PROYECCIÓN
  const [monthsToProject, setMonthsToProject] = useState<number>(6);
  const [manualGrowthRate, setManualGrowthRate] = useState<number>(2.5);

  // CAMPOS PARA DATOS DE FACTURA / CLIENTE
  const [clienteNombre, setClienteNombre] = useState<string>('Prueba');
  const [clienteRut, setClienteRut] = useState<string>('76.123.456-7');
  const [codCliente, setCodCliente] = useState<string>('CL-88492');
  const [accountManager, setAccountManager] = useState<string>('Ejecutivo TIVIT');
  const [sdm, setSdm] = useState<string>('Service Delivery Manager');
  const [tipoCambio, setTipoCambio] = useState<number>(871.78);
  const [fechaTC, setFechaTC] = useState<string>('26-02-2026');
  const [periodoInicio, setPeriodoInicio] = useState<string>('01-01-2026');
  const [periodoFin, setPeriodoFin] = useState<string>('');
  const [fechaInforme, setFechaInforme] = useState<string>('');
  const [mesConsumo, setMesConsumo] = useState<string>('enero');

  // COLUMNAS ADICIONALES SELECCIONADAS (LAS 6 PRINCIPALES SIEMPRE SE INCLUYEN PRIMERO)
  const [customReportCols, setCustomReportCols] = useState<string[]>([...FIXED_PRIMARY_COLS]);
  const [showColPicker, setShowColPicker] = useState<boolean>(false);

  // CAPTURA DE PANTALLA DE CONSOLA
  const [consoleScreenshot, setConsoleScreenshot] = useState<string | null>(null);

  // HELPER PARA OBTENER LLAVE ÚNICA DE CUENTA POR FILA
  const getRowAccountKey = (row: RowData): string => {
    const id = String(row['line_item_usage_account_id'] ?? '').trim();
    const name = String(row['line_item_usage_account_name'] ?? '').trim();
    return id || name || 'SIN_CUENTA';
  };

  // CATÁLOGO DE CUENTAS DETECTADAS EN TODOS LOS CURS CARGADOS
  const availableAccounts = useMemo<AccountCatalogItem[]>(() => {
    const map = new Map<string, AccountCatalogItem>();

    dataRows.forEach(row => {
      const accountId = String(row['line_item_usage_account_id'] ?? '').trim();
      const accountName = String(row['line_item_usage_account_name'] ?? '').trim();
      const payerAccountId = String(row['bill_payer_account_id'] ?? '').trim();
      const accountKey = accountId || accountName || 'SIN_CUENTA';
      const cost = Number(row['Costo_Final_Ajustado'] ?? row['Unblended_Cost'] ?? 0) || 0;

      const existing = map.get(accountKey);
      if (existing) {
        existing.records += 1;
        existing.totalCost += cost;
        if (!existing.accountName && accountName) existing.accountName = accountName;
        if (!existing.payerAccountId && payerAccountId) existing.payerAccountId = payerAccountId;
      } else {
        map.set(accountKey, {
          accountKey,
          accountId: accountId || 'N/A',
          accountName: accountName || 'Sin nombre en CUR',
          payerAccountId: payerAccountId || 'N/A',
          records: 1,
          totalCost: cost,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
  }, [dataRows]);

  // FILTRO DEL BUSCADOR DENTRO DEL SELECTOR DE CUENTAS
  const filteredAccountCatalog = useMemo(() => {
    const q = accountSearch.toLowerCase().trim();
    if (!q) return availableAccounts;
    return availableAccounts.filter(acc => {
      const mapped = (accountMappings[acc.accountKey] || '').toLowerCase();
      return (
        acc.accountId.toLowerCase().includes(q) ||
        acc.accountName.toLowerCase().includes(q) ||
        acc.payerAccountId.toLowerCase().includes(q) ||
        mapped.includes(q)
      );
    });
  }, [availableAccounts, accountSearch, accountMappings]);

  // LISTA FINAL DE COLUMNAS ORDENADA: SIEMPRE LAS 6 PRINCIPALES PRIMERO + EXTRA SELECCIONADAS
  const orderedActiveCols = useMemo(() => {
    const fixedSet = new Set<string>(FIXED_PRIMARY_COLS);
    const extraCols = customReportCols.filter(col => !fixedSet.has(col));
    return [...FIXED_PRIMARY_COLS, ...extraCols];
  }, [customReportCols]);

  // LISTA DE HEADERS DISPONIBLES ORDENADA (INCLUYE Cuenta_Mapeada)
  const allAvailableHeaders = useMemo(() => {
    const merged = new Set<string>([...FIXED_PRIMARY_COLS, 'Cuenta_Mapeada', ...headers]);
    if (loadedFiles.length > 1) {
      merged.add('_sourceFile');
    }
    return Array.from(merged);
  }, [headers, loadedFiles.length]);

  // PROCESAMIENTO SECUENCIAL DE UN ARCHIVO MEDIANTE WORKER
  const processSingleCurFile = (
    file: File,
    fileIndex: number,
    totalFiles: number,
    startingRowId: number
  ): Promise<{
    rows: RowData[];
    headers: string[];
    totalRecords: number;
    totalEdp: number;
    totalMarketplace: number;
  }> => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('./workers/curWorker.ts', import.meta.url),
        { type: 'module' }
      );

      let fileHeaders: string[] = [];
      let accumulatedRows: RowData[] = [];
      let nextId = startingRowId;

      worker.postMessage({ file });

      worker.onmessage = (event: MessageEvent) => {
        const {
          type,
          progress: prog,
          headers: receivedHeaders,
          rows,
          totalRecords,
          totalEdp,
          totalMarketplace,
          error,
        } = event.data;

        if (type === 'HEADERS') {
          fileHeaders = receivedHeaders || [];
        } else if (type === 'PROGRESS') {
          const globalProgress = Math.round(((fileIndex + (prog || 0) / 100) / totalFiles) * 100);
          setProgress(globalProgress);
        } else if (type === 'CHUNK' && Array.isArray(rows)) {
          const taggedRows = rows.map((r: RowData) => ({
            ...r,
            id: nextId++,
            _sourceFile: file.name,
          }));
          accumulatedRows = accumulatedRows.concat(taggedRows);
        } else if (type === 'COMPLETE') {
          worker.terminate();
          resolve({
            rows: accumulatedRows,
            headers: fileHeaders,
            totalRecords: totalRecords || accumulatedRows.length,
            totalEdp: totalEdp || 0,
            totalMarketplace: totalMarketplace || 0,
          });
        } else if (type === 'ERROR') {
          worker.terminate();
          reject(new Error(error || `Error procesando ${file.name}`));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(new Error(err.message || `Error en Worker con ${file.name}`));
      };
    });
  };

  // CARGA DE MÚLTIPLES ARCHIVOS CUR
  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const filesToProcess = Array.from(fileList);
    setIsProcessing(true);
    setProgress(0);

    let currentRows = [...dataRows];
    let currentHeadersSet = new Set<string>(headers);
    let updatedLoadedFiles = [...loadedFiles];
    let nextRowId = currentRows.length > 0 ? Math.max(...currentRows.map(r => r.id)) + 1 : 1;

    const previousAccountKeys = new Set<string>(currentRows.map(getRowAccountKey));

    try {
      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        setStatusMessage(`⏳ Procesando archivo ${i + 1} de ${filesToProcess.length}: ${file.name}...`);

        const result = await processSingleCurFile(file, i, filesToProcess.length, nextRowId);

        result.headers.forEach(h => currentHeadersSet.add(h));
        currentRows = currentRows.concat(result.rows);
        nextRowId += result.rows.length;

        updatedLoadedFiles.push({
          name: file.name,
          records: result.totalRecords,
          edp: result.totalEdp,
          marketplace: result.totalMarketplace,
        });
      }

      const mergedHeaders = Array.from(currentHeadersSet);
      setHeaders(mergedHeaders);
      setDataRows(currentRows);
      setLoadedFiles(updatedLoadedFiles);
      setCurrentPage(1);

      const allDetectedKeys = Array.from(new Set(currentRows.map(getRowAccountKey)));
      if (previousAccountKeys.size === 0) {
        setSelectedAccounts(allDetectedKeys);
      } else {
        const newlyAddedKeys = allDetectedKeys.filter(k => !previousAccountKeys.has(k));
        setSelectedAccounts(prev => Array.from(new Set([...prev, ...newlyAddedKeys])));
      }

      if (dataRows.length === 0) {
        setCustomReportCols([
          ...FIXED_PRIMARY_COLS,
          'Cuenta_Mapeada',
          'Service_Name',
          'Unblended_Cost',
          'Unblended_Rate',
          'Is_Marketplace',
          'Marketplace_Cost',
          'SPP_Discount',
          'EDP_Discount',
          ...(updatedLoadedFiles.length > 1 ? ['_sourceFile'] : []),
        ]);
      } else if (updatedLoadedFiles.length > 1 && !customReportCols.includes('_sourceFile')) {
        setCustomReportCols(prev => [...prev, '_sourceFile']);
      }

      const totalRecordsAll = updatedLoadedFiles.reduce((acc, f) => acc + f.records, 0);
      const totalEdpAll = updatedLoadedFiles.reduce((acc, f) => acc + f.edp, 0);
      const totalMktAll = updatedLoadedFiles.reduce((acc, f) => acc + f.marketplace, 0);

      const edpFormatted = totalEdpAll.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const mktFormatted = totalMktAll.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      setStatusMessage(
        `✅ ${updatedLoadedFiles.length} CUR(s) cargado(s) — ${totalRecordsAll.toLocaleString()} registros totales | ${allDetectedKeys.length} cuenta(s) detectada(s). Marketplace: $${mktFormatted} | EDP: $${edpFormatted}`
      );
    } catch (err: any) {
      setStatusMessage(`❌ Error al procesar CUR: ${err.message}`);
    } finally {
      setIsProcessing(false);
      e.target.value = '';
    }
  };

  // LIMPIAR TODOS LOS CURS CARGADOS
  const handleClearAllCurs = () => {
    setDataRows([]);
    setHeaders([]);
    setLoadedFiles([]);
    setSelectedAccounts([]);
    setAccountMappings({});
    setFilters({});
    setCurrentPage(1);
    setCustomReportCols([...FIXED_PRIMARY_COLS]);
    setStatusMessage('Sube uno o más archivos CUR descomprimidos (.csv o .tsv) para comenzar.');
  };

  // HANDLERS DE SELECCIÓN Y MAPEO DE CUENTAS
  const toggleAccountSelection = (accountKey: string) => {
    setSelectedAccounts(prev =>
      prev.includes(accountKey)
        ? prev.filter(k => k !== accountKey)
        : [...prev, accountKey]
    );
    setCurrentPage(1);
  };

  const selectAllAccounts = () => {
    setSelectedAccounts(availableAccounts.map(a => a.accountKey));
    setCurrentPage(1);
  };

  const deselectAllAccounts = () => {
    setSelectedAccounts([]);
    setCurrentPage(1);
  };

  const handleAccountMappingChange = (accountKey: string, mappedValue: string) => {
    setAccountMappings(prev => ({
      ...prev,
      [accountKey]: mappedValue,
    }));
  };

  const autoFillMappingsFromCurNames = () => {
    const nextMap: Record<string, string> = { ...accountMappings };
    availableAccounts.forEach(acc => {
      if (!nextMap[acc.accountKey] || nextMap[acc.accountKey].trim() === '') {
        nextMap[acc.accountKey] = acc.accountName !== 'Sin nombre en CUR' ? acc.accountName : acc.accountId;
      }
    });
    setAccountMappings(nextMap);
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setConsoleScreenshot(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleColumn = (colName: string) => {
    if ((FIXED_PRIMARY_COLS as readonly string[]).includes(colName)) return;
    setCustomReportCols(prev =>
      prev.includes(colName) ? prev.filter(c => c !== colName) : [...prev, colName]
    );
  };

  const selectAllCols = () => {
    setCustomReportCols(allAvailableHeaders);
  };

  const deselectAllCols = () => {
    setCustomReportCols([...FIXED_PRIMARY_COLS]);
  };

  // FILTRADO DE FILAS: POR CUENTAS SELECCIONADAS + ENRIQUECIMIENTO DE MAPEO + FILTROS DE COLUMNA
  const filteredRows = useMemo(() => {
    if (dataRows.length === 0 || selectedAccounts.length === 0) return [];

    const selectedSet = new Set(selectedAccounts);

    return dataRows
      .filter(row => selectedSet.has(getRowAccountKey(row)))
      .map(row => {
        const accKey = getRowAccountKey(row);
        const mappedLabel =
          accountMappings[accKey]?.trim() ||
          row['line_item_usage_account_name'] ||
          row['line_item_usage_account_id'] ||
          '';
        return {
          ...row,
          Cuenta_Mapeada: mappedLabel,
        };
      })
      .filter(row => {
        if (onlyDataWithValues) {
          const cost = row['Costo_Final_Ajustado'] || 0;
          const unblendedCost = row['Unblended_Cost'] || 0;
          const spp = row['SPP_Discount'] || 0;
          const edp = row['EDP_Discount'] || 0;
          const mkt = row['Marketplace_Cost'] || 0;
          if (
            Math.abs(cost) === 0 &&
            Math.abs(unblendedCost) === 0 &&
            Math.abs(spp) === 0 &&
            Math.abs(edp) === 0 &&
            Math.abs(mkt) === 0
          ) {
            return false;
          }
        }

        return Object.entries(filters).every(([col, filterVal]) => {
          if (!filterVal || filterVal.trim() === '') return true;
          const cellValue = String((row as Record<string, any>)[col] ?? '').toLowerCase();
          return cellValue.includes(filterVal.toLowerCase().trim());
        });
      });
  }, [dataRows, selectedAccounts, accountMappings, filters, onlyDataWithValues]);

  // FILAS PARA EXPORTACIÓN: EXCLUYE TODAS LAS FILAS CUYO "Total" (Costo_Final_Ajustado) SEA 0.0
  const exportableRows = useMemo(() => {
    return filteredRows.filter(row => {
      const totalVal = Number(row['Costo_Final_Ajustado'] ?? 0);
      return !Number.isNaN(totalVal) && Math.abs(totalVal) >= 0.000001;
    });
  }, [filteredRows]);

  const getExportHeaderName = (col: string): string => {
    return EXPORT_HEADER_LABELS[col] || COL_DISPLAY_LABELS[col] || col;
  };

  // ============================================================================
  // EXPORTAR COMO LIBRO DE EXCEL HABILITADO PARA MACROS (.XLSM OPENXML NATIVO)
  // ============================================================================
  const exportToExcel = () => {
    if (exportableRows.length === 0) return;

    const exportCols = orderedActiveCols;

    const escapeXml = (unsafe: any) =>
      String(unsafe ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const strCell = (ref: string, styleIdx: number, val: any) =>
      `<c r="${ref}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(val)}</t></is></c>`;

    const numCell = (ref: string, styleIdx: number, val: number | string) =>
      `<c r="${ref}" s="${styleIdx}"><v>${val}</v></c>`;

    const formulaCell = (ref: string, styleIdx: number, formula: string, cachedVal: number | string, isStrResult = false) =>
      isStrResult
        ? `<c r="${ref}" s="${styleIdx}" t="str"><f>${escapeXml(formula)}</f><v>${escapeXml(cachedVal)}</v></c>`
        : `<c r="${ref}" s="${styleIdx}"><f>${escapeXml(formula)}</f><v>${cachedVal}</v></c>`;

    const sortedDetailRows = [...exportableRows].sort((a, b) => {
      const nameA = String(a['line_item_usage_account_name'] ?? '').localeCompare(String(b['line_item_usage_account_name'] ?? ''));
      if (nameA !== 0) return nameA;
      return (Number(b['Costo_Final_Ajustado']) || 0) - (Number(a['Costo_Final_Ajustado']) || 0);
    });

    // 1. Agrupar consumo por Account Name (de mayor a menor)
    const accountSummaryMap = new Map<string, { accountName: string; accountId: string; totalCost: number }>();
    sortedDetailRows.forEach(row => {
      const rawName = String(row['line_item_usage_account_name'] ?? '').trim() || 'Sin Nombre';
      const rawId = String(row['line_item_usage_account_id'] ?? '').trim();
      const cost = Number(row['Costo_Final_Ajustado'] ?? 0) || 0;

      const current = accountSummaryMap.get(rawName);
      if (current) {
        current.totalCost += cost;
      } else {
        accountSummaryMap.set(rawName, {
          accountName: rawName,
          accountId: rawId,
          totalCost: cost,
        });
      }
    });

    const pivotAccountSummary = Array.from(accountSummaryMap.values()).sort((a, b) => b.totalCost - a.totalCost);
    const totalSumAll = pivotAccountSummary.reduce((acc, item) => acc + item.totalCost, 0);
    const maxAccountCost = pivotAccountSummary.length > 0 ? Math.max(...pivotAccountSummary.map(a => a.totalCost), 0.01) : 1;

    // 2. Agrupar consumo por Payer Account Id (de mayor a menor)
    const payerSummaryMap = new Map<string, { payerId: string; linkedAccounts: Set<string>; totalCost: number }>();
    sortedDetailRows.forEach(row => {
      const rawPayer = String(row['bill_payer_account_id'] ?? '').trim() || 'Sin Payer ID';
      const rawAcc = String(row['line_item_usage_account_id'] ?? row['line_item_usage_account_name'] ?? '').trim();
      const cost = Number(row['Costo_Final_Ajustado'] ?? 0) || 0;

      const current = payerSummaryMap.get(rawPayer);
      if (current) {
        current.totalCost += cost;
        if (rawAcc) current.linkedAccounts.add(rawAcc);
      } else {
        const set = new Set<string>();
        if (rawAcc) set.add(rawAcc);
        payerSummaryMap.set(rawPayer, {
          payerId: rawPayer,
          linkedAccounts: set,
          totalCost: cost,
        });
      }
    });

    const pivotPayerSummary = Array.from(payerSummaryMap.values())
      .map(p => ({
        payerId: p.payerId,
        accountCount: p.linkedAccounts.size,
        totalCost: p.totalCost,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);

    // 3. Agrupar consumo por Product_Name (de mayor a menor)
    const productSummaryMap = new Map<string, number>();
    sortedDetailRows.forEach(row => {
      const prodName = String(row['Product_Name'] ?? '').trim() || 'Sin Product Name';
      const cost = Number(row['Costo_Final_Ajustado'] ?? 0) || 0;
      productSummaryMap.set(prodName, (productSummaryMap.get(prodName) || 0) + cost);
    });

    const sortedProducts = Array.from(productSummaryMap.entries())
      .map(([productName, totalCost]) => ({ productName, totalCost }))
      .filter(p => Math.abs(p.totalCost) >= 0.000001)
      .sort((a, b) => b.totalCost - a.totalCost);

    const PIE_COLORS = ['CC0000', '1E293B', '2563EB', '059669', 'D97706', '7C3AED', '0891B2', 'DB2777', '64748B'];
    const pieSlices: { productName: string; totalCost: number; styleIdx: number; isOthers: boolean }[] = [];

    if (sortedProducts.length <= 9) {
      sortedProducts.forEach((item, idx) => {
        pieSlices.push({
          productName: item.productName,
          totalCost: item.totalCost,
          styleIdx: idx % PIE_COLORS.length,
          isOthers: false,
        });
      });
    } else {
      const top8 = sortedProducts.slice(0, 8);
      const restSum = sortedProducts.slice(8).reduce((acc, item) => acc + item.totalCost, 0);
      top8.forEach((item, idx) => {
        pieSlices.push({
          productName: item.productName,
          totalCost: item.totalCost,
          styleIdx: idx,
          isOthers: false,
        });
      });
      if (restSum > 0) {
        pieSlices.push({
          productName: `Otros Productos (${sortedProducts.length - 8} restantes)`,
          totalCost: restSum,
          styleIdx: 8,
          isOthers: true,
        });
      }
    }

    const totalPieSum = pieSlices.reduce((acc, s) => acc + s.totalCost, 0) || 1;

    // SHEET 1: Detalle_CUR
    const detailColsXml = exportCols
      .map((col, idx) => {
        const cNum = idx + 1;
        let width = 18;
        if (NUMERIC_ID_COLS.has(col)) width = 18;
        else if (col === 'line_item_usage_account_name') width = 28;
        else if (col === 'Product_Name') width = 34;
        else if (col === 'bill_billing_entity') width = 22;
        else if (col === 'Costo_Final_Ajustado') width = 16;
        return `<col min="${cNum}" max="${cNum}" width="${width}" customWidth="1"/>`;
      })
      .join('');

    const detailHeaderRow = `<row r="1" ht="24" customHeight="1">${exportCols
      .map((col, idx) => {
        const ref = `${colIndexToLetter(idx + 1)}1`;
        const styleId = idx < FIXED_PRIMARY_COLS.length ? 4 : 5;
        return strCell(ref, styleId, getExportHeaderName(col));
      })
      .join('')}</row>`;

    const detailBodyRows = sortedDetailRows
      .map((row, rIdx) => {
        const excelRow = rIdx + 2;
        const isAlt = rIdx % 2 === 1;
        const cells = exportCols
          .map((col, idx) => {
            const ref = `${colIndexToLetter(idx + 1)}${excelRow}`;
            const rawVal = (row as Record<string, any>)[col];

            if (NUMERIC_ID_COLS.has(col)) {
              const cleanDigits = String(rawVal ?? '').replace(/\D/g, '');
              if (cleanDigits.length > 0) {
                return numCell(ref, isAlt ? 7 : 6, cleanDigits);
              }
            }

            if (typeof rawVal === 'number' && !Number.isNaN(rawVal)) {
              const sIdx =
                col === 'Costo_Final_Ajustado'
                  ? isAlt ? 11 : 10
                  : idx < FIXED_PRIMARY_COLS.length
                  ? isAlt ? 13 : 12
                  : isAlt ? 15 : 14;
              return numCell(ref, sIdx, rawVal);
            }

            return strCell(ref, isAlt ? 9 : 8, rawVal);
          })
          .join('');
        return `<row r="${excelRow}" ht="19" customHeight="1">${cells}</row>`;
      })
      .join('');

    const lastDetailRow = sortedDetailRows.length + 1;
    const footerDetailRow = lastDetailRow + 1;
    const totalColIdx = exportCols.indexOf('Costo_Final_Ajustado');
    const totalColLetter = colIndexToLetter(totalColIdx + 1);

    const detailFooterRow = `<row r="${footerDetailRow}" ht="22" customHeight="1">${exportCols
      .map((_col, idx) => {
        const ref = `${colIndexToLetter(idx + 1)}${footerDetailRow}`;
        if (idx === 0) return strCell(ref, 24, 'TOTAL GENERAL');
        if (idx === totalColIdx) {
          return formulaCell(ref, 25, `SUM(${totalColLetter}2:${totalColLetter}${lastDetailRow})`, totalSumAll);
        }
        return strCell(ref, 24, '');
      })
      .join('')}</row>`;

    const lastColLetter = colIndexToLetter(exportCols.length);
    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane xSplit="6" ySplit="1" topLeftCell="G2" activePane="bottomRight" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="19"/>
  <cols>${detailColsXml}</cols>
  <sheetData>
    ${detailHeaderRow}
    ${detailBodyRows}
    ${detailFooterRow}
  </sheetData>
  <autoFilter ref="A1:${lastColLetter}${lastDetailRow}"/>
</worksheet>`;

    // SHEET 2: Resumen_y_Graficos
    const sheet2Rows: string[] = [];
    const sheet2Merges: string[] = [];

    sheet2Rows.push(
      `<row r="1" ht="28" customHeight="1">${Array.from({ length: 15 }, (_, c) =>
        strCell(`${colIndexToLetter(c + 1)}1`, 1, c === 0 ? 'INFORME CONSUMO AWS ' : '')
      ).join('')}</row>`
    );
    sheet2Merges.push(`<mergeCell ref="A1:O1"/>`);

    sheet2Rows.push(
      `<row r="2" ht="20" customHeight="1">${Array.from({ length: 15 }, (_, c) =>
        strCell(
          `${colIndexToLetter(c + 1)}2`,
          2,
          c === 0
            ? `Cliente: ${clienteNombre} | Fecha: ${new Date().toLocaleDateString('es-CL')} | Cuentas: ${pivotAccountSummary.length} | Payers: ${pivotPayerSummary.length} `
            : ''
        )
      ).join('')}</row>`
    );
    sheet2Merges.push(`<mergeCell ref="A2:O2"/>`);

    // SECCIÓN 1: TABLA DINÁMICA DE CONSUMO POR CUENTA
    sheet2Rows.push(
      `<row r="4" ht="22" customHeight="1">${Array.from({ length: 5 }, (_, c) =>
        strCell(`${colIndexToLetter(c + 1)}4`, 3, c === 0 ? '1. CONSUMO POR CUENTA ' : '')
      ).join('')}</row>`
    );
    sheet2Merges.push(`<mergeCell ref="A4:E4"/>`);

    sheet2Rows.push(
      `<row r="5" ht="24" customHeight="1">` +
        strCell('A5', 5, '#') +
        strCell('B5', 4, 'Account ID') +
        strCell('C5', 4, 'Account Name') +
        strCell('D5', 4, 'Consumo Total (USD)') +
        strCell('E5', 5, '% Part.') +
        `</row>`
    );

    const startPivotRow = 6;
    const endPivotRow = startPivotRow + pivotAccountSummary.length - 1;
    const totalPivotRow = endPivotRow + 1;

    pivotAccountSummary.forEach((item, idx) => {
      const r = startPivotRow + idx;
      const isAlt = idx % 2 === 1;
      const cleanId = item.accountId.replace(/\D/g, '');
      const idCellXml =
        cleanId.length > 0 ? numCell(`B${r}`, isAlt ? 7 : 6, cleanId) : strCell(`B${r}`, isAlt ? 9 : 8, item.accountId);
      const pct = totalSumAll > 0 ? item.totalCost / totalSumAll : 0;

      sheet2Rows.push(
        `<row r="${r}" ht="20" customHeight="1">` +
          numCell(`A${r}`, isAlt ? 9 : 8, idx + 1) +
          idCellXml +
          strCell(`C${r}`, isAlt ? 9 : 8, item.accountName) +
          formulaCell(
            `D${r}`,
            isAlt ? 13 : 12,
            `SUMIFS(Detalle_CUR!$F$2:$F$${lastDetailRow},Detalle_CUR!$B$2:$B$${lastDetailRow},C${r})`,
            item.totalCost
          ) +
          formulaCell(`E${r}`, isAlt ? 17 : 16, `IF($D$${totalPivotRow}>0,D${r}/$D$${totalPivotRow},0)`, pct) +
          `</row>`
      );
    });

    sheet2Rows.push(
      `<row r="${totalPivotRow}" ht="22" customHeight="1">` +
        strCell(`A${totalPivotRow}`, 24, '') +
        strCell(`B${totalPivotRow}`, 24, '') +
        strCell(`C${totalPivotRow}`, 24, 'TOTAL CONSUMO POR CUENTAS') +
        formulaCell(`D${totalPivotRow}`, 25, `SUM(D${startPivotRow}:D${endPivotRow})`, totalSumAll) +
        formulaCell(`E${totalPivotRow}`, 26, `SUM(E${startPivotRow}:E${endPivotRow})`, 1) +
        `</row>`
    );

    // SECCIÓN 2: TABLA DINÁMICA DE CONSUMO POR PAYER ACCOUNT ID
    const payerTitleRow = totalPivotRow + 2;
    const payerHeaderRow = payerTitleRow + 1;
    const startPayerRow = payerHeaderRow + 1;
    const endPayerRow = startPayerRow + pivotPayerSummary.length - 1;
    const totalPayerRow = endPayerRow + 1;

    sheet2Rows.push(
      `<row r="${payerTitleRow}" ht="22" customHeight="1">${Array.from({ length: 5 }, (_, c) =>
        strCell(`${colIndexToLetter(c + 1)}${payerTitleRow}`, 3, c === 0 ? '2. RESUMEN DE CONSUMO POR PAYER ACCOUNT ID (CONECTADO A DETALLE_CUR)' : '')
      ).join('')}</row>`
    );
    sheet2Merges.push(`<mergeCell ref="A${payerTitleRow}:E${payerTitleRow}"/>`);

    sheet2Rows.push(
      `<row r="${payerHeaderRow}" ht="24" customHeight="1">` +
        strCell(`A${payerHeaderRow}`, 5, '#') +
        strCell(`B${payerHeaderRow}`, 4, 'Payer Account Id') +
        strCell(`C${payerHeaderRow}`, 5, 'Cuentas Vinculadas') +
        strCell(`D${payerHeaderRow}`, 4, 'Monto Total (USD)') +
        strCell(`E${payerHeaderRow}`, 5, '% Part.') +
        `</row>`
    );

    pivotPayerSummary.forEach((pItem, idx) => {
      const r = startPayerRow + idx;
      const isAlt = idx % 2 === 1;
      const cleanPayerDigits = pItem.payerId.replace(/\D/g, '');
      const payerIdCellXml =
        cleanPayerDigits.length > 0
          ? numCell(`B${r}`, isAlt ? 7 : 6, cleanPayerDigits)
          : strCell(`B${r}`, isAlt ? 9 : 8, pItem.payerId);
      const pct = totalSumAll > 0 ? pItem.totalCost / totalSumAll : 0;

      sheet2Rows.push(
        `<row r="${r}" ht="20" customHeight="1">` +
          numCell(`A${r}`, isAlt ? 9 : 8, idx + 1) +
          payerIdCellXml +
          strCell(`C${r}`, isAlt ? 9 : 8, `${pItem.accountCount} cuenta(s) vinculada(s)`) +
          formulaCell(
            `D${r}`,
            isAlt ? 13 : 12,
            `SUMIFS(Detalle_CUR!$F$2:$F$${lastDetailRow},Detalle_CUR!$C$2:$C$${lastDetailRow},B${r})`,
            pItem.totalCost
          ) +
          formulaCell(`E${r}`, isAlt ? 17 : 16, `IF($D$${totalPayerRow}>0,D${r}/$D$${totalPayerRow},0)`, pct) +
          `</row>`
      );
    });

    sheet2Rows.push(
      `<row r="${totalPayerRow}" ht="22" customHeight="1">` +
        strCell(`A${totalPayerRow}`, 24, '') +
        strCell(`B${totalPayerRow}`, 24, 'TOTAL PAYER ACCOUNTS') +
        strCell(`C${totalPayerRow}`, 24, `${pivotAccountSummary.length} cuenta(s) totales`) +
        formulaCell(`D${totalPayerRow}`, 25, `SUM(D${startPayerRow}:D${endPayerRow})`, totalSumAll) +
        formulaCell(`E${totalPayerRow}`, 26, `SUM(E${startPayerRow}:E${endPayerRow})`, 1) +
        `</row>`
    );

    // SECCIÓN 3: GRÁFICO DE BARRAS DETALLADO POR CUENTA
    const barTitleRow = totalPayerRow + 2;
    const barHeaderRow = barTitleRow + 1;
    const startBarRow = barHeaderRow + 1;
    const endBarRow = startBarRow + pivotAccountSummary.length - 1;

    sheet2Rows.push(
      `<row r="${barTitleRow}" ht="22" customHeight="1">${Array.from({ length: 5 }, (_, c) =>
        strCell(`${colIndexToLetter(c + 1)}${barTitleRow}`, 3, c === 0 ? '3. CONSUMO POR ACCOUNT NAME' : '')
      ).join('')}</row>`
    );
    sheet2Merges.push(`<mergeCell ref="A${barTitleRow}:E${barTitleRow}"/>`);

    sheet2Rows.push(
      `<row r="${barHeaderRow}" ht="23" customHeight="1">` +
        strCell(`A${barHeaderRow}`, 5, 'Cuenta (Account Name)') +
        strCell(`B${barHeaderRow}`, 5, '') +
        strCell(`C${barHeaderRow}`, 4, 'Distribución Visual Proporcional') +
        strCell(`D${barHeaderRow}`, 5, 'Monto (USD)') +
        strCell(`E${barHeaderRow}`, 5, '% Part.') +
        `</row>`
    );
    sheet2Merges.push(`<mergeCell ref="A${barHeaderRow}:B${barHeaderRow}"/>`);

    pivotAccountSummary.forEach((item, idx) => {
      const r = startBarRow + idx;
      const srcR = startPivotRow + idx;
      const isAlt = idx % 2 === 1;
      const barBlocks = Math.max(1, Math.round((item.totalCost / maxAccountCost) * 34));
      const visualBar = '█'.repeat(barBlocks);
      const pct = totalSumAll > 0 ? item.totalCost / totalSumAll : 0;

      sheet2Rows.push(
        `<row r="${r}" ht="20" customHeight="1">` +
          formulaCell(`A${r}`, isAlt ? 19 : 18, `C${srcR}`, item.accountName, true) +
          strCell(`B${r}`, isAlt ? 19 : 18, '') +
          formulaCell(
            `C${r}`,
            isAlt ? 21 : 20,
            `REPT("█",MAX(1,ROUND((D${r}/MAX($D$${startBarRow}:$D$${endBarRow}))*34,0)))`,
            visualBar,
            true
          ) +
          formulaCell(`D${r}`, isAlt ? 13 : 12, `D${srcR}`, item.totalCost) +
          formulaCell(`E${r}`, isAlt ? 23 : 22, `E${srcR}`, pct) +
          `</row>`
      );
      sheet2Merges.push(`<mergeCell ref="A${r}:B${r}"/>`);
    });

    // SECCIÓN 4: CONSUMO POR PRODUCT_NAME + GRÁFICO CIRCULAR
    const pieTitleRow = endBarRow + 2;
    const pieHeaderRow = pieTitleRow + 1;
    const startPieRow = pieHeaderRow + 1;
    const endPieRow = startPieRow + pieSlices.length - 1;
    const totalPieRow = endPieRow + 1;

    sheet2Rows.push(
      `<row r="${pieTitleRow}" ht="22" customHeight="1">` +
        Array.from({ length: 5 }, (_, c) =>
          strCell(`${colIndexToLetter(c + 1)}${pieTitleRow}`, 3, c === 0 ? '4. CONSUMO POR PRODUCTO (PRODUCT_NAME)' : '')
        ).join('') +
        Array.from({ length: 9 }, (_, c) =>
          strCell(`${colIndexToLetter(c + 7)}${pieTitleRow}`, 3, c === 0 ? 'GRÁFICO  DE PARTICIPACIÓN (% POR COLOR)' : '')
        ).join('') +
        `</row>`
    );
    sheet2Merges.push(`<mergeCell ref="A${pieTitleRow}:E${pieTitleRow}"/>`);
    sheet2Merges.push(`<mergeCell ref="G${pieTitleRow}:O${pieTitleRow}"/>`);

    sheet2Rows.push(
      `<row r="${pieHeaderRow}" ht="23" customHeight="1">` +
        strCell(`A${pieHeaderRow}`, 5, 'Color') +
        strCell(`B${pieHeaderRow}`, 4, 'Product_Name') +
        strCell(`C${pieHeaderRow}`, 4, '') +
        strCell(`D${pieHeaderRow}`, 4, 'Monto Total (USD)') +
        strCell(`E${pieHeaderRow}`, 5, '% Part.') +
        Array.from({ length: 9 }, (_, c) =>
          strCell(`${colIndexToLetter(c + 7)}${pieHeaderRow}`, 5, c === 0 ? 'DISTRIBUCIÓN PORCENTUAL POR SERVICIO' : '')
        ).join('') +
        `</row>`
    );
    sheet2Merges.push(`<mergeCell ref="B${pieHeaderRow}:C${pieHeaderRow}"/>`);
    sheet2Merges.push(`<mergeCell ref="G${pieHeaderRow}:O${pieHeaderRow}"/>`);

    const ringSegments: { sliceIdx: number; styleIdx: number }[] = [];
    pieSlices.forEach((slice, sIdx) => {
      const count = Math.round((slice.totalCost / totalPieSum) * 36);
      for (let k = 0; k < count && ringSegments.length < 36; k++) {
        ringSegments.push({ sliceIdx: sIdx, styleIdx: slice.styleIdx });
      }
    });
    while (ringSegments.length < 36) {
      ringSegments.push(
        pieSlices.length > 0
          ? { sliceIdx: 0, styleIdx: pieSlices[0].styleIdx }
          : { sliceIdx: 0, styleIdx: 0 }
      );
    }

    type DonutCell =
      | { kind: 'CENTER' }
      | { kind: 'SLICE'; sliceIdx: number; styleIdx: number; showPct?: boolean }
      | null;

    const ringGrid: DonutCell[][] = Array.from({ length: 9 }, () => Array(9).fill(null));
    const sliceCoordsMap = new Map<number, { r: number; c: number; angle: number }[]>();

    for (let rr = 0; rr < 9; rr++) {
      for (let cc = 0; cc < 9; cc++) {
        const dy = rr - 4;
        const dx = cc - 4;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 1.6) {
          ringGrid[rr][cc] = { kind: 'CENTER' };
        } else if (dist <= 4.2) {
          let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
          if (angle < 0) angle += 360;
          const segIdx = Math.min(35, Math.floor(angle / 10));
          const seg = ringSegments[segIdx];
          ringGrid[rr][cc] = { kind: 'SLICE', sliceIdx: seg.sliceIdx, styleIdx: seg.styleIdx };

          const list = sliceCoordsMap.get(seg.sliceIdx) || [];
          list.push({ r: rr, c: cc, angle });
          sliceCoordsMap.set(seg.sliceIdx, list);
        }
      }
    }

    sliceCoordsMap.forEach((coords) => {
      if (coords.length === 0) return;
      coords.sort((a, b) => a.angle - b.angle);
      const midCell = coords[Math.floor(coords.length / 2)];
      const target = ringGrid[midCell.r][midCell.c];
      if (target && target.kind === 'SLICE') {
        target.showPct = true;
      }
    });

    const totalProductRows = Math.max(pieSlices.length + 1, 9);
    for (let i = 0; i < totalProductRows; i++) {
      const r = startPieRow + i;
      const isAlt = i % 2 === 1;
      let rowCells = '';

      if (i < pieSlices.length) {
        const slice = pieSlices[i];
        const pct = slice.totalCost / totalPieSum;
        const formulaStr = slice.isOthers
          ? `D${totalPivotRow}-SUM(D${startPieRow}:D${endPieRow - 1})`
          : `SUMIFS(Detalle_CUR!$F$2:$F$${lastDetailRow},Detalle_CUR!$D$2:$D$${lastDetailRow},B${r})`;

        rowCells +=
          strCell(`A${r}`, 29 + slice.styleIdx, '●') +
          strCell(`B${r}`, isAlt ? 9 : 8, slice.productName) +
          strCell(`C${r}`, isAlt ? 9 : 8, '') +
          formulaCell(`D${r}`, isAlt ? 13 : 12, formulaStr, slice.totalCost) +
          formulaCell(`E${r}`, isAlt ? 17 : 16, `IF($D$${totalPieRow}>0,D${r}/$D$${totalPieRow},0)`, pct);
        sheet2Merges.push(`<mergeCell ref="B${r}:C${r}"/>`);
      } else if (i === pieSlices.length) {
        rowCells +=
          strCell(`A${r}`, 24, '') +
          strCell(`B${r}`, 24, 'TOTAL PRODUCTOS (CONECTADO)') +
          strCell(`C${r}`, 24, '') +
          formulaCell(`D${r}`, 25, `SUM(D${startPieRow}:D${endPieRow})`, totalSumAll) +
          formulaCell(`E${r}`, 26, `SUM(E${startPieRow}:E${endPieRow})`, 1);
        sheet2Merges.push(`<mergeCell ref="B${r}:C${r}"/>`);
      }

      if (i < 9) {
        ringGrid[i].forEach((cellVal, cIdx) => {
          const ref = `${colIndexToLetter(cIdx + 7)}${r}`;
          if (cellVal && cellVal.kind === 'CENTER') {
            rowCells += strCell(ref, 27, i === 4 && cIdx === 4 ? '100%' : '');
          } else if (cellVal && cellVal.kind === 'SLICE') {
            if (cellVal.showPct && cellVal.sliceIdx < pieSlices.length) {
              const targetPctRow = startPieRow + cellVal.sliceIdx;
              const cachedPct = pieSlices[cellVal.sliceIdx].totalCost / totalPieSum;
              rowCells += formulaCell(ref, 38 + cellVal.styleIdx, `E${targetPctRow}`, cachedPct);
            } else {
              rowCells += strCell(ref, 29 + cellVal.styleIdx, '');
            }
          } else {
            rowCells += strCell(ref, 28, '');
          }
        });
      }

      sheet2Rows.push(`<row r="${r}" ht="22" customHeight="1">${rowCells}</row>`);
    }

    const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView workbookViewId="0"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>
    <col min="1" max="1" width="7" customWidth="1"/>
    <col min="2" max="2" width="19" customWidth="1"/>
    <col min="3" max="3" width="36" customWidth="1"/>
    <col min="4" max="4" width="20" customWidth="1"/>
    <col min="5" max="5" width="14" customWidth="1"/>
    <col min="6" max="6" width="4" customWidth="1"/>
    <col min="7" max="15" width="6.2" customWidth="1"/>
  </cols>
  <sheetData>
    ${sheet2Rows.join('')}
  </sheetData>
  <mergeCells count="${sheet2Merges.length}">
    ${sheet2Merges.join('')}
  </mergeCells>
</worksheet>`;

    const pieFontsXml = PIE_COLORS.map(
      () => `<font><b/><sz val="8"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`
    ).join('');
    const pieFillsXml = PIE_COLORS.map(
      hex => `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex}"/><bgColor indexed="64"/></patternFill></fill>`
    ).join('');
    const pieXfsXml = PIE_COLORS.map(
      (_hex, idx) =>
        `<xf numFmtId="0" fontId="${8 + idx}" fillId="${12 + idx}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`
    ).join('');
    const piePctXfsXml = PIE_COLORS.map(
      (_hex, idx) =>
        `<xf numFmtId="167" fontId="${8 + idx}" fillId="${12 + idx}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`
    ).join('');

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="4">
    <numFmt numFmtId="164" formatCode="0"/>
    <numFmt numFmtId="165" formatCode="$#,##0.00"/>
    <numFmt numFmtId="166" formatCode="0.00%"/>
    <numFmt numFmtId="167" formatCode="0.0%"/>
  </numFmts>
  <fonts count="${8 + PIE_COLORS.length}">
    <font><sz val="10"/><color rgb="FF1E293B"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><i/><sz val="10"/><color rgb="FF334155"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF991B1B"/><name val="Calibri"/></font>
    <font><b/><sz val="9"/><color rgb="FFCC0000"/><name val="Calibri"/></font>
    ${pieFontsXml}
  </fonts>
  <fills count="${12 + PIE_COLORS.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFCC0000"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF5F5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
    ${pieFillsXml}
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thick"><color rgb="FFCC0000"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="${29 + PIE_COLORS.length * 2}">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="5" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="5" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="165" fontId="6" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="6" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="5" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="5" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="4" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="4" fontId="0" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="166" fontId="6" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="6" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="10" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="165" fontId="4" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="4" fillId="10" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="7" borderId="0" xfId="0" applyFill="1"/>
    ${pieXfsXml}
    ${piePctXfsXml}
  </cellXfs>
</styleSheet>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr codeName="ThisWorkbook"/>
  <sheets>
    <sheet name="Detalle_CUR" sheetId="1" r:id="rId1"/>
    <sheet name="Resumen_y_Graficos" sheetId="2" r:id="rId2"/>
  </sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;

    const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const zipBytes = buildZipArchive([
      { path: '[Content_Types].xml', content: contentTypesXml },
      { path: '_rels/.rels', content: rootRelsXml },
      { path: 'xl/workbook.xml', content: workbookXml },
      { path: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
      { path: 'xl/styles.xml', content: stylesXml },
      { path: 'xl/worksheets/sheet1.xml', content: sheet1Xml },
      { path: 'xl/worksheets/sheet2.xml', content: sheet2Xml },
    ]);

    const blob = new Blob([zipBytes], {
      type: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `cur_cuentas_seleccionadas_${new Date().toISOString().slice(0, 10)}.xlsm`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // EXPORTAR CSV
  const exportSelectedCSV = () => {
    if (exportableRows.length === 0 || orderedActiveCols.length === 0) return;

    const csvHeaders = orderedActiveCols
      .map(col => getExportHeaderName(col))
      .join(',');

    const csvRows = exportableRows.map(row => {
      return orderedActiveCols
        .map(col => {
          let val = (row as Record<string, any>)[col] ?? '';
          if (typeof val === 'string') {
            val = `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        })
        .join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [csvHeaders, ...csvRows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `cur_cuentas_seleccionadas_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const metricasWidgets = useMemo(() => {
    let unblendedCostSum = 0;
    let marketplaceSum = 0;
    let sppSum = 0;
    let edpSum = 0;

    filteredRows.forEach(row => {
      const uCost = row['Unblended_Cost'] || 0;
      const mkt = row['Marketplace_Cost'] || 0;
      const spp = row['SPP_Discount'] || 0;
      const edp = row['EDP_Discount'] || 0;

      unblendedCostSum += uCost;
      marketplaceSum += mkt;
      sppSum += spp;
      edpSum += edp;
    });

    const totalAjustado = unblendedCostSum + sppSum + edpSum;

    return {
      unblendedCostSum,
      marketplaceSum,
      sppSum,
      edpSum,
      totalAjustado,
    };
  }, [filteredRows]);

  // TABLA 1: DATOS DE CLIENTES / CUENTAS MAPEADAS
  const tablaClientes = useMemo(() => {
    const accMap: Record<string, number> = {};
    filteredRows.forEach(row => {
      const accKey = getRowAccountKey(row);
      const customMapped = accountMappings[accKey]?.trim();
      const baseName =
        row['line_item_usage_account_name'] ||
        row['line_item_usage_account_id'] ||
        clienteNombre ||
        'Sin Cuenta Registrada';

      const displayName = customMapped
        ? `${customMapped} (${row['line_item_usage_account_id'] || accKey})`
        : baseName;

      const cost = row['Costo_Final_Ajustado'] || row['Unblended_Cost'] || 0;
      accMap[displayName] = (accMap[displayName] || 0) + cost;
    });

    return Object.entries(accMap)
      .map(([name, cost]) => ({ name, cost }))
      .sort((a, b) => b.cost - a.cost);
  }, [filteredRows, accountMappings, clienteNombre]);

  // TABLA 2: DATOS DE SERVICIOS Y PRODUCTOS
  const tablaServiciosProductos = useMemo(() => {
    const spMap: Record<string, { service: string; product: string; cost: number }> = {};
    filteredRows.forEach(row => {
      const service = row['Service_Name'] || row['line_item_product_code'] || 'Otros Servicios';
      const product = row['Product_Name'] || row['line_item_line_item_description'] || 'Producto General';
      const key = `${service}|||${product}`;
      const cost = row['Costo_Final_Ajustado'] || row['Unblended_Cost'] || 0;

      if (!spMap[key]) {
        spMap[key] = { service, product, cost: 0 };
      }
      spMap[key].cost += cost;
    });

    return Object.values(spMap)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 15);
  }, [filteredRows]);

  const pieDataCategory = useMemo(() => {
    return [
      {
        name: 'Unblended Cost (Sin Mkt)',
        value: Math.max(0, metricasWidgets.unblendedCostSum - metricasWidgets.marketplaceSum),
      },
      { name: 'Marketplace Cost', value: metricasWidgets.marketplaceSum },
      { name: 'SPP Discount', value: metricasWidgets.sppSum },
      { name: 'EDP Discount', value: metricasWidgets.edpSum },
    ].filter(item => item.value > 0);
  }, [metricasWidgets]);

  const finopsAvanzado = useMemo(() => {
    const serviceMap: Record<string, { total: number; count: number; descriptions: string[] }> = {};
    let computeCost = 0;
    let storageCost = 0;
    let networkCost = 0;
    let databaseCost = 0;
    let otherCost = 0;

    filteredRows.forEach(row => {
      const sName = row['Service_Name'] || 'Otros';
      const cost = row['Costo_Final_Ajustado'] || row['Unblended_Cost'] || 0;
      const desc = row['line_item_line_item_description'] || row['Product_Name'] || '';

      if (!serviceMap[sName]) serviceMap[sName] = { total: 0, count: 0, descriptions: [] };
      serviceMap[sName].total += cost;
      serviceMap[sName].count += 1;
      if (desc && !serviceMap[sName].descriptions.includes(desc) && serviceMap[sName].descriptions.length < 3) {
        serviceMap[sName].descriptions.push(desc);
      }

      const lowerService = sName.toLowerCase();
      if (
        lowerService.includes('ec2') ||
        lowerService.includes('lambda') ||
        lowerService.includes('ecs') ||
        lowerService.includes('eks') ||
        lowerService.includes('fargate')
      ) {
        computeCost += cost;
      } else if (
        lowerService.includes('s3') ||
        lowerService.includes('ebs') ||
        lowerService.includes('glacier') ||
        lowerService.includes('efs') ||
        lowerService.includes('storage')
      ) {
        storageCost += cost;
      } else if (
        lowerService.includes('vpc') ||
        lowerService.includes('cloudfront') ||
        lowerService.includes('route53') ||
        lowerService.includes('data transfer') ||
        lowerService.includes('nat')
      ) {
        networkCost += cost;
      } else if (
        lowerService.includes('rds') ||
        lowerService.includes('dynamodb') ||
        lowerService.includes('aurora') ||
        lowerService.includes('elasticache') ||
        lowerService.includes('redshift')
      ) {
        databaseCost += cost;
      } else {
        otherCost += cost;
      }
    });

    const total = metricasWidgets.totalAjustado || 1;

    const topDrivers = Object.entries(serviceMap)
      .map(([name, data]) => {
        const roundedCost = Math.round(data.total * 100) / 100;
        return {
          name,
          cost: roundedCost,
          pct: parseFloat(((data.total / total) * 100).toFixed(1)),
          count: data.count,
          sampleDesc: data.descriptions.join(' | '),
        };
      })
      .filter(d => d.cost > 0)
      .sort((a, b) => b.cost - a.cost);

    const pillarBreakdown = [
      { category: 'Cómputo (Compute)', cost: computeCost, pct: parseFloat(((computeCost / total) * 100).toFixed(1)) },
      { category: 'Bases de Datos', cost: databaseCost, pct: parseFloat(((databaseCost / total) * 100).toFixed(1)) },
      { category: 'Almacenamiento', cost: storageCost, pct: parseFloat(((storageCost / total) * 100).toFixed(1)) },
      { category: 'Red y Transferencia', cost: networkCost, pct: parseFloat(((networkCost / total) * 100).toFixed(1)) },
      { category: 'Otros Servicios', cost: otherCost, pct: parseFloat(((otherCost / total) * 100).toFixed(1)) },
    ]
      .filter(p => p.cost > 0)
      .sort((a, b) => b.cost - a.cost);

    const effiencyScore = Math.min(100, Math.max(60, Math.round(100 - (otherCost / total) * 30)));

    return {
      topDrivers: topDrivers.slice(0, 5),
      allDrivers: topDrivers,
      pillarBreakdown,
      totalServicesUsed: Object.keys(serviceMap).length,
      effiencyScore,
      computeCost,
      storageCost,
      networkCost,
      databaseCost,
      otherCost,
    };
  }, [filteredRows, metricasWidgets]);

  const projectionData = useMemo(() => {
    const baseCost = metricasWidgets.totalAjustado;
    const rate = manualGrowthRate / 100;
    const result = [];

    result.push({
      mes: 'Actual',
      costoUSD: Math.round(baseCost * 100) / 100,
      costoCLP: Math.round(baseCost * tipoCambio),
    });

    for (let i = 1; i <= monthsToProject; i++) {
      const projUSD = baseCost * Math.pow(1 + rate, i);
      result.push({
        mes: `Mes +${i}`,
        costoUSD: Math.round(projUSD * 100) / 100,
        costoCLP: Math.round(projUSD * tipoCambio),
      });
    }

    return result;
  }, [metricasWidgets.totalAjustado, monthsToProject, manualGrowthRate, tipoCambio]);

  const totalUSD = metricasWidgets.totalAjustado > 0 ? metricasWidgets.totalAjustado : 0;
  const totalCLP = Math.round(totalUSD * tipoCambio);
  const ivaUSD = totalUSD * 0.19;
  const ivaCLP = Math.round(ivaUSD * tipoCambio);
  const totalConIvaUSD = totalUSD + ivaUSD;
  const totalConIvaCLP = Math.round(totalConIvaUSD * tipoCambio);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;

  const handlePrintPDF = () => {
    window.print();
  };

  // ============================================================================
  // HELPER PARA RENDERIZAR GRÁFICO CIRCULAR (DONUT) SVG NATIVO DE ALTA NITIDEZ EN PDF
  // ============================================================================
  const pdfPieSlices = useMemo(() => {
    const palette = ['#CC0000', '#1E293B', '#2563EB', '#059669', '#D97706', '#64748B'];
    const items = finopsAvanzado.topDrivers.slice(0, 5);
    const topSum = items.reduce((acc, i) => acc + i.cost, 0);
    const othersCost = Math.max(0, totalUSD - topSum);

    const rawList = items.map((item, idx) => ({
      name: item.name,
      cost: item.cost,
      color: palette[idx % palette.length],
    }));

    if (othersCost > 0.01) {
      rawList.push({
        name: 'Otros Servicios',
        cost: othersCost,
        color: '#64748B',
      });
    }

    const totalForPie = rawList.reduce((acc, r) => acc + r.cost, 0) || 1;
    let cumulativeAngle = -90;

    return rawList.map(slice => {
      const pct = (slice.cost / totalForPie) * 100;
      const sweepAngle = (slice.cost / totalForPie) * 360;
      const startAngle = cumulativeAngle;
      const endAngle = cumulativeAngle + sweepAngle;
      cumulativeAngle = endAngle;

      return {
        ...slice,
        pct: parseFloat(pct.toFixed(1)),
        startAngle,
        endAngle,
      };
    });
  }, [finopsAvanzado.topDrivers, totalUSD]);

  const describeArc = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
    const safeEnd = endAngle - startAngle >= 359.99 ? startAngle + 359.99 : endAngle;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (safeEnd * Math.PI) / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArcFlag = safeEnd - startAngle <= 180 ? '0' : '1';
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
  };

  return (
    <div style={{ backgroundColor: '#0B0F17', color: '#F8FAFC', minHeight: '100vh', padding: '24px', fontFamily: 'Arial, sans-serif' }}>
      
      {/* REGLAS DE IMPRESIÓN Y ESTILOS DE LA CARÁTULA */}
      <style>{`
        @page {
          size: A4 portrait;
          margin: 12mm;
        }
        @media print {
          body { background-color: #FFFFFF !important; color: #000000 !important; margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .print-area { display: block !important; width: 100% !important; background-color: #FFF !important; color: #000 !important; padding: 0 !important; }
          .caratula-table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px; color: #000; border: 2px solid #000; break-inside: avoid; page-break-inside: avoid; }
          .caratula-table td, .caratula-table th { border: 1px solid #000 !important; padding: 4px 8px; vertical-align: middle; }
          .data-table-report { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 10px; color: #000; border: 1px solid #000; margin-top: 8px; break-inside: avoid; page-break-inside: avoid; }
          .data-table-report thead { display: table-header-group; }
          .data-table-report tr { break-inside: avoid; page-break-inside: avoid; }
          .data-table-report td, .data-table-report th { border: 1px solid #666 !important; padding: 4px 6px; }
          .data-table-report th { background-color: #F2F2F2 !important; font-weight: bold; text-align: left; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .header-red-banner { background-color: #CC0000 !important; color: #FFFFFF !important; text-align: center; font-weight: bold; font-size: 14px; letter-spacing: 0.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .sub-red-banner { background-color: #CC0000 !important; color: #FFFFFF !important; text-align: center; font-weight: bold; font-size: 11px; letter-spacing: 0.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .gray-cell { background-color: #D9D9D9 !important; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .yellow-cell { background-color: #FFFF00 !important; font-weight: bold; text-align: center; color: #0000FF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page-break { page-break-before: always; break-before: page; }
          .avoid-break { break-inside: avoid !important; page-break-inside: avoid !important; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .bold { font-weight: bold; }
          .finops-container { border: 1px solid #CBD5E1 !important; background-color: #FAFAFA !important; break-inside: avoid !important; page-break-inside: avoid !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .finops-header { background-color: #1E293B !important; color: #FFFFFF !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .badge-finops { background-color: #FFFFFF !important; border: 1px solid #CBD5E1 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .pdf-chart-box { break-inside: avoid !important; page-break-inside: avoid !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }

        .caratula-table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; color: #000; background-color: #FFF; border: 2px solid #000; }
        .caratula-table td, .caratula-table th { border: 1px solid #000; padding: 5px 8px; vertical-align: middle; }
        .data-table-report { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px; color: #000; background-color: #FFF; border: 1px solid #000; margin-top: 8px; }
        .data-table-report td, .data-table-report th { border: 1px solid #CCC; padding: 5px 8px; }
        .data-table-report th { background-color: #F8FAFC; font-weight: bold; text-align: left; }
        .header-red-banner { background-color: #CC0000; color: #FFF; text-align: center; font-weight: bold; font-size: 14px; height: 28px; }
        .sub-red-banner { background-color: #CC0000; color: #FFF; text-align: center; font-weight: bold; font-size: 11px; height: 22px; }
        .gray-cell { background-color: #D9D9D9; font-weight: bold; }
        .yellow-cell { background-color: #FFFF00; font-weight: bold; text-align: center; color: #0000FF; }
        .page-break { page-break-before: always; break-before: page; }
        .avoid-break { break-inside: avoid; page-break-inside: avoid; }
      `}</style>

      {/* HEADER & PESTAÑAS DE NAVEGACIÓN */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #2A364F', paddingBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ backgroundColor: TIVIT_RED, width: '12px', height: '32px', borderRadius: '2px' }} />
          <div>
            <h1 style={{ fontSize: '20px', margin: 0, fontWeight: 700, color: '#FFF' }}>FinOps CUR 2.0 — Multi-CUR & Mapeo de Cuentas</h1>
            <span style={{ fontSize: '11px', color: '#94A3B8' }}>Portal TIVIT de Análisis de Consumo, Selección de Cuentas e Informes</span>
          </div>

          <div style={{ display: 'flex', gap: '6px', marginLeft: '20px', backgroundColor: '#121824', padding: '4px', borderRadius: '8px', border: '1px solid #2A364F' }}>
            <button onClick={() => setActiveTab('dashboard')} style={{ backgroundColor: activeTab === 'dashboard' ? TIVIT_RED : 'transparent', color: '#FFF', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>📊 Explorador CUR</button>
            <button onClick={() => setActiveTab('finops')} style={{ backgroundColor: activeTab === 'finops' ? TIVIT_RED : 'transparent', color: '#FFF', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>💡 Análisis </button>
            <button onClick={() => setActiveTab('proyeccion')} style={{ backgroundColor: activeTab === 'proyeccion' ? TIVIT_RED : 'transparent', color: '#FFF', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>📈 Proyección</button>
            <button onClick={() => setActiveTab('reporte_completo')} style={{ backgroundColor: activeTab === 'reporte_completo' ? TIVIT_RED : 'transparent', color: '#FFF', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>📄 Reporte Completo </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {loadedFiles.length > 0 && (
            <button
              onClick={handleClearAllCurs}
              disabled={isProcessing}
              style={{
                backgroundColor: '#1E293B',
                color: '#F87171',
                border: '1px solid #475569',
                padding: '10px 14px',
                borderRadius: '6px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: '12px',
              }}
            >
              🗑️ Limpiar CURs ({loadedFiles.length})
            </button>
          )}

          <label style={{ backgroundColor: isProcessing ? '#64748B' : TIVIT_RED, color: '#FFF', padding: '10px 18px', borderRadius: '6px', cursor: isProcessing ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '12px' }}>
            {isProcessing ? `Cargando (${progress}%)` : loadedFiles.length > 0 ? '➕ Agregar Más CURs' : '📁 Cargar Archivos CUR'}
            <input type="file" accept=".csv, .tsv, .txt" multiple onChange={handleFileUpload} disabled={isProcessing} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {/* BARRA DE ESTADO Y BADGES DE ARCHIVOS CUR CARGADOS */}
      <div className="no-print" style={{ backgroundColor: '#121824', borderLeft: `4px solid ${TIVIT_RED}`, padding: '10px 16px', borderRadius: '6px', marginBottom: '16px', fontSize: '12px', color: '#E2E8F0' }}>
        <div>{statusMessage}</div>
        {loadedFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {loadedFiles.map((lf, index) => (
              <span
                key={`${lf.name}-${index}`}
                style={{
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#CBD5E1',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  fontSize: '11px',
                }}
              >
                📄 <strong>{lf.name}</strong> ({lf.records.toLocaleString()} filas)
              </span>
            ))}
          </div>
        )}
      </div>

      {/* PANEL DE SELECCIÓN Y MAPEO DE CUENTAS DENTRO DE LOS CURS */}
      {availableAccounts.length > 0 && (
        <div className="no-print" style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '10px', border: '1px solid #2A364F', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: '#FFF' }}>🏢 Selección y Mapeo de Cuentas AWS</h3>
              <span
                style={{
                  backgroundColor: selectedAccounts.length > 0 ? '#064E3B' : '#7F1D1D',
                  color: selectedAccounts.length > 0 ? '#6EE7B7' : '#FCA5A5',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                }}
              >
                {selectedAccounts.length} de {availableAccounts.length} cuentas activas
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Buscar ID, nombre o mapeo..."
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                style={{
                  backgroundColor: '#0B0F17',
                  border: '1px solid #2A364F',
                  color: '#FFF',
                  padding: '6px 10px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  minWidth: '190px',
                }}
              />
              <button
                onClick={selectAllAccounts}
                style={{ backgroundColor: '#1A2333', color: '#38BDF8', border: '1px solid #2A364F', padding: '6px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
              >
                Seleccionar Todas
              </button>
              <button
                onClick={deselectAllAccounts}
                style={{ backgroundColor: '#1A2333', color: '#FF4D6D', border: '1px solid #2A364F', padding: '6px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
              >
                Limpiar Selección
              </button>
              <button
                onClick={autoFillMappingsFromCurNames}
                style={{ backgroundColor: '#1A2333', color: '#FBBF24', border: '1px solid #2A364F', padding: '6px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                title="Copia el nombre original del CUR en los campos de mapeo vacíos"
              >
                ✨ Auto-mapear Nombres
              </button>
              <button
                onClick={() => setShowAccountMapper(!showAccountMapper)}
                style={{ backgroundColor: '#2A364F', color: '#FFF', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                {showAccountMapper ? 'Ocultar Cuentas ▲' : 'Mostrar Cuentas ▼'}
              </button>
            </div>
          </div>

          {showAccountMapper && (
            <div style={{ marginTop: '14px', maxHeight: '260px', overflowY: 'auto', border: '1px solid #2A364F', borderRadius: '6px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#1A2333', color: '#94A3B8', position: 'sticky', top: 0, zIndex: 5 }}>
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: '44px' }}>Usar</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Account ID (Usage)</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Nombre en CUR</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Payer Account Id</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '220px' }}>🏷️ Mapeo / Alias Cliente (Editable)</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Filas</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccountCatalog.map(acc => {
                    const isSelected = selectedAccounts.includes(acc.accountKey);
                    return (
                      <tr
                        key={acc.accountKey}
                        style={{
                          borderBottom: '1px solid #1E293B',
                          backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.06)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleAccountSelection(acc.accountKey)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td
                          onClick={() => toggleAccountSelection(acc.accountKey)}
                          style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 'bold', color: isSelected ? '#38BDF8' : '#64748B', cursor: 'pointer' }}
                        >
                          {acc.accountId}
                        </td>
                        <td
                          onClick={() => toggleAccountSelection(acc.accountKey)}
                          style={{ padding: '7px 10px', color: isSelected ? '#F8FAFC' : '#64748B', cursor: 'pointer' }}
                        >
                          {acc.accountName}
                        </td>
                        <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#94A3B8' }}>
                          {acc.payerAccountId}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <input
                            type="text"
                            placeholder={`Ej: ${acc.accountName !== 'Sin nombre en CUR' ? acc.accountName : 'Cliente / Proyecto...'}`}
                            value={accountMappings[acc.accountKey] || ''}
                            onChange={(e) => handleAccountMappingChange(acc.accountKey, e.target.value)}
                            style={{
                              width: '100%',
                              backgroundColor: '#0B0F17',
                              border: accountMappings[acc.accountKey] ? '1px solid #10B981' : '1px solid #2A364F',
                              color: '#FFF',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                            }}
                          />
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#94A3B8' }}>
                          {acc.records.toLocaleString()}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 'bold', color: isSelected ? '#F87171' : '#64748B' }}>
                          ${acc.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 1: EXPLORADOR CUR */}
      {activeTab === 'dashboard' && (
        <div className="no-print">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '8px', border: '1px solid #2A364F' }}>
              <span style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>UNBLENDED COST (SELECCIÓN)</span>
              <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '4px', color: '#FFF' }}>
                ${metricasWidgets.unblendedCostSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '8px', border: '1px solid #F59E0B' }}>
              <span style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>MARKETPLACE COST</span>
              <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '4px', color: '#F59E0B' }}>
                ${metricasWidgets.marketplaceSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '8px', border: '1px solid #2A364F' }}>
              <span style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>SPP DISCOUNT (+)</span>
              <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '4px', color: '#FF4D6D' }}>
                +${metricasWidgets.sppSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '8px', border: '1px solid #3B82F6' }}>
              <span style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>EDP DISCOUNT (+)</span>
              <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '4px', color: '#3B82F6' }}>
                +${metricasWidgets.edpSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '8px', border: `2px solid ${TIVIT_RED}` }}>
              <span style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 700 }}>TOTAL</span>
              <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '4px', color: TIVIT_RED }}>
                ${metricasWidgets.totalAjustado.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: '#121824', padding: '20px', borderRadius: '12px', border: '1px solid #2A364F', marginBottom: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#FFF' }}>Distribución Unblended Cost, Marketplace y Descuentos (Cuentas Seleccionadas)</h3>
            <div style={{ height: '240px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieDataCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label>
                    {pieDataCategory.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={['#E4002B', '#F59E0B', '#FF4D6D', '#3B82F6'][index % 4]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: number) => `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* PANEL DE PERSONALIZACIÓN Y EXPORTACIÓN */}
          <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '10px', border: '1px solid #2A364F', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0, fontSize: '14px', color: '#FFF' }}>⚙️ Columnas y Descarga (Solo Cuentas Seleccionadas)</h4>
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                  (6 fijas + {orderedActiveCols.length - FIXED_PRIMARY_COLS.length} adicionales | {exportableRows.length.toLocaleString()} filas con Total ≠ 0.0)
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={selectAllCols} style={{ backgroundColor: '#1A2333', color: '#38BDF8', border: '1px solid #2A364F', padding: '6px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                  Seleccionar Todas
                </button>
                <button onClick={deselectAllCols} style={{ backgroundColor: '#1A2333', color: '#FF4D6D', border: '1px solid #2A364F', padding: '6px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                  Dejar Solo 6 Fijas
                </button>
                <button onClick={() => setShowColPicker(!showColPicker)} style={{ backgroundColor: '#2A364F', color: '#FFF', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}>
                  {showColPicker ? 'Ocultar Selector ▲' : 'Ver Columnas ▼'}
                </button>
                <button
                  onClick={exportToExcel}
                  disabled={exportableRows.length === 0}
                  style={{
                    backgroundColor: exportableRows.length === 0 ? '#475569' : '#059669',
                    color: '#FFF',
                    border: 'none',
                    padding: '6px 14px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: exportableRows.length === 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold',
                  }}
                >
                  📊 Exportar Excel Macros (.xlsm) ({exportableRows.length.toLocaleString()})
                </button>
                <button
                  onClick={exportSelectedCSV}
                  disabled={exportableRows.length === 0}
                  style={{
                    backgroundColor: exportableRows.length === 0 ? '#475569' : '#10B981',
                    color: '#FFF',
                    border: 'none',
                    padding: '6px 14px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: exportableRows.length === 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold',
                  }}
                >
                  📥 Descargar CSV ({exportableRows.length.toLocaleString()})
                </button>
              </div>
            </div>

            {showColPicker && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #2A364F', maxHeight: '220px', overflowY: 'auto' }}>
                {allAvailableHeaders.map(col => {
                  const isFixed = (FIXED_PRIMARY_COLS as readonly string[]).includes(col);
                  const isChecked = isFixed || orderedActiveCols.includes(col);
                  return (
                    <label
                      key={col}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        color: isFixed ? '#FBBF24' : isChecked ? '#FFF' : '#64748B',
                        cursor: isFixed ? 'not-allowed' : 'pointer',
                        fontWeight: isFixed ? 'bold' : 'normal',
                      }}
                      title={isFixed ? 'Columna principal fija (siempre visible y exportada primero)' : col}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isFixed}
                        onChange={() => toggleColumn(col)}
                      />
                      <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {isFixed
                          ? `🔒 ${COL_DISPLAY_LABELS[col] || col}`
                          : col === '_sourceFile'
                          ? 'Archivo CUR Origen'
                          : col === 'Cuenta_Mapeada'
                          ? '🏷️ Cuenta / Cliente Mapeado'
                          : col}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* TABLA DE DATOS CON LAS 6 COLUMNAS PRINCIPALES SIEMPRE FIJAS AL INICIO Y CON FILTRO */}
          <div style={{ backgroundColor: '#121824', borderRadius: '8px', border: '1px solid #2A364F', overflowX: 'auto', padding: '16px' }}>
            {selectedAccounts.length === 0 && dataRows.length > 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#FBBF24', fontSize: '13px' }}>
                ⚠️ No tienes ninguna cuenta seleccionada. Marca al menos una cuenta arriba para ver y descargar sus datos.
              </div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1A2333', color: '#94A3B8' }}>
                      {orderedActiveCols.map((col, idx) => {
                        const isFixed = idx < FIXED_PRIMARY_COLS.length;
                        const colWidth = 175;
                        const stickyLeft = idx * colWidth;

                        return (
                          <th
                            key={col}
                            style={{
                              padding: '10px 12px',
                              borderBottom: isFixed ? `2px solid ${TIVIT_RED}` : '1px solid #2A364F',
                              minWidth: `${colWidth}px`,
                              width: `${colWidth}px`,
                              textAlign: 'left',
                              position: isFixed ? 'sticky' : 'static',
                              left: isFixed ? `${stickyLeft}px` : undefined,
                              zIndex: isFixed ? 10 : 1,
                              backgroundColor: isFixed ? '#182032' : '#1A2333',
                              color: isFixed ? '#F8FAFC' : '#94A3B8',
                              boxShadow: idx === FIXED_PRIMARY_COLS.length - 1 ? '3px 0 6px rgba(0,0,0,0.45)' : undefined,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: isFixed ? 700 : 600 }}>
                              {COL_DISPLAY_LABELS[col] || (col === '_sourceFile' ? '📁 Archivo CUR' : col)}
                            </div>
                            <input
                              type="text"
                              placeholder="Filtrar..."
                              value={filters[col] || ''}
                              onChange={(e) => {
                                setFilters({ ...filters, [col]: e.target.value });
                                setCurrentPage(1);
                              }}
                              style={{
                                width: '100%',
                                backgroundColor: '#0B0F17',
                                border: '1px solid #2A364F',
                                color: '#FFF',
                                padding: '4px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                marginTop: '5px',
                              }}
                            />
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map(row => (
                      <tr key={row.id} style={{ borderBottom: '1px solid #1A2333' }}>
                        {orderedActiveCols.map((col, idx) => {
                          const val = (row as Record<string, any>)[col];
                          const isNum = typeof val === 'number';
                          const isFixed = idx < FIXED_PRIMARY_COLS.length;
                          const colWidth = 175;
                          const stickyLeft = idx * colWidth;

                          return (
                            <td
                              key={col}
                              style={{
                                padding: '8px 12px',
                                whiteSpace: 'nowrap',
                                textAlign: isNum ? 'right' : 'left',
                                position: isFixed ? 'sticky' : 'static',
                                left: isFixed ? `${stickyLeft}px` : undefined,
                                zIndex: isFixed ? 5 : 1,
                                backgroundColor: isFixed ? '#121824' : 'transparent',
                                fontWeight: col === 'Costo_Final_Ajustado' ? 700 : isFixed ? 500 : 400,
                                color:
                                  col === 'Costo_Final_Ajustado'
                                    ? '#F87171'
                                    : col === 'Cuenta_Mapeada'
                                    ? '#34D399'
                                    : '#F8FAFC',
                                boxShadow: idx === FIXED_PRIMARY_COLS.length - 1 ? '3px 0 6px rgba(0,0,0,0.35)' : undefined,
                              }}
                            >
                              {isNum
                                ? col === 'Unblended_Rate'
                                  ? `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`
                                  : `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : String(val ?? '')}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', fontSize: '12px' }}>
                  <span>
                    Registros listados: <strong>{filteredRows.length}</strong> (Exportables con Total ≠ 0.0: <strong>{exportableRows.length}</strong> | Página {currentPage} de {totalPages})
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} style={{ padding: '6px 12px', backgroundColor: '#1A2333', color: '#FFF', border: '1px solid #2A364F', borderRadius: '4px', cursor: 'pointer' }}>Anterior</button>
                    <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)} style={{ padding: '6px 12px', backgroundColor: '#1A2333', color: '#FFF', border: '1px solid #2A364F', borderRadius: '4px', cursor: 'pointer' }}>Siguiente</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ANÁLISIS FINOPS DETALLADO */}
      {activeTab === 'finops' && (
        <div className="no-print">
          <div style={{ backgroundColor: '#121824', padding: '20px', borderRadius: '10px', border: '1px solid #2A364F', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', color: '#FFF', fontWeight: 700 }}>🔍 Diagnóstico FinOps (Cuentas Seleccionadas)</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94A3B8' }}>
                  Evaluación integral bajo el ciclo FinOps sobre las {selectedAccounts.length} cuenta(s) activa(s).
                </p>
              </div>
              <div style={{ backgroundColor: '#0B0F17', padding: '10px 16px', borderRadius: '8px', border: '1px solid #2A364F', textAlign: 'right' }}>
                <span style={{ fontSize: '10px', color: '#94A3B8', display: 'block' }}>EFICIENCIA GENERAL DE LA NUBE</span>
                <span style={{ fontSize: '20px', fontWeight: 'bold', color: finopsAvanzado.effiencyScore > 80 ? '#10B981' : '#F59E0B' }}>
                  {finopsAvanzado.effiencyScore} / 100
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            <div style={{ backgroundColor: '#121824', padding: '20px', borderRadius: '10px', border: '1px solid #2A364F' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#FFF' }}>📊 Distribución por Pilares Tecnológicos</h3>
              <div style={{ height: '240px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={finopsAvanzado.pillarBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#2A364F" />
                    <XAxis type="number" stroke="#94A3B8" />
                    <YAxis dataKey="category" type="category" stroke="#94A3B8" width={120} fontSize={10} />
                    <Tooltip formatter={(val: number) => `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`} />
                    <Bar dataKey="cost" fill={TIVIT_RED} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ backgroundColor: '#121824', padding: '20px', borderRadius: '10px', border: '1px solid #2A364F' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#FFF' }}>🔥 Top 5 Impulsores de Costo</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {finopsAvanzado.topDrivers.map((driver, idx) => (
                  <div key={driver.name} style={{ backgroundColor: '#0B0F17', padding: '10px 12px', borderRadius: '6px', border: '1px solid #2A364F' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#FFF' }}>{idx + 1}. {driver.name}</span>
                      <span style={{ fontSize: '12px', fontWeight: 'bold', color: TIVIT_RED }}>${driver.cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <span style={{ fontSize: '10px', color: '#64748B' }}>Items procesados: {driver.count} | {driver.sampleDesc || 'Sin descripción'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PROYECCIÓN */}
      {activeTab === 'proyeccion' && (
        <div className="no-print">
          <div style={{ backgroundColor: '#121824', padding: '20px', borderRadius: '10px', border: '1px solid #2A364F', marginBottom: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#FFF' }}>⚙️ Parámetros del Modelo Proyectivo</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '6px' }}>Horizonte de Meses:</label>
                <input
                  type="number"
                  value={monthsToProject}
                  onChange={(e) => setMonthsToProject(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '8px', borderRadius: '6px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '6px' }}>Tasa de Crecimiento Mensual (%):</label>
                <input
                  type="number"
                  step="0.1"
                  value={manualGrowthRate}
                  onChange={(e) => setManualGrowthRate(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '8px', borderRadius: '6px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '6px' }}>Tipo de Cambio (CLP/USD):</label>
                <input
                  type="number"
                  value={tipoCambio}
                  onChange={(e) => setTipoCambio(parseFloat(e.target.value) || 1)}
                  style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '8px', borderRadius: '6px' }}
                />
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: '#121824', padding: '20px', borderRadius: '10px', border: '1px solid #2A364F', marginBottom: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#FFF' }}>📈 Estimación de Consumo Futuro</h3>
            <div style={{ height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={projectionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A364F" />
                  <XAxis dataKey="mes" stroke="#94A3B8" />
                  <YAxis stroke="#94A3B8" />
                  <Tooltip formatter={(val: number) => `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`} />
                  <Legend />
                  <Area type="monotone" dataKey="costoUSD" name="Costo Estimado (USD)" stroke={TIVIT_RED} fill={TIVIT_RED} fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: REPORTE COMPLETO AIO (OPTIMIZADO PARA IMPRESIÓN PDF LIMPIA SIN CORTES DE TABLAS) */}
      {activeTab === 'reporte_completo' && (
        <div>
          <div className="no-print" style={{ backgroundColor: '#121824', padding: '20px', borderRadius: '10px', border: '1px solid #2A364F', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', color: '#FFF' }}>📝 Editar Datos de la Carátula de Consumo</h3>
              <button onClick={handlePrintPDF} style={{ backgroundColor: TIVIT_RED, color: '#FFF', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                🖨️ Imprimir / Exportar PDF
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>Nombre Cliente:</label>
                <input type="text" value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>RUT:</label>
                <input type="text" value={clienteRut} onChange={(e) => setClienteRut(e.target.value)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>Cód. Cliente:</label>
                <input type="text" value={codCliente} onChange={(e) => setCodCliente(e.target.value)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>Account Manager:</label>
                <input type="text" value={accountManager} onChange={(e) => setAccountManager(e.target.value)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>IT Service Delivery Manager:</label>
                <input type="text" value={sdm} onChange={(e) => setSdm(e.target.value)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>Fecha Informe:</label>
                <input type="text" value={fechaInforme} onChange={(e) => setFechaInforme(e.target.value)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>Mes de Consumo:</label>
                <input type="text" value={mesConsumo} onChange={(e) => setMesConsumo(e.target.value)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>Valor Dólar (TC):</label>
                <input type="number" step="0.01" value={tipoCambio} onChange={(e) => setTipoCambio(parseFloat(e.target.value) || 1)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>Fecha TC:</label>
                <input type="text" value={fechaTC} onChange={(e) => setFechaTC(e.target.value)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>Inicio de periodo:</label>
                <input type="text" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>Fin del periodo:</label>
                <input type="text" value={periodoFin} onChange={(e) => setPeriodoFin(e.target.value)} style={{ width: '100%', backgroundColor: '#0B0F17', border: '1px solid #2A364F', color: '#FFF', padding: '6px', borderRadius: '4px', fontSize: '11px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8' }}>Captura Consola AWS (Opcional):</label>
                <input type="file" accept="image/*" onChange={handleImageUpload} style={{ width: '100%', fontSize: '10px', color: '#94A3B8' }} />
              </div>
            </div>

            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #2A364F', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="toggleResumenes"
                checked={showResumenesReporte}
                onChange={(e) => setShowResumenesReporte(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="toggleResumenes" style={{ fontSize: '12px', color: '#FFF', cursor: 'pointer', fontWeight: 'bold' }}>
                Mostrar Tablas de Resumen (Cuentas Mapeadas y Servicios/Productos) en el reporte
              </label>
            </div>
          </div>

          {/* VISTA OFICIAL DE IMPRESIÓN Y CARÁTULA */}
          <div className="print-area">
            {/* PÁGINA 1: CARÁTULA OFICIAL DE CONSUMO */}
            <div className="avoid-break">
              <table className="caratula-table">
                <tbody>
                  <tr>
                    <td colSpan={5} className="header-red-banner">INFORME CONSUMO</td>
                  </tr>

                  <tr style={{ height: '50px' }}>
                    <td colSpan={3} style={{ textAlign: 'center', backgroundColor: '#FFF' }}>
                      <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#CC0000', letterSpacing: '2px', fontFamily: 'sans-serif' }}>TIVIT</span>
                    </td>
                    <td className="gray-cell text-center" style={{ width: '22%' }}>Periodo</td>
                    <td className="text-center bold" style={{ width: '28%' }}>
                      <div>{periodoInicio}</div>
                      <div>{periodoFin}</div>
                    </td>
                  </tr>

                  <tr>
                    <td colSpan={5} style={{ backgroundColor: '#CC0000', height: '10px', padding: 0 }}></td>
                  </tr>

                  <tr>
                    <td className="gray-cell" style={{ width: '25%' }}>Nombre Cliente</td>
                    <td className="bold text-center" style={{ width: '25%' }}>{clienteNombre}</td>
                    <td colSpan={2} className="gray-cell text-center" style={{ width: '25%' }}>Fecha Informe</td>
                    <td className="bold text-center" style={{ width: '25%' }}>{fechaInforme}</td>
                  </tr>
                  <tr>
                    <td className="gray-cell">RUT</td>
                    <td className="bold text-center">{clienteRut}</td>
                    <td colSpan={2} className="gray-cell text-center">Mes de Consumo del Servicio</td>
                    <td className="bold text-center">{mesConsumo}</td>
                  </tr>
                  <tr>
                    <td className="gray-cell">Cód. Cliente</td>
                    <td className="bold text-center">{codCliente}</td>
                    <td colSpan={2} style={{ border: 'none' }}></td>
                    <td style={{ border: 'none' }}></td>
                  </tr>
                  <tr>
                    <td className="gray-cell">Account Manager</td>
                    <td className="bold text-center">{accountManager}</td>
                    <td colSpan={2} className="gray-cell text-center">Valor Dólar</td>
                    <td className="yellow-cell">${tipoCambio.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="gray-cell">IT ServiceDelivery Manager</td>
                    <td className="bold text-center">{sdm}</td>
                    <td colSpan={2} className="gray-cell text-center">Fecha TC</td>
                    <td className="bold text-center">{fechaTC}</td>
                  </tr>

                  <tr>
                    <td colSpan={5} className="sub-red-banner">CONSUMO DEL PERIODO</td>
                  </tr>

                  <tr>
                    <td colSpan={3} style={{ borderBottom: '1px solid #000' }}></td>
                    <td className="bold text-center" style={{ backgroundColor: '#F2F2F2' }}>USD</td>
                    <td className="bold text-center" style={{ backgroundColor: '#F2F2F2' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 5px' }}>
                        <span style={{ flex: 1, textAlign: 'center' }}>TC</span>
                        <div style={{ width: '1px', height: '12px', backgroundColor: '#000' }}></div>
                        <span style={{ flex: 1, textAlign: 'right' }}>CLP</span>
                      </div>
                    </td>
                  </tr>

                  <tr style={{ height: '22px' }}>
                    <td colSpan={3} className="bold" style={{ fontStyle: 'italic' }}>{clienteNombre}</td>
                    <td className="text-right bold" style={{ backgroundColor: '#E9EEF4' }}>
                      ${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="bold">
                      <div style={{ display: 'flex', justifyContent: 'space-between', paddingRight: '4px' }}>
                        <span style={{ width: '45%', textAlign: 'center', color: '#CC0000' }}>
                          {tipoCambio.toFixed(2)}
                        </span>
                        <span style={{ width: '55%', textAlign: 'right' }}>
                          $ {totalCLP > 0 ? totalCLP.toLocaleString('es-CL') : '-'}
                        </span>
                      </div>
                    </td>
                  </tr>
                  <tr style={{ height: '22px' }}>
                    <td colSpan={3}></td>
                    <td></td>
                    <td className="bold"><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>$</span><span>-</span></div></td>
                  </tr>
                  <tr style={{ height: '22px' }}>
                    <td colSpan={3}></td>
                    <td></td>
                    <td className="bold"><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>$</span><span>-</span></div></td>
                  </tr>

                  <tr>
                    <td colSpan={3} className="bold text-right">TOTAL CONSUMO</td>
                    <td className="bold text-right" style={{ color: '#0000FF' }}>${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="bold">
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>$</span>
                        <span>{totalCLP > 0 ? totalCLP.toLocaleString('es-CL') : '-'}</span>
                      </div>
                    </td>
                  </tr>

                  <tr>
                    <td colSpan={5} style={{ backgroundColor: '#CC0000', height: '10px', padding: 0 }}></td>
                  </tr>

                  <tr>
                    <td colSpan={3} className="bold text-right">TOTAL NETO</td>
                    <td className="bold text-right" style={{ color: '#0000FF' }}>${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="bold">
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>$</span>
                        <span>{totalCLP > 0 ? totalCLP.toLocaleString('es-CL') : '-'}</span>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="bold text-right">IVA (19%)</td>
                    <td className="bold text-right" style={{ color: '#0000FF' }}>${ivaUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="bold">
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>$</span>
                        <span>{ivaCLP > 0 ? ivaCLP.toLocaleString('es-CL') : '-'}</span>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="bold text-right">TOTAL IVA INCLUIDO</td>
                    <td className="bold text-right" style={{ color: '#0000FF' }}>${totalConIvaUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="bold">
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>$</span>
                        <span>{totalConIvaCLP > 0 ? totalConIvaCLP.toLocaleString('es-CL') : '-'}</span>
                      </div>
                    </td>
                  </tr>

                  <tr>
                    <td colSpan={5} className="sub-red-banner" style={{ textAlign: 'left', paddingLeft: '15px' }}>Firma de Aceptación</td>
                  </tr>
                  <tr style={{ height: '35px' }}>
                    <td colSpan={5}></td>
                  </tr>
                  <tr style={{ height: '35px' }}>
                    <td colSpan={5}></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* PÁGINA 2: RESÚMENES TABULARES (SIN TIPO DE CARGO Y SIN CORTES ENTRE PÁGINAS) */}
            {showResumenesReporte && (
              <div className="page-break" style={{ marginTop: '12px' }}>
                <div className="avoid-break" style={{ marginBottom: '18px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '11px', color: '#CC0000', borderBottom: '1px solid #CC0000', paddingBottom: '2px', textTransform: 'uppercase' }}>
                     1. Cuentas Vinculadas 
                  </div>
                  <table className="data-table-report">
                    <thead>
                      <tr>
                        <th>Cuenta vinculada </th>
                        <th style={{ textAlign: 'right', width: '30%' }}>Total (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tablaClientes.map((item, idx) => (
                        <tr key={idx}>
                          <td>{item.name}</td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold' }}>${item.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="avoid-break" style={{ marginBottom: '18px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '11px', color: '#CC0000', borderBottom: '1px solid #CC0000', paddingBottom: '2px', textTransform: 'uppercase' }}>
                    Resumen 2: Costos por Servicio y Producto
                  </div>
                  <table className="data-table-report">
                    <thead>
                      <tr>
                        <th>Servicio (Service_Name)</th>
                        <th>Producto / Descripción (Product_Name)</th>
                        <th style={{ textAlign: 'right', width: '25%' }}>Total (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tablaServiciosProductos.map((item, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 'bold' }}>{item.service}</td>
                          <td>{item.product}</td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold' }}>${item.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* PÁGINA 3: DIAGNÓSTICO FINOPS (TOP 5 MÁS ALTOS, SIN SPP Y CON GRÁFICOS) */}
            <div
              className="finops-container page-break avoid-break"
              style={{
                marginTop: '12px',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                backgroundColor: '#F8FAFC',
                overflow: 'hidden',
                fontFamily: 'Arial, sans-serif',
              }}
            >
              <div
                className="finops-header"
                style={{
                  backgroundColor: '#1E293B',
                  color: '#FFFFFF',
                  padding: '12px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '3px solid #CC0000',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '16px' }}>🛡️</span>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: '#FFF' }}>
                       Análisis de Consumo
                    </h4>
                    <span style={{ fontSize: '10px', color: '#94A3B8' }}>
                      Cliente: {clienteNombre} | Período: {mesConsumo.toUpperCase()} ({periodoInicio} - {periodoFin})
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    padding: '4px 10px',
                    borderRadius: '20px',
                    fontSize: '10px',
                    fontWeight: 600,
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                  }}
                >
                  Score de Eficiencia: {finopsAvanzado.effiencyScore}/100
                </div>
              </div>

              <div style={{ padding: '16px 20px', color: '#334155', fontSize: '11px', lineHeight: '1.5' }}>
                {/* KPI CARDS SIN MENCIÓN A SPP */}
                <div className="avoid-break" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '14px' }}>
                  <div className="badge-finops" style={{ backgroundColor: '#FFFFFF', padding: '10px 12px', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                    <span style={{ fontSize: '9px', textTransform: 'uppercase', color: '#64748B', fontWeight: 700, display: 'block' }}>Gasto Neto Período</span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: '#0F172A' }}>
                      ${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </span>
                  </div>

                  <div className="badge-finops" style={{ backgroundColor: '#FFFFFF', padding: '10px 12px', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                    <span style={{ fontSize: '9px', textTransform: 'uppercase', color: '#64748B', fontWeight: 700, display: 'block' }}>Consumo Marketplace</span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: '#D97706' }}>
                      ${metricasWidgets.marketplaceSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </span>
                  </div>

                  <div className="badge-finops" style={{ backgroundColor: '#FFFFFF', padding: '10px 12px', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                    <span style={{ fontSize: '9px', textTransform: 'uppercase', color: '#64748B', fontWeight: 700, display: 'block' }}>Cuentas / Servicios Activos</span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: '#1E293B' }}>
                      {selectedAccounts.length} Cuentas / {finopsAvanzado.totalServicesUsed} Servicios
                    </span>
                  </div>
                </div>

                {/* RESUMEN DE FACTURACIÓN SIN SPP */}
                <div className="avoid-break" style={{ backgroundColor: '#FFFFFF', padding: '12px 16px', borderRadius: '6px', border: '1px solid #E2E8F0', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ color: '#CC0000', fontWeight: 'bold' }}>1.</span>
                    <strong style={{ fontSize: '11px', color: '#1E293B', textTransform: 'uppercase' }}>Resumen Ejecutivo de Facturación</strong>
                  </div>
                  <p style={{ margin: 0, textAlign: 'justify', color: '#475569' }}>
                    El análisis sobre la infraestructura del cliente <strong>{clienteNombre}</strong> (correspondiente al ciclo del {periodoInicio} al {periodoFin}) evidencia un monto neto total de <strong>${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</strong> (equivalente a <strong>${totalCLP.toLocaleString('es-CL')} CLP</strong> con tipo de cambio ${tipoCambio.toFixed(2)}). La distribución de gasto contempla <strong>{selectedAccounts.length} cuenta(s)</strong> activa(s) y <strong>{finopsAvanzado.totalServicesUsed} servicios</strong> AWS en operación.
                  </p>
                </div>

                {/* TOP 5 IMPULSORES DE COSTO MÁS ALTOS */}
                <div className="avoid-break" style={{ backgroundColor: '#FFFFFF', padding: '12px 16px', borderRadius: '6px', border: '1px solid #E2E8F0', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <span style={{ color: '#CC0000', fontWeight: 'bold' }}>2.</span>
                    <strong style={{ fontSize: '11px', color: '#1E293B', textTransform: 'uppercase' }}>Top 5 Valores Más Altos (Impulsores Principales de Costo)</strong>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '18px', color: '#475569' }}>
                    {finopsAvanzado.topDrivers.length > 0 ? (
                      finopsAvanzado.topDrivers.map((driver, index) => (
                        <li key={driver.name} style={{ marginBottom: index === finopsAvanzado.topDrivers.length - 1 ? 0 : '6px' }}>
                          <strong style={{ color: '#0F172A' }}>#{index + 1} {driver.name}:</strong> Representa el <strong>{driver.pct}%</strong> de la facturación total con un monto de <strong>${driver.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</strong>.
                          <span style={{ fontStyle: 'italic', color: '#64748B' }}> — Uso recurrente: {driver.sampleDesc || 'Infraestructura activa del cliente'}.</span>
                        </li>
                      ))
                    ) : (
                      <li>No se registran servicios con monto superior a $0.00 en la selección actual.</li>
                    )}
                  </ul>
                </div>

                {/* SECCIÓN 3: GRÁFICOS DE DISTRIBUCIÓN PARA PDF (BARRAS TOP 5 + CIRCULAR PORCENTUAL) */}
                <div className="pdf-chart-box avoid-break" style={{ backgroundColor: '#FFFFFF', padding: '12px 16px', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                    <span style={{ color: '#CC0000', fontWeight: 'bold' }}>3.</span>
                    <strong style={{ fontSize: '11px', color: '#1E293B', textTransform: 'uppercase' }}>Gráficos Comparativos de Consumo (Top 5 Servicios y Participación %)</strong>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: '16px', alignItems: 'center' }}>
                    {/* GRÁFICO DE BARRAS HORIZONTAL TOP 5 */}
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#1E293B', marginBottom: '8px', textTransform: 'uppercase' }}>
                        Ranking Top 5 Servicios (USD)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {finopsAvanzado.topDrivers.map((driver, idx) => {
                          const maxTopCost = finopsAvanzado.topDrivers[0]?.cost || 1;
                          const widthPct = Math.max(6, Math.round((driver.cost / maxTopCost) * 100));
                          const barColors = ['#CC0000', '#1E293B', '#2563EB', '#059669', '#D97706'];
                          return (
                            <div key={driver.name}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', marginBottom: '2px' }}>
                                <span style={{ fontWeight: 'bold', color: '#0F172A', maxWidth: '62%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {idx + 1}. {driver.name}
                                </span>
                                <span style={{ fontWeight: 'bold', color: '#334155' }}>
                                  ${driver.cost.toLocaleString('en-US', { minimumFractionDigits: 2 })} ({driver.pct}%)
                                </span>
                              </div>
                              <div style={{ width: '100%', height: '10px', backgroundColor: '#E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
                                <div
                                  style={{
                                    width: `${widthPct}%`,
                                    height: '100%',
                                    backgroundColor: barColors[idx % barColors.length],
                                    borderRadius: '4px',
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* GRÁFICO CIRCULAR SVG NATIVO CON LEYENDA */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', borderLeft: '1px solid #E2E8F0', paddingLeft: '12px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#1E293B', marginBottom: '6px', textTransform: 'uppercase' }}>
                        Distribución Porcentual (%)
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <svg width="115" height="115" viewBox="0 0 120 120">
                          {pdfPieSlices.length > 0 ? (
                            pdfPieSlices.map((slice, idx) => (
                              <path
                                key={idx}
                                d={describeArc(60, 60, 52, slice.startAngle, slice.endAngle)}
                                fill={slice.color}
                                stroke="#FFFFFF"
                                strokeWidth="1.5"
                              />
                            ))
                          ) : (
                            <circle cx="60" cy="60" r="52" fill="#CBD5E1" />
                          )}
                          <circle cx="60" cy="60" r="24" fill="#FFFFFF" />
                          <text x="60" y="63" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#0F172A">
                            100%
                          </text>
                        </svg>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '8.5px' }}>
                          {pdfPieSlices.map((slice, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '2px',
                                  backgroundColor: slice.color,
                                  flexShrink: 0,
                                }}
                              />
                              <span style={{ color: '#1E293B', fontWeight: 600, maxWidth: '105px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {slice.name}: <strong>{slice.pct}%</strong>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* PÁGINA 4 (OPCIONAL): EVIDENCIA DE CONSOLA */}
            {consoleScreenshot && (
              <div className="page-break avoid-break" style={{ marginTop: '20px' }}>
                <div className="bold" style={{ fontSize: '11px', marginBottom: '8px', borderBottom: '1px solid #000' }}>
                  EVIDENCIA DE CONSOLA AWS BILLING
                </div>
                <img src={consoleScreenshot} alt="Evidencia AWS Console" style={{ maxWidth: '100%', border: '1px solid #000', borderRadius: '4px' }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}