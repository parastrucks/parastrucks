import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ROLE_TOOLS = {
  sales: [
    { to: '/quotation',     icon: '📄', title: 'New Quotation',       desc: 'Generate a customer quotation PDF' },
    { to: '/my-quotations', icon: '🗂', title: 'My Quotations',       desc: 'View and re-download past quotations' },
  ],
  back_office: [
    { to: '/quotation',     icon: '📄', title: 'New Quotation',       desc: 'Generate or edit a customer quotation' },
    { to: '/my-quotations', icon: '🗂', title: 'My Quotations',       desc: 'View and re-download past quotations' },
    { to: '/catalog',       icon: '🚛', title: 'Vehicle Catalog',     desc: 'Manage the AL vehicle price catalog' },
  ],
  hr: [
    { to: '/employees',     icon: '👥', title: 'Employee Management', desc: 'Create, edit, and manage team accounts' },
  ],
  admin: [
    { to: '/quotation',     icon: '📄', title: 'New Quotation',       desc: 'Generate a customer quotation PDF' },
    { to: '/quotation-log', icon: '📊', title: 'Quotation Log',       desc: 'View all quotations across the organisation' },
    { to: '/employees',     icon: '👥', title: 'Employee Management', desc: 'Create, edit, and manage team accounts' },
    { to: '/access-rules',  icon: '🔐', title: 'Access Rules',        desc: 'Configure which roles access which tools' },
    { to: '/catalog',       icon: '🚛', title: 'Vehicle Catalog',     desc: 'Manage the AL vehicle price catalog' },
    { to: '/bus-calculator',icon: '🚌', title: 'Bus Calculator',      desc: 'Build a bus price estimate step by step' },
  ],
}

const ROLE_LABEL = {
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
  const { profile } = useAuth()
  if (!profile) return null

  const tools = ROLE_TOOLS[profile.role] || []

  // Add bus calculator for sales/back_office with bus vertical
  const showBus =
    (profile.role === 'sales' || profile.role === 'back_office') &&
    profile.vertical?.toLowerCase().includes('bus')

  const allTools = showBus
    ? [...tools, { to: '/bus-calculator', icon: '🚌', title: 'Bus Calculator', desc: 'Build a bus price estimate step by step' }]
    : tools

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1>{greeting()}, {profile.full_name.split(' ')[0]} 👋</h1>
        <p>
          {ROLE_LABEL[profile.role]}
          {profile.department ? ` · ${profile.department}` : ''}
          {profile.location   ? ` · ${profile.location}` : ''}
          {profile.entity     ? ` · ${profile.entity}` : ''}
        </p>
      </div>

      {/* Tools */}
      <div className="tool-grid">
        {allTools.map(tool => (
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
