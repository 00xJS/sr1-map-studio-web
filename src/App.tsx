import { lazy, Suspense, type ReactNode } from 'react'
import { NavLink, Link, Route, Routes } from 'react-router-dom'
import { Dialogs, ErrorBoundary, Toasts, Avatar } from './ui'
import { accountsEnabled, hubEnabled, useUser } from './lib/backend'
import Home from './pages/Home'
import Setup from './pages/Setup'
import About from './pages/About'

const Editor = lazy(() => import('./editor/EditorPage'))
const Hub = lazy(() => import('./pages/Hub'))
const HubMap = lazy(() => import('./pages/HubMap'))
const Account = lazy(() => import('./pages/Account'))
const Catalog = lazy(() => import('./pages/Catalog'))

export function Shell({ children }: { children: ReactNode }) {
  const user = useUser()
  return (
    <div className="app">
      <header className="topnav">
        <Link to="/" className="brand"><b>SR1 / MAP STUDIO</b><span>SAINTS ROW 1</span></Link>
        <nav>
          <NavLink to="/" end>My maps</NavLink>
          <NavLink to="/maps">Map catalog</NavLink>
          {hubEnabled && <NavLink to="/hub">Hub</NavLink>}
          <NavLink to="/setup">Data pack</NavLink>
          <NavLink to="/about">About</NavLink>
        </nav>
        {accountsEnabled && (user
          ? <Link to="/account" className="row" title="Account"><Avatar name={user.name} url={user.avatar_url} /><span className="muted">{user.name}</span></Link>
          : <Link to="/account" className="btn">Sign in</Link>)}
      </header>
      {children}
    </div>
  )
}

const HubOff = () => (
  <div className="page page-narrow">
    <h1>Hub</h1>
    <p className="muted">Public map sharing is turned off on this site. To share a map, use <b>Backup</b> on <Link to="/">My maps</Link> and send the <code>.sr1map.zip</code>; the other person opens it with <b>Import project…</b>.</p>
  </div>
)

const Loading = () => <div className="page"><p className="muted">Loading…</p></div>

export default function App() {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/editor/:id" element={<ErrorBoundary label="The editor hit an error"><Editor /></ErrorBoundary>} />
          <Route path="/" element={<Shell><Home /></Shell>} />
          <Route path="/maps" element={<Shell><Catalog /></Shell>} />
          <Route path="/setup" element={<Shell><Setup /></Shell>} />
          <Route path="/about" element={<Shell><About /></Shell>} />
          <Route path="/hub" element={<Shell>{hubEnabled ? <Hub /> : <HubOff />}</Shell>} />
          <Route path="/hub/:id" element={<Shell>{hubEnabled ? <HubMap /> : <HubOff />}</Shell>} />
          <Route path="/account" element={<Shell><Account /></Shell>} />
          <Route path="*" element={<Shell><div className="page"><h1>Page not found</h1><Link to="/">Back to my maps</Link></div></Shell>} />
        </Routes>
      </Suspense>
      <Dialogs />
      <Toasts />
    </>
  )
}
