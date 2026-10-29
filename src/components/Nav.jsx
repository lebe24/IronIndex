import { useEffect, useState } from 'react';
import RouteLink from './RouteLink';
import { usePath } from '../lib/router';
import './Nav.css';

/* Hrefs are absolute rather than bare hashes so every link works from either
   page: from /build, "#muscles" would do nothing. */
const LINKS = [
  { label: 'Index', to: '/#target' },
  { label: 'Muscles', to: '/#muscles' },
  { label: 'Archive', to: '/#results' },
  { label: 'Build', to: '/build' },
  { label: 'Dispatch', to: '/news' },
  { label: 'Colophon', to: '/#colophon' },
];

const Nav = () => {
  const [lifted, setLifted] = useState(false);
  const path = usePath();

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`nav${lifted ? ' nav--lifted' : ''}`}>
      <div className="nav__inner shell">
        <RouteLink className="mark" to="/#top">
          <span className="mark__glyph" aria-hidden="true">
            II
          </span>
          <span className="mark__words">
            <span className="mark__name">Iron Index</span>
            <span className="mark__sub">Training archive</span>
          </span>
        </RouteLink>

        <nav className="nav__links" aria-label="Sections">
          {LINKS.map((link) => (
            <RouteLink
              key={link.to}
              className={`nav__link${path === link.to ? ' is-here' : ''}`}
              to={link.to}
              aria-current={path === link.to ? 'page' : undefined}
            >
              {link.label}
            </RouteLink>
          ))}
        </nav>

        <RouteLink className="btn btn--solid nav__cta" to="/build">
          <span>Build a session</span>
        </RouteLink>
      </div>
    </header>
  );
};

export default Nav;
