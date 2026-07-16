/* Icon — thin wrapper over lucide-react (Phase 9.6 print-report redesign).
   Named icons are imported (tree-shaken) and referenced by a stable semantic
   name, so nav configs / pages say <Icon name="truck" /> instead of an emoji.
   Thin 1.6px stroke matches the brand's hairline rules; color = currentColor. */
import {
  LayoutDashboard, FileText, Files, Landmark, Users, Shield, Truck, Bus,
  TrendingUp, Wrench, ChevronDown, ChevronRight, ChevronLeft, ChevronUp,
  User, LogOut, Search, Eye, EyeOff, Plus, Download, Upload, ExternalLink,
  ArrowRight, ArrowLeft, ArrowUp, ArrowDown, Menu, X, Check, CheckCircle2,
  Pencil, Trash2, SlidersHorizontal, Printer, Undo2, AlertTriangle, Clock,
  BarChart3, Folder, RotateCcw, Settings, Lock, Mail, Calendar, Filter,
  Building2, Info, CircleAlert, ClipboardList, RefreshCw,
} from 'lucide-react';

/* Semantic name → Lucide component. Keep names aligned with the prototype's
   icon set (shell.jsx `P`) plus what the pages need. */
export const ICONS = {
  dashboard: LayoutDashboard,
  file: FileText,
  files: Files,
  landmark: Landmark,
  users: Users,
  shield: Shield,
  truck: Truck,
  bus: Bus,
  trending: TrendingUp,
  wrench: Wrench,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-left': ChevronLeft,
  'chevron-up': ChevronUp,
  user: User,
  logout: LogOut,
  search: Search,
  eye: Eye,
  'eye-off': EyeOff,
  plus: Plus,
  download: Download,
  upload: Upload,
  external: ExternalLink,
  'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  menu: Menu,
  x: X,
  check: Check,
  'check-circle': CheckCircle2,
  edit: Pencil,
  trash: Trash2,
  filter: SlidersHorizontal,
  'filter-alt': Filter,
  printer: Printer,
  undo: Undo2,
  alert: AlertTriangle,
  clock: Clock,
  chart: BarChart3,
  folder: Folder,
  refresh: RotateCcw,
  'refresh-cw': RefreshCw,
  settings: Settings,
  lock: Lock,
  mail: Mail,
  calendar: Calendar,
  building: Building2,
  info: Info,
  'alert-circle': CircleAlert,
  clipboard: ClipboardList,
};

export default function Icon({
  name,
  size = 18,
  strokeWidth = 1.6,
  className,
  style,
  color = 'currentColor',
  ...rest
}) {
  const Cmp = ICONS[name];
  if (!Cmp) {
    if (import.meta.env?.DEV) console.warn(`<Icon> unknown name: "${name}"`);
    return null;
  }
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      className={className}
      style={{ flex: '0 0 auto', ...style }}
      aria-hidden="true"
      {...rest}
    />
  );
}
