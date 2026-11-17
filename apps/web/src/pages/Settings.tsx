import React, { useCallback, useEffect, useState } from 'react';
import {
  archivePerson,
  archiveTag,
  createPerson,
  createTag,
  createTemplate,
  createTypeDefinition,
  deleteTypeDefinition,
  fetchPeople,
  fetchTags,
  fetchTemplates,
  fetchTypeDefinitions,
} from '../api.js';
import { Person, Tag, Template, TypeDefinition } from '@life-logger/domain';

interface SettingsProps {
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

type Theme = 'light' | 'dark';

const TAB_LABELS = ['General', 'Tags', 'People', 'Templates'] as const;

export const Settings: React.FC<SettingsProps> = ({
  onClose,
  theme,
  onThemeChange,
}) => {
  const [activeTab, setActiveTab] = useState<'General' | 'Tags' | 'People' | 'Templates'>('General');
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [typeDefinitions, setTypeDefinitions] = useState<TypeDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [tagList, peopleList, templateList, typeDefList] = await Promise.all([
        fetchTags(),
        fetchPeople(),
        fetchTemplates(),
        fetchTypeDefinitions(),
      ]);
      setTags(tagList);
      setPeople(peopleList);
      setTemplates(templateList);
      setTypeDefinitions(typeDefList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleTagCreate = async (name: string) => {
    try {
      const tag = await createTag({ name });
      setTags((prev) => [...prev, tag]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tag');
    }
  };

  const handleTagArchive = async (tagId: string) => {
    try {
      await archiveTag(tagId);
      setTags((prev) => prev.map((t) => (t.id === tagId ? { ...t, archivedAt: new Date().toISOString() } : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive tag');
    }
  };

  const handlePersonCreate = async (displayName: string) => {
    try {
      const person = await createPerson({ displayName });
      setPeople((prev) => [...prev, person]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create person');
    }
  };

  const handlePersonArchive = async (personId: string) => {
    try {
      await archivePerson(personId);
      setPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, archivedAt: new Date().toISOString() } : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive person');
    }
  };

  const handleTemplateCreate = async (name: string, title: string) => {
    try {
      const template = await createTemplate({ name, title });
      setTemplates((prev) => [...prev, template]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create template');
    }
  };

  const handleTypeDefinitionCreate = async (name: string, fieldType: string) => {
    try {
      const typeDef = await createTypeDefinition({ name, fieldType });
      setTypeDefinitions((prev) => [...prev, typeDef]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create type definition');
    }
  };

  const handleTypeDefinitionDelete = async (id: string) => {
    try {
      await deleteTypeDefinition(id);
      setTypeDefinitions((prev) => prev.filter((td) => td.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete type definition');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(2, 6, 23, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '16px',
          padding: '28px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#f8fafc' }}>Settings</h2>
          <button
            type="button"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.6rem',
              lineHeight: 1,
              cursor: 'pointer',
              padding: 0,
            }}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: '#450a0a',
              border: '1px solid #7f1d1d',
              color: '#f87171',
              padding: '10px 14px',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '0.85rem',
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '24px',
            borderBottom: '1px solid #334155',
            paddingBottom: '12px',
          }}
        >
          {TAB_LABELS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? '#1e293b' : 'transparent',
                color: activeTab === tab ? '#f8fafc' : '#94a3b8',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #818cf8' : 'none',
                padding: '8px 16px',
                fontSize: '0.82rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'General' && (
          <div>
            <h3 style={{ margin: '0 0 16px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#94a3b8' }}>General</h3>

            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #334155' }}>
                <span style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>Server</span>
                <span style={{ color: '#818cf8', fontSize: '0.85rem', fontWeight: 600 }}>zeserver</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>
                <span style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>Schema version</span>
                <span style={{ color: '#cbd5e1', fontSize: '0.85rem', fontFamily: 'monospace' }}>7</span>
              </div>
            </div>

            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#94a3b8' }}>Appearance</h3>
              <div style={{ display: 'flex', gap: '12px' }}>
                {(['light', 'dark'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={theme === option}
                    onClick={() => onThemeChange(option)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      border: `1px solid ${theme === option ? '#818cf8' : '#334155'}`,
                      borderRadius: '8px',
                      backgroundColor: theme === option ? '#374151' : '#0f172a',
                      color: theme === option ? '#f8fafc' : '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    {option === 'light' ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>☀</span>
                    ) : (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>☾</span>
                    )}
                    <span>{option === 'light' ? 'Light' : 'Dark'}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#94a3b8' }}>Typography</h3>
              <div style={{ display: 'flex', gap: '20px' }}>
                <div>
                  <span className="type-sample" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#cbd5e1', fontSize: '0.75rem', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>Aa</span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.85rem' }}>JetBrains Mono NL</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Primary face · headings, journals, interface copy</div>
                  </div>
                </div>
                <div>
                  <span className="type-sample" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#cbd5e1', fontSize: '0.75rem', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>&lt;/&gt;</span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.85rem' }}>Nerd Font Mono</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Expanded glyph set · symbols stay aligned to the grid</div>
                  </div>
                </div>
                <div>
                  <span className="type-sample" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#cbd5e1', fontSize: '0.75rem', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>08</span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.85rem' }}>Monospaced rhythm</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Data face · time, tags, timeline details</div>
                  </div>
                </div>
              </div>
              <p style={{ margin: '12px 0 0', color: '#94a3b8', fontSize: '0.72rem', fontStyle: 'italic' }}>Font: JetBrainsMonoNL Nerd Font Mono (loaded from /fonts). Changes apply instantly.</p>
            </div>

            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '20px', marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#94a3b8' }}>Things</h3>
                <button
                  type="button"
                  style={{
                    backgroundColor: '#818cf8',
                    color: '#1e1b4b',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    const name = window.prompt('Type definition name:');
                    const fieldType = window.prompt('Field type (text, number, date, select):');
                    if (name && fieldType) handleTypeDefinitionCreate(name, fieldType);
                  }}
                >
                  Create type definition
                </button>
              </div>
              {typeDefinitions.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: '0.84rem', fontStyle: 'italic' }}>No type definitions yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {typeDefinitions.map((td) => (
                    <li
                      key={td.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        marginBottom: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: '#f8fafc', fontSize: '0.9rem', fontWeight: 600 }}>{td.name}</span>
                        <span style={{ color: '#94a3b8', fontSize: '0.7rem', fontFamily: 'monospace' }}>{td.fieldType}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTypeDefinitionDelete(td.id)}
                        style={{
                          backgroundColor: 'transparent',
                          color: '#7f1d1d',
                          border: '1px solid #7f1d1d',
                          borderRadius: '6px',
                          padding: '6px 12px',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeTab === 'Tags' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#94a3b8' }}>Tags</h3>
              <button
                type="button"
                style={{
                  backgroundColor: '#818cf8',
                  color: '#1e1b4b',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 16px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const name = window.prompt('Tag name:');
                  if (name) handleTagCreate(name);
                }}
              >
                Create tag
              </button>
            </div>
            {tags.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.84rem', fontStyle: 'italic' }}>No tags yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {tags
                  .filter((t) => !t.archivedAt)
                  .map((tag) => (
                    <li
                      key={tag.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        backgroundColor: '#1e293b',
                        borderRadius: '8px',
                        marginBottom: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: '#f8fafc', fontSize: '0.9rem', fontWeight: 600 }}>{tag.name}</span>
                        <span style={{ color: '#94a3b8', fontSize: '0.7rem', fontFamily: 'monospace' }}>{tag.path}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTagArchive(tag.id)}
                        style={{
                          backgroundColor: 'transparent',
                          color: '#7f1d1d',
                          border: '1px solid #7f1d1d',
                          borderRadius: '6px',
                          padding: '6px 12px',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                        }}
                      >
                        Archive
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'People' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#94a3b8' }}>People</h3>
              <button
                type="button"
                style={{
                  backgroundColor: '#818cf8',
                  color: '#1e1b4b',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 16px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const name = window.prompt('Person name:');
                  if (name) handlePersonCreate(name);
                }}
              >
                Create person
              </button>
            </div>
            {people.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.84rem', fontStyle: 'italic' }}>No people yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {people
                  .filter((p) => !p.archivedAt)
                  .map((person) => (
                    <li
                      key={person.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        backgroundColor: '#1e293b',
                        borderRadius: '8px',
                        marginBottom: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: '#f8fafc', fontSize: '0.9rem', fontWeight: 600 }}>{person.displayName}</span>
                        {person.aliases.length > 0 && (
                          <span style={{ color: '#818cf8', fontSize: '0.7rem' }}>(aliases: {person.aliases.join(', ')})</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePersonArchive(person.id)}
                        style={{
                          backgroundColor: 'transparent',
                          color: '#7f1d1d',
                          border: '1px solid #7f1d1d',
                          borderRadius: '6px',
                          padding: '6px 12px',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                        }}
                      >
                        Archive
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'Templates' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#94a3b8' }}>Templates</h3>
              <button
                type="button"
                style={{
                  backgroundColor: '#818cf8',
                  color: '#1e1b4b',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 16px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const name = window.prompt('Template name:');
                  const title = window.prompt('Template title:');
                  if (name && title) handleTemplateCreate(name, title);
                }}
              >
                Create template
              </button>
            </div>
            {templates.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.84rem', fontStyle: 'italic' }}>No templates yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {templates
                  .filter((t) => !t.isDeleted)
                  .map((template) => (
                    <li
                      key={template.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        backgroundColor: '#1e293b',
                        borderRadius: '8px',
                        marginBottom: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: '#f8fafc', fontSize: '0.9rem', fontWeight: 600 }}>{template.title}</span>
                        <span style={{ color: '#94a3b8', fontSize: '0.7rem', fontFamily: 'monospace' }}>{template.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          // Edit template - placeholder
                        }}
                        style={{
                          backgroundColor: 'transparent',
                          color: '#7f1d1d',
                          border: '1px solid #7f1d1d',
                          borderRadius: '6px',
                          padding: '6px 12px',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                        }}
                      >
                        Archive
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
