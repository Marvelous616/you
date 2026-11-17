import React, { useEffect, useState } from 'react';
import { Event, EventParticipant, EventTag, EventThing, TypeDefinition } from '@life-logger/domain';
import {
  deleteEvent,
  deleteEventThing,
  fetchTypeDefinitions,
  attachEventThing,
  getEvent,
  patchEvent,
  restoreEvent,
} from '../api.js';

interface EventDetailProps {
  eventId: string;
  isOpen: boolean;
  onClose: () => void;
  onEventUpdated: () => void;
}

export const EventDetail: React.FC<EventDetailProps> = ({
  eventId,
  isOpen,
  onClose,
  onEventUpdated,
}) => {
  const [event, setEvent] = useState<Event | null>(null);
  const [eventTags, setEventTags] = useState<EventTag[]>([]);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [things, setThings] = useState<EventThing[]>([]);
  const [typeDefinitions, setTypeDefinitions] = useState<TypeDefinition[]>([]);
  const [attachTypeDefId, setAttachTypeDefId] = useState<string>('');
  const [attachValue, setAttachValue] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEvent = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getEvent(eventId);
      setEvent(result.event);
      setEventTags(result.eventTags);
      setParticipants(result.participants);
      setThings(result.things ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load event');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvent();
  }, [eventId]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchTypeDefinitions()
      .then((defs) => {
        if (!cancelled) setTypeDefinitions(defs);
      })
      .catch(() => {
        /* Things rendering is best-effort; ignore fetch failures. */
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleSave = async () => {
    if (!event) return;
    setLoading(true);
    setError(null);
    try {
      await patchEvent(event.id, {
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt ?? null,
        notes: event.notes,
      });
      onEventUpdated();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save event');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    setLoading(true);
    setError(null);
    try {
      await deleteEvent(event.id);
      onEventUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!event) return;
    setLoading(true);
    setError(null);
    try {
      await restoreEvent(event.id);
      onEventUpdated();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore event');
    } finally {
      setLoading(false);
    }
  };

  const handleAttachThing = async () => {
    if (!event) return;
    if (!attachTypeDefId || !attachValue.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const parsed = JSON.parse(attachValue);
      await attachEventThing(event.id, {
        typeDefinitionId: attachTypeDefId,
        value: parsed,
      });
      setAttachTypeDefId('');
      setAttachValue('');
      setLoading(false);
      const result = await getEvent(event.id);
      setThings(result.things ?? []);
      onEventUpdated();
    } catch (err) {
      setLoading(false);
      setError(
        err instanceof Error ? err.message : 'Failed to attach thing (value must be valid JSON)',
      );
    }
  };

  const handleDeleteThing = async (thingId: string) => {
    setLoading(true);
    setError(null);
    try {
      const thing = things.find((t) => t.id === thingId);
      if (!thing) return;
      await deleteEventThing(eventId, thing.typeDefinitionId);
      setThings((prev) => prev.filter((t) => t.id !== thingId));
      onEventUpdated();
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Failed to delete thing');
    }
  };

  const tagPaths = eventTags.map((et) => et.tagId);

  if (!isOpen) return null;

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
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '16px',
          padding: '28px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#f8fafc' }}>
            {event?.isDeleted ? 'Event (deleted)' : 'Event'}
          </h2>
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

        {event ? (
          <>
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: '#94a3b8',
                }}
              >
                Title
              </label>
              <input
                type="text"
                value={event.title}
                onChange={(e) => setEvent({ ...event, title: e.target.value })}
                disabled={!editing || loading || event.isDeleted}
                style={{
                  width: '100%',
                  backgroundColor: editing || event.isDeleted ? '#334155' : '#0f172a',
                  border: `1px solid ${editing ? '#818cf8' : '#334155'}`,
                  borderRadius: '8px',
                  color: '#f8fafc',
                  padding: '11px 14px',
                  fontSize: '0.95rem',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '16px',
                marginBottom: '20px',
              }}
            >
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                  }}
                >
                  Start time
                </label>
                <input
                  type="datetime-local"
                  value={event.startAt ? new Date(event.startAt).toISOString().slice(0, 16) : ''}
                  onChange={(e) =>
                    setEvent({ ...event, startAt: `${e.target.value}:00.000Z` })}
                  disabled={!editing || loading || event.isDeleted}
                  style={{
                    width: '100%',
                    backgroundColor: editing || event.isDeleted ? '#334155' : '#0f172a',
                    border: `1px solid ${editing ? '#818cf8' : '#334155'}`,
                    borderRadius: '8px',
                    color: '#f8fafc',
                    padding: '11px 14px',
                    fontSize: '0.95rem',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                  }}
                >
                  End time
                </label>
                <input
                  type="datetime-local"
                  value={event.endAt ? new Date(event.endAt).toISOString().slice(0, 16) : ''}
                  onChange={(e) =>
                    setEvent({
                      ...event,
                      endAt: e.target.value ? `${e.target.value}:00.000Z` : undefined,
                    })
                  }
                  disabled={!editing || loading || event.isDeleted}
                  style={{
                    width: '100%',
                    backgroundColor: editing || event.isDeleted ? '#334155' : '#0f172a',
                    border: `1px solid ${editing ? '#818cf8' : '#334155'}`,
                    borderRadius: '8px',
                    color: '#f8fafc',
                    padding: '11px 14px',
                    fontSize: '0.95rem',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: '#94a3b8',
                }}
              >
                Notes
              </label>
              <textarea
                value={event.notes ?? ''}
                onChange={(e) => setEvent({ ...event, notes: e.target.value })}
                disabled={!editing || loading || event.isDeleted}
                rows={4}
                style={{
                  width: '100%',
                  backgroundColor: editing || event.isDeleted ? '#334155' : '#0f172a',
                  border: `1px solid ${editing ? '#818cf8' : '#334155'}`,
                  borderRadius: '8px',
                  color: '#f8fafc',
                  padding: '12px',
                  fontSize: '0.9rem',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: '#94a3b8',
                }}
              >
                Tags ({tagPaths.length})
              </label>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                {tagPaths.map((path) => (
                  <span
                    key={path}
                    style={{
                      backgroundColor: '#334155',
                      color: '#cbd5e1',
                      borderRadius: '999px',
                      padding: '2px 8px',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                    }}
                  >
                    #{path}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: '#94a3b8',
                }}
              >
                People ({participants.length})
              </label>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                {participants.map((p) => (
                  <span
                    key={p.personId}
                    style={{
                      backgroundColor: '#3f3f46',
                      color: '#d4d4d8',
                      borderRadius: '999px',
                      padding: '2px 8px',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                    }}
                  >
                    Person {p.personId.slice(-6)}
                  </span>
                ))}
              </div>
            </div>

            {things.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                  }}
                >
                  Things ({things.length})
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {things.map((thing) => {
                    const typeDef = typeDefinitions.find(
                      (def) => def.id === thing.typeDefinitionId
                    );
                    const entries = Object.entries(thing.value ?? {});
                    return (
                      <div
                        key={thing.id}
                        style={{
                          backgroundColor: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          padding: '10px 12px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            color: '#c4b5fd',
                            marginBottom: entries.length > 0 ? '6px' : '0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div>
                            {typeDef?.name ?? thing.typeDefinitionId}
                            {typeDef?.fieldType ? ` (${typeDef.fieldType})` : ''}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteThing(thing.id)}
                            disabled={loading}
                            style={{
                              backgroundColor: 'transparent',
                              color: '#7f1d1d',
                              border: '1px solid #7f1d1d',
                              borderRadius: '6px',
                              padding: '2px 8px',
                              fontSize: '0.7rem',
                              cursor: 'pointer',
                              marginLeft: '8px',
                            }}
                          >
                            Delete
                          </button>
                        </div>
                        {entries.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {entries.map(([key, value]) => (
                              <span
                                key={key}
                                style={{
                                  backgroundColor: '#334155',
                                  color: '#e2e8f0',
                                  borderRadius: '999px',
                                  padding: '2px 8px',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                }}
                              >
                                {key}: {String(value)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                            No value recorded
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
      {
        <div style={{ marginBottom: '20px' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '0.7rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#94a3b8',
            }}
          >
            Attach thing
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <select
              value={attachTypeDefId}
              onChange={(e) => setAttachTypeDefId(e.target.value)}
              disabled={loading}
              style={{
                flex: 1,
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#f8fafc',
                padding: '8px 10px',
                fontSize: '0.82rem',
                fontFamily: 'inherit',
              }}
            >
              <option value="">Choose a type</option>
              {typeDefinitions.map((td) => (
                <option key={td.id} value={td.id}>
                  {td.name} ({td.fieldType})
                </option>
              ))}
            </select>
            <input
              type="text"
              value={attachValue}
              onChange={(e) => setAttachValue(e.target.value)}
              placeholder='{"hours": 7.5}'
              disabled={loading || !attachTypeDefId}
              style={{
                flex: 1,
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#f8fafc',
                padding: '8px 10px',
                fontSize: '0.82rem',
                fontFamily: 'inherit',
              }}
            />
            <button
              type="button"
              onClick={handleAttachThing}
              disabled={loading || !attachTypeDefId || !attachValue.trim()}
              style={{
                backgroundColor: '#818cf8',
                color: '#1e1b4b',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontWeight: 700,
                fontSize: '0.72rem',
                cursor: 'pointer',
              }}
            >
              Attach
            </button>
          </div>
          <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '0.72rem' }}>
            Value must be valid JSON, e.g. <code style={{ color: '#818cf8' }}>hours: 7.5</code>
          </p>
        </div>
      }


            <div
              style={{
                display: 'flex',
                gap: '10px',
                marginTop: '24px',
                justifyContent: 'flex-end',
              }}
            >
              {!editing && (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    disabled={loading || event.isDeleted}
                    style={{
                      backgroundColor: '#818cf8',
                      color: '#1e1b4b',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '10px 20px',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={loading || event.isDeleted}
                    style={{
                      backgroundColor: 'transparent',
                      color: '#f87171',
                      border: '1px solid #7f1d1d',
                      borderRadius: '8px',
                      padding: '10px 20px',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
              {editing && (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    disabled={loading}
                    style={{
                      backgroundColor: '#334155',
                      color: '#cbd5e1',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '10px 20px',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={loading}
                    style={{
                      backgroundColor: '#818cf8',
                      color: '#1e1b4b',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '10px 20px',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    {loading ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
            </div>

            {event.isDeleted && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  backgroundColor: '#450a0a',
                  borderRadius: '8px',
                  border: '1px solid #7f1d1d',
                }}
              >
                <p style={{ margin: '0 0 10px', color: '#f87171', fontSize: '0.85rem' }}>
                  This event has been deleted.
                </p>
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={loading}
                  style={{
                    backgroundColor: '#34d399',
                    color: '#064e3b',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  {loading ? 'Restoring…' : 'Restore'}
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            {loading ? 'Loading event…' : 'Event not found'}
          </div>
        )}
      </div>
    </div>
  );
};
