import React, { useMemo, useState } from 'react';
import { parseQuickEntry } from '@life-logger/domain';

interface QuickEntryProps {
  tags: { id: string; path: string }[];
  people: { id: string; displayName: string }[];
  onSubmit: (text: string) => Promise<void>;
}

export const QuickEntry: React.FC<QuickEntryProps> = ({ tags, people, onSubmit }) => {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preview = useMemo(
    () => (text.trim() ? parseQuickEntry(text, new Date()) : null),
    [text]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(text);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  const insertTag = (path: string) => {
    setText((prev) => `${prev} #${path} `.trimStart());
  };

  const insertPerson = (name: string) => {
    setText((prev) => `${prev} @${name} `.trimStart());
  };

  return (
    <div className="card compact">
      <div className="card-header">
        <h3 className="card-title">Quick Entry</h3>
      </div>
      <form onSubmit={handleSubmit} className="quick-form">
        <input
          className="input quick-input"
          placeholder="lunch with @rahul at 1pm #food/lunch"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn btn-primary btn-full" disabled={!text.trim() || saving}>
          {saving ? 'Saving…' : 'Log'}
        </button>
      </form>

      {preview && (
        <div className="quick-preview">
          <div className="quick-preview-title">“{preview.title}”</div>
          <div className="quick-preview-line">
            {formatClock(preview.startAt)}{preview.endAt ? ` – ${formatClock(preview.endAt)}` : ''}
          </div>
          {preview.tagPaths.map((path) => (
            <span key={`tag-${path}`} className="tag-chip">#{path}</span>
          ))}
          {preview.peopleNames.map((name) => (
            <span key={`person-${name}`} className="tag-chip" style={{ color: '#d4d4d8', background: '#3f3f46' }}>
              @{name}
            </span>
          ))}
        </div>
      )}

      {(tags.length > 0 || people.length > 0) && (
        <div className="quick-suggestions">
          {tags.slice(0, 6).map((tag) => (
            <button
              key={`tag-${tag.id}`}
              type="button"
              className="tag-suggestion-chip"
              onClick={() => insertTag(tag.path)}
            >
              #{tag.path}
            </button>
          ))}
          {people.slice(0, 5).map((person) => (
            <button
              key={`person-${person.id}`}
              type="button"
              className="tag-suggestion-chip"
              style={{ background: '#3f3f46', color: '#d4d4d8' }}
              onClick={() => insertPerson(person.displayName)}
            >
              @{person.displayName}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error-text">{error}</div>}
    </div>
  );
};

function formatClock(iso?: string): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
