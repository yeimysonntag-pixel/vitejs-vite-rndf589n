import React, { useMemo } from 'react';

interface AwsConfigMultiCurTabProps {
  dataRows: any[];
  headers: string[];
  isProcessing: boolean;
  statusMessage: string;
  selectedClients: string[];
  setSelectedClients: React.Dispatch<React.SetStateAction<string[]>>;
}

export default function AwsConfigMultiCurTab({
  dataRows,
  headers,
  isProcessing,
  statusMessage,
  selectedClients,
  setSelectedClients,
}: AwsConfigMultiCurTabProps) {
  // Extracción dinámica y consolidación de clientes/cuentas detectadas en los CURs
  const availableClients = useMemo(() => {
    const clientsMap: Record<string, { id: string; name: string; count: number; totalCost: number }> = {};

    dataRows.forEach((row) => {
      const accountId = String(row['line_item_usage_account_id'] || row['usageaccountid'] || 'Sin ID').trim();
      const accountName = String(
        row['line_item_usage_account_name'] || row['usageaccountname'] || row['account_name'] || accountId
      ).trim();
      
      const cost = Number(row['Costo_Final_Ajustado'] || row['Unblended_Cost'] || 0);

      const key = accountName !== '' ? accountName : accountId;

      if (!clientsMap[key]) {
        clientsMap[key] = { id: accountId, name: key, count: 0, totalCost: 0 };
      }
      clientsMap[key].count += 1;
      clientsMap[key].totalCost += cost;
    });

    return Object.values(clientsMap).sort((a, b) => b.totalCost - a.totalCost);
  }, [dataRows]);

  const handleSelectAll = () => {
    setSelectedClients(availableClients.map((c) => c.name));
  };

  const handleDeselectAll = () => {
    setSelectedClients([]);
  };

  const toggleClient = (clientName: string) => {
    setSelectedClients((prev) =>
      prev.includes(clientName) ? prev.filter((c) => c !== clientName) : [...prev, clientName]
    );
  };

  return (
    <div style={{ backgroundColor: '#121824', padding: '24px', borderRadius: '12px', border: '1px solid #2A364F' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#FFF', fontWeight: 700 }}>
            ⚙️ Selección e Identificación de Clientes / Cuentas
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94A3B8' }}>
            Selecciona una o más cuentas para filtrar el análisis FinOps, Dashboard y Reporte Final.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleSelectAll}
            disabled={availableClients.length === 0}
            style={{
              backgroundColor: '#1A2333',
              color: '#38BDF8',
              border: '1px solid #2A364F',
              padding: '8px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Seleccionar Todos ({availableClients.length})
          </button>
          <button
            onClick={handleDeselectAll}
            disabled={selectedClients.length === 0}
            style={{
              backgroundColor: '#1A2333',
              color: '#FF4D6D',
              border: '1px solid #2A364F',
              padding: '8px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Limpiar Selección
          </button>
        </div>
      </div>

      {availableClients.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748B', fontSize: '13px', backgroundColor: '#0B0F17', borderRadius: '8px', border: '1px dashed #2A364F' }}>
          {isProcessing ? '⏳ Leyendo archivos CUR en segundo plano...' : '📁 Carga al menos un archivo CUR para detectar automáticamente los clientes y cuentas.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px', maxHeight: '450px', overflowY: 'auto', paddingRight: '6px' }}>
          {availableClients.map((client) => {
            const isChecked = selectedClients.includes(client.name);
            return (
              <label
                key={client.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justify: 'space-between',
                  backgroundColor: isChecked ? '#1E293B' : '#0B0F17',
                  border: isChecked ? '1px solid #CC0000' : '1px solid #2A364F',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleClient(client.name)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: isChecked ? '#FFF' : '#CBD5E1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {client.name}
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748B' }}>
                      ID: {client.id} | Registros: {client.count.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right', minWidth: '90px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: isChecked ? '#10B981' : '#94A3B8' }}>
                    ${client.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: '16px', fontSize: '11px', color: '#94A3B8', textAlign: 'right' }}>
        Cuentas activas seleccionadas: <strong style={{ color: '#FFF' }}>{selectedClients.length}</strong> de <strong style={{ color: '#FFF' }}>{availableClients.length}</strong>
      </div>
    </div>
  );
}