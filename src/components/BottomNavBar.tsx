import type { ComponentType } from 'react';
import { Download, Gamepad2, MessageSquare, Search, User } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { TempleNavHomeIcon } from './TempleLogo';

export type MobileNavTab = 'home' | 'search' | 'downloads' | 'games' | 'lounge' | 'profile';

interface BottomNavBarProps {
  activeTab: MobileNavTab;
  activeDownloadsCount?: number;
  onSelectHome: () => void;
  onSelectSearch: () => void;
  onSelectDownloads: () => void;
  onSelectGames: () => void;
  onSelectLounge: () => void;
  onSelectProfile: () => void;
}

export function BottomNavBar({
  activeTab,
  activeDownloadsCount = 0,
  onSelectHome,
  onSelectSearch,
  onSelectDownloads,
  onSelectGames,
  onSelectLounge,
  onSelectProfile,
}: BottomNavBarProps) {
  const { t } = useLanguage();

  const tabs: Array<{
    id: MobileNavTab;
    label: string;
    icon: ComponentType<{ className?: string }>;
    onClick: () => void;
  }> = [
    { id: 'home', label: t('navHome'), icon: TempleNavHomeIcon, onClick: onSelectHome },
    { id: 'search', label: t('navSearch'), icon: Search, onClick: onSelectSearch },
    { id: 'downloads', label: t('navDownloads'), icon: Download, onClick: onSelectDownloads },
    { id: 'games', label: 'Games', icon: Gamepad2, onClick: onSelectGames },
    { id: 'lounge', label: t('navLounge'), icon: MessageSquare, onClick: onSelectLounge },
    { id: 'profile', label: t('navProfile'), icon: User, onClick: onSelectProfile },
  ];

  return (
    <nav
      aria-label="Mobile navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[#27272A] bg-[#0A0A0C]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] touch-manipulation"
    >
      <div className="grid grid-cols-6 items-center h-16 max-w-xl mx-auto px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={tab.onClick}
              aria-current={active ? 'page' : undefined}
              className={`relative min-h-[44px] min-w-0 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                active ? 'text-[#E6A93C]' : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
              }`}
            >
              <span className="relative">
                <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                {tab.id === 'downloads' && activeDownloadsCount > 0 && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#E6A93C] px-1 font-mono text-[9px] font-bold text-[#0A0A0C]">
                    {activeDownloadsCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium tracking-tight leading-none max-w-full truncate px-0.5">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
