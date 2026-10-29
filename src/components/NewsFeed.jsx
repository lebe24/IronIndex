import { useCallback, useEffect, useMemo, useState } from 'react';
import StateBlock from './StateBlock';
import './NewsFeed.css';

const ALL = 'all';

function relativeDay(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const NewsFeed = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [tag, setTag] = useState(ALL);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/news', { signal: controller.signal })
      .then(async (res) => {
        /* The dev server has no functions, and its history fallback answers an
           unknown GET with index.html and a 200 - not a 404. Trusting the
           status here meant parsing HTML as a feed. Check the content type. */
        const isJson = (res.headers.get('content-type') || '').includes('application/json');
        if (res.status === 404 || !isJson) {
          throw new Error(
            'The feed only runs on the deployed site, not on the local dev server.'
          );
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error((data && data.error) || `The feed returned ${res.status}.`);
        }
        if (!data || !Array.isArray(data.items)) {
          throw new Error('The feed returned an unexpected response.');
        }
        return data;
      })
      .then((data) => setState({ status: 'ready', data, error: '' }))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setState({ status: 'error', data: null, error: err.message });
      });
    return () => controller.abort();
  }, []);

  const items = useMemo(
    () => (Array.isArray(state.data?.items) ? state.data.items : []),
    [state.data]
  );

  const tags = useMemo(() => [...new Set(items.map((i) => i.tag))].sort(), [items]);

  const visible = useMemo(
    () => (tag === ALL ? items : items.filter((i) => i.tag === tag)),
    [items, tag]
  );

  const pick = useCallback((t) => setTag(t), []);

  if (state.status === 'error') {
    return (
      <StateBlock tone="alert" code="Error 02-A" title="Wire down">
        {state.error}
      </StateBlock>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="news">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="news__row news__row--ghost skeleton" key={`ghost-${i}`} />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="news__filters" role="group" aria-label="Filter by topic">
        <button
          type="button"
          className={`news__chip${tag === ALL ? ' is-on' : ''}`}
          aria-pressed={tag === ALL}
          onClick={() => pick(ALL)}
        >
          All <span>{items.length}</span>
        </button>
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            className={`news__chip${tag === t ? ' is-on' : ''}`}
            aria-pressed={tag === t}
            onClick={() => pick(t)}
          >
            {t} <span>{items.filter((i) => i.tag === t).length}</span>
          </button>
        ))}
      </div>

      <ol className="news">
        {visible.map((item, i) => (
          <li className="news__row" key={item.id}>
            <span className="news__num">{String(i + 1).padStart(2, '0')}</span>
            <div className="news__body">
              <p className="news__meta">
                <span className="news__source">{item.source}</span>
                <span className="news__tag">{item.tag}</span>
                <time dateTime={item.publishedAt || undefined}>
                  {relativeDay(item.publishedAt)}
                </time>
              </p>
              <h3 className="news__title">
                <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                  {item.title}
                  <span className="news__out" aria-hidden="true">
                    ↗
                  </span>
                </a>
              </h3>
              {item.summary && <p className="news__summary">{item.summary}</p>}
            </div>
          </li>
        ))}
      </ol>

      <p className="news__foot">
        Headlines and publishers' own summaries, linked to the source. Updated
        hourly. Last pulled {relativeDay(state.data.fetchedAt).toLowerCase()}.
      </p>
    </>
  );
};

export default NewsFeed;
