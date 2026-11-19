import React from 'react';
import type { DynamicMetrics } from '../types/finops'; // <-- Cambiado a 'import type'

const TIVIT_RED = '#E4002B';

interface Props {
  metrics: DynamicMetrics;
  marketplaceTotal: number;
}

export const MetricsSummary: React.FC<Props> = ({ metrics, marketplaceTotal }) => {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
      <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '10px', border: '1px solid #2A364F' }}>
        <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>USO Y TARIFAS (USD)</span>
        <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '6px', color: '#FFF' }}>
          ${metrics.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>

      <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '10px', border: '1px solid #2A364F' }}>
        <span style={{ fontSize: '11px', color: '#FFB703', fontWeight: 600 }}>DESCUENTOS (EDP / BUNDLED)</span>
        <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '6px', color: '#FFB703' }}>
          -${metrics.totalDiscount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>

      <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '10px', border: '1px solid #2A364F' }}>
        <span style={{ fontSize: '11px', color: '#38BDF8', fontWeight: 600 }}>TAX / CREDITS</span>
        <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '6px', color: '#38BDF8' }}>
          ${metrics.totalTaxOrCredit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>

      <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '10px', border: '1px solid #A855F7' }}>
        <span style={{ fontSize: '11px', color: '#C084FC', fontWeight: 700 }}>AWS MARKETPLACE</span>
        <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '6px', color: '#C084FC' }}>
          ${marketplaceTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>

      <div style={{ backgroundColor: '#121824', padding: '16px', borderRadius: '10px', border: `2px solid ${TIVIT_RED}` }}>
        <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 700 }}>TOTAL NETO FILTRADO</span>
        <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '6px', color: TIVIT_RED }}>
          ${metrics.netTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
    </div>
  );
};