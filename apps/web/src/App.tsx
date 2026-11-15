import React from 'react';
import { DayView } from './pages/DayView.js';
import './index.css';

export const App: React.FC = () => {
  return (
    <React.StrictMode>
      <DayView />
    </React.StrictMode>
  );
};

export default App;
