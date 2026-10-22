import { lazy, Suspense, type ReactNode } from 'react'
import { NavLink, Link, Route, Routes } from 'react-router-dom'
import { Dialogs, ErrorBoundary, Toasts, Avatar } from './ui'
import { accountsEnabled, useUser } from './lib/backend'
import Home from './pages/Home'
import Setup from './pages/Setup'
import About from './pages/About'

const Editor = lazy(() => import('./editor/EditorPage'))
const Hub = lazy(() => import('./pages/Hub'))
const HubMap = lazy(() => import('./pages/HubMap'))
const Account = lazy(() => import('./pages/Account'))

export function Shell({ children }: { children: ReactNode }) {
  const user = useUser()
  return (
    <div className="app">
      <header className="topnav">
        <Link to="/" className="brand"><b>SR1 / MAP STUDIO</b><span>SAINTS ROW 1</span></Link>
        <nav>
          <NavLink to="/" end>My maps</NavLink>
          {accountsEnabled && <NavLink to="/hub">Hub</NavLink>}
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

const Loading = () => <div className="page"><p className="muted">Loading…</p></div>

export default function App() {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/editor/:id" element={<ErrorBoundary label="The editor hit an error"><Editor /></ErrorBoundary>} />
          <Route path="/" element={<Shell><Home /></Shell>} />
          <Route path="/setup" element={<Shell><Setup /></Shell>} />
          <Route path="/about" element={<Shell><About /></Shell>} />
          <Route path="/hub" element={<Shell><Hub /></Shell>} />
          <Route path="/hub/:id" element={<Shell><HubMap /></Shell>} />
          <Route path="/account" element={<Shell><Account /></Shell>} />
          <Route path="*" element={<Shell><div className="page"><h1>Page not found</h1><Link to="/">Back to my maps</Link></div></Shell>} />
        </Routes>
      </Suspense>
      <Dialogs />
      <Toasts />
    </>
  )
}
