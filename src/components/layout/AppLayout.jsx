import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import BottomNav from './BottomNav'

export default function AppLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <TopBar />
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
