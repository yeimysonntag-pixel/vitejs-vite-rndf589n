import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configuración limpia de Vite sin dependencias de backend inexistentes
export default defineConfig({
  plugins: [react()],
});