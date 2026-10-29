import { useCallback, useEffect, useRef, useState } from 'react';
import { workoutToText } from '../lib/workout';
import './CoachChat.css';

const SUGGESTIONS = [
  'Why these exercises?',
  'Swap the first lift for something else',
  'How do I warm up for this?',
  'How heavy should I go?',
];

/**
 * Talks to /api/chat, a Vercel function that holds the API key server-side.
 * Running locally with `npm start` there is no function, so the fetch 404s and
 * the panel says so rather than looking broken.
 */
const CoachChat = ({ workout }) => {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const send = useCallback(
    async (text) => {
      const content = (text || '').trim();
      if (!content || status === 'sending') return;

      const next = [...messages, { role: 'user', content }];
      setMessages(next);
      setDraft('');
      setStatus('sending');
      setError('');

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: next,
            workout: workout ? workoutToText(workout) : '',
          }),
        });

        // A dev server answers an unknown route with HTML, not JSON, and not
        // always with a 404. Check the content type rather than the status.
        const isJson = (res.headers.get('content-type') || '').includes('application/json');
        if (res.status === 404 || !isJson) {
          throw new Error(
            'The coach only runs on the deployed site, not on the local dev server.'
          );
        }

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error((data && data.error) || `The coach returned ${res.status}.`);
        }
        if (!data || typeof data.reply !== 'string') {
          throw new Error('The coach returned an unexpected response.');
        }

        setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
        setStatus('idle');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    },
    [messages, status, workout]
  );

  return (
    <section className="coach" aria-label="Training coach">
      <header className="coach__head">
        <h3 className="coach__title">Ask the coach</h3>
        <p className="coach__sub">
          Questions about this session. Not medical advice.
        </p>
      </header>

      <div className="coach__log" ref={listRef} role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="coach__suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="coach__suggestion" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <p key={i} className={`coach__msg coach__msg--${m.role}`}>
            {m.content}
          </p>
        ))}

        {status === 'sending' && (
          <p className="coach__msg coach__msg--assistant coach__msg--pending">Thinking…</p>
        )}
        {status === 'error' && (
          <p className="coach__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <form
        className="coach__form"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label className="visually-hidden" htmlFor="coach-input">
          Message the coach
        </label>
        <input
          id="coach-input"
          className="coach__input"
          value={draft}
          placeholder="Ask about this workout…"
          maxLength={1500}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="coach__send" disabled={!draft.trim() || status === 'sending'}>
          Send
        </button>
      </form>
    </section>
  );
};

export default CoachChat;
