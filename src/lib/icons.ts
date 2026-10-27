// 화면에서 쓰는 아이콘 모음 (lucide). 브랜드 로고는 lucide에 없어서 직접 그렸어요.
export {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bold,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Clock,
  ClockFading,
  Code,
  Copy,
  CornerDownRight,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Files,
  Globe,
  Hash,
  Heading2,
  Highlighter,
  Image,
  ImagePlus,
  Inbox,
  Info,
  KeyRound,
  LayoutDashboard,
  Link,
  ListChecks,
  ListTodo,
  LogOut,
  Mail,
  MessageCircle,
  MessageSquare,
  Minus,
  MonitorSmartphone,
  Moon,
  PanelRight,
  Pencil,
  PenLine,
  Plus,
  Quote,
  RotateCcw,
  Rss,
  Save,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  SquarePen,
  Sun,
  Table,
  Tags,
  Trash,
  Upload,
  X,
} from 'lucide';

export type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

export const GithubIcon: IconNode = [
  [
    'path',
    {
      d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
    },
  ],
  ['path', { d: 'M9 18c-4.51 2-5-2-7-2' }],
];

export const InstagramIcon: IconNode = [
  ['rect', { x: 2, y: 2, width: 20, height: 20, rx: 5.5 }],
  ['circle', { cx: 12, cy: 12, r: 4.2 }],
  ['circle', { cx: 17.6, cy: 6.4, r: 0.6, fill: 'currentColor' }],
];

export const YoutubeIcon: IconNode = [
  [
    'path',
    {
      d: 'M2.5 17a24.1 24.1 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.6 49.6 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.1 24.1 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.6 49.6 0 0 1-16.2 0A2 2 0 0 1 2.5 17',
    },
  ],
  ['path', { d: 'm10 15 5-3-5-3z' }],
];

export const XBrandIcon: IconNode = [
  ['path', { d: 'M4 4l6.6 8.8L4.3 20H6l5.4-6.1L16 20h4l-7-9.3L18.9 4h-1.7l-5 5.7L8 4z', fill: 'currentColor', stroke: 'none' }],
];
