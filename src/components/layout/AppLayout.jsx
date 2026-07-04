import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import MobileDrawer from './MobileDrawer'
import BottomNav from './BottomNav'

export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
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
