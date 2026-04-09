import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ALL_TOOLS = [
  { to: '/quotation',      icon: '📄', title: 'New Quotation',       desc: 'Generate a customer quotation PDF' },
  { to: '/my-quotations',  icon: '🗂', title: 'My Quotations',       desc: 'View and re-download past quotations' },
  { to: '/quotation-log',  icon: '📊', title: 'Quotation Log',       desc: 'View all quotations across the organisation' },
  { to: '/employees',      icon: '👥', title: 'Employee Management', desc: 'Create, edit, and manage team accounts' },
  { to: '/access-rules',   icon: '🔐', title: 'Access Rules',        desc: 'Configure roles, brands, and tool access' },
  { to: '/catalog',        icon: '🚛', title: 'Vehicle Catalog',     desc: 'Manage the vehicle price catalog' },
  { to: '/bus-calculator', icon: '🚌', title: 'Bus Calculator',      desc: 'Build a bus price estimate step by step' },
  { to: '/tiv-forecast',  icon: '📈', title: 'TIV Forecast',        desc: 'Industry volume forecasting and segment analysis' },
]

const PERMISSION_LABEL = {
  admin:       'Admin',
  hr:          'HR',
  back_office: 'Back Office',
  sales:       'Sales',
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const { profile, canAccess } = useAuth()
  if (!profile) return null

  const tools = ALL_TOOLS.filter(t => canAccess(t.to))

  return (
    <div>
      <div className="page-header">
        <h1>{greeting()}, {profile.full_name.split(' ')[0]} 👋</h1>
        <p>
          {PERMISSION_LABEL[profile.role]}
          {profile.department ? ` · ${profile.department}` : ''}
          {profile.brand      ? ` · ${profile.brand.toUpperCase()}` : ''}
          {profile.location   ? ` · ${profile.location}` : ''}
        </p>
      </div>

      <div className="tool-grid">
        {tools.map(tool => (
          <Link key={tool.to} to={tool.to} className="tool-card">
            <div className="tool-card-icon">{tool.icon}</div>
            <h3>{tool.title}</h3>
            <p>{tool.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
