import {
  Article,
  ChartBar,
  ClockCounterClockwise,
  Fire,
  FolderOpen,
  House,
  ImageSquare,
  Lightbulb,
  PaperPlaneTilt,
  Sparkle,
  TextAa,
  VideoCamera,
} from '@phosphor-icons/react'
import type { ComponentType } from 'react'

export type PageId =
  | 'home'
  | 'create'
  | 'graphic'
  | 'assets'
  | 'analytics'
  | 'publish'
  | 'inspiration'
  | 'history'
  | 'settings'

export type StudioId = 'article' | 'image' | 'video' | 'headline' | 'marketing' | 'xiaohongshu' | 'graphic'

export type IconComponent = ComponentType<{
  size?: number | string
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
  'aria-hidden'?: boolean | 'true' | 'false'
}>

export interface NavItem {
  id: PageId
  label: string
  icon: IconComponent
}

export interface QuickAction {
  id: StudioId
  title: string
  description: string
  icon: IconComponent
  category: string
  art: 'river' | 'court' | 'blossom' | 'night'
}

export const navigation: NavItem[] = [
  { id: 'home', label: '首页', icon: House },
  { id: 'create', label: 'AI 创作', icon: Sparkle },
  { id: 'graphic', label: '公众号创作', icon: Article },
  { id: 'assets', label: '素材库', icon: FolderOpen },
  { id: 'analytics', label: '数据分析', icon: ChartBar },
  { id: 'publish', label: '发布管理', icon: PaperPlaneTilt },
  { id: 'inspiration', label: '灵感中心', icon: Lightbulb },
  { id: 'history', label: '创作记录', icon: ClockCounterClockwise },
]

export const quickActions: QuickAction[] = [
  {
    id: 'article',
    title: 'AI 文章生成',
    description: '一键生成高质量文章',
    icon: Article,
    category: '文章创作',
    art: 'court',
  },
  {
    id: 'image',
    title: 'AI 图片生成',
    description: '描述即出精美画面',
    icon: ImageSquare,
    category: '图片生成',
    art: 'river',
  },
  {
    id: 'video',
    title: 'AI 视频生成',
    description: '功能预览，暂未开放',
    icon: VideoCamera,
    category: '视频创作',
    art: 'night',
  },
  {
    id: 'headline',
    title: '爆款标题',
    description: '轻松打造高点击标题',
    icon: Fire,
    category: '热门推荐',
    art: 'blossom',
  },
  {
    id: 'marketing',
    title: '营销文案',
    description: '聚焦卖点与行动号召',
    icon: TextAa,
    category: '营销文案',
    art: 'court',
  },
  {
    id: 'xiaohongshu',
    title: '小红书笔记',
    description: '自然口吻与结构化种草',
    icon: Sparkle,
    category: '小红书笔记',
    art: 'river',
  },
]

export const categoryPills = [
  '热门推荐',
  '文章创作',
  '图片生成',
  '视频创作',
  '营销文案',
  '小红书笔记',
]

export const inspirations = [
  {
    eyebrow: '春日灵感',
    title: '春日花影，古风美文',
    description: '描绘一幅唯美的春日画卷，融合落樱、楼阁与微风的东方诗意。',
    art: 'blossom' as const,
  },
  {
    eyebrow: '品牌灵感',
    title: '把产品故事拍成一幕电影',
    description: '从人物、冲突与转折出发，为品牌构建可传播的短片叙事。',
    art: 'night' as const,
  },
  {
    eyebrow: '城市灵感',
    title: '一座城的清晨与烟火',
    description: '用生活化镜头描绘城市醒来的片刻，适合作为纪录短片提案。',
    art: 'river' as const,
  },
]

export const templates = [
  { title: '春日限定', subtitle: '诗意文案', art: 'blossom' as const },
  { title: '国风山水', subtitle: '大气排版', art: 'river' as const },
  { title: '古风写真', subtitle: '唯美散文', art: 'portrait' as const },
  { title: '东方意境', subtitle: '情感文案', art: 'court' as const },
  { title: '花开有期', subtitle: '治愈文章', art: 'night' as const },
]

export const pageMeta: Record<PageId, { title: string; description: string }> = {
  home: { title: '首页', description: '创作入口、灵感与模板' },
  create: { title: 'AI 创作', description: '选择适合内容目标的创作方式' },
  graphic: { title: '公众号创作', description: '多页图文分镜工作台' },
  assets: { title: '素材库', description: '统一管理图片、文字、提示词与文件' },
  analytics: { title: '数据分析', description: '查看本地创作趋势与类型分布' },
  publish: { title: '发布管理', description: '整理待发布内容与本地导出记录' },
  inspiration: { title: '灵感中心', description: '从主题池快速进入创作' },
  history: { title: '创作记录', description: '搜索、恢复与继续编辑本地内容' },
  settings: { title: '设置中心', description: '配置模型、存储、主题与模板' },
}
