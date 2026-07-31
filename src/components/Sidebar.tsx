import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  BookOpen,
  Library,
  Microscope,
  Bot,
  Camera,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Tooltip } from './ui/Tooltip';
import { useAppUpdate } from '../hooks/useAppUpdate';

export interface SidebarProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userAvatar: string;
  setUserAvatar: (avatar: string) => void;
  userName: string;
  setUserName: (name: string) => void;
  userRole: string;
  setUserRole: (role: string) => void;
  setIsSettingsOpen: (open: boolean) => void;
}

export function Sidebar({
  isSidebarOpen,
  setIsSidebarOpen,
  activeTab,
  setActiveTab,
  userAvatar,
  setUserAvatar,
  userName,
  setUserName,
  userRole,
  setUserRole,
  setIsSettingsOpen,
}: SidebarProps) {
  const { t } = useTranslation();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const isLogoAvatar = userAvatar.includes('LOGO');
  // 直接订阅 store，不走 props：这个状态还要给设置页的更新卡片用
  const { phase: updatePhase } = useAppUpdate();
  const hasUpdate = updatePhase === 'available' || updatePhase === 'ready';
  const toggleLabel = isSidebarOpen ? t('sidebar.collapse') : t('sidebar.expand');

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setUserAvatar(event.target.result as string);
        }
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  return (
    <aside className={`hidden md:flex flex-col py-6 space-y-2 bg-app-surface-subtle h-full min-h-0 shrink-0 border-r border-app-border transition-all duration-300 overflow-y-auto scrollbar-hide ${isSidebarOpen ? 'w-48' : 'w-20 items-center'}`}>

      <div className="mb-6 px-4">
        <div className={`flex flex-col ${isSidebarOpen ? 'items-start' : 'items-center'} gap-2`}>
          <div className="flex items-center gap-3 w-full group relative">
            <input 
              type="file" 
              ref={avatarInputRef} 
              onChange={handleAvatarChange} 
              accept="image/*" 
              className="hidden" 
            />
            <div 
              onClick={() => avatarInputRef.current?.click()}
              className={`relative cursor-pointer group/avatar flex-shrink-0 flex items-center justify-center overflow-hidden rounded ${isSidebarOpen ? 'w-6' : 'w-10'}`}
            >
              <img 
                alt={t('sidebar.avatar_alt')}
                className={`rounded border-2 border-app-border object-cover shadow-sm transition-all group-hover/avatar:opacity-80 ${isLogoAvatar ? 'scale-[1.45]' : ''} ${isSidebarOpen ? 'w-6 h-6' : 'w-10 h-10'}`} 
                src={userAvatar}
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity bg-black/20 rounded">
                <Camera className="w-3 h-3 text-white" />
              </div>
            </div>
            {isSidebarOpen && (
              <p 
                contentEditable 
                suppressContentEditableWarning
                onBlur={(e) => setUserName(e.currentTarget.innerText)}
                className="text-base font-bold whitespace-nowrap tracking-tight outline-none hover:bg-app-surface-sunken/50 rounded px-1 -mx-1 transition-colors cursor-text overflow-hidden text-ellipsis"
              >
                {userName}
              </p>
            )}
          </div>
          {isSidebarOpen && (
            <p 
              contentEditable 
              suppressContentEditableWarning
              onBlur={(e) => setUserRole(e.currentTarget.innerText)}
              className="text-[10px] font-sans uppercase tracking-widest text-app-text-faint whitespace-nowrap outline-none hover:bg-app-surface-sunken/50 rounded px-1 -mx-1 transition-colors cursor-text"
            >
              {userRole}
            </p>
          )}
        </div>
      </div>
      <nav className="flex flex-col font-sans text-sm w-full">
        {isSidebarOpen && <div className="px-4 py-2 text-app-text-faint text-[11px] tracking-wider mb-2">{t('sidebar.nav_heading')}</div>}
        <a onClick={(e) => { e.preventDefault(); setActiveTab('personal'); }} className={`cursor-pointer flex items-center ${isSidebarOpen ? 'gap-3 px-4' : 'justify-center'} py-2 ${activeTab === 'personal' ? 'bg-app-surface-raised border-y border-app-border text-app-accent' : 'text-app-text-muted hover:bg-app-surface-sunken transition-colors'}`}>
          <BookOpen className="w-4 h-4 flex-shrink-0" />
          {isSidebarOpen && <span>{t('sidebar.personal')}</span>}
        </a>
        <a onClick={(e) => { e.preventDefault(); setActiveTab('reference'); }} className={`cursor-pointer flex items-center ${isSidebarOpen ? 'gap-3 px-4' : 'justify-center'} py-2 ${activeTab === 'reference' ? 'bg-app-surface-raised border-y border-app-border text-app-accent' : 'text-app-text-muted hover:bg-app-surface-sunken transition-colors'}`}>
          <Library className="w-4 h-4 flex-shrink-0" />
          {isSidebarOpen && <span>{t('sidebar.reference')}</span>}
        </a>
        <a onClick={(e) => { e.preventDefault(); setActiveTab('lab'); }} className={`cursor-pointer flex items-center ${isSidebarOpen ? 'gap-3 px-4' : 'justify-center'} py-2 ${activeTab === 'lab' ? 'bg-app-surface-raised border-y border-app-border text-app-accent' : 'text-app-text-muted hover:bg-app-surface-sunken transition-colors'}`}>
          <Microscope className="w-4 h-4 flex-shrink-0" />
          {isSidebarOpen && <span>{t('sidebar.lab')}</span>}
        </a>
        <a onClick={(e) => { e.preventDefault(); setActiveTab('agents'); }} className={`cursor-pointer flex items-center ${isSidebarOpen ? 'gap-3 px-4' : 'justify-center'} py-2 ${activeTab === 'agents' ? 'bg-app-surface-raised border-y border-app-border text-app-accent' : 'text-app-text-muted hover:bg-app-surface-sunken transition-colors'}`}>
          <Bot className="w-4 h-4 flex-shrink-0" />
          {isSidebarOpen && <span>{t('sidebar.agents')}</span>}
        </a>
      </nav>
      <div className="mt-auto px-4 pb-4 w-full flex flex-col gap-1">
        {/* 收起时只剩图标，靠悬停提示说明；展开时文案已经写在按钮上，再弹提示是噪音。 */}
        <Tooltip label={toggleLabel} disabled={isSidebarOpen}>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsSidebarOpen(!isSidebarOpen); }}
            className={`w-full flex items-center ${isSidebarOpen ? 'gap-3' : 'justify-center'} py-2 text-app-text-faint hover:text-app-text hover:bg-app-surface-sunken transition-colors rounded-lg group/toggle`}
            aria-label={toggleLabel}
          >
            <div className={`flex items-center justify-center ${isSidebarOpen ? 'w-6' : 'w-10'}`}>
              {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5 transition-transform group-hover/toggle:translate-x-0.5" />}
            </div>
            {isSidebarOpen && <span className="whitespace-nowrap">{toggleLabel}</span>}
          </button>
        </Tooltip>
        <Tooltip
          label={hasUpdate ? t('sidebar.settings_update_available') : t('sidebar.settings')}
          disabled={isSidebarOpen}
        >
          <button
            onClick={() => setIsSettingsOpen(true)}
            className={`w-full flex items-center ${isSidebarOpen ? 'gap-3' : 'justify-center'} py-2 text-app-text-muted hover:bg-app-surface-sunken transition-colors rounded-lg group/settings`}
            aria-label={hasUpdate ? t('sidebar.settings_update_available') : t('sidebar.settings')}
          >
            <div className={`relative flex items-center justify-center ${isSidebarOpen ? 'w-6' : 'w-10'}`}>
              <Settings className={`w-4 h-4 flex-shrink-0 transition-transform group-hover/settings:rotate-45`} />
              {/* 启动自检发现新版本时挂个点，不弹窗打断 */}
              {hasUpdate && (
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-app-accent ring-2 ring-app-surface"
                />
              )}
            </div>
            {isSidebarOpen && <span className="whitespace-nowrap">{t('sidebar.settings')}</span>}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
