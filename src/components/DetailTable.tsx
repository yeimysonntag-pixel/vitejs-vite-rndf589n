import React from 'react';

interface DetailTableProps {
  rows: Record<string, any>[];
  selectedColumns: string[];
  totalRowsCount: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export const DetailTable: React.FC<DetailTableProps> = ({
  rows = [],
  selectedColumns = [],
  totalRowsCount = 0,
  currentPage = 1,
  totalPages = 1,
  onPageChange
}) => {

  const renderCell = (val: any) => {
    if (val === undefined || val === null || val === '') {
      return <span style={{ color: '#475569' }}>-</span>;
    }

    if (typeof val === 'number') {
      const formatted = Number.isInteger(val) 
        ? val.toLocaleString() 
        : val.toFixed(6).replace(/\.?0+$/, '');
      return <span style={{ fontFamily: 'monospace' }}>{formatted}</span>;
    }

    return String(val);
  };

  return (
    <div style={{ backgroundColor: '#121824', borderRadius: '8px', padding: '16px', border: '1px solid #2A364F' }}>
      <div style={{ overflowX: 'auto', maxHeight: '550px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', color: '#FFF', whiteSpace: 'nowrap' }}>
          <thead>
            <tr style={{ backgroundColor: '#1A2333', color: '#94A3B8', position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={{ padding: '8px 12px', borderBottom: '1px solid #2A364F', textTransform: 'capitalize' }}>#</th>
              {selectedColumns.map((col, idx) => (
                <th key={idx} style={{ padding: '8px 12px', borderBottom: '1px solid #2A364F', textAlign: 'left' }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={selectedColumns.length + 1} style={{ padding: '24px', textAlign: 'center', color: '#64748B' }}>
                  No se encontraron registros para los filtros seleccionados.
                </td>
              </tr>
            ) : (
              rows.map((row, rowIdx) => (
                <tr key={rowIdx} style={{ borderBottom: '1px solid #1A2333', backgroundColor: rowIdx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)' }}>
                  <td style={{ padding: '6px 12px', color: '#64748B' }}>
                    {(currentPage - 1) * rows.length + rowIdx + 1}
                  </td>
                  {selectedColumns.map((col, colIdx) => {
                    const cellVal = row[col];
                    const isNum = typeof cellVal === 'number';
                    return (
                      <td 
                        key={colIdx} 
                        style={{ 
                          padding: '6px 12px', 
                          textAlign: isNum ? 'right' : 'left',
                          color: isNum && cellVal < 0 ? '#60A5FA' : '#E2E8F0' 
                        }}
                      >
                        {renderCell(cellVal)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginador */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', fontSize: '12px', color: '#94A3B8' }}>
        <span>
          Página {currentPage} de {totalPages} ({totalRowsCount.toLocaleString()} registros filtrados)
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              backgroundColor: currentPage <= 1 ? '#0F172A' : '#1A2333',
              color: currentPage <= 1 ? '#475569' : '#FFF',
              border: '1px solid #2A364F',
              cursor: currentPage <= 1 ? 'not-allowed' : 'pointer'
            }}
          >
            Anterior
          </button>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              backgroundColor: currentPage >= totalPages ? '#0F172A' : '#1A2333',
              color: currentPage >= totalPages ? '#475569' : '#FFF',
              border: '1px solid #2A364F',
              cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer'
            }}
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
};