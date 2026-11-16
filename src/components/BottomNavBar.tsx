import { Download, Home, Search, User } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

export type MobileNavTab = 'home' | 'search' | 'downloads' | 'profile';

interface BottomNavBarProps {
  activeTab: MobileNavTab;
  onSelectHome: () => void;
  onSelectSearch: () => void;
  onSelectDownloads: () => void;
  onSelectProfile: () => void;
}

export function BottomNavBar({
  activeTab,
  onSelectHome,
  onSelectSearch,
  onSelectDownloads,
  onSelectProfile,
}: BottomNavBarProps) {
  const { t } = useLanguage();

  const tabs: Array<{
    id: MobileNavTab;
    label: string;
    icon: typeof Home;
    onClick: () => void;
  }> = [
    { id: 'home', label: t('navHome'), icon: Home, onClick: onSelectHome },
    { id: 'search', label: t('navSearch'), icon: Search, onClick: onSelectSearch },
    { id: 'downloads', label: t('navDownloads'), icon: Download, onClick: onSelectDownloads },
    { id: 'profile', label: t('navProfile'), icon: User, onClick: onSelectProfile },
  ];

  return (
    <nav
      aria-label="Mobile navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[#27272A] bg-[#09090B]/95 backdrop-blur-md"
    >
      <div className="grid grid-cols-4 items-center h-16 max-w-xl mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={tab.onClick}
              aria-current={active ? 'page' : undefined}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                active ? 'text-[#E5A93B]' : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
              }`}
            >
              <Icon
                className={`h-5 w-5 ${active && tab.id === 'home' ? 'fill-[#E5A93B]/20' : ''}`}
                aria-hidden="true"
              />
              <span className="text-[11px] font-medium tracking-tight leading-none">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
