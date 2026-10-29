import Nav from './components/Nav';
import Footer from './components/Footer';
import Home from './pages/Home';
import Build from './pages/Build';
import News from './pages/News';
import { usePath } from './lib/router';

export default function App() {
  const path = usePath();

  return (
    <div className="grain">
      <Nav />
      {path === '/build' && <Build />}
      {path === '/news' && <News />}
      {path !== '/build' && path !== '/news' && <Home />}
      <Footer />
    </div>
  );
}
