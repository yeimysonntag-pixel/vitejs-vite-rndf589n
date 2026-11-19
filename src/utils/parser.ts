import Papa from 'papaparse';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';

// Desactivar completamente el uso de Web Workers para evitar DataCloneError en StackBlitz
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

export interface FinOpsRecord {
  payerAccountId: string;
  linkedAccountId: string;
  partnerId: string;
  clientId: string;
  environment: string;
  service: string;
  grossCost: number;
  discounts: number;
  netCost: number;
}

export const parseCSV = (file: File): Promise<FinOpsRecord[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedData: FinOpsRecord[] = results.data.map((row: any) => {
          const parseNum = (val: any) => {
            if (!val) return 0;
            const cleaned = String(val).replace(/[^0-9.-]+/g, '');
            return parseFloat(cleaned) || 0;
          };

          const gross = parseNum(
            row.UnBlendedCost || row.GrossCost || row.LineItemCost
          );
          const discounts = parseNum(row.Discounts || row.Credits);
          const net =
            parseNum(row.NetUnblendedCost || row.NetCost) || gross - discounts;

          return {
            payerAccountId:
              row.PayerAccountId || row.BillingAccountId || '123456789012',
            linkedAccountId:
              row.LinkedAccountId || row.SubAccountId || row.AccountId || 'N/A',
            partnerId:
              row['resourceTags/user:PartnerID'] ||
              row.PartnerID ||
              'PARTNER-DIRECT',
            clientId:
              row['resourceTags/user:ClientID'] ||
              row.ClientID ||
              'CLIENT-GENERIC',
            environment: row['resourceTags/user:Environment'] || 'Production',
            service: row.ProductName || row.Service || 'Unspecified Service',
            grossCost: gross,
            discounts: discounts,
            netCost: net,
          };
        });
        resolve(parsedData);
      },
      error: (err) => reject(err),
    });
  });
};

export const parsePDF = async (file: File): Promise<FinOpsRecord[]> => {
  try {
    const arrayBuffer = await file.arrayBuffer();

    // Cargamos el PDF directamente en el Hilo Principal (isEvalSupported: false previene errores de ejecución)
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      disableFontFace: true,
      isEvalSupported: false,
    });

    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }

    const payerMatch = fullText.match(
      /(?:Account|Payer|Billing)[\s#:]*(\d{12})/i
    );
    const detectedPayer = payerMatch ? payerMatch[1] : '123456789012';

    const lines = fullText.split('\n');
    const records: FinOpsRecord[] = [];

    lines.forEach((line, index) => {
      const amountMatches = line.match(
        /\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/g
      );

      if (amountMatches && amountMatches.length >= 1) {
        const cleanNum = (str: string) => {
          let n = str.replace('$', '').trim().replace(/,/g, '');
          return parseFloat(n) || 0;
        };

        const gross = cleanNum(amountMatches[0]);
        const net = amountMatches[1] ? cleanNum(amountMatches[1]) : gross;
        const linkedMatch = line.match(/(\d{12})/);

        records.push({
          payerAccountId: detectedPayer,
          linkedAccountId: linkedMatch
            ? linkedMatch[1]
            : `SUB-ACC-${index + 1}`,
          partnerId: 'PARTNER-LATAM-01',
          clientId: 'CLI-CUSTOM',
          environment: 'Production',
          service:
            line.length > 35
              ? line.substring(0, 35) + '...'
              : line || `PDF Line ${index + 1}`,
          grossCost: gross,
          discounts: Math.max(0, gross - net),
          netCost: net,
        });
      }
    });

    return records;
  } catch (error) {
    console.error('Error al procesar PDF:', error);
    throw new Error('No se pudo procesar el PDF.');
  }
};

export const parseCloudFile = async (file: File): Promise<FinOpsRecord[]> => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv') {
    return await parseCSV(file);
  } else if (extension === 'pdf') {
    return await parsePDF(file);
  } else {
    throw new Error('Formato no soportado. Sube un archivo .csv o .pdf');
  }
};
