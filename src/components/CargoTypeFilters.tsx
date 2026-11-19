import React from 'react';
import { CARGO_TYPES } from '../types/finops';
import type { CargoType } from '../types/finops'; // <-- Agregado 'type'

const TIVIT_RED = '#E4002B';

interface Props {
  selectedTypes: Record<CargoType, boolean>;
  onToggle: (type: CargoType) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export const CargoTypeFilters: React.FC<Props> = ({
  selectedTypes,
  onToggle,
  onSelectAll,
  onDeselectAll,
}) => {
  return (
    <div style={{ backgroundColor: '#121824', padding: '20px', borderRadius: '10px', border: '1px solid #2A364F', marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', color: '#FFF', fontWeight: 700 }}>☑️ Filtrar por line_item_type</h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onSelectAll} style={{ backgroundColor: '#1A2333', color: '#38BDF8', border: '1px solid #2A364F', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>Marcar todos</button>
          <button onClick={onDeselectAll} style={{ backgroundColor: '#1A2333', color: '#94A3B8', border: '1px solid #2A364F', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>Desmarcar todos</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
        {CARGO_TYPES.map(type => (
          <label 
            key={type} 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              backgroundColor: selectedTypes[type] ? (type === 'AWS Marketplace' ? '#2E1065' : '#1E293B') : '#0B0F17', 
              padding: '8px 12px', 
              borderRadius: '6px', 
              border: `1px solid ${selectedTypes[type] ? (type === 'AWS Marketplace' ? '#A855F7' : TIVIT_RED) : '#2A364F'}`,
              cursor: 'pointer',
              fontSize: '11px',
              color: selectedTypes[type] ? '#FFF' : '#64748B'
            }}
          >
            <input 
              type="checkbox" 
              checked={selectedTypes[type]} 
              onChange={() => onToggle(type)}
              style={{ accentColor: type === 'AWS Marketplace' ? '#A855F7' : TIVIT_RED, cursor: 'pointer' }}
            />
            <span style={{ fontWeight: selectedTypes[type] ? 600 : 400 }}>{type}</span>
          </label>
        ))}
      </div>
    </div>
  );
};