import React, { useState } from 'react';
import { DayView } from './pages/DayView.js';
import { Settings } from './pages/Settings.js';
import './index.css';

export const App: React.FC = () => {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <React.StrictMode>
      <DayView onSettingsOpen={() => setSettingsOpen(true)} />
      {settingsOpen && (
        <Settings onClose={() => setSettingsOpen(false)} />
      )}
    </React.StrictMode>
  );
};

export default App;
