// src/workers/curWorker.ts

const parseCSVLine = (text: string, delimiter: string): string[] => {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delimiter && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
};

// Extracción de Service_Name y Product_Name desde la fila
const resolveServiceAndProductName = (rowObj: Record<string, any>, rawHeaders: string[]) => {
  let serviceName = '';
  let productName = '';

  const findValueInHeaders = (possibleKeys: string[]): string => {
    for (const key of possibleKeys) {
      const foundHeader = rawHeaders.find(h => h.toLowerCase() === key.toLowerCase() || h.toLowerCase().endsWith(`_${key.toLowerCase()}`));
      if (foundHeader && rowObj[foundHeader] !== undefined && rowObj[foundHeader] !== null && String(rowObj[foundHeader]).trim() !== '') {
        return String(rowObj[foundHeader]).trim();
      }
    }
    return '';
  };

  const potentialJsonCols = rawHeaders.filter(h => {
    const l = h.toLowerCase();
    return l.includes('product') || l.includes('service');
  });

  for (const colHeader of potentialJsonCols) {
    const val = String(rowObj[colHeader] || '').trim();
    if (val.startsWith('{') && val.endsWith('}')) {
      try {
        const obj = JSON.parse(val);
        if (obj && typeof obj === 'object') {
          if (!serviceName) {
            serviceName = obj.servicename || obj.serviceName || obj.service_name || obj.servicecode || obj.service_code || '';
          }
          if (!productName) {
            productName = obj.productname || obj.productName || obj.product_name || obj.productFamily || obj.group || obj.description || '';
          }
        }
      } catch (e) {}
    }

    if (!serviceName && val) {
      const sMatch = val.match(/["']?(?:servicename|service_name|servicecode)["']?\s*:\s*["']([^"']+)["']/i);
      if (sMatch && sMatch[1]) serviceName = sMatch[1];
    }
    if (!productName && val) {
      const pMatch = val.match(/["']?(?:productname|product_name|productFamily)["']?\s*:\s*["']([^"']+)["']/i);
      if (pMatch && pMatch[1]) productName = pMatch[1];
    }
  }

  if (!serviceName) {
    serviceName = findValueInHeaders([
      'line_item_product_code', 'product_code', 'product_servicename',
      'product_service_code', 'product_service_name', 'servicename', 'service_name'
    ]);
  }

  if (!productName) {
    productName = findValueInHeaders([
      'product_product_name', 'product_name', 'productfamily',
      'product_product_family', 'product_group', 'product_description', 'line_item_line_item_description'
    ]);
  }

  if (!serviceName && productName) serviceName = productName;
  if (!serviceName) {
    const lineType = findValueInHeaders(['line_item_line_item_type', 'lineitemtype']);
    serviceName = lineType ? `AWS ${lineType.toUpperCase()}` : 'AWS Service General';
  }
  if (!productName) productName = serviceName;

  return {
    serviceName,
    productName,
    combined: serviceName === productName ? serviceName : `${serviceName} — ${productName}`
  };
};

// Extrae el valor numérico de EDP
const extractEdpFromJson = (rowObj: Record<string, any>, rawHeaders: string[]): number => {
  for (const header of rawHeaders) {
    const val = String(rowObj[header] || '').trim();
    
    if (val.toLowerCase().includes('edp_discount') || val.toLowerCase().includes('edpdiscount')) {
      if (val.startsWith('{') && val.endsWith('}')) {
        try {
          const obj = JSON.parse(val);
          if (obj && typeof obj === 'object') {
            for (const key of Object.keys(obj)) {
              if (key.toLowerCase().includes('edp')) {
                const num = parseFloat(obj[key]);
                if (!isNaN(num)) return Math.abs(num);
              }
            }
          }
        } catch (e) {}
      }

      const match = val.match(/["']?edp(?:_discount)?["']?\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/i);
      if (match && match[1]) {
        const num = parseFloat(match[1]);
        if (!isNaN(num)) return Math.abs(num);
      }
    }
  }
  return 0;
};

// Detecta Marketplace examinando columnas clave y la entidad de facturación
const isMarketplaceRow = (rowObj: Record<string, any>, rawHeaders: string[], billingEntity: string): boolean => {
  const getStrVal = (...keys: string[]) => {
    for (const k of keys) {
      const match = rawHeaders.find(h => h.toLowerCase() === k.toLowerCase() || h.toLowerCase().endsWith(`_${k.toLowerCase()}`));
      if (match && rowObj[match]) return String(rowObj[match]).toLowerCase();
    }
    return '';
  };

  const legalEntity = getStrVal('line_item_legal_entity', 'legal_entity', 'lineitem/legalentity');
  const publisher = getStrVal('publisher', 'product_publisher');
  const productCode = getStrVal('line_item_product_code', 'product_code');
  const productName = getStrVal('product_product_name', 'product_name');

  return (
    billingEntity.toLowerCase().includes('marketplace') ||
    legalEntity.includes('marketplace') ||
    publisher.includes('marketplace') ||
    productCode.includes('marketplace') ||
    productName.includes('marketplace')
  );
};

self.onmessage = async (e: MessageEvent) => {
  const { file } = e.data;
  if (!file) return;

  const chunkSize = 1024 * 1024 * 8;
  let offset = 0;
  const fileSize = file.size;

  let partialLine = '';
  let rawHeaders: string[] = [];
  let extendedHeaders: string[] = [];

  let batchRows: Record<string, any>[] = [];
  const BATCH_SIZE = 15000;
  let totalProcessed = 0;
  let totalEdpAccumulated = 0;
  let totalMarketplaceAccumulated = 0;
  let delimiter = ',';

  while (offset < fileSize) {
    const chunk = file.slice(offset, offset + chunkSize);
    const text = await chunk.text();
    const content = partialLine + text;
    const lines = content.split(/\r?\n/);

    partialLine = lines.pop() || '';
    let startIdx = 0;

    if (rawHeaders.length === 0 && lines.length > 0) {
      const firstLine = lines[0];
      if (firstLine.includes('\t')) delimiter = '\t';
      else if (firstLine.includes(';')) delimiter = ';';

      rawHeaders = parseCSVLine(firstLine, delimiter).map(h => h.replace(/^["']|["']$/g, '').trim());
      
      // Inyección de bill_billing_entity y campos derivados al listado de columnas
      extendedHeaders = Array.from(new Set([
        'Service_Name', 
        'Product_Name', 
        'bill_billing_entity',
        'Unblended_Cost', 
        'Unblended_Rate', 
        'Is_Marketplace', 
        'Marketplace_Cost', 
        'SPP_Discount', 
        'EDP_Discount', 
        'Costo_Final_Ajustado', 
        ...rawHeaders
      ]));

      self.postMessage({ type: 'HEADERS', headers: extendedHeaders });
      startIdx = 1;
    }

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const cols = parseCSVLine(line, delimiter);
      const rowObj: Record<string, any> = { id: ++totalProcessed };

      rawHeaders.forEach((header, idx) => {
        let rawVal = cols[idx] !== undefined ? cols[idx].replace(/^["']|["']$/g, '').trim() : '';
        const numVal = parseFloat(rawVal);
        rowObj[header] = (!isNaN(numVal) && isFinite(numVal) && !rawVal.includes('-') && rawVal.match(/^-?\d+(\.\d+)?$/))
          ? numVal
          : rawVal;
      });

      const productInfo = resolveServiceAndProductName(rowObj, rawHeaders);
      rowObj['Service_Name'] = productInfo.serviceName;
      rowObj['Product_Name'] = productInfo.productName;

      const getVal = (...keys: string[]) => {
        for (const k of keys) {
          const match = Object.keys(rowObj).find(h => h.toLowerCase() === k.toLowerCase() || h.toLowerCase().endsWith(`_${k.toLowerCase()}`));
          if (match && rowObj[match] !== undefined) return rowObj[match];
        }
        return 0;
      };

      // Extracción explícita de bill_billing_entity
      const billingEntity = String(getVal('bill_billing_entity', 'billing_entity', 'bill/billingentity') || 'AWS').trim();

      // Extracción de line_item_unblended_cost y line_item_unblended_rate
      const unblendedCost = parseFloat(getVal('line_item_unblended_cost', 'unblended_cost', 'unblendedcost')) || 0;
      const unblendedRate = parseFloat(getVal('line_item_unblended_rate', 'unblended_rate', 'unblendedrate')) || 0;

      const bundledCol = parseFloat(getVal('discount_bundled_discount', 'discount_total_discount', 'discount')) || 0;
      const edpColDirect = parseFloat(getVal('discount_edp_discount', 'edpdiscount', 'edp_discount')) || 0;

      const lineType = String(getVal('line_item_line_item_type', 'lineitemtype') || '').toLowerCase();
      const itemDesc = String(getVal('line_item_line_item_description', 'product_fee_description') || '').toLowerCase();

      // Detección de Marketplace y costo asignado
      const isMkt = isMarketplaceRow(rowObj, rawHeaders, billingEntity);
      const mktCost = isMkt ? unblendedCost : 0;
      if (isMkt) totalMarketplaceAccumulated += mktCost;

      // Descuentos SPP y EDP
      const isSPP = lineType.includes('spp') || itemDesc.includes('spp') || itemDesc.includes('solution provider');
      const sppVal = isSPP ? Math.abs(bundledCol !== 0 ? bundledCol : unblendedCost) : 0;

      let edpVal = 0;
      const isEDPLine = lineType.includes('edpdiscount') || lineType.includes('edp') || itemDesc.includes('edp discount');
      
      if (isEDPLine) {
        edpVal = Math.abs(edpColDirect !== 0 ? edpColDirect : unblendedCost);
      } else if (edpColDirect !== 0) {
        edpVal = Math.abs(edpColDirect);
      } else {
        edpVal = extractEdpFromJson(rowObj, rawHeaders);
      }

      totalEdpAccumulated += edpVal;

      // Inyección explícita de variables procesadas
      rowObj['bill_billing_entity'] = billingEntity;
      rowObj['Unblended_Cost'] = unblendedCost;
      rowObj['Unblended_Rate'] = unblendedRate;
      rowObj['Is_Marketplace'] = isMkt ? 'Sí' : 'No';
      rowObj['Marketplace_Cost'] = mktCost;
      rowObj['SPP_Discount'] = sppVal;
      rowObj['EDP_Discount'] = edpVal;
      rowObj['Costo_Final_Ajustado'] = unblendedCost + sppVal + edpVal;

      batchRows.push(rowObj);

      if (batchRows.length >= BATCH_SIZE) {
        self.postMessage({ type: 'CHUNK', rows: batchRows });
        batchRows = [];
      }
    }

    offset += chunkSize;
    self.postMessage({
      type: 'PROGRESS',
      progress: Math.min(100, Math.round((offset / fileSize) * 100))
    });
  }

  if (batchRows.length > 0) {
    self.postMessage({ type: 'CHUNK', rows: batchRows });
    batchRows = [];
  }

  self.postMessage({ 
    type: 'COMPLETE', 
    totalRecords: totalProcessed,
    totalEdp: totalEdpAccumulated,
    totalMarketplace: totalMarketplaceAccumulated
  });
};