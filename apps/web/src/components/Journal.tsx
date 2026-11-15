import React from 'react';
import { JournalEntry } from '@life-logger/domain';

interface JournalProps {
  entries: JournalEntry[];
  onSave: (body: string) => Promise<void>;
  currentDraft: string;
  setCurrentDraft: (text: string) => void;
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const Journal: React.FC<JournalProps> = ({ entries, onSave, currentDraft, setCurrentDraft }) => {
  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentDraft.trim()) return;
    await onSave(currentDraft.trim());
  };

  if (entries.length === 0 && !currentDraft.trim()) {
    return (
      <div className="card compact">
        <div className="card-header">
          <h3 className="card-title">Journal</h3>
        </div>
        <p className="empty-state">
          No reflection yet. Write a journal entry during your day or evening review.
        </p>
      </div>
    );
  }

  return (
    <div className="card compact">
      <div className="card-header">
        <h3 className="card-title">Journal</h3>
      </div>
      <form onSubmit={handleSave} style={{ marginBottom: '16px' }}>
        <textarea
          className="textarea"
          placeholder="What mattered today? What did you learn?"
          value={currentDraft}
          onChange={(e) => setCurrentDraft(e.target.value)}
          rows={4}
        />
      </form>
      {entries.length > 0 && (
        <div>
          {entries.map((entry) => (
            <div key={entry.id} className="journal-card">
              <p className="journal-body">{entry.body}</p>
              <div className="journal-meta">{formatClock(entry.writtenAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
