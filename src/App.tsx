import { useIsAdmin } from './lib/admin'
import { lazy, Suspense, type ReactNode } from 'react'
import { NavLink, Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { Dialogs, ErrorBoundary, FileButton, Toasts, Avatar, Kewizzle, ZeroXJS, toastError } from './ui'
import { accountsEnabled, hubEnabled, useUser } from './lib/backend'
import { openMapFiles, useOpenMap } from './lib/mapFolder/store'
import Home from './pages/Home'
import Setup from './pages/Setup'
import About from './pages/About'

const Editor = lazy(() => import('./editor/EditorPage'))
const Hub = lazy(() => import('./pages/Hub'))
const HubMap = lazy(() => import('./pages/HubMap'))
const Account = lazy(() => import('./pages/Account'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Play = lazy(() => import('./play/PlayPage'))
const City = lazy(() => import('./pages/City'))
const GamePiecesCheck = lazy(() => import('./pages/GamePiecesCheck'))
const AdminLabels = lazy(() => import('./pages/AdminLabels'))
const OpenMapHost = lazy(() => import('./pages/OpenMapDialog'))
const Proven = lazy(() => import('./pages/Proven'))
// Development only: checking the game library's names and roles against pictures.
const GameLabels = import.meta.env.DEV ? lazy(() => import('./pages/GameLabels')) : null

/** The "Open a game map" dialog, loaded when a map folder is first opened. */
function OpenMap() {
  const open = useOpenMap((s) => !!s.sources)
  return open ? <Suspense fallback={null}><OpenMapHost /></Suspense> : null
}

export function Shell({ children }: { children: ReactNode }) {
  const user = useUser()
  const admin = useIsAdmin()
  return (
    <div className="app">
      <header className="topnav">
        <Link to="/" className="brand"><b>SR1 / MAP STUDIO</b><span>SAINTS ROW 1</span></Link>
        <nav>
          <NavLink to="/" end>My maps</NavLink>
          <NavLink to="/maps">Map catalog</NavLink>
          <NavLink to="/city" title="The real city from your own game: start a map from it, or scan it for holes">Stilwater</NavLink>
          {hubEnabled && <NavLink to="/showcase">Showcase</NavLink>}
          <NavLink to="/setup">Data pack</NavLink>
          <NavLink to="/about">About</NavLink>
          {admin && <NavLink to="/admin/labels" title="Your labelling desk (only you see this)">Labels</NavLink>}
        </nav>
        <FileButton className="sm" directory onFiles={(f) => openMapFiles(f).catch(toastError)}
          title="Open a finished Saints Row map folder (from SaintsReborn/dist/maps) to edit it, or to add the game's sky to it. You can also drop a map folder or zip on My maps.">Open a game map…</FileButton>
        {accountsEnabled && (user
          ? <Link to="/account" className="row" title="Account"><Avatar name={user.name} url={user.avatar_url} /><span className="muted">{user.name}</span></Link>
          : <Link to="/account" className="btn">Sign in</Link>)}
      </header>
      {children}
      <footer className="site-footer">
        <span>Free and open source. Original SR1 Map Studio by <Kewizzle /> · Rebuilt and expanded for the web by <ZeroXJS /></span>
        <a href="https://github.com/00xJS/sr1-map-studio-web" target="_blank" rel="noreferrer">Source on GitHub</a>
      </footer>
    </div>
  )
}

const HubOff = () => (
  <div className="page page-narrow">
    <h1>Showcase</h1>
    <p className="muted">The public Showcase is turned off on this site. To share a map, use <b>Backup</b> on <Link to="/">My maps</Link> and send the <code>.sr1map.zip</code>; the other person opens it with <b>Import project…</b>.</p>
  </div>
)

/** Old /hub links. */
const ToShowcase = () => { const { id } = useParams(); return <Navigate to={id ? `/showcase/${id}` : '/showcase'} replace /> }

const Loading = () => <div className="page"><p className="muted">Loading…</p></div>

export default function App() {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/editor/:id" element={<ErrorBoundary label="The editor hit an error"><Editor /></ErrorBoundary>} />
          <Route path="/play" element={<ErrorBoundary label="Play mode hit an error"><Play /></ErrorBoundary>} />
          <Route path="/play/s/:token" element={<ErrorBoundary label="Play mode hit an error"><Play /></ErrorBoundary>} />
          <Route path="/play/:id" element={<ErrorBoundary label="Play mode hit an error"><Play /></ErrorBoundary>} />
          <Route path="/" element={<Shell><Home /></Shell>} />
          <Route path="/maps" element={<Shell><Catalog /></Shell>} />
          <Route path="/city" element={<Shell><ErrorBoundary label="The city page hit an error"><Suspense fallback={null}><City /></Suspense></ErrorBoundary></Shell>} />
          <Route path="/game-pieces" element={<Shell><ErrorBoundary label="The game pieces page hit an error"><Suspense fallback={null}><GamePiecesCheck /></Suspense></ErrorBoundary></Shell>} />
          <Route path="/admin/labels" element={<Shell><ErrorBoundary label="The labelling desk hit an error"><Suspense fallback={null}><AdminLabels /></Suspense></ErrorBoundary></Shell>} />
          <Route path="/setup" element={<Shell><Setup /></Shell>} />
          <Route path="/about" element={<Shell><About /></Shell>} />
          <Route path="/proven" element={<Shell><ErrorBoundary label="The tried-in-game page hit an error"><Suspense fallback={null}><Proven /></Suspense></ErrorBoundary></Shell>} />
          <Route path="/showcase" element={<Shell>{hubEnabled ? <Hub /> : <HubOff />}</Shell>} />
          <Route path="/showcase/:id" element={<Shell>{hubEnabled ? <HubMap /> : <HubOff />}</Shell>} />
          <Route path="/hub" element={<ToShowcase />} />
          <Route path="/hub/:id" element={<ToShowcase />} />
          {GameLabels && <Route path="/dev/game-labels" element={<GameLabels />} />}
          <Route path="/account" element={<Shell><Account /></Shell>} />
          <Route path="*" element={<Shell><div className="page"><h1>Page not found</h1><Link to="/">Back to my maps</Link></div></Shell>} />
        </Routes>
      </Suspense>
      <OpenMap />
      <Dialogs />
      <Toasts />
    </>
  )
}
