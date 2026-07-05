import { Outlet, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import MobileDrawer from './MobileDrawer'
import BottomNav from './BottomNav'

export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Close the drawer on any route change — covers browser back/forward (a link
  // tap already closes it, but a history navigation isn't a click).
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  return (
    <div className="app-layout">
      <Sidebar />
      <TopBar onMenu={() => setDrawerOpen(true)} />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
